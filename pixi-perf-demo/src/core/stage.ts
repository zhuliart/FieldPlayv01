import { STAGE_W, STAGE_H } from '../data/baseCorners';

// fitBoard：固定 1280×720 设计舞台等比缩放铺满视口（letterbox）+ 移动端双击放大 + 放大后单指拖动平移。
// ⚠️ 移动端曾用「竖屏 rotate(90°)」转正横屏，但 CSS 旋转会破坏触摸坐标（Pixi/SVG 命中用 getBoundingClientRect，
//    不认旋转 → 点击落点全错）→ 已弃用，改为不旋转缩放 + 竖屏提示横屏。
//
// 分层：#fp-root 只受 fit 缩放(baseScale)，承载 HUD 菜单 → 放大时菜单固定可见可点；
//       内层 #fp-game(Pixi 画布 + 路网 SVG)在 fit 之上再叠 zoom+pan → 只放大画面。
//       因 Pixi/SVG 命中都用 getBoundingClientRect（返回叠加变换后的真实屏幕矩形），放大/平移后点击坐标自动仍正确。
export function installFitBoard(root: HTMLElement, gameLayer: HTMLElement, onScale?: (scale: number) => void): () => void {
  const ZOOM_IN = 2.2; // 双击放大倍数（相对 fit）
  let baseScale = 1;
  let zoom = 1; // 1=贴合；>1=放大
  let panX = 0, panY = 0; // 屏幕像素平移（叠加在居中之上）

  const viewport = () => {
    const vv = window.visualViewport;
    return { W: (vv && vv.width) || window.innerWidth, H: (vv && vv.height) || window.innerHeight };
  };

  const clampPan = () => {
    const { W, H } = viewport();
    const s = baseScale * zoom; // 画面净缩放
    // 平移上限 = 舞台超出视口的一半 +「过卷余量」。过卷余量让最贴边的地块能再往视口里多拖一段 →
    // 否则贴边地块卡在屏幕边缘、还会被左侧 HUD 面板/浏览器边挡住，表现为"拖不到原画面最左/最右"。
    const overX = W * 0.4, overY = H * 0.28;
    const maxTX = Math.max(0, (STAGE_W / 2) * s - W / 2 + overX);
    const maxTY = Math.max(0, (STAGE_H / 2) * s - H / 2 + overY);
    panX = Math.max(-maxTX, Math.min(maxTX, panX));
    panY = Math.max(-maxTY, Math.min(maxTY, panY));
  };

  // 应用画面层变换：pan 以屏幕像素记；#fp-game 在 #fp-root(baseScale) 内，故 translate 需 ÷baseScale 抵消父级缩放。
  const applyGame = () => {
    gameLayer.style.transform = `translate(${(panX / baseScale).toFixed(2)}px, ${(panY / baseScale).toFixed(2)}px) scale(${zoom.toFixed(4)})`;
    document.body.classList.toggle('fp-zoomed', zoom > 1.001); // 放大态：隐藏世界锚定的浮标(仓库/商店/基站牌，避免错位)
    onScale?.(baseScale * zoom); // 让 Pixi 按显示像素提分辨率（放大也清晰；onScale 内部已封顶）
  };

  const apply = () => {
    const { W, H } = viewport();
    if (!W || !H) return;
    baseScale = Math.min(W / STAGE_W, H / STAGE_H);
    root.style.transform = `scale(${baseScale.toFixed(4)})`; // #fp-root 只受 fit 缩放（菜单层）
    clampPan();
    applyGame();
    const touch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
    const hint = document.getElementById('fp-rotate-hint');
    if (hint) hint.style.display = touch && H > W ? 'flex' : 'none';
  };

  // —— 触摸手势：双击放大/复位 + 放大后单指拖动平移 ——
  const isGame = (t: Element | null) =>
    !!t && (t.tagName === 'CANVAS' || t.id === 'fp-game' || t.id === 'fp-root' || t instanceof SVGElement);
  const isNode = (t: Element | null) => !!t && t.getAttribute('data-node') != null; // 路网节点(有 data-node) → 让其自身拖动，不平移

  let lastT = 0, lastX = 0, lastY = 0;             // 双击计时
  let panCand = false, panning = false;            // 平移：候选 / 已激活
  let dX = 0, dY = 0, sPanX = 0, sPanY = 0;        // 平移起点

  const onDown = (e: PointerEvent) => {
    if (e.pointerType !== 'touch' || zoom <= 1) return; // 仅触摸、放大态进入平移候选（种植模式也允许：拖动=平移、点击=种植）
    const t = e.target as Element;
    if (!isGame(t) || isNode(t)) return; // 非画面 / 在路网节点上(让其自身拖动) → 不平移
    panCand = true; panning = false; dX = e.clientX; dY = e.clientY; sPanX = panX; sPanY = panY;
  };
  const onMove = (e: PointerEvent) => {
    if (!panCand || e.pointerType !== 'touch') return;
    if (!panning && Math.abs(e.clientX - dX) + Math.abs(e.clientY - dY) > 8) panning = true;
    if (panning) {
      panX = sPanX + (e.clientX - dX); panY = sPanY + (e.clientY - dY);
      clampPan(); applyGame();
      e.preventDefault(); e.stopPropagation(); // 平移期间吞掉事件 → 不触发地块操作/加节点
    }
  };
  const onUp = (e: PointerEvent) => {
    if (e.pointerType !== 'touch') return;
    if (panning) { e.preventDefault(); e.stopPropagation(); panning = false; panCand = false; lastT = 0; return; }
    panCand = false;
    const t = e.target as Element;
    const dt = e.timeStamp - lastT;
    const near = Math.abs(e.clientX - lastX) < 30 && Math.abs(e.clientY - lastY) < 30;
    if (isGame(t) && dt > 0 && dt < 300 && near) { // 双击
      e.preventDefault(); e.stopPropagation(); lastT = 0;
      if (zoom > 1) { zoom = 1; panX = 0; panY = 0; } // 已放大 → 复位
      else { // 放大并把双击点移到屏幕中心
        const r = gameLayer.getBoundingClientRect();
        const px = ((e.clientX - r.left) / r.width) * STAGE_W;
        const py = ((e.clientY - r.top) / r.height) * STAGE_H;
        zoom = ZOOM_IN;
        const s = baseScale * zoom;
        panX = (STAGE_W / 2 - px) * s; panY = (STAGE_H / 2 - py) * s;
      }
      clampPan(); applyGame();
      return;
    }
    lastT = e.timeStamp; lastX = e.clientX; lastY = e.clientY;
  };
  window.addEventListener('pointerdown', onDown, { capture: true });
  window.addEventListener('pointermove', onMove, { capture: true });
  window.addEventListener('pointerup', onUp, { capture: true });

  apply();
  window.addEventListener('resize', apply);
  window.addEventListener('orientationchange', apply);
  if (window.visualViewport) window.visualViewport.addEventListener('resize', apply);
  return apply;
}
