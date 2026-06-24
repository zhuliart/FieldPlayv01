import { Container, Sprite } from 'pixi.js';
import { STAGE_W, STAGE_H } from '../data/baseCorners';
import { dayState } from '../data/scenes';
import { makeWhiteTexture, makeStarTexture } from '../core/textures';

// 昼夜 tint 层：整屏 multiply（压暗/偏冷）+ screen（暖/冷洗），由 tod(0–1) 驱动；外加夜空星点。
// 任务书三章「昼夜 tint + 夜间车灯」用整屏 tint Sprite 还原（比 ColorMatrixFilter 更省）。
export class DayNight {
  readonly view = new Container();
  readonly stars = new Container();
  private mul: Sprite;
  private add: Sprite;
  private starSprites: { s: Sprite; phase: number; base: number }[] = [];
  private t = 0;

  constructor() {
    const white = makeWhiteTexture();
    this.mul = new Sprite(white);
    this.mul.width = STAGE_W;
    this.mul.height = STAGE_H;
    this.mul.blendMode = 'multiply';
    this.add = new Sprite(white);
    this.add.width = STAGE_W;
    this.add.height = STAGE_H;
    this.add.blendMode = 'add';
    this.view.addChild(this.mul, this.add);

    // 夜空星点（程序化，~120 颗），集中在天空区（上半）
    const star = makeStarTexture();
    for (let i = 0; i < 120; i++) {
      const s = new Sprite(star);
      s.anchor.set(0.5);
      s.x = Math.random() * STAGE_W;
      s.y = Math.random() * STAGE_H * 0.5;
      const sc = 0.5 + Math.random() * 1.3;
      s.scale.set(sc);
      s.blendMode = 'add';
      this.stars.addChild(s);
      this.starSprites.push({ s, phase: Math.random() * Math.PI * 2, base: 0.5 + Math.random() * 0.5 });
    }
  }

  update(tod: number, enabled: boolean, dtMS: number) {
    this.view.visible = enabled;
    this.stars.visible = enabled;
    if (!enabled) return;

    const dn = dayState(tod);
    this.mul.tint = (dn.mul.c[0] << 16) | (dn.mul.c[1] << 8) | dn.mul.c[2];
    this.mul.alpha = dn.mul.a;
    this.add.tint = (dn.add.c[0] << 16) | (dn.add.c[1] << 8) | dn.add.c[2];
    this.add.alpha = dn.add.a;

    this.t += dtMS;
    const starA = dn.star;
    for (const st of this.starSprites) {
      const tw = 0.78 + 0.22 * Math.sin(this.t / 600 + st.phase);
      st.s.alpha = starA * st.base * tw;
    }
  }
}
