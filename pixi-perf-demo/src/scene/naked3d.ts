// 裸眼 3D 模式（按 P）—— 破框（break-frame）效果
// ─────────────────────────────────────────────────────────────────────────────
// 经典大屏裸眼 3D 戏法：银色相框 = 一扇「窗」。留在框内的内容在玻璃之后；
// 画在框「之上」、越过框边的内容（前景大植株的叶/穗）则冲到玻璃之前、朝观众弹出。
// 这里在画面最上层叠 frame.png，再把两株写实大植株（酸模/蛇莓）放在框之上的左下/右下角，
// 底部探出银边 → 破框扑出。植株走自循环生长动画（baby→盛放→枯），
// 并跟随 Field 的实时环境色罩(relight)与接地阴影强度(shadowAlpha) → 与场景昼夜/天气光影一致。
//
// z 序（main.ts 注入到 app.stage 顶部）：…游戏… → frameLayer(银框) → heroLayer(破框主角株)。
// 纯叠加层：关闭即隐藏，对游戏本体零影响。

import { Container, Sprite, Texture } from 'pixi.js';
import { STAGE_W, STAGE_H } from '../data/baseCorners';
import type { WeedKind } from './field';

export interface HeroSpec {
  kind: WeedKind;     // 用哪株（已归一化的杂草 kind）
  cx: number;         // 根部 X（舞台坐标）
  by: number;         // 根部 Y（舞台坐标，常略低于 STAGE_H → base 沉到框外、株体破框升起）
  heightPx: number;   // 盛放期目标高
  cycleMs: number;    // 一轮 生长→盛放→枯→重生 的时长
  phase: number;      // 起始相位（0..1）错峰，两株不同步
}

export interface Naked3DOpts {
  frameTex: Texture;
  heroes: HeroSpec[];
  light: () => { relight: number; shadowAlpha: number }; // 取 Field 当前实时光照
  badgeHost: HTMLElement;
  onEnter?: () => void;
  onExit?: () => void;
}

export interface Naked3DHandle {
  toggle(): boolean;
  readonly active: boolean;
  readonly frameLayer: Container; // 银框层（main 加到 stage 顶）
  readonly heroLayer: Container;  // 破框主角层（在银框之上）
  update(dtMS: number): void;
}

const ENV_RAMP = 1400;        // 进/出场包络(ms)
const stageRel = (i: number, n: number) => (n > 1 ? 0.32 + 0.68 * Math.pow(i / (n - 1), 0.8) : 1);

function mul(a: number, b: number): number {
  const r = (((a >> 16) & 255) * ((b >> 16) & 255)) / 255;
  const g = (((a >> 8) & 255) * ((b >> 8) & 255)) / 255;
  const bl = ((a & 255) * ((b & 255))) / 255;
  return (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(bl);
}
function lerpC(a: number, b: number, t: number): number {
  const ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255;
  const br = (b >> 16) & 255, bg = (b >> 8) & 255, bb = b & 255;
  return ((Math.round(ar + (br - ar) * t)) << 16) | ((Math.round(ag + (bg - ag) * t)) << 8) | Math.round(ab + (bb - ab) * t);
}

// 程序生成的软椭圆阴影贴图（白底→可 tint 上色），主角株接地投影用
let SHADOW_TEX: Texture | null = null;
function shadowTex(): Texture {
  if (SHADOW_TEX) return SHADOW_TEX;
  const c = document.createElement('canvas'); c.width = 128; c.height = 128;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(64, 64, 4, 64, 64, 62);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.6, 'rgba(255,255,255,0.55)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad; g.beginPath(); g.arc(64, 64, 62, 0, Math.PI * 2); g.fill();
  SHADOW_TEX = Texture.from(c);
  return SHADOW_TEX;
}

interface HeroRec {
  spec: HeroSpec;
  root: Container;       // 容器（破框升起的偏移 + 呼吸前倾作用在此）
  base: Sprite; over: Sprite; shadow: Sprite;
  t: number;             // 该株累计时间(ms)
}

export function installNaked3D(opts: Naked3DOpts): Naked3DHandle {
  const { frameTex, heroes, light, badgeHost, onEnter, onExit } = opts;

  const frameLayer = new Container(); frameLayer.eventMode = 'none'; frameLayer.visible = false;
  const heroLayer = new Container(); heroLayer.eventMode = 'none'; heroLayer.visible = false;

  // 银框：铺满舞台
  const frame = new Sprite(frameTex);
  frame.width = STAGE_W; frame.height = STAGE_H;
  frameLayer.addChild(frame);

  // 破框主角株
  const recs: HeroRec[] = heroes.map((spec) => {
    const root = new Container();
    const shadow = new Sprite(shadowTex()); shadow.anchor.set(0.5, 0.5); shadow.tint = 0x1c241e;
    const base = new Sprite(); base.anchor.set(0.5, 1);
    const over = new Sprite(); over.anchor.set(0.5, 1);
    root.addChild(shadow, base, over);
    root.position.set(spec.cx, spec.by);
    heroLayer.addChild(root);
    return { spec, root, base, over, shadow, t: spec.phase * spec.cycleMs };
  });

  let active = false, env = 0;

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
    if (active) { refreshBadge(); badge.style.display = 'block'; frameLayer.visible = true; heroLayer.visible = true; onEnter?.(); }
    else { onExit?.(); }
    return active;
  };

  // 单株生长：一轮 = 生长(40%)→盛放保持(25%)→枯萎(25%)→消隐重生(10%)
  const lifeOf = (t: number, cycle: number): { life: number; wither: number; vis: number } => {
    const p = (t % cycle) / cycle;
    if (p < 0.40) return { life: p / 0.40, wither: 0, vis: Math.min(1, p / 0.05) };          // 生长（含出土淡入）
    if (p < 0.65) return { life: 1, wither: 0, vis: 1 };                                       // 盛放保持
    if (p < 0.90) return { life: 1, wither: (p - 0.65) / 0.25, vis: 1 };                       // 枯萎
    return { life: 1, wither: 1, vis: Math.max(0, 1 - (p - 0.90) / 0.10) };                    // 枯株淡出→重生
  };

  const update = (dtMS: number) => {
    const target = active ? 1 : 0;
    env += (target - env) * Math.min(1, (dtMS / ENV_RAMP) * 3);
    if (env < 0.002 && !active) {
      env = 0; frameLayer.visible = false; heroLayer.visible = false; badge.style.display = 'none';
      return;
    }
    frame.alpha = env;

    const { relight, shadowAlpha } = light();
    for (const r of recs) {
      r.t += dtMS;
      const { kind, heightPx } = r.spec;
      const stg = kind.stages, N = stg.length, growN = kind.hasWithered ? N - 1 : N;
      const { life, wither, vis } = lifeOf(r.t, r.spec.cycleMs);
      const alpha = env * vis;
      if (alpha < 0.01) { r.base.visible = r.over.visible = r.shadow.visible = false; continue; }

      const plantH = heightPx * (0.06 + 0.94 * Math.pow(life, 1.12)) * (1 - wither * 0.18);
      // 枯萎转枯褐→久枯灰
      let dark = wither > 0 ? lerpC(0xffffff, 0x7a5f38, wither * 0.85) : 0xffffff;
      if (wither > 0.6) dark = lerpC(dark, 0x8c847a, (wither - 0.6) / 0.4 * 0.5);
      const tint = mul(relight, dark);

      // 阶段交叉淡入 / 成熟→枯萎溶解（与 drawWeed 同构，自包含简版）
      let baseStage: number, overStage: number, overAlpha: number, dissolve: boolean;
      if (wither > 0) { baseStage = growN - 1; overStage = N - 1; overAlpha = kind.hasWithered ? Math.min(1, wither / 0.55) : 0; dissolve = true; }
      else { const f = life * growN; baseStage = Math.min(growN - 1, Math.floor(f)); const frac = Math.min(1, f - baseStage); overStage = Math.min(growN - 1, baseStage + 1); overAlpha = baseStage < growN - 1 ? Math.max(0, (frac - 0.3) / 0.7) : 0; dissolve = false; }

      const setStage = (sp: Sprite, idx: number, a: number) => {
        if (sp.texture !== stg[idx]) sp.texture = stg[idx];
        sp.scale.set(plantH / (stageRel(idx, N) * (stg[idx].height || 1)));
        sp.tint = tint; sp.alpha = a; sp.visible = a > 0.003;
      };
      setStage(r.base, baseStage, dissolve ? alpha * (1 - overAlpha) : alpha);
      if (overAlpha > 0.003 && overStage !== baseStage) setStage(r.over, overStage, alpha * overAlpha);
      else r.over.visible = false;

      // 接地软阴影（朝右下，浓度随场景实时 shadowAlpha）
      const w = (r.base.texture.width || 100) * r.base.scale.x;
      r.shadow.visible = true;
      r.shadow.position.set(w * 0.14, -plantH * 0.015);
      r.shadow.scale.set((w * 0.85) / 128, (w * 0.34) / 128);
      r.shadow.alpha = alpha * shadowAlpha * (1 - wither * 0.5);

      // 入场：自上轻微沉降到位（不向下越过底边 → 避免入场瞬间被屏幕下缘裁切而"露陷"）
      r.root.y = r.spec.by - (1 - env) * 30;
    }
  };

  return { toggle, get active() { return active; }, frameLayer, heroLayer, update };
}
