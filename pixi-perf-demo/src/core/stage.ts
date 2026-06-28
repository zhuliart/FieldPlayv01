import { STAGE_W, STAGE_H } from '../data/baseCorners';

// fitBoard：固定 1280×720 设计舞台等比缩放铺满视口（letterbox）+ 移动端双击放大。
// ⚠️ 移动端曾用「竖屏 rotate(90°)」把横屏舞台转正，但 CSS 旋转会破坏触摸坐标映射：
//   - Pixi 命中测试用画布「轴对齐」的 getBoundingClientRect、完全不认 CSS 旋转 → 点地块落点全错（手动模式点不动、无反馈）；
//   - SVG 路网编辑 getScreenCTM 在祖先旋转下坍塌 → 新增节点全堆到画面最左边(x≈0)。
// 故弃用旋转：始终「不旋转、等比缩放」（与桌面/横屏一致、坐标正确）；竖屏给非阻断提示，引导旋转到横屏获得大画面。
//
// 双击放大（仅触摸）：在 fit 基准缩放之上再叠一层 translate+scale 变换。因为 Pixi/SVG 命中都用
// getBoundingClientRect（返回变换后的真实屏幕矩形），所以放大后点击坐标仍然正确 → 放大状态下照样能操作。
export function installFitBoard(root: HTMLElement, onScale?: (scale: number) => void): () => void {
  const ZOOM_IN = 2.2; // 双击放大倍数（相对 fit）
  let baseScale = 1; // fit 基准缩放
  let zoom = 1; // 1=贴合；>1=放大
  let panX = 0, panY = 0; // 屏幕像素平移（叠加在居中之上）

  const viewport = () => {
    const vv = window.visualViewport;
    return { W: (vv && vv.width) || window.innerWidth, H: (vv && vv.height) || window.innerHeight };
  };

  const clampPan = () => {
    const { W, H } = viewport();
    const s = baseScale * zoom;
    const maxTX = Math.max(0, (STAGE_W / 2) * s - W / 2); // 舞台比视口宽才允许平移，且不露出舞台外的空白
    const maxTY = Math.max(0, (STAGE_H / 2) * s - H / 2);
    panX = Math.max(-maxTX, Math.min(maxTX, panX));
    panY = Math.max(-maxTY, Math.min(maxTY, panY));
  };

  const applyTransform = () => {
    root.style.transform = `translate(${panX.toFixed(2)}px, ${panY.toFixed(2)}px) scale(${(baseScale * zoom).toFixed(4)})`;
    onScale?.(baseScale * zoom); // 让 Pixi 按显示像素提分辨率（放大也清晰；onScale 内部已对分辨率封顶）
  };

  const apply = () => {
    const { W, H } = viewport();
    if (!W || !H) return;
    baseScale = Math.min(W / STAGE_W, H / STAGE_H);
    clampPan();
    applyTransform();
    // 竖屏（触摸设备）提示横屏：画面仍可用（满宽横条），只是较小 → 非阻断提示，旋转后自动消失
    const touch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
    const hint = document.getElementById('fp-rotate-hint');
    if (hint) hint.style.display = touch && H > W ? 'flex' : 'none';
  };

  // —— 双击放大（仅触摸）——
  // 双击画面：贴合态→放大并把双击点居中；放大态→复位贴合。在捕获阶段处理 → 第二击在到达 canvas/SVG 前被吞掉，
  // 不会误触发地块操作/加节点（视图/托管模式下单击本就无操作，最干净；手动/路网编辑下仅首击可能触发一次，可接受）。
  let lastT = 0, lastX = 0, lastY = 0;
  const onUp = (e: PointerEvent) => {
    if (e.pointerType !== 'touch') return; // 仅触摸设备；桌面双击不缩放
    const t = e.target as (HTMLElement & { ownerSVGElement?: unknown }) | null;
    const onGame = !!t && (t.tagName === 'CANVAS' || t.id === 'fp-root' || t.tagName === 'svg' || t.ownerSVGElement != null);
    const dt = e.timeStamp - lastT;
    const near = Math.abs(e.clientX - lastX) < 30 && Math.abs(e.clientY - lastY) < 30;
    if (onGame && dt > 0 && dt < 300 && near) {
      e.preventDefault();
      e.stopPropagation(); // 吞掉第二击 → 不落到 Pixi/SVG
      lastT = 0;
      if (zoom > 1) { zoom = 1; panX = 0; panY = 0; } // 已放大 → 复位
      else {
        const r = root.getBoundingClientRect(); // 当前（贴合）屏幕矩形 → 反推双击点的游戏坐标
        const px = ((e.clientX - r.left) / r.width) * STAGE_W;
        const py = ((e.clientY - r.top) / r.height) * STAGE_H;
        zoom = ZOOM_IN;
        const s = baseScale * zoom;
        panX = (STAGE_W / 2 - px) * s; // 把双击点移到屏幕中心
        panY = (STAGE_H / 2 - py) * s;
      }
      clampPan();
      applyTransform();
      return;
    }
    lastT = e.timeStamp; lastX = e.clientX; lastY = e.clientY;
  };
  window.addEventListener('pointerup', onUp, { capture: true });

  apply();
  window.addEventListener('resize', apply);
  window.addEventListener('orientationchange', apply);
  if (window.visualViewport) window.visualViewport.addEventListener('resize', apply);
  return apply;
}
