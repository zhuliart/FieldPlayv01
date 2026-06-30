// 裸眼 3D 模式（按 P 循环）—— 破框（break-frame）多场景展示
// ─────────────────────────────────────────────────────────────────────────────
// 银色相框 = 一扇「窗」。留框内的内容在玻璃后；画在框「之上」、压过银边内沿的前景元素
// （花丛/机器人/昆虫）冲到玻璃前、朝观众弹出。背景=游戏本体（框内即当前农场画面）。
// 多套「场景」(各=一个画框 + 若干破框元素，按用户 demo 组装)；P 键循环：关 → 场景1 → 场景2 → 关。
//
// 三条铁律（勿回退）：① 元素压银边内沿出框（不缩在框内）；② 整体留在画框外边界(舞台 0..1280×0..720)以内、
// 不被屏幕边缘裁切（露陷）；③ 框与元素全程不透明（框中心透明=PNG 自带 alpha=窗口）。
// 动效极简：植物轻微偶尔随风摆（绕根锚点）；昆虫/机器人静止。
// 单独打光：与画面互补的室内顶光（场景冷→元素暖、场景暖→元素冷，恒亮，展柜射灯感）。
//
// z 序（main 注入 stage 顶）：…游戏… → 当前场景容器(画框 → 破框元素)。

import { Container, Sprite, Texture } from 'pixi.js';
import { STAGE_W, STAGE_H } from '../data/baseCorners';

export interface Element {
  tex: Texture;
  cx: number; cy: number; // 位置(舞台坐标)
  heightPx: number;       // 显示高
  anchorY: number;        // 锚点 y：1=底部(花/机器人坐地)，0.5=居中(昆虫贴边框)
  sway: boolean;          // 是否随风摆(植物 true；昆虫/机器人 false)
  phase: number;          // 随风相位错峰
}
export interface Scene { name: string; frameTex: Texture; elements: Element[]; }

export interface Naked3DOpts {
  scenes: Scene[];
  light: () => { lum: number };
  badgeHost: HTMLElement;
  onEnter?: () => void; // 首次进入(从关→某场景)：隐藏 HUD
  onExit?: () => void;  // 退出(→关)：恢复 HUD
}

export interface Naked3DHandle {
  cycle(): void;        // P：关→场景1→场景2→…→关
  readonly active: boolean;
  readonly root: Container; // main 加到 stage 顶
  update(dtMS: number): void;
}

const WIND_AMP = 0.045, WIND_CALM = 0.12;
const TOP_COOL = 0xcdd9ff, TOP_WARM = 0xffd0a0; // 互补顶光：场景暗→暖、场景亮→冷
function lerpColor(a: number, b: number, t: number): number {
  const ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255;
  const br = (b >> 16) & 255, bg = (b >> 8) & 255, bb = b & 255;
  return ((Math.round(ar + (br - ar) * t)) << 16) | ((Math.round(ag + (bg - ag) * t)) << 8) | Math.round(ab + (bb - ab) * t);
}

interface SceneRec { name: string; box: Container; sprites: { sp: Sprite; el: Element }[]; }

export function installNaked3D(opts: Naked3DOpts): Naked3DHandle {
  const { scenes, light, badgeHost, onEnter, onExit } = opts;
  const root = new Container(); root.eventMode = 'none';

  // 预建所有场景容器（画框在底、破框元素在上），只显当前
  const recs: SceneRec[] = scenes.map((sc) => {
    const box = new Container(); box.eventMode = 'none'; box.visible = false;
    const frame = new Sprite(sc.frameTex); frame.width = STAGE_W; frame.height = STAGE_H; box.addChild(frame);
    const sprites = sc.elements.map((el) => {
      const sp = new Sprite(el.tex); sp.anchor.set(0.5, el.anchorY);
      sp.scale.set(el.heightPx / (el.tex.height || 1));
      sp.position.set(el.cx, el.cy);
      box.addChild(sp);
      return { sp, el };
    });
    root.addChild(box);
    return { name: sc.name, box, sprites };
  });

  let idx = -1, t = 0; // idx: -1=关，0..n-1=场景

  // —— 角标 ——
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
    badge.innerHTML = `🖼️ <b>裸眼3D · 破框 ${idx + 1}/${recs.length}</b>（${recs[idx]?.name || ''}）<br>屏幕 ${screen.width}×${screen.height} · 窗口 ${iw}×${ih}<br>比例 ${(iw / Math.max(1, ih)).toFixed(3)} · DPR ${dpr}<br><span style="opacity:.7">按 P 切换/退出</span>`;
  };
  window.addEventListener('resize', () => { if (idx >= 0) refreshBadge(); });

  const show = (i: number) => recs.forEach((r, k) => (r.box.visible = k === i));

  const cycle = (): void => {
    const was = idx;
    idx = idx + 1 >= recs.length ? -1 : idx + 1; // 关→0→1→…→关
    show(idx);
    if (idx >= 0) { refreshBadge(); badge.style.display = 'block'; if (was < 0) onEnter?.(); }
    else { badge.style.display = 'none'; onExit?.(); }
  };

  const update = (dtMS: number) => {
    if (idx < 0) return;
    t += dtMS;
    const { lum } = light();
    const topLight = lerpColor(TOP_COOL, TOP_WARM, Math.max(0, Math.min(1, 1 - lum))); // 互补顶光
    for (const { sp, el } of recs[idx].sprites) {
      sp.tint = topLight; sp.alpha = 1;
      if (el.sway) { // 植物：阵风包络×颤动，绕锚点轻摆
        const gust = Math.max(0, Math.sin(t / 6100 + el.phase) * Math.sin(t / 9300 + el.phase * 1.7));
        sp.rotation = WIND_AMP * (WIND_CALM + (1 - WIND_CALM) * gust) * Math.sin(t / 540 + el.phase * 3);
      }
    }
  };

  return { cycle, get active() { return idx >= 0; }, root, update };
}
