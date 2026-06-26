import { Container, Sprite, Texture } from 'pixi.js';
import { STAGE_W, STAGE_H } from '../data/baseCorners';
import { bgBracket, type WeatherType } from '../data/scenes';
import { OnDemandTextureCache } from '../core/assets';
import type { World } from '../sim/world';

// 杂草 / 极端天气状态叠加层（全屏状态图，按需解码）：
//  - 杂草：assets/wd/weed_<node>.jpg，alpha 随田间杂草率。
//  - 灾害：assets/state/{flood|drought|frost}<1..12>.png，帧与 alpha 随生命周期强度。
// 这些图较大（状态图 1672×941 RGBA），用 OnDemandTextureCache 只热当前帧、闲置即卸载。
const STATE_SET: Partial<Record<WeatherType, string>> = {
  rain: 'flood',
  drought: 'drought',
  frost: 'frost',
};

export class WeatherOverlay {
  readonly view = new Container();
  private weed: Sprite;
  private state: Sprite;
  private cache = new OnDemandTextureCache(180);
  private weedAlpha = 0;
  private stateAlpha = 0;

  constructor() {
    this.weed = new Sprite(Texture.EMPTY);
    this.weed.width = STAGE_W;
    this.weed.height = STAGE_H;
    this.weed.alpha = 0;
    this.weed.blendMode = 'multiply';
    this.state = new Sprite(Texture.EMPTY);
    this.state.width = STAGE_W;
    this.state.height = STAGE_H;
    this.state.alpha = 0;
    this.view.addChild(this.weed, this.state);
  }

  update(world: World, dtMS: number) {
    this.view.visible = world.toggles.overlays;
    if (!world.toggles.overlays) {
      this.cache.sweep();
      return;
    }
    const rate = Math.min(1, dtMS / 320);

    // —— 杂草 ——
    const { Ak, Bk, ft } = bgBracket(world.tod);
    const node = ft < 0.5 ? Ak : Bk;
    const weedTarget = 0; // 整屏杂草叠层停用 → 改用 field.ts 逐地块程序化杂草精灵
    if (weedTarget > 0) {
      const tex = this.cache.request(`assets/wd/weed_${node}.jpg`);
      if (tex) this.weed.texture = tex;
    }
    this.weedAlpha += (weedTarget - this.weedAlpha) * rate;
    this.weed.alpha = this.weedAlpha;
    this.weed.visible = this.weedAlpha > 0.004;

    // —— 极端天气状态 ——
    const set = STATE_SET[world.weather.type];
    const wInt = world.weatherIntensity();
    let stateTarget = 0;
    if (set && wInt > 0.05) {
      const frame = Math.max(1, Math.min(12, Math.round(wInt * 11) + 1));
      const tex = this.cache.request(`assets/state/${set}${frame}.png`);
      if (tex) this.state.texture = tex;
      stateTarget = Math.min(0.85, wInt * 0.9);
    }
    this.stateAlpha += (stateTarget - this.stateAlpha) * rate;
    this.state.alpha = this.stateAlpha;
    this.state.visible = this.stateAlpha > 0.004;

    this.cache.sweep();
  }
}
