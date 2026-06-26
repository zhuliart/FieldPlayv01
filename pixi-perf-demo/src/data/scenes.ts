// 昼夜 / 天气 / 背景调度算法 —— 全部从原型 FieldPlay.dc.html 原样移植，保证观感与节奏一致。

export type WeatherType = 'clear' | 'cloudy' | 'lightrain' | 'rain' | 'drought' | 'frost';
export type TimeNode = 'dawn' | 'morning' | 'noon' | 'afternoon' | 'evening' | 'night';

export interface DayState {
  mul: { c: [number, number, number]; a: number }; // 正片叠底 tint（夜里压暗/偏冷）
  add: { c: [number, number, number]; a: number }; // 滤色暖/冷洗（暖阳/曙光）
  light: number; // 0..1 夜光强度（驱动车灯）
  star: number; // 0..1 星空
  veil: number;
  clock: string;
  phase: string;
  icon: string;
}

// 16 个昼夜关键帧（t, multiply色/alpha, add色/alpha, light, star, veil）
const DAY_KEYS = [
  { t: 0.0, m: [10, 11, 17], ma: 0.93, a: [0, 0, 0], aa: 0.0, li: 1.0, st: 1.0, v: 0.6 },
  { t: 0.16, m: [9, 10, 16], ma: 0.94, a: [0, 0, 0], aa: 0.0, li: 1.0, st: 1.0, v: 0.62 },
  { t: 0.2, m: [14, 16, 38], ma: 0.87, a: [90, 46, 30], aa: 0.05, li: 0.95, st: 0.72, v: 0.48 },
  { t: 0.235, m: [64, 42, 58], ma: 0.6, a: [255, 120, 70], aa: 0.2, li: 0.58, st: 0.26, v: 0.2 },
  { t: 0.27, m: [200, 142, 112], ma: 0.28, a: [255, 150, 92], aa: 0.15, li: 0.3, st: 0.04, v: 0.05 },
  { t: 0.31, m: [150, 182, 222], ma: 0.2, a: [120, 162, 212], aa: 0.05, li: 0.04, st: 0.0, v: 0.0 },
  { t: 0.38, m: [212, 226, 236], ma: 0.07, a: [0, 0, 0], aa: 0.0, li: 0.0, st: 0.0, v: 0.0 },
  { t: 0.46, m: [255, 255, 255], ma: 0.0, a: [255, 226, 152], aa: 0.05, li: 0.0, st: 0.0, v: 0.0 },
  { t: 0.5, m: [255, 255, 255], ma: 0.0, a: [255, 208, 118], aa: 0.14, li: 0.0, st: 0.0, v: 0.0 },
  { t: 0.58, m: [255, 255, 255], ma: 0.0, a: [255, 214, 138], aa: 0.1, li: 0.0, st: 0.0, v: 0.0 },
  { t: 0.66, m: [255, 236, 202], ma: 0.05, a: [255, 198, 128], aa: 0.07, li: 0.0, st: 0.0, v: 0.0 },
  { t: 0.72, m: [120, 140, 172], ma: 0.23, a: [0, 0, 0], aa: 0.0, li: 0.1, st: 0.0, v: 0.06 },
  { t: 0.78, m: [78, 98, 140], ma: 0.43, a: [0, 0, 0], aa: 0.0, li: 0.36, st: 0.12, v: 0.18 },
  { t: 0.83, m: [36, 42, 80], ma: 0.64, a: [120, 60, 84], aa: 0.05, li: 0.7, st: 0.46, v: 0.36 },
  { t: 0.9, m: [14, 16, 26], ma: 0.9, a: [0, 0, 0], aa: 0.0, li: 0.95, st: 0.9, v: 0.55 },
  { t: 1.0, m: [10, 11, 17], ma: 0.93, a: [0, 0, 0], aa: 0.0, li: 1.0, st: 1.0, v: 0.6 },
];

export function dayState(tod: number): DayState {
  tod = (((tod || 0) % 1) + 1) % 1;
  let i = 0;
  while (i < DAY_KEYS.length - 1 && tod >= DAY_KEYS[i + 1].t) i++;
  const A = DAY_KEYS[i];
  const B = DAY_KEYS[Math.min(i + 1, DAY_KEYS.length - 1)];
  const span = B.t - A.t || 1;
  const f = Math.max(0, Math.min(1, (tod - A.t) / span));
  const L = (x: number, y: number) => x + (y - x) * f;
  const LC = (p: number[], q: number[]): [number, number, number] => [
    Math.round(L(p[0], q[0])), Math.round(L(p[1], q[1])), Math.round(L(p[2], q[2])),
  ];
  const hh = Math.floor(tod * 24);
  const mm = Math.floor(((tod * 24) % 1) * 60);
  const clock = String(hh).padStart(2, '0') + ':' + String(mm).padStart(2, '0');
  let phase = '夜间', icon = '🌙';
  if (tod >= 0.2 && tod < 0.26) { phase = '黎明'; icon = '🌅'; }
  else if (tod >= 0.26 && tod < 0.34) { phase = '清晨'; icon = '🌄'; }
  else if (tod >= 0.34 && tod < 0.46) { phase = '上午'; icon = '🌤️'; }
  else if (tod >= 0.46 && tod < 0.55) { phase = '正午'; icon = '☀️'; }
  else if (tod >= 0.55 && tod < 0.63) { phase = '午后'; icon = '🌞'; }
  else if (tod >= 0.63 && tod < 0.72) { phase = '下午'; icon = '⛅'; }
  else if (tod >= 0.72 && tod < 0.82) { phase = '傍晚'; icon = '🌆'; }
  else if (tod >= 0.82 && tod < 0.9) { phase = '黄昏'; icon = '🌇'; }
  return {
    mul: { c: LC(A.m, B.m), a: L(A.ma, B.ma) },
    add: { c: LC(A.a, B.a), a: L(A.aa, B.aa) },
    light: L(A.li, B.li), star: L(A.st, B.st), veil: L(A.v, B.v), clock, phase, icon,
  };
}

// 背景时段插值区间：当前处于哪两个时段节点之间，以及混合系数 ft（夜→黎明有保持段）
const BG_NODES: { t: number; k: TimeNode }[] = [
  { t: 5 / 24, k: 'dawn' }, { t: 8 / 24, k: 'morning' }, { t: 12 / 24, k: 'noon' },
  { t: 15 / 24, k: 'afternoon' }, { t: 19 / 24, k: 'evening' }, { t: 23 / 24, k: 'night' },
];

export function bgBracket(tod: number): { Ak: TimeNode; Bk: TimeNode; ft: number } {
  tod = (((tod || 0) % 1) + 1) % 1;
  const ss = (x: number, a: number, b: number) => {
    const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
  };
  let ai = -1;
  for (let i = 0; i < BG_NODES.length; i++) if (tod >= BG_NODES[i].t) ai = i;
  if (ai < 0 || ai === BG_NODES.length - 1) {
    const A = BG_NODES[BG_NODES.length - 1];
    const B = BG_NODES[0];
    const span = B.t + (1 - A.t);
    const raw = (ai < 0 ? tod + (1 - A.t) : tod - A.t) / span;
    return { Ak: A.k, Bk: B.k, ft: ss(raw, 0.5, 1.0) };
  }
  const A = BG_NODES[ai];
  const B = BG_NODES[ai + 1];
  return { Ak: A.k, Bk: B.k, ft: Math.max(0, Math.min(1, (tod - A.t) / (B.t - A.t))) };
}

export function wxSet(wxType: WeatherType): string {
  return wxType === 'rain' ? 'wet'
    : wxType === 'drought' ? 'dry'
    : wxType === 'frost' ? 'freezing'
    : wxType === 'cloudy' ? 'cloudy'
    : wxType === 'lightrain' ? 'lightrain'
    : 'normal';
}

export function isDisaster(t: WeatherType): boolean {
  return t === 'rain' || t === 'drought' || t === 'frost';
}

// 各 (天气×时段) 场景的土壤环境色 —— 用于把作物/状态图重打光到当前场景亮度
const AMB: Record<string, [number, number, number]> = {
  normal_dawn: [54, 37, 58], normal_morning: [170, 96, 29], normal_noon: [194, 119, 35], normal_afternoon: [156, 83, 18], normal_evening: [122, 56, 14], normal_night: [33, 33, 59],
  dry_dawn: [103, 70, 73], dry_morning: [184, 121, 56], dry_noon: [202, 147, 85], dry_afternoon: [185, 102, 30], dry_evening: [110, 53, 28], dry_night: [29, 33, 58],
  freezing_dawn: [95, 100, 148], freezing_morning: [133, 151, 180], freezing_noon: [170, 190, 215], freezing_afternoon: [165, 153, 146], freezing_evening: [99, 73, 113], freezing_night: [16, 35, 76],
  wet_dawn: [38, 39, 60], wet_morning: [107, 110, 122], wet_noon: [119, 114, 110], wet_afternoon: [104, 79, 59], wet_evening: [62, 39, 34], wet_night: [18, 25, 38],
  cloudy_dawn: [64, 47, 51], cloudy_morning: [105, 91, 76], cloudy_noon: [151, 100, 48], cloudy_afternoon: [144, 86, 32], cloudy_evening: [56, 34, 29], cloudy_night: [19, 19, 35],
  lightrain_dawn: [31, 31, 57], lightrain_morning: [96, 91, 93], lightrain_noon: [132, 111, 85], lightrain_afternoon: [84, 60, 32], lightrain_evening: [47, 29, 28], lightrain_night: [11, 23, 47],
};

// 场景绝对亮度（0≈深夜，1≈正午），由混合后的土壤环境色推出 —— 用于重打光作物/状态图
export function sceneLum(tod: number, wxType: WeatherType, wInt: number): number {
  const { Ak, Bk, ft } = bgBracket(tod);
  const SET = wxSet(wxType);
  const wi = SET === 'normal' ? 0 : Math.max(0, Math.min(1, wInt || 0));
  const lerp = (p: number[], q: number[], t: number) => [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t, p[2] + (q[2] - p[2]) * t];
  let a = lerp(AMB['normal_' + Ak], AMB['normal_' + Bk], ft);
  if (SET !== 'normal' && wi > 0.01) {
    const w = lerp(AMB[SET + '_' + Ak], AMB[SET + '_' + Bk], ft);
    a = lerp(a, w, wi);
  }
  const lum = 0.3 * a[0] + 0.59 * a[1] + 0.11 * a[2];
  const REF = 0.3 * 194 + 0.59 * 119 + 0.11 * 35;
  return Math.max(0, Math.min(1.1, lum / REF));
}

// 背景图层合成：最多 4 张候选场景（normal/天气 × 时段 A/B），按目标权重做 over 合成 →
// 沿时间线 + 跨天气过渡读作「一次干净的交叉淡入」。权重≈0 的不渲染（只 1–3 张需要流式解码）。
export interface BgCandidate { key: string; set: string; node: TimeNode; weight: number; opacity: number; url: string }

export function bgLayers(tod: number, wxType: WeatherType, wInt: number): BgCandidate[] {
  const { Ak, Bk, ft } = bgBracket(tod);
  const SET = wxSet(wxType);
  const wi = SET === 'normal' ? 0 : Math.max(0, Math.min(1, wInt || 0));
  const url = (set: string, k: string) => `assets/bg/bg_${set}_${k}.jpg`;
  let cand = [
    { key: 'NA', set: 'normal', node: Ak, weight: (1 - wi) * (1 - ft) },
    { key: 'NB', set: 'normal', node: Bk, weight: (1 - wi) * ft },
    { key: 'WA', set: SET, node: Ak, weight: wi * (1 - ft) },
    { key: 'WB', set: SET, node: Bk, weight: wi * ft },
  ].filter((c) => c.weight > 0.004);
  const tot = cand.reduce((s, c) => s + c.weight, 0) || 1;
  cand.forEach((c) => (c.weight /= tot));
  let cum = 0;
  return cand.map((c) => {
    cum += c.weight;
    const op = Math.min(1, c.weight / cum); // 底层=1，每个上层= w/累计 → 精确 over 合成
    return { key: c.key, set: c.set, node: c.node as TimeNode, weight: c.weight, opacity: op, url: url(c.set, c.node) };
  });
}

// 极端天气生命周期：每个事件走 初起→高潮→尾声，强度 0→峰值→衰减
export function wxIntensity(prog: number): number {
  const p = prog;
  if (p <= 0) return 0;
  if (p < 0.3) return 0.16 + (p / 0.3) * 0.64; // 初起：0.16 → 0.80
  if (p < 0.7) return 0.8 + Math.sin(((p - 0.3) / 0.4) * Math.PI) * 0.2; // 高潮：0.80 → 1.0 → 0.80
  return Math.max(0.04, 0.8 * (1 - (p - 0.7) / 0.3)); // 尾声：0.80 → 0.04
}

export function wxPhase(prog: number): string | null {
  if (prog <= 0) return null;
  return prog < 0.3 ? 'onset' : prog < 0.7 ? 'climax' : 'ending';
}

export const WEATHER_META: Record<string, { icon: string; label: string }> = {
  clear: { icon: '☀️', label: '晴' },
  cloudy: { icon: '⛅', label: '阴天' },
  lightrain: { icon: '🌦️', label: '小雨' },
  rain: { icon: '🌧️', label: '连续暴雨' },
  drought: { icon: '🌵', label: '持续干旱' },
  frost: { icon: '❄️', label: '寒潮霜冻' },
};
