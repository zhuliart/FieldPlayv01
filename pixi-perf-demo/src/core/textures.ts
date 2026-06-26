import { Texture } from 'pixi.js';

// 程序化生成纹理（一次性，用 2D canvas 烘焙 → Texture.from）。
// 避免每帧 new、保证 GPU 友好；车灯辉光把原型 CSS「径向渐变 + ellipse mask」精确烘焙进单张 RGBA。

type LStop = { t: number; c: [number, number, number]; a: number };
function lerpStops(stops: LStop[], t: number): [number, number, number, number] {
  if (t <= stops[0].t) return [...stops[0].c, stops[0].a];
  const last = stops[stops.length - 1];
  if (t >= last.t) return [...last.c, last.a];
  for (let i = 0; i < stops.length - 1; i++) {
    const a = stops[i], b = stops[i + 1];
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
 * 车灯光池纹理 —— 精确复刻 H5 原型 lightPoolStyle（FieldPlay.dc.html）：
 *   glow: radial-gradient(ellipse 46% 44% at 63% 50%, rgba(206,166,96,.66), rgba(176,134,74,.32) 44%, rgba(120,92,52,.12) 70%, transparent 86%)
 *   mask: radial-gradient(ellipse 42% 40% at 63% 50%, #000, rgba(0,0,0,.94) 28%, rgba(0,0,0,.55) 54%, rgba(0,0,0,.18) 76%, transparent 92%)
 * 输出 RGB = glow 暖色，alpha = glow.a × mask.a；以 mix-blend-mode:color-dodge 叠在「机身之下、地面之上」，
 * 在夜景里按比例提亮被照的地面/作物、露出本色（黑处仍黑），这才是「照亮」而非贴一团色。
 * 中心偏置 63% 让光斑落在车头前方，sprite 跟随机器人位置、按朝向旋转、按景深缩放。
 */
export function makeLightPoolTexture(w = 360, h = 240): Texture {
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  const ctx = cv.getContext('2d')!;
  const img = ctx.createImageData(w, h);
  const data = img.data;

  // 该纹理现在仅用作「光照遮罩」（其 alpha 形状决定夜间被照对象增强的范围；颜色无意义）：
  // 中心实心(alpha 1.0) → 增强足量显示；外圈柔边 + 噪点溶解 → 边界自然、不是一团有形的光。
  const glow: LStop[] = [
    { t: 0.0, c: [255, 255, 255], a: 1.0 },
    { t: 0.44, c: [255, 255, 255], a: 0.66 },
    { t: 0.7, c: [255, 255, 255], a: 0.28 },
    { t: 0.86, c: [255, 255, 255], a: 0.0 },
  ];
  const mask: LStop[] = [
    { t: 0.0, c: [0, 0, 0], a: 1.0 },
    { t: 0.28, c: [0, 0, 0], a: 0.94 },
    { t: 0.54, c: [0, 0, 0], a: 0.55 },
    { t: 0.76, c: [0, 0, 0], a: 0.18 },
    { t: 0.92, c: [0, 0, 0], a: 0.0 },
  ];

  const cx = 0.63 * w, cy = 0.5 * h;
  const gRx = 0.46 * w, gRy = 0.44 * h;
  const mRx = 0.42 * w, mRy = 0.4 * h;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dg = Math.sqrt(((x - cx) / gRx) * ((x - cx) / gRx) + ((y - cy) / gRy) * ((y - cy) / gRy));
      const dm = Math.sqrt(((x - cx) / mRx) * ((x - cx) / mRx) + ((y - cy) / mRy) * ((y - cy) / mRy));
      const g = lerpStops(glow, dg);
      const m = lerpStops(mask, dm);
      const o = (y * w + x) * 4;
      // 噪点溶解（对齐 H5 noise dissolve）：中心平滑、越靠边越颗粒 → 椭圆边界被打散成「颗粒状淡出」，
      // 不再是一条干净的、像画出来的椭圆轮廓；配合 opacity=nightLight 形成「随昼夜 noise 淡入淡出」。
      const noise = 1 - (1 - m[3]) * (0.55 * Math.random());
      data[o] = g[0];
      data[o + 1] = g[1];
      data[o + 2] = g[2];
      data[o + 3] = Math.round(g[3] * m[3] * noise * 255);
    }
  }
  ctx.putImageData(img, 0, 0);
  // 预乘 alpha（默认）：边缘干净无彩色描边；color-dodge 提亮温和（约 ×1.8），不会过曝成黄团
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

// ── 田间杂草（程序化，多类型）：草丛 / 阔叶 / 蒲公英 / 三叶；按地块杂草率随机生长蔓延 ──
export function makeWeedTextures(): Texture[] {
  return [weedGrass(), weedBroad(), weedDandelion(), weedClover()];
}
function weedCanvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  return [cv, cv.getContext('2d')!];
}
function weedGrass(): Texture {
  const w = 46, h = 52; const [cv, ctx] = weedCanvas(w, h);
  const bx = w / 2, by = h - 2;
  const cols = ['#4f8a32', '#5ea03a', '#6fb348', '#477f2c', '#62a83f'];
  for (let i = 0; i < 7; i++) {
    const t = i / 6 - 0.5;
    const lean = t * 30;
    const tipx = bx + lean, tipy = by - (40 - Math.abs(t) * 20);
    ctx.beginPath();
    ctx.moveTo(bx + t * 5, by);
    ctx.quadraticCurveTo(bx + lean * 0.5, by - 22, tipx, tipy);
    ctx.lineWidth = 3.4; ctx.lineCap = 'round';
    ctx.strokeStyle = cols[i % cols.length];
    ctx.stroke();
  }
  return Texture.from(cv);
}
function weedBroad(): Texture {
  const w = 46, h = 46; const [cv, ctx] = weedCanvas(w, h);
  const bx = w / 2, by = h - 3;
  ctx.strokeStyle = '#4a7a2a'; ctx.lineWidth = 3; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(bx, by - 20); ctx.stroke();
  const leaves: [number, number, number][] = [[-1, 0.5, -0.6], [1, 0.5, 0.6], [-1, 0.95, -0.25], [1, 0.95, 0.25], [0, 1.25, 0]];
  for (const [sx, fy, ang] of leaves) {
    ctx.save(); ctx.translate(bx + sx * 12, by - 12 * fy * 1.6); ctx.rotate(ang);
    const g = ctx.createLinearGradient(0, -8, 0, 8);
    g.addColorStop(0, '#6fb348'); g.addColorStop(1, '#4f8a32');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.ellipse(0, 0, 11, 6.5, 0, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }
  return Texture.from(cv);
}
function weedDandelion(): Texture {
  const w = 44, h = 56; const [cv, ctx] = weedCanvas(w, h);
  const bx = w / 2, by = h - 2;
  ctx.fillStyle = '#4f8a32';
  for (const s of [-1, 1, -0.5, 0.5]) {
    ctx.save(); ctx.translate(bx, by); ctx.rotate(s * 0.5);
    ctx.beginPath(); ctx.ellipse(0, -7, 4.5, 9, 0, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }
  ctx.strokeStyle = '#5ea03a'; ctx.lineWidth = 2.4;
  ctx.beginPath(); ctx.moveTo(bx, by - 6); ctx.lineTo(bx, by - 36); ctx.stroke();
  ctx.fillStyle = '#f4c531';
  ctx.beginPath(); ctx.arc(bx, by - 40, 6.5, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#ffe06a';
  ctx.beginPath(); ctx.arc(bx, by - 41, 3.6, 0, Math.PI * 2); ctx.fill();
  return Texture.from(cv);
}
function weedClover(): Texture {
  const w = 42, h = 40; const [cv, ctx] = weedCanvas(w, h);
  const bx = w / 2, by = h - 2;
  for (const [dx, dy] of [[-9, -16], [0, -22], [9, -16]] as [number, number][]) {
    const tx = bx + dx, ty = by + dy;
    ctx.strokeStyle = '#5ea03a'; ctx.lineWidth = 2; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(tx, ty); ctx.stroke();
    ctx.fillStyle = '#62a83f';
    for (const ang of [-0.9, 0, 0.9]) {
      ctx.save(); ctx.translate(tx, ty); ctx.rotate(ang);
      ctx.beginPath(); ctx.ellipse(0, -5, 4, 5.5, 0, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
  }
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
