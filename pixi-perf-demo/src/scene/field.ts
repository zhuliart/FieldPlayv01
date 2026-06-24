import { Container, Sprite, Graphics } from 'pixi.js';
import { PLANT_SIZE, PLANT_SIZE_DEFAULT, CROP_BOTTOM } from '../data/crops';
import { STAGE_H } from '../data/baseCorners';
import { sceneLum, type WeatherType } from '../data/scenes';
import { getQuad, plantHash, pctX, pctY } from '../sim/layout';
import type { World } from '../sim/world';
import type { PlantAtlas } from '../core/assets';

interface SpriteRec {
  sprite: Sprite;
  plotId: number;
  slotIdx: number;
  depth: number;
  sizeJit: number;
  restAng: number;
  pdepPct: number; // 该地块纵深（%）
}

// 地块层：12 个可点多边形（点击=浇水）+ 全田作物精灵（共享图集 → 合批）。
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
      for (const c of q) {
        pts.push(pctX(c[0]), pctY(c[1]));
      }
      const g = new Graphics();
      g.poly(pts).fill({ color: 0xffffff, alpha: 0.0001 }); // 近乎透明，仅作命中区
      g.eventMode = 'static';
      g.cursor = 'pointer';
      g.on('pointertap', () => this.onPlotTap(id));
      this.hitLayer.addChild(g);
    }
  }

  // 依据 world 当前 slots 重建作物精灵（初次 / 压力档加密后调用）
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
        });
      });
    }
  }

  update(world: World) {
    const lum = world.toggles.cropRelight
      ? sceneLum(world.tod, world.weather.type as WeatherType, world.weatherIntensity())
      : 1;
    const b = 0.32 + 0.68 * lum;
    const tint = packGray(b);

    for (const rec of this.recs) {
      const plot = world.plots[rec.plotId];
      const sl = plot?.slots[rec.slotIdx];
      if (!sl) continue;
      const growthCont = Math.max(0, Math.min(4, sl.growth / 100));
      const stage = Math.min(4, Math.floor(growthCont));
      const sp = rec.sprite;

      // 按 stage 换贴图 + 根锚（CROP_BOTTOM）
      sp.texture = this.atlas.get(`plant_${sl.crop}_s${stage + 1}`);
      sp.anchor.set(0.5, CROP_BOTTOM[sl.crop][stage] ?? 0.68);

      // 近大远小 + 随生长平滑变大
      const gScale = 0.4 + 0.6 * (growthCont / 4);
      const sizeBase = PLANT_SIZE[sl.crop] ?? PLANT_SIZE_DEFAULT;
      const hPct = rec.pdepPct * (sizeBase + 0.18 * rec.depth) * rec.sizeJit * gScale;
      const heightPx = (hPct / 100) * STAGE_H;
      const texH = sp.texture.height || 1;
      const scale = heightPx / texH;
      sp.scale.set(scale);
      sp.rotation = (rec.restAng * Math.PI) / 180;
      sp.tint = tint;
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
