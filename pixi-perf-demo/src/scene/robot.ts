import { Container, Sprite, Graphics } from 'pixi.js';

type PoolBlend = 'screen' | 'add' | 'color-dodge';
import { dayState } from '../data/scenes';
import { pctX, pctY } from '../sim/layout';
import { makeLightPoolTexture, makeSoftCircleTexture } from '../core/textures';
import type { World } from '../sim/world';

const MOD_COLOR: Record<string, number> = {
  water: 0x3f8fd0, fert: 0x5da32e, harvest: 0xd8a23a, patrol: 0x7a5bd0,
};

// 机器人 + 车灯光池。
// 光池 = 一张把原型 color-dodge 径向渐变 + ellipse mask 烘焙好的纹理，跟随机器人位置、
// 按朝向旋转、按景深缩放、夜间按 light 显隐；默认 screen 近似辉光，可切 color-dodge 严格还原。
export class Robot {
  readonly bodyView = new Container();
  readonly poolView = new Container();

  private pool: Sprite;
  private lamp: Sprite;
  private body = new Graphics();
  private leftEye = new Graphics();
  private rightEye = new Graphics();
  private moduleBox = new Graphics();
  private bobT = 0;

  constructor() {
    // —— 光池 ——
    this.pool = new Sprite(makeLightPoolTexture(360, 240));
    this.pool.anchor.set(0.5);
    this.pool.blendMode = 'screen';
    this.poolView.addChild(this.pool);
    // —— 车头灯辉光 ——
    this.lamp = new Sprite(makeSoftCircleTexture(128, '#fff0c8'));
    this.lamp.anchor.set(0.5, 0.7);
    this.lamp.blendMode = 'screen';
    this.lamp.scale.set(0.8);
    this.poolView.addChild(this.lamp);

    this.drawBody();
    this.bodyView.addChild(this.body, this.moduleBox, this.leftEye, this.rightEye);
  }

  setPoolBlend(mode: PoolBlend) {
    this.pool.blendMode = mode;
  }

  private drawBody() {
    const g = this.body;
    g.clear();
    // 地面投影
    g.ellipse(0, 2, 40, 11).fill({ color: 0x000000, alpha: 0.22 });
    // 轮子
    g.circle(-24, -10, 12).fill(0x2b3a44);
    g.circle(24, -10, 12).fill(0x2b3a44);
    g.circle(-24, -10, 5).fill(0x6b7d88);
    g.circle(24, -10, 5).fill(0x6b7d88);
    // 车身（主蓝 + 暗底厚边）
    g.roundRect(-30, -56, 60, 46, 12).fill(0x3f7fd0);
    g.roundRect(-30, -56, 60, 46, 12).stroke({ color: 0x2f63aa, width: 3 });
    g.roundRect(-26, -52, 52, 20, 9).fill(0x5aa0e8);
    // 面板
    g.roundRect(-20, -44, 40, 20, 7).fill(0x1d2a33);
    // 头顶传感器
    g.rect(-2, -64, 4, 9).fill(0x9aa4ab);
    g.circle(0, -65, 3.5).fill(0xbff05f);
  }

  update(world: World, dtMS: number) {
    const r = world.robot;
    const dn = dayState(world.tod);
    const nightLight = dn.light;
    const depthScale = Math.max(0.36, Math.min(1.18, +(1.0 + (r.top - 72) * 0.0188).toFixed(3)));

    // —— 机身 ——
    this.bobT += dtMS;
    const bob = r.moving ? 0 : Math.sin(this.bobT / 414) * 4;
    this.bodyView.position.set(pctX(r.left), pctY(r.top) + bob);
    this.bodyView.scale.set(depthScale);
    // 夜间整体压暗（被自身灯光重新照亮的对比感）
    const bodyB = 0.6 + 0.4 * (1 - nightLight);
    this.bodyView.tint = packGray(bodyB);

    // 眼睛颜色：白天绿、夜间暖琥珀
    const eg = Math.max(0, Math.min(1, (nightLight - 0.15) / 0.45));
    const eye = mixColor(0x46e08a, 0xffc94f, eg);
    this.leftEye.clear().circle(-9, -38, 4).fill(eye);
    this.rightEye.clear().circle(9, -38, 4).fill(eye);

    // 作业模块盒
    this.moduleBox.clear();
    if (r.module && MOD_COLOR[r.module] != null) {
      this.moduleBox.roundRect(26, -40, 16, 16, 5).fill(MOD_COLOR[r.module]);
      this.moduleBox.roundRect(26, -40, 16, 16, 5).stroke({ color: 0xffffff, width: 2 });
    }

    // —— 光池（朝向旋转 + 景深缩放 + 夜间显隐）——
    const lit = world.toggles.lightPool && nightLight > 0.04;
    this.poolView.visible = lit;
    if (lit) {
      this.poolView.position.set(pctX(r.left), pctY(r.top - 3));
      this.pool.rotation = r.face;
      this.pool.scale.set(depthScale);
      this.pool.alpha = nightLight;
      // 灯随朝向稍微前移
      this.lamp.position.set(Math.cos(r.face) * 10, Math.sin(r.face) * 10 - 6);
      this.lamp.scale.set(0.8 * depthScale);
      this.lamp.alpha = nightLight * 0.9;
    }
  }
}

function packGray(b: number): number {
  const v = Math.max(0, Math.min(255, Math.round(b * 255)));
  return (v << 16) | (v << 8) | v;
}

function mixColor(a: number, b: number, t: number): number {
  const ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255;
  const br = (b >> 16) & 255, bg = (b >> 8) & 255, bb = b & 255;
  const r = Math.round(ar + (br - ar) * t);
  const g = Math.round(ag + (bg - ag) * t);
  const bl = Math.round(ab + (bb - ab) * t);
  return (r << 16) | (g << 8) | bl;
}
