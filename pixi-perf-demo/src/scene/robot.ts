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
  private lampL: Sprite;
  private lampR: Sprite;
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
    // —— 车头双灯泡发光点（对齐 H5：两颗暖白点 + 柔光晕，screen 叠加，固定在车头不随朝向公转）——
    this.lampL = new Sprite(makeSoftCircleTexture(72, '#fff3cc'));
    this.lampR = new Sprite(makeSoftCircleTexture(72, '#fff3cc'));
    for (const lp of [this.lampL, this.lampR]) {
      lp.anchor.set(0.5);
      lp.blendMode = 'screen';
      this.poolView.addChild(lp);
    }

    this.drawBody();
    this.bodyView.addChild(this.body, this.moduleBox, this.leftEye, this.rightEye);
  }

  setPoolBlend(mode: PoolBlend) {
    this.pool.blendMode = mode;
  }

  /** 暴露光照遮罩 —— 夜间「被照对象增强」(backdrop ColorMatrix) 用它作 mask：
   *  其 alpha 形状(柔边椭圆 + 噪点溶解)随机器人位置/朝向/景深/夜光变化，决定增强只发生在被照区域。 */
  get lightMask(): Sprite { return this.pool; }

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
    // 进入商店/仓库办理时整体隐藏（机身 + 车灯光池）
    this.bodyView.visible = !r.hidden;
    if (r.hidden) {
      this.poolView.visible = false;
      return;
    }
    const dn = dayState(world.tod);
    const nightLight = dn.light;
    // 透视：近(top大)大、远(top小)显著小。加强斜率+下探下限 → 去商店/仓库(top~43-45)时明显缩小，不再和房子一样大
    const depthScale = Math.max(0.28, Math.min(1.5, +(1.0 + (r.top - 73) * 0.026).toFixed(3)));

    // —— 机身 ——
    this.bobT += dtMS;
    const bob = r.moving ? 0 : Math.sin(this.bobT / 414) * 4;
    this.bodyView.position.set(pctX(r.left), pctY(r.top) + bob);
    this.bodyView.scale.set(depthScale);
    this.bodyView.zIndex = r.top; // 与作物按 y(纵深)排序：在某排时被更靠前的高作物遮挡
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
      this.pool.scale.set(depthScale * 1.5); // 照亮范围放大（遮罩本身放大 1.5×）
      this.pool.alpha = nightLight;
      // 双灯泡固定在车头两侧（不随朝向公转），只随景深缩放；地面光池主导「照亮」，灯泡仅作暖白点缀
      const bw = 10 * depthScale, by = 2 * depthScale;
      this.lampL.position.set(-bw, by);
      this.lampR.position.set(bw, by);
      const ls = 0.42 * depthScale;
      this.lampL.scale.set(ls);
      this.lampR.scale.set(ls);
      this.lampL.alpha = this.lampR.alpha = nightLight * 0.5;
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
