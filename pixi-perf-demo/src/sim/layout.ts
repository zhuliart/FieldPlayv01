import { BASE_CORNERS, type Quad, STAGE_W, STAGE_H } from '../data/baseCorners';
import { CANOPY_W, DENSITY, DENSITY_CAP, LAYOUT_MARGIN, LAYOUT_JITTER, type CropKey } from '../data/crops';

// 田间几何 / 自动布点 —— 移植自原型 autoPoints()，按地块透视在四边形内铺植株点。

export interface PlantPoint {
  x: number; // % of 1672×941（与 BASE_CORNERS 同坐标系）
  y: number;
  depth: number; // 0(近)..1(远)，驱动近大远小
}

export function quadCenterPct(q: Quad): { x: number; y: number } {
  return {
    x: (q[0][0] + q[1][0] + q[2][0] + q[3][0]) / 4,
    y: (q[0][1] + q[1][1] + q[2][1] + q[3][1]) / 4,
  };
}

// % → 舞台像素
export function pctX(x: number): number {
  return (x / 100) * STAGE_W;
}
export function pctY(y: number): number {
  return (y / 100) * STAGE_H;
}

// 自动布点（透视双线性插值 + 稳定抖动）。capBoost 用于压力模式加密。
export function autoPoints(plotId: number, crop: CropKey, q: Quad, capBoost = 0): PlantPoint[] {
  const CW = 1672;
  const CH = 941;
  const [TOP, RIGHT, BOT, LEFT] = q;
  const cen: [number, number] = [
    (TOP[0] + RIGHT[0] + BOT[0] + LEFT[0]) / 4,
    (TOP[1] + RIGHT[1] + BOT[1] + LEFT[1]) / 4,
  ];
  const mg = LAYOUT_MARGIN;
  const insP = (P: number[]): [number, number] => [P[0] + (cen[0] - P[0]) * mg, P[1] + (cen[1] - P[1]) * mg];
  const A = insP(LEFT);
  const B = insP(TOP);
  const C = insP(RIGHT);
  const D = insP(BOT);
  const pdep = Math.abs(BOT[1] - TOP[1]) || 1;
  const widthPx = Math.hypot(((RIGHT[0] - LEFT[0]) / 100) * CW, ((RIGHT[1] - LEFT[1]) / 100) * CH);
  const depthPx = Math.hypot(((BOT[0] - TOP[0]) / 100) * CW, ((BOT[1] - TOP[1]) / 100) * CH);
  const canopyW = (pdep / 100) * CH * (CANOPY_W[crop] || 0.16);
  const cap = (DENSITY_CAP[crop] ?? DENSITY.cap) + capBoost;
  const cols = Math.max(3, Math.min(cap, Math.round(widthPx / (DENSITY.sf * canopyW))));
  const rows = Math.max(3, Math.min(cap, Math.round(depthPx / (DENSITY.sf * 0.85 * canopyW))));
  const jit = LAYOUT_JITTER;
  const rnd = (n: number) => {
    const x = Math.sin(plotId * 131.7 + n * 39.3) * 43758.5453;
    return x - Math.floor(x);
  };
  let k = 0;
  const pts: PlantPoint[] = [];
  for (let ri = 0; ri < rows; ri++) {
    for (let ci = 0; ci < cols; ci++) {
      const u = Math.max(0.02, Math.min(0.98, (ci + 0.5) / cols + (rnd(k * 2) - 0.5) * jit));
      const v = Math.max(0.02, Math.min(0.98, (ri + 0.5) / rows + (rnd(k * 2 + 1) - 0.5) * jit));
      k++;
      const x = (1 - u) * (1 - v) * A[0] + u * (1 - v) * B[0] + u * v * C[0] + (1 - u) * v * D[0];
      const y = (1 - u) * (1 - v) * A[1] + u * (1 - v) * B[1] + u * v * C[1] + (1 - u) * v * D[1];
      const depth = Math.max(0, Math.min(1, (y - TOP[1]) / pdep));
      pts.push({ x, y, depth });
    }
  }
  return pts;
}

export function getQuad(plotId: number): Quad {
  return BASE_CORNERS[plotId];
}

// 每个植株精灵的稳定哈希（大小/倾角抖动），移植自原型字段渲染
export function plantHash(plotId: number, idx: number, n: number): number {
  const sd = (plotId * 131 + idx * 0x9e3779b1 + 0x6d2b79f5) >>> 0;
  let x = (sd ^ (n * 0x9e3779b1)) >>> 0;
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b) >>> 0;
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b) >>> 0;
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}
