import { Texture } from 'pixi.js';

// 程序化生成纹理（一次性，用 2D canvas 烘焙 → Texture.from）。
// 避免每帧 new、保证 GPU 友好；车灯辉光把原型 CSS「径向渐变 + ellipse mask」精确烘焙进单张 RGBA。

type Stop = { t: number; c: [number, number, number]; a: number };

function sampleStops(stops: Stop[], t: number): [number, number, number, number] {
  if (t <= stops[0].t) return [...stops[0].c, stops[0].a];
  const last = stops[stops.length - 1];
  if (t >= last.t) return [...last.c, last.a];
  for (let i = 0; i < stops.length - 1; i++) {
    const a = stops[i];
    const b = stops[i + 1];
    if (t >= a.t && t <= b.t) {
      const f = (t - a.t) / (b.t - a.t || 1);
      return [
        a.c[0] + (b.c[0] - a.c[0]) * f,
        a.c[1] + (b.c[1] - a.c[1]) * f,
        a.c[2] + (b.c[2] - a.c[2]) * f,
        a.a + (b.a - a.a) * f,
      ];
    }
  }
  return [...last.c, last.a];
}

/**
 * 车灯光池纹理 —— 把原型两段 CSS 渐变烘焙成一张：
 *   glow: radial-gradient(ellipse 46% 44% at 63% 50%, rgba(206,166,96,.66), rgba(176,134,74,.32) 44%, rgba(120,92,52,.12) 70%, transparent 86%)
 *   mask: radial-gradient(ellipse 42% 40% at 63% 50%, #000, rgba(0,0,0,.94) 28%, rgba(0,0,0,.55) 54%, rgba(0,0,0,.18) 76%, transparent 92%)
 * 输出 alpha = glow.a × mask.a；偏置 63% 让光斑落在车头前方，配合 sprite 旋转跟随朝向。
 * 用 screen/add（默认，近似辉光）或 color-dodge（严格还原）混合。
 */
export function makeLightPoolTexture(w = 360, h = 240): Texture {
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  const ctx = cv.getContext('2d')!;
  const img = ctx.createImageData(w, h);
  const data = img.data;

  const glow: Stop[] = [
    { t: 0.0, c: [206, 166, 96], a: 0.66 },
    { t: 0.44, c: [176, 134, 74], a: 0.32 },
    { t: 0.7, c: [120, 92, 52], a: 0.12 },
    { t: 0.86, c: [0, 0, 0], a: 0.0 },
  ];
  const mask: Stop[] = [
    { t: 0.0, c: [0, 0, 0], a: 1.0 },
    { t: 0.28, c: [0, 0, 0], a: 0.94 },
    { t: 0.54, c: [0, 0, 0], a: 0.55 },
    { t: 0.76, c: [0, 0, 0], a: 0.18 },
    { t: 0.92, c: [0, 0, 0], a: 0.0 },
  ];

  const cx = 0.63 * w;
  const cy = 0.5 * h;
  const gRx = 0.46 * w, gRy = 0.44 * h;
  const mRx = 0.42 * w, mRy = 0.4 * h;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dgx = (x - cx) / gRx;
      const dgy = (y - cy) / gRy;
      const dg = Math.sqrt(dgx * dgx + dgy * dgy);
      const dmx = (x - cx) / mRx;
      const dmy = (y - cy) / mRy;
      const dm = Math.sqrt(dmx * dmx + dmy * dmy);
      const g = sampleStops(glow, dg);
      const m = sampleStops(mask, dm);
      const a = g[3] * m[3];
      const o = (y * w + x) * 4;
      data[o] = g[0];
      data[o + 1] = g[1];
      data[o + 2] = g[2];
      data[o + 3] = Math.round(a * 255);
    }
  }
  ctx.putImageData(img, 0, 0);
  return Texture.from(cv);
}

// 圆形软光（车头灯 / 通用辉光）
export function makeSoftCircleTexture(size = 128, color = '#fff6d8'): Texture {
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const ctx = cv.getContext('2d')!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, color);
  g.addColorStop(0.4, hexA(color, 0.55));
  g.addColorStop(1, hexA(color, 0));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return Texture.from(cv);
}

// 水滴（浇水粒子）—— 上窄下圆，带高光
export function makeDropletTexture(): Texture {
  const w = 24, h = 36;
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  const ctx = cv.getContext('2d')!;
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, '#dff3ff');
  g.addColorStop(1, '#5ab6ee');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(w / 2, 1);
  ctx.bezierCurveTo(w, h * 0.45, w, h * 0.85, w / 2, h - 1);
  ctx.bezierCurveTo(0, h * 0.85, 0, h * 0.45, w / 2, 1);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,.6)';
  ctx.beginPath();
  ctx.ellipse(w * 0.38, h * 0.58, 2.2, 3.4, 0, 0, Math.PI * 2);
  ctx.fill();
  return Texture.from(cv);
}

// 肥料颗粒（圆角小方块）
export function makeGrainTexture(color: string): Texture {
  const s = 14;
  const cv = document.createElement('canvas');
  cv.width = cv.height = s;
  const ctx = cv.getContext('2d')!;
  ctx.fillStyle = color;
  roundRect(ctx, 1, 1, s - 2, s - 2, 3);
  ctx.fill();
  return Texture.from(cv);
}

// 涟漪 / 生长爆发环（描边椭圆）
export function makeRingTexture(color: string): Texture {
  const w = 128, h = 64;
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  const ctx = cv.getContext('2d')!;
  ctx.strokeStyle = color;
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.ellipse(w / 2, h / 2, w / 2 - 4, h / 2 - 4, 0, 0, Math.PI * 2);
  ctx.stroke();
  return Texture.from(cv);
}

// 星点（夜空）
export function makeStarTexture(): Texture {
  const s = 8;
  const cv = document.createElement('canvas');
  cv.width = cv.height = s;
  const ctx = cv.getContext('2d')!;
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  g.addColorStop(0, '#ffffff');
  g.addColorStop(0.5, 'rgba(255,255,255,.5)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
  return Texture.from(cv);
}

// 1×1 白纹理（用于整屏 tint 矩形 / multiply / screen 层）
export function makeWhiteTexture(): Texture {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 2;
  const ctx = cv.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, 2, 2);
  return Texture.from(cv);
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function hexA(hex: string, a: number): string {
  // 支持 #rrggbb
  const m = hex.replace('#', '');
  const r = parseInt(m.slice(0, 2), 16);
  const g = parseInt(m.slice(2, 4), 16);
  const b = parseInt(m.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${a})`;
}
