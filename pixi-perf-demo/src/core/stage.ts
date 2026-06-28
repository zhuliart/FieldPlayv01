import { STAGE_W, STAGE_H } from '../data/baseCorners';

// fitBoard：固定 1280×720 设计舞台等比缩放铺满视口（letterbox）+ 移动端双指捏合缩放 + 放大后单指拖动平移。
// ⚠️ 移动端曾用「竖屏 rotate(90°)」转正横屏，但 CSS 旋转会破坏触摸坐标（Pixi/SVG 命中用 getBoundingClientRect，
//    不认旋转 → 点击落点全错）→ 已弃用，改为不旋转缩放 + 竖屏提示横屏。
//
// 分层：#fp-root 只受 fit 缩放(baseScale)，承载 HUD 菜单 → 放大时菜单固定可见可点；
//       内层 #fp-game(Pixi 画布 + 路网 SVG)在 fit 之上再叠 zoom+pan → 只放大画面。
//       因 Pixi/SVG 命中都用 getBoundingClientRect（返回叠加变换后的真实屏幕矩形），放大/平移后点击坐标自动仍正确。
//
// 手势：双指捏合 = 缩放（开=放大 / 合=缩小复原，连续、锚定两指中点）；单指拖动(放大态) = 平移；单指轻点 = 种植/作业。
//       三者互不冲突（缩放需两指、平移/操作单指）。缩放范围 [ZOOM_MIN, ZOOM_MAX]。
export function installFitBoard(root: HTMLElement, gameLayer: HTMLElement, onScale?: (scale: number) => void): () => void {
  const ZOOM_MIN = 1, ZOOM_MAX = 3; // 1=贴合(复原)；上限 3×（手机看细节足够、又不至于过糊/过载）
  // 拉伸铺满：横纵各自缩放铺满视口（非等比）→ 无黑边/无白边，但画面会随视口比例轻微变形。
  // bsX/bsY 分轴 → 平移/缩放/触摸坐标换算全部按轴处理，避免拉伸后落点错位。
  let bsX = 1, bsY = 1;
  let zoom = 1; // 1=贴合；>1=放大
  let panX = 0, panY = 0; // 屏幕像素平移（叠加在居中之上）

  const viewport = () => {
    const vv = window.visualViewport;
    return { W: (vv && vv.width) || window.innerWidth, H: (vv && vv.height) || window.innerHeight };
  };

  const clampPan = () => {
    const { W, H } = viewport();
    const sX = bsX * zoom, sY = bsY * zoom; // 画面净缩放（分轴）
    // 平移上限 = 舞台超出视口的一半 +「过卷余量」。过卷余量让最贴边的地块能再往视口里多拖一段 →
    // 否则贴边地块卡在屏幕边缘、还会被左侧 HUD 面板/浏览器边挡住，表现为"拖不到原画面最左/最右"。
    const overX = W * 0.4, overY = H * 0.28;
    const maxTX = Math.max(0, (STAGE_W / 2) * sX - W / 2 + overX);
    const maxTY = Math.max(0, (STAGE_H / 2) * sY - H / 2 + overY);
    panX = Math.max(-maxTX, Math.min(maxTX, panX));
    panY = Math.max(-maxTY, Math.min(maxTY, panY));
  };

  // 应用画面层变换：pan 以屏幕像素记；#fp-game 在 #fp-root(baseScale) 内，故 translate 需 ÷baseScale 抵消父级缩放。
  const applyGame = () => {
    // #fp-game 在 #fp-root(scale bsX,bsY) 内：平移需分轴 ÷bsX/÷bsY 抵消父级非等比缩放
    gameLayer.style.transform = `translate(${(panX / bsX).toFixed(2)}px, ${(panY / bsY).toFixed(2)}px) scale(${zoom.toFixed(4)})`;
    document.body.classList.toggle('fp-zoomed', zoom > 1.001); // 放大态：隐藏世界锚定的浮标(仓库/商店/基站牌，避免错位)
    onScale?.(Math.max(bsX, bsY) * zoom); // 按较大轴的放大倍率提分辨率（保清晰；onScale 内部已封顶）
  };

  const apply = () => {
    const { W, H } = viewport();
    if (!W || !H) return;
    bsX = W / STAGE_W; bsY = H / STAGE_H; // 拉伸铺满：横纵各自缩放（非等比，无黑边）
    root.style.transform = `scale(${bsX.toFixed(4)}, ${bsY.toFixed(4)})`;
    clampPan();
    applyGame();
    const touch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
    const hint = document.getElementById('fp-rotate-hint');
    if (hint) hint.style.display = touch && H > W ? 'flex' : 'none';
  };

  // —— 触摸手势：双指捏合缩放 + 放大后单指拖动平移 ——
  const isGame = (t: Element | null) =>
    !!t && (t.tagName === 'CANVAS' || t.id === 'fp-game' || t.id === 'fp-root' || t instanceof SVGElement);
  const isNode = (t: Element | null) => !!t && t.getAttribute('data-node') != null; // 路网节点(有 data-node) → 让其自身拖动，不平移

  const pts = new Map<number, { x: number; y: number }>(); // 活跃触摸点
  let pinching = false, startDist = 1, startZoom = 1, aWX = 0, aWY = 0; // 捏合：起始两指间距/缩放 + 锚定的世界点(舞台坐标)
  let panCand = false, panning = false, dX = 0, dY = 0, sPanX = 0, sPanY = 0; // 单指平移

  // 屏幕坐标 → 世界(舞台)坐标：用于把两指中点锚在同一处缩放
  const toWorld = (sx: number, sy: number) => { const { W, H } = viewport(); const sX = bsX * zoom, sY = bsY * zoom; return { wx: STAGE_W / 2 + (sx - W / 2 - panX) / sX, wy: STAGE_H / 2 + (sy - H / 2 - panY) / sY }; };
  const firstTwo = () => { const it = pts.values(); return [it.next().value!, it.next().value!] as const; };
  const beginPinch = () => {
    const [a, b] = firstTwo();
    startDist = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
    startZoom = zoom;
    const w = toWorld((a.x + b.x) / 2, (a.y + b.y) / 2); aWX = w.wx; aWY = w.wy;
    pinching = true; panCand = false; panning = false;
  };

  const onDown = (e: PointerEvent) => {
    if (e.pointerType !== 'touch') return;
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.size >= 2) { beginPinch(); return; } // 双指 → 捏合缩放
    const t = e.target as Element; // 单指：放大态在画面上拖动 → 平移
    if (zoom > 1 && isGame(t) && !isNode(t)) { panCand = true; panning = false; dX = e.clientX; dY = e.clientY; sPanX = panX; sPanY = panY; }
  };
  const onMove = (e: PointerEvent) => {
    if (e.pointerType !== 'touch') return;
    if (pts.has(e.pointerId)) pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinching && pts.size >= 2) { // 捏合：缩放比 = 当前两指距/起始距；锚点(世界)保持在两指中点之下
      const [a, b] = firstTwo();
      const dist = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
      zoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, startZoom * (dist / startDist)));
      const { W, H } = viewport(); const sX = bsX * zoom, sY = bsY * zoom;
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      panX = mx - W / 2 - (aWX - STAGE_W / 2) * sX; panY = my - H / 2 - (aWY - STAGE_H / 2) * sY;
      clampPan(); applyGame();
      e.preventDefault(); e.stopPropagation();
      return;
    }
    if (panCand) {
      if (!panning && Math.abs(e.clientX - dX) + Math.abs(e.clientY - dY) > 8) panning = true;
      if (panning) { panX = sPanX + (e.clientX - dX); panY = sPanY + (e.clientY - dY); clampPan(); applyGame(); e.preventDefault(); e.stopPropagation(); }
    }
  };
  const endPointer = (e: PointerEvent) => {
    if (e.pointerType !== 'touch') return;
    const wasPinch = pinching, wasPan = panning;
    pts.delete(e.pointerId);
    if (pts.size < 2 && pinching) { // 抬起一指 → 结束捏合；接近贴合则吸附复原
      pinching = false;
      if (zoom < 1.06) { zoom = 1; panX = 0; panY = 0; clampPan(); applyGame(); }
    }
    if (pts.size === 0) { panCand = false; panning = false; }
    if (wasPinch || wasPan) { e.preventDefault(); e.stopPropagation(); }
  };
  window.addEventListener('pointerdown', onDown, { capture: true });
  window.addEventListener('pointermove', onMove, { capture: true });
  window.addEventListener('pointerup', endPointer, { capture: true });
  window.addEventListener('pointercancel', endPointer, { capture: true });

  apply();
  window.addEventListener('resize', apply);
  window.addEventListener('orientationchange', apply);
  if (window.visualViewport) window.visualViewport.addEventListener('resize', apply);
  return apply;
}
