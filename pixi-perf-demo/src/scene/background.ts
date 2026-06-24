import { Container, Sprite, Texture } from 'pixi.js';
import { STAGE_W, STAGE_H } from '../data/baseCorners';
import { bgLayers, type WeatherType } from '../data/scenes';
import { OnDemandTextureCache } from '../core/assets';

// 背景层：天气×时段最多 4 张全屏图按 over 合成做交叉淡入。
// 只 request 当前需要的 1–4 张 → OnDemandTextureCache 按需解码、闲置卸载（禁止一次性 36 张）。
const SLOT_KEYS = ['NA', 'NB', 'WA', 'WB'] as const;
type SlotKey = (typeof SLOT_KEYS)[number];

export class Background {
  readonly view = new Container();
  private cache = new OnDemandTextureCache(240);
  private slots = new Map<SlotKey, { sprite: Sprite; alpha: number }>();

  constructor() {
    // 固定 z 序：NA(底) → NB → WA → WB(顶)
    for (const key of SLOT_KEYS) {
      const sp = new Sprite(Texture.EMPTY);
      sp.width = STAGE_W + 2;
      sp.height = STAGE_H + 2;
      sp.position.set(-1, -1);
      sp.alpha = 0;
      sp.visible = false;
      this.view.addChild(sp);
      this.slots.set(key, { sprite: sp, alpha: 0 });
    }
  }

  update(tod: number, wxType: WeatherType, wInt: number, fade: boolean, dtMS: number): void {
    const cands = bgLayers(tod, wxType, wInt);
    const byKey = new Map(cands.map((c) => [c.key as SlotKey, c]));

    if (!fade) {
      // 关闭淡入：只显示权重最高的单张场景 → 1 个全屏层（用于量化淡入/多层合成开销）
      let best = cands[0];
      for (const c of cands) if (c.weight > (best?.weight ?? -1)) best = c;
      for (const key of SLOT_KEYS) {
        const slot = this.slots.get(key)!;
        if (best && key === (best.key as SlotKey)) {
          const tex = this.cache.request(best.url);
          if (tex) {
            slot.sprite.texture = tex;
            slot.sprite.visible = true;
            slot.alpha = 1;
            slot.sprite.alpha = 1;
          }
        } else {
          slot.alpha = 0;
          slot.sprite.alpha = 0;
          slot.sprite.visible = false;
        }
      }
      this.cache.sweep();
      return;
    }

    const rate = Math.min(1, dtMS / 380); // ~0.38s 完成淡入，近似原型 2.2s 的更灵敏版（DEMO 节奏更快）
    for (const key of SLOT_KEYS) {
      const slot = this.slots.get(key)!;
      const cand = byKey.get(key);
      let target = 0;
      if (cand) {
        const tex = this.cache.request(cand.url);
        if (tex) {
          slot.sprite.texture = tex;
          target = cand.opacity;
        } else {
          target = slot.alpha; // 还在解码 → 保持现状，避免闪烁
        }
      }
      slot.alpha += (target - slot.alpha) * rate;
      slot.sprite.alpha = slot.alpha;
      slot.sprite.visible = slot.alpha > 0.003;
    }
    this.cache.sweep();
  }

  get decodedCount(): number {
    return this.cache.decodedCount;
  }
}
