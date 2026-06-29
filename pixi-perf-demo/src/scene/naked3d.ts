// 裸眼 3D 模式（按 P）—— 破框（break-frame）效果
// ─────────────────────────────────────────────────────────────────────────────
// 银色相框 = 一扇「窗」。留在框内的内容在玻璃之后；画在框「之上」、越过银边内沿的前景大植株
// 则冲到玻璃之前、朝观众弹出。两株静态写实植株(酸模/蛇莓)压住左下/右下银边内沿破框扑出，
// 整株完整留在外框以内(不被屏幕边缘裁切→不"露陷")。
//
// 动效极简(按用户要求)：不做生长动画；只做「轻微、偶尔的随风摆动」+ 接地投影。
// 摆动 = 阵风包络(多数时间近静止，偶尔来一阵)×轻微颤动，绕根部旋转，幅度很小。
// 投影/色罩跟随 Field 的实时 relight + shadowAlpha → 与场景昼夜/天气一致。
//
// z 序(main 注入 stage 顶)：…游戏… → frameLayer(银框) → heroLayer(破框主角株)。
// 纯叠加层：关闭即隐藏，对游戏本体零影响。

import { Container, Sprite, Texture } from 'pixi.js';
import { STAGE_W, STAGE_H } from '../data/baseCorners';

export interface HeroSpec {
  tex: Texture;       // 静态成熟植株图(底部对齐)
  cx: number;         // 根部 X(舞台坐标)
  by: number;         // 根部 Y(舞台坐标，略低于框底内沿)
  heightPx: number;   // 显示高(已按"别太大"收敛)
  windPhase: number;  // 随风相位错峰(两株不同步)
}

export interface Naked3DOpts {
  frameTex: Texture;
  heroes: HeroSpec[];
  light: () => { relight: number; shadowAlpha: number };
  badgeHost: HTMLElement;
  onEnter?: () => void;
  onExit?: () => void;
}

export interface Naked3DHandle {
  toggle(): boolean;
  readonly active: boolean;
  readonly frameLayer: Container;
  readonly heroLayer: Container;
  update(dtMS: number): void;
}

const ENV_RAMP = 1400;     // 进/出场包络(ms)
const WIND_AMP = 0.045;    // 随风最大偏转(弧度，~2.6°)：很轻
const WIND_CALM = 0.12;    // 静息底噪比例(无阵风时只剩极轻颤动)

// 程序生成的软椭圆阴影贴图(白底→可 tint 上色)
let SHADOW_TEX: Texture | null = null;
function shadowTex(): Texture {
  if (SHADOW_TEX) return SHADOW_TEX;
  const c = document.createElement('canvas'); c.width = 128; c.height = 128;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(64, 64, 4, 64, 64, 62);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.6, 'rgba(255,255,255,0.5)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad; g.beginPath(); g.arc(64, 64, 62, 0, Math.PI * 2); g.fill();
  SHADOW_TEX = Texture.from(c);
  return SHADOW_TEX;
}

interface HeroRec { spec: HeroSpec; sprite: Sprite; shadow: Sprite; }

export function installNaked3D(opts: Naked3DOpts): Naked3DHandle {
  const { frameTex, heroes, light, badgeHost, onEnter, onExit } = opts;

  const frameLayer = new Container(); frameLayer.eventMode = 'none'; frameLayer.visible = false;
  const heroLayer = new Container(); heroLayer.eventMode = 'none'; heroLayer.visible = false;

  const frame = new Sprite(frameTex);
  frame.width = STAGE_W; frame.height = STAGE_H;
  frameLayer.addChild(frame);

  const recs: HeroRec[] = heroes.map((spec) => {
    const shadow = new Sprite(shadowTex()); shadow.anchor.set(0.5, 0.5); shadow.tint = 0x1c241e;
    const sprite = new Sprite(spec.tex); sprite.anchor.set(0.5, 1); // 根部锚点 → 摆动绕根、随风不移根
    const scale = spec.heightPx / (spec.tex.height || 1);
    sprite.scale.set(scale);
    sprite.position.set(spec.cx, spec.by);
    const w = (spec.tex.width || 100) * scale;
    shadow.position.set(spec.cx + w * 0.1, spec.by - spec.heightPx * 0.01);
    shadow.scale.set((w * 0.8) / 128, (w * 0.3) / 128);
    heroLayer.addChild(shadow, sprite);
    return { spec, sprite, shadow };
  });

  let active = false, env = 0, t = 0;

  // —— 分辨率角标 ——
  const badge = document.createElement('div');
  badge.style.cssText =
    'position:absolute; top:14px; left:14px; z-index:120; display:none; pointer-events:none;' +
    'background:rgba(14,20,32,.74); color:#dfe9f6; font:600 12px/1.5 "Noto Sans SC",ui-monospace,monospace;' +
    'padding:9px 13px; border-radius:11px; box-shadow:0 4px 14px rgba(0,0,0,.34);' +
    'border:1px solid rgba(140,170,210,.22); letter-spacing:.3px; backdrop-filter:blur(3px);';
  badgeHost.appendChild(badge);
  const refreshBadge = () => {
    const dpr = +(window.devicePixelRatio || 1).toFixed(2);
    const iw = window.innerWidth, ih = window.innerHeight;
    badge.innerHTML = `🖼️ <b>裸眼3D · 破框模式</b><br>屏幕 ${screen.width}×${screen.height} · 窗口 ${iw}×${ih}<br>比例 ${(iw / Math.max(1, ih)).toFixed(3)} · DPR ${dpr}<br><span style="opacity:.7">按 P 退出</span>`;
  };
  window.addEventListener('resize', () => { if (active) refreshBadge(); });

  const toggle = (): boolean => {
    active = !active;
    if (active) { refreshBadge(); badge.style.display = 'block'; frameLayer.visible = true; heroLayer.visible = true; env = 0; onEnter?.(); }
    else { frameLayer.visible = false; heroLayer.visible = false; badge.style.display = 'none'; onExit?.(); } // 即时隐藏(不做透明淡出)
    return active;
  };

  const update = (dtMS: number) => {
    if (!active) return; // 关闭即停(已即时隐藏)
    env += (1 - env) * Math.min(1, (dtMS / ENV_RAMP) * 3); // 仅用于入场「沉降」位移(非透明)
    frame.alpha = 1; // 框不透明(中间透明=窗口，靠 PNG 自带 alpha；不叠额外透明效果)
    t += dtMS;

    const { relight, shadowAlpha } = light();
    for (const r of recs) {
      const ph = r.spec.windPhase;
      // 阵风包络：两条慢正弦相乘 → 多数时间≈0(静息)，偶尔同号叠加成一阵风(确定性、无随机)
      const gust = Math.max(0, Math.sin(t / 6100 + ph) * Math.sin(t / 9300 + ph * 1.7));
      const flutter = Math.sin(t / 540 + ph * 3);
      const sway = WIND_AMP * (WIND_CALM + (1 - WIND_CALM) * gust) * flutter;
      r.sprite.rotation = sway;     // 绕根部轻摆(锚点在根 → 不移根)
      r.sprite.tint = relight;      // 实时环境色罩(白天≈白，夜里转冷)
      r.sprite.alpha = 1;           // 植株不透明
      r.shadow.tint = 0x1c241e;
      r.shadow.alpha = shadowAlpha * 0.9; // 阴影本就半透(随实时光照)，与"植株不透明"无关
      r.sprite.y = r.spec.by - (1 - env) * 22; // 入场轻微沉降(位置动效，非透明)
    }
  };

  return { toggle, get active() { return active; }, frameLayer, heroLayer, update };
}
