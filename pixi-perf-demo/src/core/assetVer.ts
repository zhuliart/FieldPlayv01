// 资源缓存失效（cache-busting）：
// 图片用固定文件名(如 assets/plant_wheat_s1.png)、无内容哈希，部署后浏览器/CDN 会继续吃旧图，
// 即使代码已更新、硬刷新也未必清得掉。构建期由 vite define 注入 __ASSET_VER__(=构建时间戳)，
// 给每个图片 URL 加 ?v=<ver>；每次构建版本号变 → 浏览器视为新 URL 强制取新图。
// （JS 主包本就带哈希会更新；图片靠这个版本号同步。）
declare const __ASSET_VER__: string;
export const ASSET_VER: string = typeof __ASSET_VER__ === 'string' ? __ASSET_VER__ : 'dev';
export function av(url: string): string {
  return `${url}${url.includes('?') ? '&' : '?'}v=${ASSET_VER}`;
}
