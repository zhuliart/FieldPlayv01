import { defineConfig, type Plugin } from 'vite';
import { createReadStream, existsSync, statSync, cpSync } from 'node:fs';
import { resolve, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * 复用仓库根目录的 `assets/`（36 背景 / 作物 / 状态 / 杂草），不复制进本工程，
 * 保持仓库无重复美术：
 *  - 开发期：用中间件把 /assets/** 直出 ../assets 下的真实文件。
 *  - 构建期：把 ../assets 整体拷进 dist/assets，产出自包含、可丢到任意静态服务器的版本。
 * 这样画面与原型用的是同一套图，性能对比才公平（任务书〇章「唯一变量＝渲染方式」）。
 */
function sharedAssets(): Plugin {
  const assetsDir = resolve(__dirname, '..', 'assets');
  const MIME: Record<string, string> = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
  };
  return {
    name: 'fieldplay-shared-assets',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!req.url || !req.url.startsWith('/assets/')) return next();
        const clean = decodeURIComponent(req.url.split('?')[0]).replace(/^\/assets\//, '');
        const file = resolve(assetsDir, clean);
        if (!file.startsWith(assetsDir) || !existsSync(file) || !statSync(file).isFile()) {
          return next();
        }
        res.setHeader('Content-Type', MIME[extname(file).toLowerCase()] || 'application/octet-stream');
        res.setHeader('Cache-Control', 'no-cache');
        createReadStream(file).pipe(res);
      });
    },
    closeBundle() {
      const out = resolve(__dirname, 'dist', 'assets');
      if (existsSync(assetsDir)) {
        cpSync(assetsDir, out, { recursive: true });
        // eslint-disable-next-line no-console
        console.log('[fieldplay] copied shared assets -> dist/assets');
      }
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [sharedAssets()],
  // 资源版本号：构建时间戳注入到代码常量，供 av() 给图片 URL 加 ?v= 做缓存失效（见 core/assetVer.ts）
  define: {
    __ASSET_VER__: JSON.stringify(String(Date.now())),
  },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1500,
  },
});
