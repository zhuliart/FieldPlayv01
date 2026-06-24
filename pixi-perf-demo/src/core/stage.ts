import { STAGE_W, STAGE_H } from '../data/baseCorners';

// fitBoard：固定 1280×720 设计舞台等比缩放铺满视口；移动端竖屏自动 rotate(90°) 横屏适配。
// 逻辑移植自原型 FieldPlay.dc.html fitBoard()。
export function installFitBoard(root: HTMLElement): () => void {
  const apply = () => {
    const vv = window.visualViewport;
    const W = (vv && vv.width) || window.innerWidth;
    const H = (vv && vv.height) || window.innerHeight;
    if (!W || !H) return;
    const touch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
    const portrait = H > W;
    if (touch && portrait) {
      // 竖屏：把 16:9 舞台旋 90° 横过来
      const scale = Math.min(W / STAGE_H, H / STAGE_W);
      root.style.transform = `rotate(90deg) scale(${scale})`;
    } else {
      const scale = Math.min(W / STAGE_W, H / STAGE_H);
      root.style.transform = `scale(${scale})`;
    }
  };
  apply();
  window.addEventListener('resize', apply);
  window.addEventListener('orientationchange', apply);
  if (window.visualViewport) window.visualViewport.addEventListener('resize', apply);
  return apply;
}
