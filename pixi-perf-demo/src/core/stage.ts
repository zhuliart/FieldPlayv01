import { STAGE_W, STAGE_H } from '../data/baseCorners';

// fitBoard：固定 1280×720 设计舞台等比缩放铺满视口（letterbox）。
// ⚠️ 移动端曾用「竖屏 rotate(90°)」把横屏舞台转正，但 CSS 旋转会破坏触摸坐标映射：
//   - Pixi 命中测试用画布「轴对齐」的 getBoundingClientRect，完全不认 CSS 旋转 → 点地块落点全错（手动模式点不动、无反馈）；
//   - SVG 路网编辑 getScreenCTM 在祖先旋转下坍塌 → 新增节点全堆到画面最左边(x≈0)。
// 故弃用旋转：始终「不旋转、等比缩放」（与桌面/横屏一致、坐标正确）；竖屏时给非阻断提示，引导旋转到横屏获得大画面。
export function installFitBoard(root: HTMLElement, onScale?: (scale: number) => void): () => void {
  const apply = () => {
    const vv = window.visualViewport;
    const W = (vv && vv.width) || window.innerWidth;
    const H = (vv && vv.height) || window.innerHeight;
    if (!W || !H) return;
    const touch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
    const portrait = H > W;
    const scale = Math.min(W / STAGE_W, H / STAGE_H);
    root.style.transform = `scale(${scale})`;
    // 竖屏（触摸设备）提示横屏：画面仍可用（满宽横条），只是较小 → 非阻断提示，旋转后自动消失
    const hint = document.getElementById('fp-rotate-hint');
    if (hint) hint.style.display = touch && portrait ? 'flex' : 'none';
    // 上报适配缩放 → 让 Pixi 画布按实际显示像素提分辨率（CSS 放大位图会糊，提分辨率才锐）
    onScale?.(scale);
  };
  apply();
  window.addEventListener('resize', apply);
  window.addEventListener('orientationchange', apply);
  if (window.visualViewport) window.visualViewport.addEventListener('resize', apply);
  return apply;
}
