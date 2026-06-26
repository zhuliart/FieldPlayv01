import { Container, Sprite, Graphics, Texture } from 'pixi.js';
import { PLANT_SIZE, PLANT_SIZE_DEFAULT, CROP_BOTTOM } from '../data/crops';
import { STAGE_H } from '../data/baseCorners';
import { sceneLum, type WeatherType } from '../data/scenes';
import { getQuad, plantHash, pctX, pctY } from '../sim/layout';
import { DRY_DEATH, type World } from '../sim/world';
import type { PlantAtlas } from '../core/assets';

interface SpriteRec {
  sprite: Sprite;
  sprite2: Sprite; // 下一阶段贴图（按阶段内进度 frac 交叉淡入，平滑形态过渡、消除突变）
  plotId: number;
  slotIdx: number;
  depth: number;
  sizeJit: number;
  restAng: number;
  pdepPct: number;
  // 倒伏随机参数（移植原型 hash(1..4)）：方向 / 占比·延迟 / 最大角 / 倒速
  r1: number;
  r2: number;
  r3: number;
  r4: number;
  curLodge: number; // 当前倒伏角（平滑逼近目标）
  colorVar: number; // 每株自然色彩随机（乘法 tint）：有的更红/橙、有的偏黄绿
}

// 地块层：12 个可点多边形（点击=浇水）+ 全田作物精灵（共享图集 → 合批）。
// 含逐项移植的「倒伏（lodging）随机机制」与「应激滤镜（旱黄/冻蓝/涝暗/枯褐/过熟褪色）」。
export class Field {
  readonly view = new Container();
  private cropLayer = new Container();
  private hitLayer = new Container();
  private recs: SpriteRec[] = [];
  private weedTypes: Texture[][] = []; // 每类杂草一组阶段贴图（阶段数可不同）
  private habitats: ('both' | 'wild')[] = []; // 习性：both=田/野皆有，wild=主要野地
  private bothTypes: number[] = []; // habitat==='both' 的类型索引（田内杂草只用这些）
  private weedRecs: { sprite: Sprite; plotId: number; order: number; stages: Texture[]; targetH: number; cur: number }[] = [];
  // 野地杂草：田块之外(田埂/路边/前景空地)按自然习性长草，不翻耕/不被田务清除；贴巡田路(onPath)者被经过的机器人压除
  private wildRecs: { sprite: Sprite; stages: Texture[]; targetH: number; cur: number; onPath: boolean; prog: number }[] = [];
  private actor: Container | null = null; // 机器人机身（放进作物层做深度排序；重建时需保留）

  constructor(private atlas: PlantAtlas, weedTypes: Texture[][], habitats: ('both' | 'wild')[], private onPlotTap: (plotId: number) => void) {
    this.weedTypes = weedTypes;
    this.habitats = habitats;
    this.bothTypes = weedTypes.map((_, i) => i).filter((i) => (this.habitats[i] ?? 'both') === 'both');
    if (this.bothTypes.length === 0) this.bothTypes = weedTypes.map((_, i) => i); // 兜底：无 both 类则田内用全部
    this.cropLayer.sortableChildren = true; // 作物 + 杂草 + 机器人机身 共用此层，按 y 纵深统一排序
    this.view.addChild(this.cropLayer);
    this.view.addChild(this.hitLayer);
  }

  /** 把"演员"(机器人机身)放进作物层，按 zIndex=y 与作物一起纵深排序 → 走到更靠前高作物后会被遮挡（真实 2.5D）。 */
  addActor(c: Container): void {
    this.actor = c;
    this.cropLayer.addChild(c);
  }

  buildHitAreas() {
    this.hitLayer.removeChildren();
    for (let id = 0; id < 12; id++) {
      const q = getQuad(id);
      const pts: number[] = [];
      for (const c of q) pts.push(pctX(c[0]), pctY(c[1]));
      const g = new Graphics();
      g.poly(pts).fill({ color: 0xffffff, alpha: 0.0001 });
      g.eventMode = 'static';
      g.cursor = 'pointer';
      g.on('pointertap', () => this.onPlotTap(id));
      this.hitLayer.addChild(g);
    }
  }

  rebuild(world: World) {
    this.cropLayer.removeChildren();
    if (this.actor) this.cropLayer.addChild(this.actor); // 重建作物时保留机身，否则被 removeChildren 清掉→机器人消失
    this.recs = [];
    this.weedRecs = [];
    for (const p of world.plots) {
      const q = getQuad(p.id);
      const pdepPct = Math.abs(q[2][1] - q[0][1]) || 1;
      p.slots.forEach((sl, idx) => {
        const mk = () => {
          const s = new Sprite(this.atlas.get(`plant_${sl.crop}_s1`));
          s.anchor.set(0.5, 0.68);
          s.position.set(pctX(sl.pt.x), pctY(sl.pt.y));
          s.zIndex = sl.pt.y; // 近(下)在前
          this.cropLayer.addChild(s);
          return s;
        };
        const sprite = mk();  // 当前阶段（下层）
        const sprite2 = mk(); // 下一阶段（上层，交叉淡入）
        this.recs.push({
          sprite,
          sprite2,
          plotId: p.id,
          slotIdx: idx,
          depth: sl.pt.depth,
          sizeJit: 0.84 + plantHash(p.id, idx, 11) * 0.34,
          restAng: (plantHash(p.id, idx, 12) - 0.5) * 16,
          pdepPct,
          r1: plantHash(p.id, idx, 1),
          r2: plantHash(p.id, idx, 2),
          r3: plantHash(p.id, idx, 3),
          r4: plantHash(p.id, idx, 4),
          curLodge: 0,
          colorVar: makeColorVar(p.id, idx),
        });
      });
      // 杂草：每地块预置 ~12 株（随机位置/类型，写实三阶段贴图），随 weedProg 逐株出现、换阶段(幼→中→熟)并长大（蔓延）
      for (let k = 0; this.weedTypes.length > 0 && k < 12; k++) {
        const wpt = quadPoint(q, 0.1 + plantHash(p.id, k, 21) * 0.8, 0.12 + plantHash(p.id, k, 22) * 0.76);
        const type = this.bothTypes[Math.floor(plantHash(p.id, k, 23) * this.bothTypes.length) % this.bothTypes.length]; // 田内只用「田/野皆有」类
        const stages = this.weedTypes[type]; // [幼苗, 生长, 成熟...]
        const s = new Sprite(stages[0]);
        s.anchor.set(0.5, 0.96);
        s.position.set(pctX(wpt.x), pctY(wpt.y));
        s.zIndex = wpt.y; // 与作物/机身同层按 y 排序 → 身前的杂草遮挡机器人底部，身后的在其后
        s.visible = false;
        this.cropLayer.addChild(s);
        const depthScale = 0.6 + (wpt.y / 100) * 0.7; // 近大远小
        const sizeJit = 0.8 + plantHash(p.id, k, 24) * 0.5;
        const targetH = 34 * depthScale * sizeJit; // 成熟期目标高度(px)：小而朴素的地面杂草
        this.weedRecs.push({ sprite: s, plotId: p.id, order: k, stages, targetH, cur: -1 });
      }
    }
    this.buildWildWeeds(world);
  }

  // 野地杂草：在田块之外的地面(田埂/路边/前景空地)按自然习性散布长草。位置避开所有田块四边形，
  // 限定在地面带(纵向 50~99%，避开远山/天空)。贴近巡田路网节点者标 onPath → 经过的机器人会压除。
  private buildWildWeeds(world: World) {
    this.wildRecs = [];
    if (this.weedTypes.length === 0) return;
    const quads = Array.from({ length: 12 }, (_, i) => getQuad(i));
    const nodes = world.roadNet?.nodes ?? [];
    const edges = world.roadNet?.edges ?? [];
    const TARGET = 80;
    let placed = 0;
    for (let a = 1; placed < TARGET && a < TARGET * 8; a++) {
      const gx = 1 + wildHash(a, 1) * 98;   // 横向 1..99 %
      const gy = 50 + wildHash(a, 2) * 49;  // 纵向 50..99 %（地面带）
      if (quads.some((q) => pointInQuad(gx, gy, q))) continue; // 落在田块内→留给田内杂草
      // onPath：到任一巡田路边(节点连线段)够近 → 长在机器人巡田路上，会被经过的机器人拔/压除
      let onPath = false;
      for (const [ia, ib] of edges) {
        const A = nodes[ia], B = nodes[ib];
        if (A && B && distToSeg(gx, gy, A.left, A.top, B.left, B.top) < 3.5) { onPath = true; break; }
      }
      const wt = this.weedTypes.length;
      const type = Math.floor(wildHash(a, 3) * wt) % wt; // 野地用全部类型（含仅野地的 wild 类）
      const stages = this.weedTypes[type];
      const s = new Sprite(stages[0]);
      s.anchor.set(0.5, 0.96);
      s.position.set(pctX(gx), pctY(gy));
      s.zIndex = gy; // 与作物/机身同层按 y 纵深排序
      s.visible = false;
      this.cropLayer.addChild(s);
      const depthScale = 0.55 + (gy / 100) * 0.85;
      const sizeJit = 0.75 + wildHash(a, 4) * 0.7;
      const targetH = 40 * depthScale * sizeJit; // 野地草比田内(34)略高
      // 初始成熟度参差(野地本就长期无人打理)；onPath 的起步低些(常被压)
      const prog = onPath ? wildHash(a, 6) * 18 : 12 + wildHash(a, 6) * 64;
      this.wildRecs.push({ sprite: s, stages, targetH, cur: -1, onPath, prog });
      placed++;
    }
  }

  update(world: World, dtMS: number) {
    const wx = world.weather.type as WeatherType;
    const lum = world.toggles.cropRelight
      ? sceneLum(world.tod, wx, world.weatherIntensity())
      : 1;
    const relight = packGray(0.32 + 0.68 * lum);

    for (const rec of this.recs) {
      const plot = world.plots[rec.plotId];
      const sl = plot?.slots[rec.slotIdx];
      if (!sl) continue;
      const a = rec.sprite, b = rec.sprite2;
      // 收获后翻耕/休耕期：隐藏作物，露出翻耕裸土（收完不再瞬间满田新苗）
      const fallow = sl.fallowMS > 0;
      a.visible = !fallow; b.visible = !fallow;
      if (fallow) continue;

      const growthCont = Math.max(0, Math.min(4, sl.growth / 100));
      const stage = Math.min(4, Math.floor(growthCont));
      const frac = growthCont - stage; // 阶段内进度 0..1
      const upper = Math.min(4, stage + 1);

      // 近大远小 + 随生长连续平滑变大（高度连续，无突变）
      const gScale = 0.4 + 0.6 * (growthCont / 4);
      const sizeBase = PLANT_SIZE[sl.crop] ?? PLANT_SIZE_DEFAULT;
      const hPct = rec.pdepPct * (sizeBase + 0.18 * rec.depth) * rec.sizeJit * gScale;
      const heightPx = (hPct / 100) * STAGE_H;

      // 交叉淡入：下层=当前阶段(alpha 1)，上层=下一阶段(alpha=frac) → 形态平滑过渡，消除"突然变样/突然变大"
      a.texture = this.atlas.get(`plant_${sl.crop}_s${stage + 1}`);
      a.anchor.set(0.5, CROP_BOTTOM[sl.crop][stage] ?? 0.68);
      a.scale.set(heightPx / (a.texture.height || 1));
      b.texture = this.atlas.get(`plant_${sl.crop}_s${upper + 1}`);
      b.anchor.set(0.5, CROP_BOTTOM[sl.crop][upper] ?? 0.68);
      b.scale.set(heightPx / (b.texture.height || 1));

      // —— 倒伏（lodging）：受灾/缺水/过熟/死亡 → bend，方向/幅度/速度/延迟各株不同（两层同步）——
      const wsev = wx === 'rain' ? sl.flood : wx === 'drought' ? sl.parch : wx === 'frost' ? sl.frost : 0;
      let bend = 0;
      if (wsev > 0) bend = Math.max(bend, Math.min(1, wsev / 4));
      if (!sl.dead && stage < 4 && sl.dry > 0) {
        const thr = DRY_DEATH[stage] || 5;
        bend = Math.max(bend, Math.min(0.9, sl.dry / thr));
      }
      if (!sl.dead && sl.growth >= 400) {
        const ag = Math.max(0, sl.age - 5);
        if (ag > 0) bend = Math.max(bend, Math.min(0.65, ag / 11));
      }
      if (sl.dead) bend = Math.max(bend, sl.deathKind === 'frozen' ? 0.78 : 0.96);

      let targetLodge = 0;
      if (bend > 0.002) {
        const sgn = rec.r1 < 0.5 ? -1 : 1;
        const amt = 0.4 + 0.6 * rec.r2;
        const mag = bend * (sl.dead ? 46 + rec.r2 * 34 : 24 + rec.r3 * 30);
        targetLodge = sgn * amt * mag + (rec.r3 - 0.5) * 18;
      }
      // 每株倒速 0.85–2.75s（hash4），平滑逼近
      const durMS = (0.85 + rec.r4 * 1.9) * 1000;
      rec.curLodge += (targetLodge - rec.curLodge) * Math.min(1, dtMS / durMS);
      const rot = ((rec.restAng + rec.curLodge) * Math.PI) / 180;
      a.rotation = rot; b.rotation = rot;

      // —— 应激滤镜（tint 近似，不破合批）：旱黄 / 冻蓝 / 涝暗 / 枯褐 / 过熟褪色 ——
      let stress = 0xffffff;
      if (sl.dead) {
        stress = sl.deathKind === 'frozen' ? 0x9fb1d0 : sl.deathKind === 'rot' ? 0x5c6b46 : 0x6f5530;
      } else if (sl.growth >= 400 && sl.age > 5) {
        stress = lerpColor(0xffffff, 0xc9a85a, Math.min(1, (sl.age - 5) / 11) * 0.7);
      } else if (stage < 4) {
        if (wx === 'drought' && (sl.parch > 0 || sl.dry > 0)) stress = 0xe6cb5e;
        else if (wx === 'frost' && sl.frost > 0) stress = 0xbcd6f2;
        else if (wx === 'rain' && sl.flood > 0) stress = 0x9fb58e;
        if (sl.dry > 0) {
          const thr = DRY_DEATH[stage] || 5;
          stress = lerpColor(stress, 0xd8b84a, Math.min(1, sl.dry / thr) * 0.7);
        }
      }
      const tint = multiplyColor(multiplyColor(relight, stress), rec.colorVar);
      a.tint = tint; b.tint = tint;
      a.alpha = 1;
      // 上层(下一阶段)仅在每阶段最后 30% 才淡入 → 其余 70% 完全只显当前阶段(不透明)，
      // 消除"整株半透明"观感（此前 alpha=frac 让上层贴图常年半透叠在下层上，露出背景而发虚）。
      b.alpha = stage >= 4 ? 0 : Math.max(0, (frac - 0.7) / 0.3);
    }

    // —— 杂草：按地块 weedProg 逐株出现(蔓延)，按生长进度换阶段贴图(幼→中→熟)并连续长高；跟随昼夜明暗 ——
    for (const wr of this.weedRecs) {
      const plot = world.plots[wr.plotId];
      if (!plot) { wr.sprite.visible = false; continue; }
      const wp = plot.weedProg;
      const appearAt = wr.order * 7 + 6; // 越靠后的草越晚冒出 → 视觉上"蔓延"
      if (wp <= appearAt) { wr.sprite.visible = false; continue; }
      wr.sprite.visible = true;
      const grow = Math.min(1, (wp - appearAt) / 30); // 0..1 该株生长进度
      const n = wr.stages.length;                         // 各类阶段数可不同（weed_8 为 4 阶段含开花）
      const wstage = Math.min(n - 1, Math.floor(grow * n)); // 按阶段数均分生长进度，逐阶换贴图
      if (wr.cur !== wstage) { wr.sprite.texture = wr.stages[wstage]; wr.cur = wstage; }
      // 屏上高度连续(0.42→1.0×targetH)，除以当前阶段贴图实高 → 换阶段不跳高，只换形态细节
      const h = wr.targetH * (0.42 + 0.58 * grow);
      wr.sprite.scale.set(h / (wr.stages[wstage].height || 1));
      wr.sprite.tint = relight;
    }

    // —— 野地杂草：野地无人打理 → 常年自然生长到成熟；贴巡田路(onPath)且机器人在近旁 → 被经过的机器人压除/拔掉 ——
    const rob = this.actor && this.actor.visible && this.actor.x > 0 ? this.actor : null;
    for (const wr of this.wildRecs) {
      const near = !!(rob && wr.onPath) && Math.hypot(rob!.x - wr.sprite.x, rob!.y - wr.sprite.y) < 50;
      if (near) wr.prog = Math.max(0, wr.prog - dtMS / 16);   // 机器人经过 → 压除/拔掉(快)
      else wr.prog = Math.min(100, wr.prog + dtMS / 1000);    // 自然生长(约 100s 到成熟)
      if (wr.prog < 4) { wr.sprite.visible = false; continue; }
      wr.sprite.visible = true;
      const grow = wr.prog / 100;
      const n = wr.stages.length;
      const wstage = Math.min(n - 1, Math.floor(grow * n));
      if (wr.cur !== wstage) { wr.sprite.texture = wr.stages[wstage]; wr.cur = wstage; }
      const h = wr.targetH * (0.42 + 0.58 * grow);
      wr.sprite.scale.set(h / (wr.stages[wstage].height || 1));
      wr.sprite.tint = relight;
    }
  }

  get spriteCount(): number {
    return this.recs.length;
  }
}

function packGray(b: number): number {
  const v = Math.max(0, Math.min(255, Math.round(b * 255)));
  return (v << 16) | (v << 8) | v;
}
function lerpColor(a: number, b: number, t: number): number {
  const ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255;
  const br = (b >> 16) & 255, bg = (b >> 8) & 255, bb = b & 255;
  const r = Math.round(ar + (br - ar) * t);
  const g = Math.round(ag + (bg - ag) * t);
  const bl = Math.round(ab + (bb - ab) * t);
  return (r << 16) | (g << 8) | bl;
}
function multiplyColor(a: number, b: number): number {
  const r = (((a >> 16) & 255) * ((b >> 16) & 255)) / 255;
  const g = (((a >> 8) & 255) * ((b >> 8) & 255)) / 255;
  const bl = ((a & 255) * (b & 255)) / 255;
  return (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(bl);
}
// 每株自然色彩随机（乘法 tint，确定性）：约 38% 偏红/橙、40% 偏黄绿、22% 中性微暖 →
// 同一作物里有的更红、有的橙红、有的黄绿，像真实田里的个体差异。
// 在地块四边形(q)内按 (u,v)∈[0,1] 双线性取点（u 横向、v 纵深；q 顺序 TL,TR,BR,BL）
function quadPoint(q: number[][], u: number, v: number): { x: number; y: number } {
  const tx = q[0][0] + (q[1][0] - q[0][0]) * u, ty = q[0][1] + (q[1][1] - q[0][1]) * u;
  const bxp = q[3][0] + (q[2][0] - q[3][0]) * u, byp = q[3][1] + (q[2][1] - q[3][1]) * u;
  return { x: tx + (bxp - tx) * v, y: ty + (byp - ty) * v };
}
// 野地杂草布点的确定性伪随机（与 plantHash 独立，避免强刷位置漂移）
function wildHash(i: number, n: number): number {
  let x = (i * 0x9e3779b1 + n * 0x85ebca77 + 0x27d4eb2f) >>> 0;
  x = Math.imul(x ^ (x >>> 15), 0x2c1b3c6d) >>> 0;
  x = Math.imul(x ^ (x >>> 13), 0x297a2d39) >>> 0;
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}
// 点到线段最短距离（用于判断野草是否长在巡田路边）
function distToSeg(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 > 1e-9 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}
// 点 (px,py) 是否在凸四边形 q 内（顺/逆时针均可：要求各边叉积同号）
function pointInQuad(px: number, py: number, q: number[][]): boolean {
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const a = q[i], b = q[(i + 1) % 4];
    const cross = (b[0] - a[0]) * (py - a[1]) - (b[1] - a[1]) * (px - a[0]);
    if (Math.abs(cross) < 1e-9) continue;
    const s = cross > 0 ? 1 : -1;
    if (sign === 0) sign = s;
    else if (s !== sign) return false;
  }
  return true;
}
function makeColorVar(id: number, idx: number): number {
  const h = plantHash(id, idx, 7); // 0..1 色相倾向
  const s = plantHash(id, idx, 8); // 0..1 强度
  const amt = 0.08 + s * 0.14;     // 0.08..0.22
  let vr = 1, vg = 1, vb = 1;
  if (h > 0.62) { vg = 1 - amt * 0.45; vb = 1 - amt; }            // 偏红/橙：压绿压蓝
  else if (h < 0.4) { vr = 1 - amt * 0.5; vb = 1 - amt * 0.55; }  // 偏黄绿：压红压蓝
  else { vb = 1 - amt * 0.5; }                                    // 中性微暖：略压蓝
  return (Math.round(vr * 255) << 16) | (Math.round(vg * 255) << 8) | Math.round(vb * 255);
}
