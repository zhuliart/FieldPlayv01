import { Container, Sprite, Graphics, Texture, RenderTexture, type Renderer } from 'pixi.js';
import { PLANT_SIZE, PLANT_SIZE_DEFAULT, CROP_BOTTOM, CROPS, type CropKey } from '../data/crops';
import { STAGE_H, STAGE_W } from '../data/baseCorners';
import { sceneLum, type WeatherType } from '../data/scenes';
import { getQuad, plantHash, pctX, pctY } from '../sim/layout';
import { isBgVeg } from '../data/vegMask';
import { DRY_DEATH, type World } from '../sim/world';
import type { PlantAtlas } from '../core/assets';

// 作物代表色（用于种植可视化的预览圈/标记芯）：优先果色、否则叶色
function cropColorOf(crop: CropKey): number {
  const hex = (CROPS[crop]?.fruit || CROPS[crop]?.leaf || '#7ec943').replace('#', '');
  const v = parseInt(hex, 16);
  return Number.isFinite(v) ? v : 0x7ec943;
}

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
  shadow: Sprite;   // 接地软阴影
}

// 野草类型定义（习性分类 + 尺寸层级 + 蔓延形态 + 可生长区域）。由 main.ts 登记表加载贴图后构造。
export interface WeedKind {
  stages: Texture[];                          // 阶段贴图（baby→…→末，已统一画布归一化）
  category: 'field' | 'wild' | 'malignant';   // 田地类 / 野地类 / 恶性类（标签）
  sizeH: number;                              // 成熟目标高(px)：尺寸层级（Yellow Dock 最大≈番茄）
  growSec: number;                            // 野地长到成熟的秒数（各物种不同→错落生长）
  spread: 'patch' | 'single' | 'mix';         // 成片 / 单株 / 皆可
  inField: boolean;                           // 可长在田里
  inWild: boolean;                            // 可长在野地
  onRoad: boolean;                            // 可长在巡田路上
  nearWater: boolean;                         // 喜水（weed_8）
  hasWithered: boolean;                       // 末阶段是否为枯萎帧 → 生长期只到成熟，枯萎期才显末帧
}

// 水源位置（左下角，% 坐标，与 BASE_CORNERS 同系）—— 喜水野草(weed_8)在此成片密生。要挪改这一处即可。
const WATER_SRC = { x: 9, y: 89 };

// 各天气下「定向光强度」(0..1)：晴（含晴夜有月）→ 强投影；阴雨漫射 → 弱投影。
// 接地阴影强度据此对齐背景植物投影（晴夜背景投影也强，故夜里阴影不随亮度变弱）。
const SHADOW_CLEARNESS: Record<string, number> = { clear: 1, drought: 0.95, frost: 0.58, cloudy: 0.28, lightrain: 0.22, rain: 0.12 };

// 野草生命周期时长(ms)：成熟保持 / 枯萎(大幅延长) / 枯死后保留。按所在位置(田/野地/路)不同。
const W_MATURE = 9000, W_MATURE_RND = 16000;
const WITHER_FIELD = 34000, WITHER_OPEN = 38000, WITHER_ROAD = 24000; // 枯萎时长(大幅延长，rule3)
const DEAD_OPEN = 165000, FADE_ROAD = 12000;  // 野地枯株保留极长后原地重生(rule5)；路上枯株淡出(延长)后异地重生(rule5)
// 归一化时各阶段「植株占画布高」比例(与 weed_norm 脚本同公式)。渲染时补偿换阶段的尺寸跳变 → 连续生长无突变。
function stageRel(stage: number, n: number): number {
  return n > 1 ? 0.32 + 0.68 * Math.pow(stage / (n - 1), 0.8) : 1;
}

// 地块层：12 个可点多边形（点击=浇水）+ 全田作物精灵（共享图集 → 合批）。
// 含逐项移植的「倒伏（lodging）随机机制」与「应激滤镜（旱黄/冻蓝/涝暗/枯褐/过熟褪色）」。
export class Field {
  readonly view = new Container();
  private cropLayer = new Container();
  private hitLayer = new Container();
  private shadowLayer = new Container(); // 投影层（作物层之下、背景之上）：野草/作物的接地软阴影
  private shadowTex: Texture;
  private recs: SpriteRec[] = [];
  private kinds: WeedKind[] = [];
  private fieldKinds: number[] = []; // 可长在田里的类型索引
  private wildKinds: number[] = [];  // 可长在野地的类型索引
  private roadKinds: number[] = [];  // 可长在路上的类型索引
  // 田内杂草：随 weedProg 出现，出现后走个体生命周期(生长→成熟→枯萎转黑倒伏)，枯后保留为残株待机器人清枯(rule4)
  private weedRecs: { sprite: Sprite; plotId: number; order: number; appear: number; kind: WeedKind; targetH: number; cur: number; malign: boolean; shadow: Sprite; colorVar: number; restAng: number; growMul: number; life: number; phase: number; hold: number; wither: number; lodge: number }[] = [];
  // 野地杂草：田块外按习性长草，有完整生命周期（生长→成熟→枯萎→原地/异地重生）+ 多样性随机
  private wildRecs: { sprite: Sprite; shadow: Sprite; kind: WeedKind; onPath: boolean; bx: number; by: number; sizeJit: number; colorVar: number; restAng: number; growMul: number; cur: number; life: number; phase: number; hold: number; wither: number; lodge: number; pressed: boolean }[] = [];
  private roadNodes: { left: number; top: number }[] = []; // 供野草异地重生时判定 onPath
  private roadEdges: [number, number][] = [];
  private lastShadowAlpha = 0.3; // 当前接地阴影强度（随天气/昼夜），供全量光影冠层投影同步浓度
  private actor: Container | null = null; // 机器人机身（放进作物层做深度排序；重建时需保留）
  private plantFx = new Graphics(); // 种植可视化：已种点位标记 + 落点预览光标 + 落定脉冲
  private w: World | null = null;   // 缓存最近 world，供指针事件读取（plant 模式判定/选种/株数）
  private previewPt: { x: number; y: number } | null = null; // 落点预览（% 坐标）
  private pulse: { x: number; y: number; t: number } | null = null; // 落定脉冲（%, 剩余 ms）

  constructor(private atlas: PlantAtlas, kinds: WeedKind[], private onPlotTap: (plotId: number, xPct: number, yPct: number) => void) {
    this.kinds = kinds;
    this.fieldKinds = kinds.map((_, i) => i).filter((i) => kinds[i].inField);
    this.wildKinds = kinds.map((_, i) => i).filter((i) => kinds[i].inWild);
    this.roadKinds = kinds.map((_, i) => i).filter((i) => kinds[i].onRoad);
    if (this.fieldKinds.length === 0) this.fieldKinds = kinds.map((_, i) => i); // 兜底
    if (this.wildKinds.length === 0) this.wildKinds = kinds.map((_, i) => i);
    if (this.roadKinds.length === 0) this.roadKinds = this.wildKinds.slice();
    this.shadowTex = makeShadowTexture();
    this.cropLayer.sortableChildren = true; // 作物 + 杂草 + 机器人机身 共用此层，按 y 纵深统一排序
    this.view.addChild(this.shadowLayer); // 投影在最底（背景之上、作物之下）
    this.view.addChild(this.cropLayer);
    this.plantFx.eventMode = 'none';
    this.view.addChild(this.plantFx); // 种植可视化：作物之上、命中层之下（不拦截指针）
    this.view.addChild(this.hitLayer);
  }

  private isPlantMode(): boolean { return !!this.w && this.w.mode === 'manual' && this.w.manualTool === 'plant'; }

  // 种植可视化：已种点位标记(各活株小点) + 落点预览光标(圈+芯) + 落定脉冲(扩散环)。仅手动种植模式绘制。
  private drawPlantFx(world: World, dtMS: number): void {
    const g = this.plantFx; g.clear();
    if (!this.isPlantMode()) { this.previewPt = null; this.pulse = null; return; }
    // 已种点位标记（限量防密集卡顿）：白底小点 + 作物色芯 → 看清在哪儿、多密地种过
    let n = 0;
    for (const p of world.plots) {
      for (const sl of p.slots) {
        if (sl.phase !== 'grow' || sl.dead) continue;
        const mx = pctX(sl.pt.x), my = pctY(sl.pt.y);
        g.circle(mx, my, 3.1).fill({ color: 0xffffff, alpha: 0.4 });
        g.circle(mx, my, 1.7).fill({ color: cropColorOf(sl.crop), alpha: 0.95 });
        if (++n >= 140) break;
      }
      if (n >= 140) break;
    }
    const col = cropColorOf(world.manualSeed);
    if (this.previewPt) { // 落点预览光标：圈(株数大小) + 中心芯
      const px = pctX(this.previewPt.x), py = pctY(this.previewPt.y);
      const rad = Math.max(1, world.plantBrushN) > 1 ? 27 : 13;
      g.circle(px, py, rad).fill({ color: col, alpha: 0.13 });
      g.circle(px, py, rad).stroke({ color: col, width: 2, alpha: 0.92 });
      g.circle(px, py, 3.6).fill({ color: 0xffffff, alpha: 0.95 });
      g.circle(px, py, 2).fill({ color: col, alpha: 1 });
    }
    if (this.pulse) { // 落定脉冲：扩散环
      this.pulse.t -= dtMS;
      if (this.pulse.t <= 0) this.pulse = null;
      else { const k = 1 - this.pulse.t / 620; g.circle(pctX(this.pulse.x), pctY(this.pulse.y), 8 + k * 36).stroke({ color: col, width: 3, alpha: (1 - k) * 0.85 }); }
    }
  }

  private mkShadow(): Sprite {
    const s = new Sprite(this.shadowTex);
    s.anchor.set(SH_ANCHOR_X, 0.5); // 锚点=贴图近端浓团(接地点) → 旋转/缩放时根部不动、只有尾巴摆向地面
    s.visible = false;
    this.shadowLayer.addChild(s);
    return s;
  }

  /** 把"演员"(机器人机身)放进作物层，按 zIndex=y 与作物一起纵深排序 → 走到更靠前高作物后会被遮挡（真实 2.5D）。 */
  addActor(c: Container): void {
    this.actor = c;
    this.cropLayer.addChild(c);
  }

  /** 全量光影：把作物层(含野草/机身)渲到 RT，供主程序做冠层投影（上叶投下叶/接地，密集处顶亮底暗）。 */
  renderCanopyTo(renderer: Renderer, rt: RenderTexture): void {
    renderer.render({ container: this.cropLayer, target: rt, clear: true });
  }
  /** 轻投影模式：开=显示每株接地阴影层；全量光影模式下关闭(改用 RT 冠层投影，避免重复)。 */
  setLightShadows(on: boolean): void { this.shadowLayer.visible = on; }
  /** 当前接地阴影强度(随天气/昼夜)。 */
  get shadowStrength(): number { return this.lastShadowAlpha; }

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
      g.on('pointertap', (e) => { const lp = e.getLocalPosition(this.hitLayer); const x = (lp.x / STAGE_W) * 100, y = (lp.y / STAGE_H) * 100; this.onPlotTap(id, x, y); if (this.isPlantMode()) this.pulse = { x, y, t: 620 }; });
      // 种植模式落点预览：按下/移动(桌面悬停或触摸按住)显示预览光标；抬起清除
      g.on('pointerdown', (e) => { if (!this.isPlantMode()) return; const lp = e.getLocalPosition(this.hitLayer); this.previewPt = { x: (lp.x / STAGE_W) * 100, y: (lp.y / STAGE_H) * 100 }; });
      g.on('pointermove', (e) => { if (!this.isPlantMode()) return; const lp = e.getLocalPosition(this.hitLayer); this.previewPt = { x: (lp.x / STAGE_W) * 100, y: (lp.y / STAGE_H) * 100 }; });
      g.on('pointerup', () => { this.previewPt = null; });
      g.on('pointerupoutside', () => { this.previewPt = null; });
      this.hitLayer.addChild(g);
    }
  }

  rebuild(world: World) {
    this.cropLayer.removeChildren();
    this.shadowLayer.removeChildren();
    if (this.actor) this.cropLayer.addChild(this.actor); // 重建作物时保留机身，否则被 removeChildren 清掉→机器人消失
    this.recs = [];
    this.weedRecs = [];
    // 田内杂草分两池：非恶性田草(weed_8/11/蛇莓) 占绝大多数槽位；恶性草(yellowdock) 仅极少数槽位
    const fieldRegular = this.fieldKinds.filter((i) => this.kinds[i].category !== 'malignant');
    const fieldMalign = this.fieldKinds.filter((i) => this.kinds[i].category === 'malignant');
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
          shadow: this.mkShadow(),
        });
      });
      // 田内杂草：每地块预置 12 株。恶性草仅占固定 2 槽位(k=4/9，低 appearAt→侵染中期才冒出)，其余 10 株全为非恶性田草
      // → 大幅降低恶性草在田里的密度；普通草用密集递进 appear，提高其出现率。
      let regIdx = 0;
      for (let k = 0; this.fieldKinds.length > 0 && k < 12; k++) {
        const wpt = quadPoint(q, 0.1 + plantHash(p.id, k, 21) * 0.8, 0.12 + plantHash(p.id, k, 22) * 0.76);
        const malignSlot = (k === 4 || k === 9) && fieldMalign.length > 0;
        const pool = malignSlot ? fieldMalign : (fieldRegular.length > 0 ? fieldRegular : this.fieldKinds);
        const kind = this.kinds[pool[Math.floor(plantHash(p.id, k, 23) * pool.length) % pool.length]];
        const appear = malignSlot ? (k === 4 ? 12 : 30) : (regIdx++ * 5 + 4); // 恶性: malign>12/>30；普通: weedProg>4,9,14… 密集冒出
        const s = new Sprite(kind.stages[0]);
        s.anchor.set(0.5, 0.99);
        s.position.set(pctX(wpt.x), pctY(wpt.y));
        s.zIndex = wpt.y; // 与作物/机身同层按 y 排序 → 身前的杂草遮挡机器人底部，身后的在其后
        s.visible = false;
        this.cropLayer.addChild(s);
        const sizeJit = 0.8 + plantHash(p.id, k, 24) * 0.5;
        const targetH = kind.sizeH * perspScale(wpt.y) * sizeJit; // 透视：远小近大 + 类型尺寸层级 + 随株大小
        this.weedRecs.push({ sprite: s, plotId: p.id, order: k, appear, kind, targetH, cur: -1, malign: kind.category === 'malignant', shadow: this.mkShadow(), colorVar: weedTint(plantHash(p.id, k, 26), plantHash(p.id, k, 27)), restAng: (plantHash(p.id, k, 28) - 0.5) * 22, growMul: 0.7 + plantHash(p.id, k, 25) * 0.8, life: 0, phase: 0, hold: W_MATURE + plantHash(p.id, k, 29) * W_MATURE_RND, wither: 0, lodge: 0 });
      }
    }
    this.buildWildWeeds(world);
  }

  // 野地杂草：在田块之外的地面(田埂/路边/前景空地)按自然习性散布长草。位置避开所有田块四边形，
  // 限定在地面带(纵向 50~99%，避开远山/天空)。贴近巡田路网节点者标 onPath → 经过的机器人会压除。
  private buildWildWeeds(world: World) {
    this.wildRecs = [];
    if (this.kinds.length === 0) return;
    const quads = Array.from({ length: 12 }, (_, i) => getQuad(i));
    const nodes = world.roadNet?.nodes ?? [];
    const edges = world.roadNet?.edges ?? [];
    this.roadNodes = nodes; this.roadEdges = edges; // 存一份供野草异地重生判定 onPath
    const inField = (x: number, y: number) => quads.some((q) => pointInQuad(x, y, q));
    const onPathOf = (x: number, y: number): boolean => {
      for (const [ia, ib] of edges) { const A = nodes[ia], B = nodes[ib]; if (A && B && distToSeg(x, y, A.left, A.top, B.left, B.top) < 3.5) return true; }
      return false;
    };
    // 落单株野草：避开田块/地面带外，按类型尺寸层级与 onPath 设定
    const spawn = (gx: number, gy: number, ki: number, h: number, ignoreVeg = false): boolean => {
      if (gx < 1 || gx > 99 || gy < 50 || gy > 99 || inField(gx, gy) || (!ignoreVeg && isBgVeg(gx, gy))) return false; // 避开田块；默认避开背景树/灌木(喜水水源簇例外)
      const kind = this.kinds[ki];
      const s = new Sprite(kind.stages[0]);
      s.anchor.set(0.5, 0.99);
      s.position.set(pctX(gx), pctY(gy));
      s.zIndex = gy; // 与作物/机身同层按 y 纵深排序
      s.visible = false;
      this.cropLayer.addChild(s);
      // 多样性随机(尺寸/色彩/方向/速度) + 初始生命阶段参差(野地长期无人打理)
      this.wildRecs.push({
        sprite: s, shadow: this.mkShadow(), kind, onPath: onPathOf(gx, gy),
        bx: gx, by: gy,
        sizeJit: 0.7 + wildHash(h, 4) * 0.7,
        colorVar: weedTint(wildHash(h, 9), wildHash(h, 10)),
        restAng: (wildHash(h, 11) - 0.5) * 22,
        growMul: 0.7 + wildHash(h, 12) * 0.8,
        cur: -1, life: 0.05 + wildHash(h, 6) * 0.7, phase: 0,
        hold: 4000 + wildHash(h, 8) * 12000, wither: 0, lodge: 0, pressed: false,
      });
      return true;
    };
    // 簇生：以 (cx,cy) 为中心按数量 n 撒同类成簇（n=1 即单株）
    const cluster = (cx: number, cy: number, ki: number, n: number, base: number, ignoreVeg = false) => {
      for (let j = 0; j < n; j++) {
        const h = base * 23 + j;
        spawn(j ? cx + (wildHash(h, 1) - 0.5) * 7 : cx, j ? cy + (wildHash(h, 2) - 0.5) * 4.5 : cy, ki, h, ignoreVeg);
      }
    };
    // 喜水成片（rule4）：水源角附近密集播 nearWater 类(weed_8) 几大簇
    const waterKi = this.kinds.findIndex((k) => k.nearWater && k.inWild);
    if (waterKi >= 0) {
      for (let c = 0; c < 7; c++) {
        const cx = WATER_SRC.x + (wildHash(901 + c, 1) - 0.5) * 22;
        const cy = WATER_SRC.y + (wildHash(901 + c, 2) - 0.5) * 12;
        cluster(cx, cy, waterKi, 5, 901 + c, true); // 喜水成片：水源角(湿地草甸)即使背景有灌木也长 → weed_8 大片
      }
    }
    // 通用散布：patch 类成簇(3~4)、single 单株、mix 1~2（rule5/6/7）
    let placed = this.wildRecs.length;
    for (let a = 1; placed < 130 && a < 800; a++) {
      const gx = 1 + wildHash(a, 1) * 98, gy = 50 + wildHash(a, 2) * 49;
      if (inField(gx, gy)) continue;
      const pool = onPathOf(gx, gy) ? this.roadKinds : this.wildKinds; // 路上用 onRoad 类(车前草/蛇莓/恶性)，开阔野地用 inWild 类
      if (pool.length === 0) continue;
      const ki = pool[Math.floor(wildHash(a, 3) * pool.length) % pool.length];
      const sp = this.kinds[ki].spread;
      const n = sp === 'single' ? 1 : sp === 'patch' ? 2 + Math.floor(wildHash(a, 7) * 2) : 1 + Math.floor(wildHash(a, 7) * 2);
      const before = this.wildRecs.length;
      cluster(gx, gy, ki, n, a);
      placed += this.wildRecs.length - before;
    }
  }

  // 重建单个地块的作物精灵：机器人改种不同作物后按新 autoPoints 布点重排（销毁旧精灵→建新精灵，不触碰野草）。
  private rebindPlotCrops(world: World, plotId: number): void {
    const keep: SpriteRec[] = [];
    for (const rec of this.recs) {
      if (rec.plotId === plotId) {
        this.cropLayer.removeChild(rec.sprite); rec.sprite.destroy();
        this.cropLayer.removeChild(rec.sprite2); rec.sprite2.destroy();
        this.shadowLayer.removeChild(rec.shadow); rec.shadow.destroy();
      } else keep.push(rec);
    }
    this.recs = keep;
    const p = world.plots[plotId];
    if (!p) return;
    const q = getQuad(plotId);
    const pdepPct = Math.abs(q[2][1] - q[0][1]) || 1;
    p.slots.forEach((sl, idx) => {
      const mk = () => {
        const s = new Sprite(this.atlas.get(`plant_${sl.crop}_s1`));
        s.anchor.set(0.5, 0.68);
        s.position.set(pctX(sl.pt.x), pctY(sl.pt.y));
        s.zIndex = sl.pt.y;
        this.cropLayer.addChild(s);
        return s;
      };
      const sprite = mk();
      const sprite2 = mk();
      this.recs.push({
        sprite, sprite2, plotId, slotIdx: idx, depth: sl.pt.depth,
        sizeJit: 0.84 + plantHash(plotId, idx, 11) * 0.34,
        restAng: (plantHash(plotId, idx, 12) - 0.5) * 16,
        pdepPct,
        r1: plantHash(plotId, idx, 1), r2: plantHash(plotId, idx, 2), r3: plantHash(plotId, idx, 3), r4: plantHash(plotId, idx, 4),
        curLodge: 0, colorVar: makeColorVar(plotId, idx), shadow: this.mkShadow(),
      });
    });
  }

  update(world: World, dtMS: number) {
    this.w = world; // 缓存供指针事件读取（plant 模式/选种/株数）
    // 机器人改种了不同作物的地块：按新作物布点重建该地块作物精灵（不动野草，避免整田重建闪烁）
    if (world.dirtyPlots.length) {
      for (const id of world.dirtyPlots) this.rebindPlotCrops(world, id);
      world.dirtyPlots.length = 0;
    }
    this.drawPlantFx(world, dtMS); // 种植可视化（已种标记/落点预览/落定脉冲）
    const wx = world.weather.type as WeatherType;
    const lum = world.toggles.cropRelight
      ? sceneLum(world.tod, wx, world.weatherIntensity())
      : 1;
    const relight = ambientTint(lum); // 环境色罩染：白天近中性、夜里转冷蓝 → 与场景融为一体
    // 接地阴影强度对齐背景：随天气「定向光强度」(晴/晴夜强、阴雨弱)，夜里仅轻微减弱（晴夜有月投影仍强）
    const shadowAlpha = (0.2 + 0.52 * (SHADOW_CLEARNESS[wx] ?? 0.5)) * (0.85 + 0.15 * lum);
    this.lastShadowAlpha = shadowAlpha;

    for (const rec of this.recs) {
      const plot = world.plots[rec.plotId];
      const sl = plot?.slots[rec.slotIdx];
      if (!sl) { rec.shadow.visible = false; continue; }
      const a = rec.sprite, b = rec.sprite2;
      // 收割后空置 / 翻耕 / 出苗期：隐藏作物，露出裸土（收割→翻耕→播种 轮作过程可见）
      const bare = sl.fallowMS > 0 || sl.phase !== 'grow';
      a.visible = !bare; b.visible = !bare;
      if (bare) { rec.shadow.visible = false; continue; }

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
      setShadow(rec.shadow, a.x, a.y, heightPx, a.texture.width * a.scale.x, shadowAlpha * 0.72); // 作物接地定向阴影（按冠幅取宽、株高取长 → 接地+投射）
    }

    // —— 杂草：按地块 weedProg 逐株出现(蔓延)，按生长进度换阶段贴图(幼→中→熟)并连续长高；跟随昼夜明暗 ——
    for (const wr of this.weedRecs) {
      const plot = world.plots[wr.plotId];
      const sp = wr.sprite;
      if (!plot) { sp.visible = false; wr.shadow.visible = false; continue; }
      const wp = wr.malign ? plot.malign : plot.weedProg; // 恶性株按 malign 出现，普通株按 weedProg
      const appearAt = wr.appear; // 每株自带出现阈值（普通密集递进、恶性低阈值且仅 2 株）
      if (wp <= appearAt) { // 未冒出 / 已被除草翻耕 → 隐藏并复位生命周期
        sp.visible = false; wr.shadow.visible = false;
        wr.life = 0; wr.phase = 0; wr.wither = 0; wr.lodge = 0; wr.cur = -1; continue;
      }
      const kind = wr.kind;
      // 个体生命周期：生长→成熟→枯萎；枯死后保留为黑残株(rule4，不自动消失，待机器人清枯/翻耕清除)
      if (wr.phase === 0) { wr.life += dtMS / (kind.growSec * wr.growMul * 1000); if (wr.life >= 1) { wr.life = 1; wr.phase = 1; } }
      else if (wr.phase === 1) { wr.hold -= dtMS; if (wr.hold <= 0) wr.phase = 2; }
      else if (wr.phase === 2) { wr.wither += dtMS / WITHER_FIELD; if (wr.wither >= 1) { wr.wither = 1; wr.phase = 3; } }
      const lodgeTarget = wr.phase >= 2 ? 52 * Math.min(1, wr.wither) : 0; // 枯萎渐渐倒伏
      wr.lodge += (lodgeTarget - wr.lodge) * Math.min(1, dtMS / 800);
      drawWeed(sp, wr.shadow, kind, wr.targetH, wr.life, wr.phase, wr.wither, wr.lodge, wr.restAng, wr.colorVar, relight, shadowAlpha, 1, (st) => { if (wr.cur !== st) { sp.texture = kind.stages[st]; wr.cur = st; } });
    }

    // —— 野地杂草生命周期：生长→成熟→枯萎(倒伏/转黑/缩)→枯死。野地枯株保留极长后原地重生(rule5)；
    //    路上枯株淡出(延长)后异地重生(rule5)；被机器人压过的路草进入枯萎并死后异地(rule4) ——
    const rob = this.actor && this.actor.visible && this.actor.x > 0 ? this.actor : null;
    for (const wr of this.wildRecs) {
      const kind = wr.kind, sp = wr.sprite;
      if (rob && wr.onPath && wr.phase < 2 && Math.hypot(rob!.x - sp.x, rob!.y - sp.y) < 50) { wr.phase = 2; wr.pressed = true; }
      let fade = 1;
      if (wr.phase === 0) { wr.life += dtMS / (kind.growSec * wr.growMul * 1000); if (wr.life >= 1) { wr.life = 1; wr.phase = 1; } }
      else if (wr.phase === 1) { wr.hold -= dtMS; if (wr.hold <= 0) wr.phase = 2; }
      else if (wr.phase === 2) { // 枯萎(大幅延长)：路上较快、野地较慢
        wr.wither += dtMS / (wr.onPath ? WITHER_ROAD : WITHER_OPEN);
        if (wr.wither >= 1) { wr.wither = 1; wr.phase = 3; wr.hold = wr.onPath ? FADE_ROAD : DEAD_OPEN; } // 枯死后保留计时
      } else { // phase 3 枯死保留
        wr.hold -= dtMS;
        if (wr.onPath) fade = Math.max(0, wr.hold / FADE_ROAD);                 // 路上：缓慢淡出(延长)
        else if (wr.hold < 9000) fade = Math.max(0, wr.hold / 9000);            // 野地：保留极久，末段才淡出
        if (wr.hold <= 0) { // 重生：路上异地、野地原地
          if (wr.onPath) { const ns = this.randomWildSpot(); if (ns) { wr.bx = ns.x; wr.by = ns.y; wr.onPath = ns.onPath; sp.position.set(pctX(ns.x), pctY(ns.y)); sp.zIndex = ns.y; } }
          wr.life = 0; wr.phase = 0; wr.wither = 0; wr.pressed = false; wr.lodge = 0; wr.cur = -1;
          wr.hold = W_MATURE + Math.random() * W_MATURE_RND;
          wr.sizeJit = 0.7 + Math.random() * 0.7; wr.growMul = 0.7 + Math.random() * 0.8;
          wr.colorVar = weedTint(Math.random(), Math.random()); wr.restAng = (Math.random() - 0.5) * 22;
        }
      }
      const lodgeTarget = wr.phase >= 2 ? (wr.pressed ? 82 : 50) * Math.min(1, wr.wither) : 0;
      wr.lodge += (lodgeTarget - wr.lodge) * Math.min(1, dtMS / 800);
      const targetH = kind.sizeH * perspScale(wr.by) * wr.sizeJit; // 透视：远小近大（动态，随重生位置更新）
      drawWeed(sp, wr.shadow, kind, targetH, wr.life, wr.phase, wr.wither, wr.lodge, wr.restAng, wr.colorVar, relight, shadowAlpha, fade, (st) => { if (wr.cur !== st) { sp.texture = kind.stages[st]; wr.cur = st; } });
    }
  }

  // 为被压枯死的野草找一个开阔野地(非田块/非背景植被/非路)的重生点
  private randomWildSpot(): { x: number; y: number; onPath: boolean } | null {
    for (let t = 0; t < 24; t++) {
      const x = 1 + Math.random() * 98, y = 50 + Math.random() * 49;
      let bad = isBgVeg(x, y);
      for (let i = 0; !bad && i < 12; i++) if (pointInQuad(x, y, getQuad(i))) bad = true;
      for (const [ia, ib] of this.roadEdges) { const A = this.roadNodes[ia], B = this.roadNodes[ib]; if (A && B && distToSeg(x, y, A.left, A.top, B.left, B.top) < 3.5) { bad = true; break; } }
      if (!bad) return { x, y, onPath: false };
    }
    return null;
  }

  get spriteCount(): number {
    return this.recs.length;
  }
}

// 环境色罩染：按昼夜给作物/野草统一的环境光乘法色 —— 白天近中性、夜里转冷蓝，让贴图融入场景而非"贴上去"。
function ambientTint(lum: number): number {
  const b = 0.32 + 0.68 * lum;               // 基础明度（同原 relight 灰度）
  const night = 1 - Math.min(1, lum / 0.5);  // 0(昼)..1(夜)
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v * 255)));
  return (c(b * (1 - night * 0.20)) << 16) | (c(b * (1 - night * 0.08)) << 8) | c(b * (1 + night * 0.12));
}
// 透视：野草按所在纵向位置(y%)缩放 —— 远(上,y小)显著小、近(下,y大)大，正向对齐背景纵深（消除远近一样大）。
function perspScale(yPct: number): number {
  const t = Math.max(0, Math.min(1, (yPct - 46) / 52)); // 46%(远)..98%(近)
  return 0.4 + 1.15 * Math.pow(t, 1.15);
}
// 野草健康/色彩随机（乘法 tint）：偏黄绿(健康) / 偏枯褐(不健康) / 中性微暖
function weedTint(h: number, s: number): number {
  const amt = 0.10 + s * 0.16;
  let r = 1, g = 1, b = 1;
  if (h > 0.66) { r = 1 - amt * 0.15; g = 1 - amt * 0.5; b = 1 - amt; }   // 偏枯黄褐
  else if (h < 0.4) { r = 1 - amt * 0.5; b = 1 - amt * 0.5; }             // 偏黄绿
  else { b = 1 - amt * 0.4; }                                             // 中性微暖
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v * 255)));
  return (c(r) << 16) | (c(g) << 8) | c(b);
}
// —— 接地定向阴影（写实化重写）——
// 旧版"整株按株高画一枚对称扁椭圆、略偏右下"无法表达"接地点不动、影子只把尾巴甩向地面"，
// 配合默认的 RT 整层平移更显悬浮。现：每株一枚"彗星"软阴影——近端浓团贴根=接地(contact AO)，
// 主体沿固定光向(左上→右下，匹配背景烘焙树影)延展=投射(cast)；长随株高(越高影越长)、宽随冠幅、浓随天气/昼夜。
// 锚点钉在浓团(接地点) → 旋转/缩放时根部不动，只有远端尾巴摆向地面，从根本上消除"悬浮"。
const SH_TEX_W = 128, SH_TEX_H = 64;
const SH_ANCHOR_X = 0.22;  // 浓团(接地点)在贴图长轴 22% 处：少量在根后(软接地)、多数向光背面延展
const SH_ANGLE = 0.42;     // 投射方向(rad,≈24°)：右下对角，匹配背景树影方向
const SH_FOOT = 0.46;      // 渲染宽→实际冠幅(贴图含透明边，打折)
const SH_WID = 0.92;       // 冠幅→阴影宽
const SH_LEN_BASE = 0.6;   // 冠幅→基础长(矮株也有接地团)
const SH_LEN_H = 0.5;      // 株高→附加长度(高株投影更长)

// 彗星软阴影贴图：长轴 128 × 短轴 64；近端(≈22%处)浓团=接地，向远端渐隐成尾=投射。
function makeShadowTexture(): Texture {
  const W = SH_TEX_W, H = SH_TEX_H;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d')!;
  // 接地浓团：径向渐变，圆心在长轴 22%(接地点)
  const cx = W * SH_ANCHOR_X, cy = H * 0.5;
  const g = ctx.createRadialGradient(cx, cy, 1, cx, cy, H * 0.72);
  g.addColorStop(0, 'rgba(0,0,0,0.64)');
  g.addColorStop(0.5, 'rgba(0,0,0,0.30)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  // 投射尾巴：远端再叠一片更淡更扁的椭圆 → 整体呈水滴/彗星形向投射方向拖出
  const tx = W * 0.60;
  const g2 = ctx.createRadialGradient(tx, cy, 1, tx, cy, H * 0.44);
  g2.addColorStop(0, 'rgba(0,0,0,0.20)');
  g2.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g2; ctx.fillRect(0, 0, W, H);
  return Texture.from(cv);
}
// 把彗星阴影钉在植株根 (rootX,rootY)：锚点=接地浓团，旋到右下；长随株高、宽随冠幅 renderW。
function setShadow(sh: Sprite, rootX: number, rootY: number, hPx: number, renderW: number, alpha: number) {
  sh.visible = true;
  const foot = Math.max(4, renderW * SH_FOOT);
  const len = Math.min(hPx * 1.25, foot * SH_LEN_BASE + hPx * SH_LEN_H); // 高株投影更长，封顶不过界
  const wid = Math.max(foot * SH_WID, len * 0.34);                       // 宽度下限：矮株也不至于细成线
  sh.rotation = SH_ANGLE;
  sh.position.set(rootX, rootY + hPx * 0.01); // 贴根（浓团即接地点，几乎不偏移 → 牢牢咬住地面）
  sh.scale.set(len / SH_TEX_W, wid / SH_TEX_H);
  sh.alpha = alpha;
}
// 渲染一株野草：连续生长(补偿阶段relH，消除换阶段突然变大) + 枯萎转黑/缩/倒 + 接地阴影。setTex(stage) 按需换贴图。
function drawWeed(sp: Sprite, sh: Sprite, kind: WeedKind, targetH: number, life: number, phase: number, wither: number, lodge: number, restAng: number, colorVar: number, relight: number, shadowAlpha: number, fade: number, setTex: (stage: number) => void): void {
  const stg = kind.stages, N = stg.length, growN = kind.hasWithered ? N - 1 : N;
  const Lc = Math.min(1, life);
  const stage = phase >= 2 ? N - 1 : Math.min(growN - 1, Math.floor(Lc * growN)); // 枯萎显末帧；生长只到成熟
  const plantH = targetH * (0.18 + 0.82 * Math.pow(Lc, 0.92)) * (1 - wither * 0.22); // 幼苗更小(0.18)→成熟(1.0)拉开差距；枯萎以倒伏/转黑为主、仅轻微缩
  if (plantH < 1.2 || fade <= 0.01) { sp.visible = false; sh.visible = false; return; }
  sp.visible = true;
  setTex(stage);
  // 关键：目标株高 ÷ 该阶段贴图内植株占比(relH) → 换阶段只换形态、不跳大小（消除 yellowdock 突然长大）
  sp.scale.set(plantH / (stageRel(stage, N) * (stg[stage].height || 1)));
  sp.rotation = ((restAng + lodge) * Math.PI) / 180;
  const dark = wither > 0 ? lerpColor(0xffffff, 0x241d14, Math.min(1, wither) * 0.9) : 0xffffff; // 枯萎转黑(rule4)
  sp.tint = multiplyColor(multiplyColor(relight, colorVar), dark);
  sp.alpha = fade;
  setShadow(sh, sp.x, sp.y, plantH, sp.texture.width * sp.scale.x, shadowAlpha * (1 - wither * 0.55));
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
