// 作物定义 —— 从原型 FieldPlay.dc.html 的 this.CROPS 原样移植（含 5 个生长阶段、成本/售价、形态）。
// 合规：售价/成本只是「让画面繁忙」的假数据驱动，不与任何真实结算挂钩（见 CLAUDE.md 合规红线）。
export type CropKey = 'tomato' | 'lettuce' | 'corn' | 'chili' | 'wheat';

export interface CropDef {
  name: string;
  leaf: string;
  dark: string;
  fruit: string | null;
  tall: boolean;
  head: boolean;
  seed: number;
  sell: number;
  stages: string[];
}

export const CROPS: Record<CropKey, CropDef> = {
  tomato: {
    name: '番茄', leaf: '#4e9c3f', dark: '#357029', fruit: '#e2452f',
    tall: false, head: false, seed: 120, sell: 260,
    stages: ['发芽期', '幼苗期', '开花期', '结果期', '成熟期'],
  },
  lettuce: {
    name: '生菜', leaf: '#86cf45', dark: '#5fa72e', fruit: null,
    tall: false, head: true, seed: 80, sell: 180,
    stages: ['发芽期', '幼苗期', '莲座期', '包心期', '成熟期'],
  },
  corn: {
    name: '玉米', leaf: '#7bbf3c', dark: '#4f8a25', fruit: '#f3c33a',
    tall: true, head: false, seed: 150, sell: 330,
    stages: ['发芽期', '幼苗期', '拔节期', '抽穗期', '成熟期'],
  },
  chili: {
    name: '辣椒', leaf: '#4e9c3f', dark: '#357029', fruit: '#d8392b',
    tall: false, head: false, seed: 100, sell: 220,
    stages: ['发芽期', '幼苗期', '开花期', '结果期', '成熟期'],
  },
  wheat: {
    name: '小麦', leaf: '#8fb24a', dark: '#5f7f2c', fruit: '#d8b84a',
    tall: true, head: false, seed: 90, sell: 200,
    stages: ['发芽期', '分蘖期', '拔节期', '灌浆期', '成熟期'],
  },
};

export const CROP_KEYS: CropKey[] = ['tomato', 'lettuce', 'corn', 'chili', 'wheat'];

// 田间植株渲染参数（移植自原型）：
// 株高占地块纵深的系数（高秆玉米最大、番茄次之，其余默认 0.42）
// 株高占地块纵深的系数：玉米最高最大，番茄次之，辣椒再次，生菜最小（用户调校）
export const PLANT_SIZE: Record<string, number> = { corn: 1.804, tomato: 0.99, chili: 0.588, wheat: 0.74 };
export const PLANT_SIZE_DEFAULT = 0.42; // 生菜（保持原尺寸）

// 各作物成熟所需「墙钟秒数」(rate=1、常规档)：按真实生长周期相对差异定，整体约为旧版(~30s)的 5× →
// 生长更慢更像在"长"，且各作物快慢不同（玉米最久、生菜最快）；压力档内部再 ×2 提速。
export const GROW_SEC: Record<string, number> = { lettuce: 100, chili: 140, tomato: 160, corn: 190, wheat: 175 };

// 每张精灵图「可见根部」占图高的比例 —— 用于把根锚在种植点上（anchor.y）。索引 = stage 0..4
export const CROP_BOTTOM: Record<CropKey, number[]> = {
  tomato: [0.58, 0.671, 0.677, 0.68, 0.683],
  lettuce: [0.645, 0.66, 0.751, 0.77, 0.808],
  corn: [0.835, 0.832, 0.842, 0.842, 0.84],
  chili: [0.59, 0.61, 0.621, 0.631, 0.659],
  wheat: [0.96, 0.96, 0.96, 0.96, 0.96], // 已 trim 紧贴 bbox，根在底部
};

// 冠幅系数（用于自动布点的行列密度）
export const CANOPY_W: Record<string, number> = { corn: 0.135, tomato: 0.15, chili: 0.135, lettuce: 0.18, wheat: 0.12 };

// 自动布点密度配置（原型 densityCfg / layoutMargin / layoutJitter）
export const DENSITY = { sf: 2.55, cap: 5 };
export const LAYOUT_MARGIN = 0.15;
export const LAYOUT_JITTER = 0.03;
