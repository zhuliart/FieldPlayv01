import { Container, Sprite, Graphics } from 'pixi.js';
import { PLANT_SIZE, PLANT_SIZE_DEFAULT, CROP_BOTTOM } from '../data/crops';
import { STAGE_H } from '../data/baseCorners';
import { sceneLum, type WeatherType } from '../data/scenes';
import { getQuad, plantHash, pctX, pctY } from '../sim/layout';
import { DRY_DEATH, type World } from '../sim/world';
import type { PlantAtlas } from '../core/assets';

interface SpriteRec {
  sprite: Sprite;
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
}

// 地块层：12 个可点多边形（点击=浇水）+ 全田作物精灵（共享图集 → 合批）。
// 含逐项移植的「倒伏（lodging）随机机制」与「应激滤镜（旱黄/冻蓝/涝暗/枯褐/过熟褪色）」。
export class Field {
  readonly view = new Container();
  private cropLayer = new Container();
  private hitLayer = new Container();
  private recs: SpriteRec[] = [];

  constructor(private atlas: PlantAtlas, private onPlotTap: (plotId: number) => void) {
    this.cropLayer.sortableChildren = true;
    this.view.addChild(this.cropLayer);
    this.view.addChild(this.hitLayer);
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
    this.recs = [];
    for (const p of world.plots) {
      const q = getQuad(p.id);
      const pdepPct = Math.abs(q[2][1] - q[0][1]) || 1;
      p.slots.forEach((sl, idx) => {
        const sprite = new Sprite(this.atlas.get(`plant_${sl.crop}_s1`));
        sprite.anchor.set(0.5, 0.68);
        sprite.position.set(pctX(sl.pt.x), pctY(sl.pt.y));
        sprite.zIndex = sl.pt.y; // 近(下)在前
        this.cropLayer.addChild(sprite);
        this.recs.push({
          sprite,
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
        });
      });
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
      const sp = rec.sprite;
      const growthCont = Math.max(0, Math.min(4, sl.growth / 100));
      const stage = Math.min(4, Math.floor(growthCont));

      // 按 stage 换贴图 + 根锚
      sp.texture = this.atlas.get(`plant_${sl.crop}_s${stage + 1}`);
      sp.anchor.set(0.5, CROP_BOTTOM[sl.crop][stage] ?? 0.68);

      // 近大远小 + 随生长平滑变大
      const gScale = 0.4 + 0.6 * (growthCont / 4);
      const sizeBase = PLANT_SIZE[sl.crop] ?? PLANT_SIZE_DEFAULT;
      const hPct = rec.pdepPct * (sizeBase + 0.18 * rec.depth) * rec.sizeJit * gScale;
      const heightPx = (hPct / 100) * STAGE_H;
      const texH = sp.texture.height || 1;
      sp.scale.set(heightPx / texH);

      // —— 倒伏（lodging）：受灾/缺水/过熟/死亡 → bend，方向/幅度/速度/延迟各株不同（绕根=anchor 旋转）——
      const wsev = wx === 'rain' ? sl.flood : wx === 'drought' ? sl.parch : wx === 'frost' ? sl.frost : 0;
      let bend = 0;
      if (wsev > 0) bend = Math.max(bend, Math.min(1, wsev / 4));
      if (!sl.dead && stage < 4 && sl.dry > 0) {
        const thr = DRY_DEATH[stage] || 5;
        bend = Math.max(bend, Math.min(0.9, sl.dry / thr));
      }
      if (!sl.dead && sl.growth >= 400) {
        const a = Math.max(0, sl.age - 5);
        if (a > 0) bend = Math.max(bend, Math.min(0.65, a / 11));
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
      sp.rotation = ((rec.restAng + rec.curLodge) * Math.PI) / 180;

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
      sp.tint = multiplyColor(relight, stress);
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
