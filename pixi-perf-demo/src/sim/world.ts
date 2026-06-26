import { CROPS, CROP_KEYS, GROW_SEC, type CropKey } from '../data/crops';
import { type WeatherType, wxIntensity, isDisaster } from '../data/scenes';
import { MAP } from '../data/tokens';
import { autoPoints, getQuad, quadCenterPct, type PlantPoint } from './layout';

export interface Slot {
  pt: PlantPoint;
  crop: CropKey;
  growth: number; // 0..400（stage = floor/100）
  rate: number; // 个体生长速率 0.6..1.4
  // —— 应激 / 生命周期状态（移植原型 tick 逐项）——
  moist: number; // 土壤湿度
  dry: number; // 缺水累积 → 达阈值旱死
  flood: number; // 涝渍累积（暴雨）→ 概率烂根
  frost: number; // 受冻累积（霜冻）→ 概率冻死
  parch: number; // 干旱累积
  age: number; // 成熟后老化（过熟枯萎）
  dead: boolean;
  deathKind: '' | 'dry' | 'rot' | 'frozen' | 'aged';
  respawnT: number; // 死亡后重生计时(ms)，保持田间持续繁忙（仅手动模式）
  fallowMS: number; // 收获后翻耕/休耕计时(ms)：>0 时显示裸土翻耕、暂不生长，归零后新苗才开始长
  // 托管轮作生命周期：grow 生长中 / empty 收割后空置(待翻耕) / tilled 已翻耕(待播种)。手动模式恒为 grow。
  phase: 'grow' | 'empty' | 'tilled';
}

// 各 stage 的耐旱阈值（发芽/幼苗脆弱、生长期更耐旱），移植原型 DRY_DEATH
export const DRY_DEATH = [16, 18, 22, 26];

export interface Plot {
  id: number;
  slots: Slot[];
  weeds: number; // 0..3（撂荒杂草等级）
  weedProg: number; // 杂草累积进度（撂荒越久越高）
  roadWeed: number; // 0..3 杂草爬上道路
  roadDmg: boolean; // 路面被杂草破坏
  idle: number; // 闲置 tick 计数（无活株则累加）→ 闲置土地税
  malign: number; // 恶性草(Yellow Dock)侵染度 0..100：快蔓延 / 田里抢营养 / 路上毁路 / 难根除
}

// AI 自主经营学习状态（移植原型 state.ai 的 Q 学习经济）
export interface AIState {
  funds: number; // 经营资金
  q: Record<CropKey, number>; // 各作物收益评分（Q 值，学习中）
  trades: number; // 决策/交易次数
  sells: number; // 出售次数
  harvests: number; // 收获株数
  deaths: number; // 损失株数
  plantings: number; // 播种次数
  explore: number; // ε 探索率（随播种衰减）
  sellThreshold: number; // 售卖阈值（待售库存达此件数即出手，区间[2,9]，按折损自适应）
  storeBias: number; // 囤货/入库倾向（区间[0.1,0.92]，按仓储盈亏自适应）
  wear: number; // 设备老化（低资金时上升 → 机器人变慢）
  fails: number; // 破产次数
  decayLoss: number; // 累计折损损失（遥测）
  feesPaid: number; // 累计仓储费（遥测）
  idleTaxPaid: number; // 累计闲置税（遥测）
  spikeGain: number; // 累计行情尖峰套利收益（遥测）
  last: string; // 最近一条学习/经营播报
}

// 收成库存 / 仓储经济（移植原型 state.econ）：收获入 stock（带新鲜度，随时间折损），
// 机器人据行情/折损择机「出售」或「入库」（入库锁价止损但付仓储费）—— 托管 AI 的经营核心。
export interface EconState {
  stock: Record<CropKey, number>; // 待售库存（收获入此，不直接变现）
  fresh: number; // 库存新鲜度 0.3..1（越陈越贬值）
  wh: Record<CropKey, number>; // 仓库库存（入库后停止折损）
  whBasis: number; // 入库时锁定的价值（用于清仓盈亏学习）
  decay: number; // 折损率 0.02..0.12（均值回归 0.05）
  fee: number; // 单位仓储费 1..10（均值回归 3）
  seedStock: number; // 种子库存（播种消耗，去商店按批采购）
}

export interface RealWx {
  ok: boolean;
  type: WeatherType;
  code: number;
  temp: number;
  label: string;
  at: number;
}

export interface RobotState {
  left: number;
  top: number;
  face: number;
  moving: boolean;
  module: string | null;
  hidden: boolean; // 进入商店/仓库办理时视觉消失
}

export interface Toggles {
  lightPool: boolean;
  bgFade: boolean;
  particles: boolean;
  dayTint: boolean;
  overlays: boolean;
  cropRelight: boolean;
  cropFullShadow: boolean; // 作物全量光影(RT冠层投影,较重) ↔ 关=轻投影(每株接地阴影)
}

export interface Burst {
  plotId: number;
  kind: 'water' | 'fert';
}

// 手动模式工具类型（点地块执行）
export type ManualTool = 'water' | 'fert' | 'harvest' | 'weed' | 'clear' | 'till' | 'cover' | 'drain';

// 田间道路网络（巡田路径）：节点 + 连线，机器人沿道路寻路
export interface RoadNet {
  nodes: { left: number; top: number }[];
  edges: [number, number][];
}

// 机器人当前任务（需求驱动决策的产物）
interface RobotTask {
  kind: 'water' | 'fert' | 'cover' | 'drain' | 'harvest' | 'clear' | 'weed' | 'till' | 'plant' | 'buy' | 'sell' | 'sellwh' | 'store' | 'charge' | 'idle';
  label: string;
  plotId: number; // -1 表示建筑/无地块
  workMs: number; // 到点作业停顿时长（对齐原型 workMs）
  bat: number; // 作业耗电
  atBuilding: boolean; // 目标是建筑（商店/充电站）
}

// 初始种子田（作物 + 起始阶段），移植自原型 seed 表的作物分布意图
const SEED: [CropKey, number][] = [
  ['corn', 4], ['tomato', 4], ['lettuce', 4], ['chili', 4],
  ['wheat', 4], ['tomato', 2], ['corn', 4], ['chili', 3],
  ['tomato', 3], ['lettuce', 4], ['wheat', 3], ['chili', 1],
];

// 经济常量（原样移植原型）
const AI_START = 2500;
const IDLE_LIMIT = 45; // 闲置达此 tick 数才进入课税池
const IDLE_TAX = 44; // 单块闲置税基（每次随机浮动）
const BANKRUPT = -20000; // 资金跌破即破产重置

// 机器人物料库存：作业消耗、去商店补给
type ResKey = 'water' | 'eco' | 'thermal' | 'seed';
const RES_MAX: Record<ResKey, number> = { water: 120, eco: 80, thermal: 50, seed: 60 };
const RES_NAME: Record<ResKey, string> = { water: '水', eco: '生态肥', thermal: '保温材料', seed: '种子' };
// 任务 → 机器人作业模块盒配色（robot.ts 读 module）
const MOD_FOR: Record<string, string> = {
  water: 'water', drain: 'water', fert: 'fert', cover: 'fert', harvest: 'harvest',
  clear: 'fert', weed: 'fert', till: 'harvest', plant: 'fert', buy: 'patrol', sell: 'patrol', sellwh: 'patrol', store: 'patrol', charge: 'patrol', idle: 'patrol',
};

// 农场坐标：四川巴中市南江县南江镇 ≈ 32.353N, 106.843E（实时天气锚点）
const FARM_LAT = 32.353;
const FARM_LON = 106.843;
const WX_POLL_MS = 600000; // 实时天气每 10 分钟刷新一次

// 实时灾害起始播报
const WX_LIVE_MSG: Partial<Record<WeatherType, string>> = {
  rain: '🌧️ 实时天气·暴雨！排水不及将涝害烂根，生长停滞',
  drought: '🌵 实时天气·干旱！作物极易缺水枯死，务必勤浇水',
  frost: '❄️ 实时天气·霜冻！低温冻伤作物，生长停滞甚至冻死',
};
const WX_OFFLINE_MSG: Partial<Record<WeatherType, string>> = {
  rain: '🌧️ 极端天气·连续暴雨！排水不及将涝害烂根，生长停滞',
  drought: '🌵 极端天气·持续干旱！作物极易缺水枯死，务必勤浇水',
  frost: '❄️ 极端天气·寒潮霜冻！低温冻伤作物，生长停滞甚至冻死',
};

export class World {
  tod = 0.34; // 初始上午（原型默认）；live 模式下每帧锁农场当地时间
  todAuto = true;
  todSpeed = 0.0; // 每毫秒推进量（main 里按 dayLengthSec 设定，仅加速模式生效）

  mode: 'manual' | 'auto' = 'auto';
  stress = false;

  // 实时模式：时钟锁农场当地时间(UTC+8) + 天气镜像 Open-Meteo；关闭则进入加速合成演示
  live = true;
  realWx: RealWx | null = null;
  private weatherReal = false; // 当前游戏天气是否由实时数据驱动
  private wxPollAcc = WX_POLL_MS; // 立即首拉
  private wxFetching = false;

  robotAction = '待命中…'; // 托管状态条/气泡文案

  weather: { type: WeatherType; elapsedMS: number; durMS: number } = { type: 'clear', elapsedMS: 0, durMS: 0 };
  private weatherCooldownMS = 4000; // 仅加速模式使用
  private lifeTickAcc = 0;
  private slowAcc = 0; // 慢 tick（市场/杂草/经济）累积器

  // —— 市场行情（均值回归 + 暴涨暴跌），权威模型 ——
  market: Record<CropKey, number> = { tomato: 1, lettuce: 1, corn: 1, chili: 1, wheat: 1 };
  marketPrev: Record<CropKey, number> = { tomato: 1, lettuce: 1, corn: 1, chili: 1, wheat: 1 };
  marketEvent: { k: CropKey; up: boolean } | null = null;

  // —— AI 自主经营学习 ——
  ai: AIState = freshAI();

  // —— 收成库存 / 仓储经济（收获入此，机器人择机出售/入库）——
  econ: EconState = freshEcon();

  // 待消费的播报（HUD 取走后清空）
  pendingToasts: string[] = [];

  plots: Plot[] = [];
  robot: RobotState = { ...MAP.robotHome, face: Math.PI, moving: false, module: null, hidden: false };

  toggles: Toggles = {
    lightPool: true,
    bgFade: true,
    particles: true,
    dayTint: true,
    overlays: true,
    cropRelight: true,
    cropFullShadow: true,
  };

  // 本帧产生的粒子爆发事件（renderer 消费后清空）
  pendingBursts: Burst[] = [];

  // 机器人 AI 状态机（需求驱动：扫描田地选最高优先级任务 → 移动 → 作业/买卖 → 充电）
  res: Record<ResKey, number> = { water: 100, eco: 60, thermal: 30, seed: 40 };
  robotBattery = 86;
  private rPhase: 'decide' | 'move' | 'work' | 'charge' = 'decide';
  private rTask: RobotTask | null = null;
  private rDest: { left: number; top: number } = { left: MAP.robotHome.left, top: MAP.robotHome.top };
  private rWork = 0;
  private rDidTask = false;
  private buyResKey: ResKey | null = null;
  private buySeed = false; // 本次商店行程是否为采购种子批（否则为补给作业物料）

  // 手动模式当前工具（点地块执行）
  manualTool: ManualTool = 'water';

  // 巡田路径（道路网络 + 编辑模式）
  roadNet: RoadNet = { nodes: [], edges: [] };
  roadEditOn = false;
  private rPath: { left: number; top: number }[] = [];
  private rPathIdx = 0;

  constructor() {
    this.seed();
    if (!this.loadRoadNet()) this.seedRoadNet(); // 优先加载本地已保存的巡田路径，没有才用默认路网
    if (this.live) this.tod = this.localTod();
  }

  // ===== 实时天气（Open-Meteo，无 key，CORS）→ 游戏天气。农场：四川巴中南江县 =====
  // 游戏时钟 = 农场当地时间（UTC+8），无论访客所在时区
  localTod(): number {
    const n = new Date();
    const sh = new Date(n.getTime() + n.getTimezoneOffset() * 60000 + 8 * 3600000);
    return (sh.getHours() * 3600 + sh.getMinutes() * 60 + sh.getSeconds()) / 86400;
  }

  // weather_code + 气温 → 游戏天气类型（启发式，移植原型 _mapWx）
  mapWx(code: number | null, temp: number | null): WeatherType {
    if (code == null) return 'clear';
    if ([71, 73, 75, 77, 85, 86].includes(code)) return 'frost'; // 雪/冰 → 冻害
    if ([63, 65, 66, 67, 80, 81, 82, 95, 96, 99].includes(code)) return 'rain'; // 大雨/雷暴 → 暴雨（灾害）
    if ([51, 53, 55, 56, 57, 61].includes(code)) return 'lightrain'; // 毛毛雨/小雨（非灾害）
    if ([2, 3, 45, 48].includes(code)) return 'cloudy'; // 多云/阴/雾
    if ((code === 0 || code === 1) && temp != null && temp >= 34) return 'drought'; // 高温晴 → 干旱（启发式）
    return 'clear';
  }

  wxLabel(code: number | null): string {
    const M: Record<number, string> = {
      0: '晴', 1: '晴', 2: '多云', 3: '阴', 45: '雾', 48: '雾凇', 51: '小雨', 53: '雨', 55: '雨',
      56: '冻雨', 57: '冻雨', 61: '小雨', 63: '中雨', 65: '大雨', 66: '冻雨', 67: '冻雨', 71: '小雪',
      73: '中雪', 75: '大雪', 77: '雪粒', 80: '阵雨', 81: '阵雨', 82: '暴雨', 85: '阵雪', 86: '阵雪',
      95: '雷雨', 96: '雷雨', 99: '雷暴',
    };
    return (code != null && M[code]) || '晴';
  }

  private async fetchRealWx() {
    if (this.wxFetching) return;
    this.wxFetching = true;
    try {
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${FARM_LAT}&longitude=${FARM_LON}&current=weather_code,temperature_2m&timezone=Asia%2FShanghai`;
      const r = await fetch(url, { cache: 'no-store' });
      if (!r.ok) throw new Error('bad status');
      const j = await r.json();
      const c = j.current || {};
      const code = c.weather_code ?? null;
      const temp = c.temperature_2m ?? null;
      this.realWx = { ok: true, type: this.mapWx(code, temp), code, temp, label: this.wxLabel(code), at: Date.now() };
    } catch {
      // 拉取失败：保留上次成功值；若从未成功则标记离线（游戏走随机回退）
      if (!(this.realWx && this.realWx.ok)) {
        this.realWx = { ok: false, type: 'clear', code: 0, temp: 0, label: '', at: Date.now() };
      }
    } finally {
      this.wxFetching = false;
    }
  }

  private pushToast(msg: string) {
    this.pendingToasts.push(msg);
    if (this.pendingToasts.length > 5) this.pendingToasts.shift();
  }

  priceOf(crop: CropKey): number {
    return Math.round(CROPS[crop].sell * (this.market[crop] || 1));
  }

  // 一批收成的市值（Σ 各作物件数 × 实时市价）
  private cropVal(m: Record<CropKey, number>): number {
    let v = 0;
    for (const k of CROP_KEYS) v += (m[k] || 0) * this.priceOf(k);
    return v;
  }
  // 一批收成的总件数
  private cropCount(m: Record<CropKey, number>): number {
    let n = 0;
    for (const k of CROP_KEYS) n += m[k] || 0;
    return n;
  }

  // ε-greedy 选种：先探索，后按「行情毛利 0.55 + 学习 Q 值 0.45」挑期望最高的作物（移植原型 chooseCrop）
  private chooseCrop(): CropKey {
    if (Math.random() < this.ai.explore) return CROP_KEYS[(Math.random() * CROP_KEYS.length) | 0];
    let best: CropKey = CROP_KEYS[0], bestV = -Infinity;
    for (const k of CROP_KEYS) {
      const c = CROPS[k];
      const ev = 0.55 * (c.sell * (this.market[k] || 1) - c.seed) + 0.45 * (this.ai.q[k] || 0);
      if (ev > bestV) { bestV = ev; best = k; }
    }
    return best;
  }

  seed(capBoost = 0) {
    this.plots = [];
    for (let i = 0; i < 12; i++) {
      const [crop, stage] = SEED[i];
      const q = getQuad(i);
      const pts = autoPoints(i, crop, q, capBoost);
      const slots: Slot[] = pts.map((pt) => {
        const gh = (((Math.round(pt.x * 7.3 + pt.y * 13.1) % 100) + 100) % 100) / 100;
        const rate = 0.6 + gh * 0.8;
        return {
          pt, crop, growth: stage * 100, rate,
          moist: stage < 4 ? 5 : 0, dry: 0, flood: 0, frost: 0, parch: 0, age: 0,
          dead: false, deathKind: '' as const, respawnT: 0, fallowMS: 0, phase: 'grow' as const,
        };
      });
      const weeds = i % 4 === 0 ? 2 : i % 3 === 0 ? 1 : 0;
      // 初始 weedProg 与起始 weeds 等级对齐（撂荒进度的反推）
      const weedProg = weeds === 2 ? 60 : weeds === 1 ? 24 : 0;
      // 恶性草初始：仅 1 块轻度侵染做"种源"，随后自行蔓延（避免开局多块作物即长不动）
      this.plots.push({ id: i, slots, weeds, weedProg, roadWeed: 0, roadDmg: false, idle: 0, malign: i === 5 ? 26 : 0 });
    }
  }

  // 全量重置（HUD「重置」按钮）：农田 + 市场 + AI 学习记录全部清空
  resetAll() {
    this.seed(this.stress ? 3 : 0);
    this.market = { tomato: 1, lettuce: 1, corn: 1, chili: 1, wheat: 1 };
    this.marketPrev = { tomato: 1, lettuce: 1, corn: 1, chili: 1, wheat: 1 };
    this.marketEvent = null;
    this.ai = freshAI();
    this.econ = freshEcon();
  }

  // （旧的固定蛇形巡逻 buildPatrol/startSeg 已移除，改为下方需求驱动状态机 stepRobot）

  setStress(on: boolean) {
    if (this.stress === on) return;
    this.stress = on;
    // 压力档：加密植株 + 提升生长/天气频率（在 update 里体现）
    this.seed(on ? 3 : 0);
  }

  update(dtMS: number) {
    this.pendingBursts.length = 0;

    // —— 实时天气轮询（10 分钟）——
    if (this.live) {
      this.wxPollAcc += dtMS;
      if (this.wxPollAcc >= WX_POLL_MS) {
        this.wxPollAcc = 0;
        void this.fetchRealWx();
      }
    }

    // —— 昼夜 ——
    if (this.live) {
      this.tod = this.localTod(); // 实时：时钟锁农场当地时间
    } else if (this.todAuto) {
      this.tod = (this.tod + this.todSpeed * dtMS) % 1; // 加速：合成演示
      if (this.tod < 0) this.tod += 1;
    }

    // —— 慢 tick：市场 / 杂草 / 闲置 / AI 经济（移植原型 2.6s tick 节奏）——
    this.slowAcc += dtMS;
    const slowMS = this.stress ? 1300 : 2600;
    let slowFired = false;
    while (this.slowAcc >= slowMS) {
      this.slowAcc -= slowMS;
      slowFired = true;
      this.slowTick();
    }

    // —— 天气决策（实时镜像 / 加速合成）——
    this.decideWeather(dtMS, slowFired);

    // —— 作物生长（连续，平滑变大）+ 应激/致死生命周期（固定 tick，移植原型）——
    const wInt = this.weatherIntensity();
    const wx = this.weather.type;
    const stressMul = this.stress ? 2 : 1; // 压力档整体提速 2×
    const stall = wx === 'frost' ? 0.15 : wx === 'rain' ? 0.55 : 1; // 极端天气拖慢
    for (const p of this.plots) {
      // 杂草拖慢生长：杂草率 >30% 起拖慢，最多降到 0.35（必须除草，对齐用户要求）
      const weedRate = Math.min(1, p.weedProg / 100);
      const weedFactor = weedRate > 0.3 ? Math.max(0.35, 1 - (weedRate - 0.3) * 1.2) : 1;
      // 恶性草抢营养：侵染 >30 起急剧拖慢，重度几乎让作物长不动（rule3「无法正常生长」）
      const malignFactor = p.malign > 30 ? Math.max(0.08, 1 - ((p.malign - 30) / 100) * 1.4) : 1;
      for (const sl of p.slots) {
        if (sl.dead) {
          // 托管：枯死残株保留，待机器人「清枯」转空地（不自动重生，撂荒→闲置税生效）；手动：短暂展示后自动重生
          if (this.mode !== 'auto') { sl.respawnT -= dtMS; if (sl.respawnT <= 0) this.respawn(sl); }
          continue;
        }
        if (sl.phase !== 'grow') continue; // 空置/已翻耕地块不生长（待播种）
        // 收获后翻耕/休耕期：先显示裸土翻耕，暂不生长（让"耕地→育苗"过程看得见，而非收完瞬间满田新苗）
        if (sl.fallowMS > 0) { sl.fallowMS -= dtMS; continue; }
        if (sl.growth < 400) {
          // 每作物按自身生长周期(GROW_SEC 秒)连续推进：growth 0→400；各株再乘个体 rate(0.6~1.4) → 平滑爬升、每株不同
          const gPerMs = (400 / ((GROW_SEC[sl.crop] || 130) * 1000)) * stressMul;
          const waterFactor = sl.dry > 0 ? 0.25 : 1; // 缺水拖慢生长
          sl.growth += gPerMs * dtMS * sl.rate * (1 - wInt * (1 - stall) * 0.6) * waterFactor * weedFactor * malignFactor;
          if (sl.growth >= 400) sl.growth = 400;
        }
      }
    }
    // 应激/致死按固定节奏跑，保留原型离散阈值与概率
    this.lifeTickAcc += dtMS;
    const tickMS = this.stress ? 1500 : 4000; // 随生长放慢同比拉长：湿度/缺水/致死节奏一起变慢，避免成熟前旱死（防死亡循环）
    while (this.lifeTickAcc >= tickMS) {
      this.lifeTickAcc -= tickMS;
      this.lifeTick();
    }

    // —— 机器人 AI（需求驱动状态机：决策 → 移动 → 作业/买卖 → 充电）——
    this.stepRobot(dtMS);
  }

  // ===== 机器人 AI：需求驱动状态机（对齐原型 aiStep 的任务优先级）=====
  private stepRobot(dtMS: number) {
    if (this.mode !== 'auto') {
      this.robot.moving = false;
      this.robot.module = null;
      this.robotAction = '待命中…';
      this.rPhase = 'decide';
      this.rTask = null;
      return;
    }
    if (this.rPhase === 'move' || this.rPhase === 'work') {
      this.robotBattery = Math.max(0, this.robotBattery - 0.0016 * dtMS); // 移动/作业缓慢耗电
    }
    switch (this.rPhase) {
      case 'decide': this.robotDecide(); break;
      case 'move': this.robotMove(dtMS); break;
      case 'work': this.robotWork(dtMS); break;
      case 'charge': this.robotCharge(dtMS); break;
    }
  }

  // 田边停留点：地块近边（top 较大的两角）中点，略外移到田埂 —— 机器人在地块前作业，不进地中央
  private approachPoint(id: number): { left: number; top: number } {
    const q = getQuad(id);
    const c = quadCenterPct(q);
    const pts = q.map((p) => ({ x: p[0], y: p[1] }));
    pts.sort((a, b) => b.y - a.y);
    const fx = (pts[0].x + pts[1].x) / 2, fy = (pts[0].y + pts[1].y) / 2;
    return { left: fx + (fx - c.x) * 0.18, top: fy + (fy - c.y) * 0.18 };
  }
  private hasYoung(p: Plot): boolean { return p.slots.some((sl) => sl.phase === 'grow' && !sl.dead && sl.growth < 400); }
  private plotHasEmpty(p: Plot): boolean { return p.slots.some((sl) => sl.phase === 'empty'); } // 收割后空置、待翻耕
  private plotTilled(p: Plot): boolean { return p.slots.some((sl) => sl.phase === 'tilled'); } // 已翻耕、待播种

  // 扫描田地，选最高优先级任务：充电→补料→采收→抢险(排水/保温)→浇水→清枯→除草→施肥→卖货→待命
  private robotDecide() {
    const wx = this.weather.type;
    if (this.robotBattery < 14) { // 对齐 H5：电量<14 返回充电
      this.startTask({ kind: 'charge', label: '返回充电', plotId: -1, workMs: 0, bat: 0, atBuilding: true }, MAP.station);
      return;
    }
    const low = this.lowestRes();
    if (low && this.ai.funds > 300) {
      this.buyResKey = low; this.buySeed = false;
      this.startTask({ kind: 'buy', label: '采购' + RES_NAME[low], plotId: -1, workMs: 1100, bat: 3, atBuilding: true }, MAP.shop);
      return;
    }
    const ripe = this.findPlot((p) => p.slots.some((sl) => sl.phase === 'grow' && !sl.dead && sl.growth >= 400));
    if (ripe >= 0) { this.startTask({ kind: 'harvest', label: '采收', plotId: ripe, workMs: 900, bat: 3, atBuilding: false }, this.approachPoint(ripe)); return; }
    if (wx === 'rain') { const t = this.findPlot((p) => this.hasYoung(p)); if (t >= 0) { this.startTask({ kind: 'drain', label: '开沟排水', plotId: t, workMs: 900, bat: 4, atBuilding: false }, this.approachPoint(t)); return; } }
    if (wx === 'frost' && this.res.thermal > 0) { const t = this.findPlot((p) => this.hasYoung(p)); if (t >= 0) { this.startTask({ kind: 'cover', label: '覆盖保温', plotId: t, workMs: 900, bat: 4, atBuilding: false }, this.approachPoint(t)); return; } }
    if (this.res.water > 0 && wx !== 'rain' && wx !== 'frost') { const t = this.thirstiest(); if (t >= 0) { this.startTask({ kind: 'water', label: '浇水', plotId: t, workMs: 720, bat: 3, atBuilding: false }, this.approachPoint(t)); return; } }
    const dead = this.findPlot((p) => p.slots.some((sl) => sl.dead));
    if (dead >= 0) { this.startTask({ kind: 'clear', label: '清枯', plotId: dead, workMs: 600, bat: 3, atBuilding: false }, this.approachPoint(dead)); return; }
    const malignant = this.findPlot((p) => p.malign >= 35); // 恶性草优先：更费时(2800ms)更耗电(9)，且难根除→只能压制（rule3 任务类型/难度）
    if (malignant >= 0) { this.startTask({ kind: 'weed', label: '清除恶性草', plotId: malignant, workMs: 2800, bat: 9, atBuilding: false }, this.approachPoint(malignant)); return; }
    const weedy = this.findPlot((p) => p.weedProg >= 40); // 杂草率达 ~40% 即除草（生长惩罚 30% 起，留缓冲）
    if (weedy >= 0) { this.startTask({ kind: 'weed', label: '除草', plotId: weedy, workMs: 1600, bat: 5, atBuilding: false }, this.approachPoint(weedy)); return; }
    const tillable = this.findPlot((p) => this.plotHasEmpty(p) && !this.hasYoung(p) && !p.slots.some((sl) => sl.dead)); // 整块收割完(无在长/无枯株)才翻耕，避免混茬
    if (tillable >= 0) { this.startTask({ kind: 'till', label: '翻耕整地', plotId: tillable, workMs: 1100, bat: 4, atBuilding: false }, this.approachPoint(tillable)); return; }
    const plantable = this.findPlot((p) => this.plotTilled(p)); // 已翻耕地块补种（对齐 H5：先 buy 种子，后 plant）
    if (plantable >= 0) {
      if (this.econ.seedStock < 3 && this.ai.funds >= 990) { this.buySeed = true; this.startTask({ kind: 'buy', label: '采购种子', plotId: -1, workMs: 1100, bat: 3, atBuilding: true }, MAP.shop); return; }
      if (this.econ.seedStock > 0) { this.startTask({ kind: 'plant', label: '播种', plotId: plantable, workMs: 720, bat: 3, atBuilding: false }, this.approachPoint(plantable)); return; }
    }
    if (wx === 'clear' && this.res.eco > 0) { const t = this.findPlot((p) => this.hasYoung(p)); if (t >= 0) { this.startTask({ kind: 'fert', label: '施肥', plotId: t, workMs: 720, bat: 3, atBuilding: false }, this.approachPoint(t)); return; } }
    // —— 经营决策：清仓仓库 / 择机出售待售库存 / 低价入库（移植原型 wantSellWh/wantSell/wantStore）——
    const e = this.econ;
    const avgMkt = CROP_KEYS.reduce((s, k) => s + (this.market[k] || 1), 0) / CROP_KEYS.length;
    const stockN = this.cropCount(e.stock);
    const whN = this.cropCount(e.wh);
    const sellTh = Math.round(this.ai.sellThreshold);
    const spikeStock = stockN > 0 && CROP_KEYS.some((c) => e.stock[c] > 0 && this.market[c] >= 1.35);
    const spikeWh = whN > 0 && CROP_KEYS.some((c) => e.wh[c] > 0 && this.market[c] >= 1.3);
    const wantSellWh = whN > 0 && (spikeWh || avgMkt >= 1.08);
    const wantSell = stockN > 0 && (spikeStock || stockN >= sellTh || avgMkt >= 1.08 || (e.decay >= 0.08 && stockN >= 2));
    const wantStore = stockN >= 4 && avgMkt < 0.95 && this.ai.storeBias > 0.4 && !spikeStock;
    if (wantSellWh) { this.startTask({ kind: 'sellwh', label: '去商店清仓', plotId: -1, workMs: 1100, bat: 3, atBuilding: true }, MAP.shop); return; }
    if (wantSell) { this.startTask({ kind: 'sell', label: '去商店出售', plotId: -1, workMs: 1100, bat: 3, atBuilding: true }, MAP.shop); return; }
    if (wantStore) { this.startTask({ kind: 'store', label: '去仓库入库', plotId: -1, workMs: 1100, bat: 3, atBuilding: true }, MAP.warehouse); return; }
    this.startTask({ kind: 'idle', label: '待命充电', plotId: -1, workMs: 0, bat: 0, atBuilding: true }, MAP.station);
  }

  private startTask(task: RobotTask, dest: { left: number; top: number }) {
    this.rTask = task;
    this.rDest = { left: dest.left, top: dest.top };
    this.rPath = this.routeTo({ left: this.robot.left, top: this.robot.top }, dest);
    this.rPathIdx = 0;
    this.rDidTask = false;
    this.rPhase = 'move';
    this.robot.module = MOD_FOR[task.kind] || 'patrol';
  }

  private robotMove(dtMS: number) {
    const t = this.rTask!;
    const wp = this.rPath[this.rPathIdx] || this.rDest; // 当前道路路点（沿道路网络折线行进）
    const dl = wp.left - this.robot.left;
    const dt = wp.top - this.robot.top;
    const dist = Math.hypot(dl, dt);
    this.robot.moving = true;
    if (dist > 0.001) this.robot.face = Math.atan2((dt / 100) * 720, (dl / 100) * 1280);
    this.robotAction = t.atBuilding ? t.label + '，沿路前往…' : `前往 ${t.plotId + 1} 号地 · ${t.label}…`;
    const wearSlow = 1 - Math.min(0.5, this.ai.wear * 0.5); // 低资金老化拖慢
    const speed = (this.stress ? 0.020 : 0.0115) * wearSlow; // pct/ms：放慢约 40%（机器人移动不再过快）
    const step = speed * dtMS;
    if (dist <= step || dist < 0.4) {
      this.robot.left = wp.left; this.robot.top = wp.top;
      if (this.rPathIdx < this.rPath.length - 1) {
        this.rPathIdx++; // 推进到下一道路路点
      } else if (t.kind === 'charge' || t.kind === 'idle') {
        this.rPhase = 'charge';
      } else {
        this.rPhase = 'work'; this.rWork = t.workMs;
      }
    } else {
      this.robot.left += (dl / dist) * step;
      this.robot.top += (dt / dist) * step;
    }
  }

  private robotWork(dtMS: number) {
    const t = this.rTask!;
    this.robot.moving = false;
    if (!this.rDidTask) {
      this.rDidTask = true;
      if (t.atBuilding) this.robot.hidden = true; // 进入商店/仓库（视觉消失）
      this.execTask(t);
      this.robotBattery = Math.max(0, this.robotBattery - t.bat);
    }
    this.robotAction = (t.atBuilding ? t.label + '·办理' : `${t.plotId + 1} 号地 · ${t.label}`) + '中…';
    this.rWork -= dtMS;
    if (this.rWork <= 0) {
      this.robot.hidden = false; // 办完出现在门口，随后返回田地
      this.rPhase = 'decide';
      this.rTask = null;
    }
  }

  private robotCharge(dtMS: number) {
    const t = this.rTask!;
    this.robot.moving = false;
    this.robot.module = null;
    const rate = 7 * (1 - this.ai.wear * 0.7) * (dtMS / 700); // 每 ~700ms +7（老化拖慢充电）
    this.robotBattery = Math.min(100, this.robotBattery + rate);
    this.robotAction = (t.kind === 'idle' ? '待命充电 ' : '充电中 ') + Math.round(this.robotBattery) + '%';
    if (this.robotBattery >= (t.kind === 'idle' ? 100 : 60)) { this.rPhase = 'decide'; this.rTask = null; }
  }

  // 执行作业：资源消耗 + 经济入账 + 粒子
  private execTask(t: RobotTask) {
    const id = t.plotId;
    const burst = (kind: 'water' | 'fert') => { if (this.toggles.particles && id >= 0) this.pendingBursts.push({ plotId: id, kind }); };
    switch (t.kind) {
      case 'water': this.applyWater(id); this.res.water = Math.max(0, this.res.water - 4); burst('water'); break;
      case 'drain': this.drainPlot(id); this.res.water = Math.max(0, this.res.water - 2); burst('water'); break;
      case 'fert': this.fertPlot(id); this.res.eco = Math.max(0, this.res.eco - 3); burst('fert'); break;
      case 'cover': this.coverPlot(id); this.res.thermal = Math.max(0, this.res.thermal - 4); burst('fert'); break;
      case 'harvest': this.harvestPlot(id); burst('fert'); break;
      case 'clear': this.clearPlot(id); burst('fert'); break;
      case 'weed': this.weedPlot(id); burst('fert'); break;
      case 'till': this.tillPlot(id); burst('fert'); break;
      case 'plant': this.plantPlot(id); burst('fert'); break;
      case 'buy': this.buyResource(); break;
      case 'sell': this.sellStock(); break;
      case 'sellwh': this.sellWh(); break;
      case 'store': this.storeStock(); break;
      case 'charge': case 'idle': break;
    }
  }

  // —— 作业子程序（缓解对应应激 / 加速生长 / 清理）——
  private drainPlot(id: number) { const p = this.plots[id]; if (!p) return; for (const sl of p.slots) if (!sl.dead) sl.flood = Math.max(0, sl.flood - 4); this.ai.last = '🌊 开沟排水，缓解涝渍'; }
  private coverPlot(id: number) { const p = this.plots[id]; if (!p) return; for (const sl of p.slots) if (!sl.dead) sl.frost = Math.max(0, sl.frost - 4); this.ai.last = '🧣 覆盖稻草保温，抵御霜冻'; }
  private fertPlot(id: number) { const p = this.plots[id]; if (!p) return; for (const sl of p.slots) if (!sl.dead && sl.growth < 400) sl.growth = Math.min(400, sl.growth + 18); this.ai.last = '🌿 精准施肥，加速生长'; }
  private clearPlot(id: number) {
    const p = this.plots[id]; if (!p) return; let n = 0;
    for (const sl of p.slots) if (sl.dead) {
      if (this.mode === 'auto') { sl.dead = false; sl.deathKind = ''; sl.phase = 'empty'; } // 清枯→空地，待翻耕
      else this.respawn(sl);
      n++;
    }
    if (n > 0) this.ai.last = `🥀 清除 ${n} 株枯株（空出待翻耕）`;
  }
  private weedPlot(id: number) {
    const p = this.plots[id]; if (!p) return;
    p.weeds = 0; p.weedProg = 0; p.roadWeed = p.roadDmg ? p.roadWeed : 0;
    if (p.malign >= 35) { p.malign = Math.max(22, p.malign - 55); this.ai.last = '☠️ 压制恶性草（难根除，将复发）'; } // 只能压制不能根除（rule3）
    else this.ai.last = '🌿 清除杂草，恢复可耕作';
  }
  private tillPlot(id: number) {
    const p = this.plots[id]; if (!p) return;
    if (this.mode === 'auto') { for (const sl of p.slots) if (sl.phase === 'empty') sl.phase = 'tilled'; this.ai.last = '🚜 翻耕整地，准备播种'; }
    else { for (const sl of p.slots) if (sl.dead) this.respawn(sl); }
    p.weeds = 0; p.weedProg = 0; // 翻耕同时清除杂草
  }
  private buyResource() {
    if (this.buySeed) { // 采购种子批：seedStock +9（对齐 H5 SEED_BATCH=9 / 990🪙）
      const cost = 990;
      if (this.ai.funds >= cost) {
        this.econ.seedStock += 9;
        this.ai.funds -= cost;
        this.ai.trades++;
        this.ai.last = `🛒 在商店采购种子批 ×9（-${cost}🪙）`;
        this.pushToast(`🛒 机器人采购种子批 ×9 -${cost}🪙`);
      } else {
        this.ai.last = '💰 资金不足，无法采购种子';
      }
      this.buySeed = false;
      return;
    }
    const k = this.buyResKey;
    if (!k) return;
    const cost = 220;
    if (this.ai.funds >= cost) {
      this.res[k] = RES_MAX[k];
      this.ai.funds -= cost;
      this.ai.trades++;
      this.ai.last = `🛒 在商店采购${RES_NAME[k]}（-${cost}🪙）`;
      this.pushToast(`🛒 机器人采购${RES_NAME[k]} -${cost}🪙`);
    } else {
      this.ai.last = '💰 资金不足，无法采购物料';
    }
    this.buyResKey = null;
  }

  // —— 辅助：扫描田地找目标地块 ——
  private thirstiest(): number {
    let best = -1, urg = 0;
    for (const p of this.plots) {
      for (const sl of p.slots) {
        if (sl.dead || sl.phase !== 'grow' || sl.growth >= 400) continue;
        if (sl.moist <= 2 || sl.dry > 0) { const u = sl.dry * 3 + (3 - sl.moist); if (u > urg) { urg = u; best = p.id; } }
      }
    }
    return best;
  }
  private findPlot(pred: (p: Plot) => boolean): number { for (const p of this.plots) if (pred(p)) return p.id; return -1; }
  private lowestRes(): ResKey | null {
    const thr: Record<ResKey, number> = { water: 16, eco: 12, thermal: 8, seed: 0 }; // seed 由 econ.seedStock 接管，不再走作业物料采购
    let pick: ResKey | null = null, ratio = 1;
    (Object.keys(thr) as ResKey[]).forEach((k) => {
      if (this.res[k] < thr[k]) { const r = this.res[k] / RES_MAX[k]; if (r < ratio) { ratio = r; pick = k; } }
    });
    return pick;
  }

  // ===== 巡田路径：道路网络 + 寻路 + 编辑 =====
  // 默认路网：12 地块中心 + 充电站/商店/仓库，按最近 3 邻连边（保证连通）
  seedRoadNet() {
    const nodes: { left: number; top: number }[] = [];
    for (let i = 0; i < 12; i++) nodes.push(this.approachPoint(i));
    nodes.push({ left: MAP.station.left, top: MAP.station.top });
    nodes.push({ left: MAP.shop.left, top: MAP.shop.top });
    nodes.push({ left: MAP.warehouse.left, top: MAP.warehouse.top });
    const d = (a: number, b: number) => Math.hypot(nodes[a].left - nodes[b].left, nodes[a].top - nodes[b].top);
    const edges: [number, number][] = [];
    const seen = new Set<string>();
    const addE = (a: number, b: number) => { const k = a < b ? `${a}_${b}` : `${b}_${a}`; if (!seen.has(k)) { seen.add(k); edges.push([a, b]); } };
    for (let i = 0; i < nodes.length; i++) {
      const near = nodes.map((_, j) => j).filter((j) => j !== i).sort((x, y) => d(i, x) - d(i, y)).slice(0, 3);
      for (const j of near) addE(i, j);
    }
    this.roadNet = { nodes, edges };
  }

  // 沿道路网络求 from→to 折线（Dijkstra）；路网空/不连通则退化直线
  routeTo(from: { left: number; top: number }, to: { left: number; top: number }): { left: number; top: number }[] {
    const rn = this.roadNet;
    const N = rn.nodes.length;
    if (N === 0) return [from, to];
    const snap = (p: { left: number; top: number }) => {
      let bi = 0, bd = Infinity;
      rn.nodes.forEach((n, i) => { const dd = Math.hypot(n.left - p.left, n.top - p.top); if (dd < bd) { bd = dd; bi = i; } });
      return bi;
    };
    const s = snap(from), t = snap(to);
    const adj: number[][] = Array.from({ length: N }, () => []);
    for (const [a, b] of rn.edges) { if (a < N && b < N) { adj[a].push(b); adj[b].push(a); } }
    const dist = new Array(N).fill(Infinity), prev = new Array(N).fill(-1), vis = new Array(N).fill(false);
    dist[s] = 0;
    for (let it = 0; it < N; it++) {
      let u = -1, bd = Infinity;
      for (let i = 0; i < N; i++) if (!vis[i] && dist[i] < bd) { bd = dist[i]; u = i; }
      if (u < 0) break;
      vis[u] = true;
      for (const v of adj[u]) { const w = Math.hypot(rn.nodes[u].left - rn.nodes[v].left, rn.nodes[u].top - rn.nodes[v].top); if (dist[u] + w < dist[v]) { dist[v] = dist[u] + w; prev[v] = u; } }
    }
    if (t !== s && prev[t] < 0) return [from, to];
    const mid: { left: number; top: number }[] = [];
    let cur = t;
    while (cur >= 0) { mid.unshift({ left: rn.nodes[cur].left, top: rn.nodes[cur].top }); if (cur === s) break; cur = prev[cur]; }
    return [from, ...mid, to];
  }

  // —— 编辑接口（gameHud 调用）——每次改动即存盘，刷新不丢 ——
  toggleRoadEdit() { this.roadEditOn = !this.roadEditOn; if (!this.roadEditOn) this.saveRoadNet(); } // 点「保存」退出编辑时落盘
  addRoadNode(left: number, top: number) { this.roadNet.nodes.push({ left, top }); this.saveRoadNet(); }
  moveRoadNode(i: number, left: number, top: number) { const n = this.roadNet.nodes[i]; if (n) { n.left = left; n.top = top; this.saveRoadNet(); } }
  toggleRoadEdge(i: number, j: number) {
    if (i === j) return;
    const idx = this.roadNet.edges.findIndex(([a, b]) => (a === i && b === j) || (a === j && b === i));
    if (idx >= 0) this.roadNet.edges.splice(idx, 1);
    else this.roadNet.edges.push([i, j]);
    this.saveRoadNet();
  }
  removeRoadNode(i: number) {
    if (i < 0 || i >= this.roadNet.nodes.length) return;
    this.roadNet.nodes.splice(i, 1);
    this.roadNet.edges = this.roadNet.edges
      .filter(([a, b]) => a !== i && b !== i)
      .map(([a, b]) => [a > i ? a - 1 : a, b > i ? b - 1 : b] as [number, number]);
    this.saveRoadNet();
  }
  resetRoadNet() { this.seedRoadNet(); try { localStorage.removeItem('fp_pixi_roadnet'); } catch { /* 隐私模式忽略 */ } } // 恢复默认并清除本地覆盖
  clearRoadNet() { this.roadNet = { nodes: [], edges: [] }; this.saveRoadNet(); }

  // 巡田路径持久化（localStorage，强刷/重开浏览器都不丢；对齐 H5 的 fp_roadnet 机制）
  private saveRoadNet() {
    try { localStorage.setItem('fp_pixi_roadnet', JSON.stringify(this.roadNet)); } catch { /* 隐私模式忽略 */ }
  }
  private loadRoadNet(): boolean {
    try {
      const raw = localStorage.getItem('fp_pixi_roadnet');
      if (!raw) return false;
      const d = JSON.parse(raw) as RoadNet;
      const nodes = d && (d.nodes as { left: number; top: number }[]);
      const edges = d && (d.edges as [number, number][]);
      if (Array.isArray(nodes) && Array.isArray(edges)
        && nodes.every((n) => n && typeof n.left === 'number' && typeof n.top === 'number')
        && edges.every((e) => Array.isArray(e) && e.length === 2 && typeof e[0] === 'number' && typeof e[1] === 'number')) {
        this.roadNet = { nodes, edges };
        return true;
      }
    } catch { /* 解析失败 → 回退默认路网 */ }
    return false;
  }

  // 收获该地块所有成熟株 → 入待售库存 econ.stock（不即时变现，带新鲜度）+ 更新 Q 值 + 回补生态肥。
  // 收成以「地块单位」计（封顶 9，对齐 H5 每块≤9 株的经济口径）：与视觉密度解耦，避免密植麦田刷爆库存使售卖阈值失效。
  // 原地复种暂保留（P1 将改为 翻耕→播种 轮作，并救活闲置税）。
  private harvestPlot(plotId: number): number {
    if (this.mode !== 'auto') return 0;
    const p = this.plots[plotId];
    if (!p) return 0;
    const cropHarvested = p.slots.find((sl) => sl.phase === 'grow' && !sl.dead && sl.growth >= 400)?.crop;
    let n = 0; // 成熟株数（视觉）
    for (const sl of p.slots) {
      if (sl.phase !== 'grow' || sl.dead || sl.growth < 400) continue;
      n++;
      sl.phase = 'empty'; // 收割后空出地块，待翻耕→播种（撂荒计入闲置；不再原地秒复种）
      sl.fallowMS = 0;
    }
    if (n > 0 && cropHarvested) {
      const units = Math.min(9, n); // 地块产出单位（封顶 9，保持库存在 H5 经济量级）
      const price = this.priceOf(cropHarvested);
      this.econ.stock[cropHarvested] = (this.econ.stock[cropHarvested] || 0) + units;
      // 新入库视为最新鲜(1.0)，与原有库存按件数加权平均新鲜度
      const had = this.cropCount(this.econ.stock) - units;
      this.econ.fresh = had > 0 ? (had * this.econ.fresh + units * 1) / (had + units) : 1;
      this.res.eco = Math.min(RES_MAX.eco, this.res.eco + 5); // 对齐 H5：收获回补生态肥
      // Q 学习：奖励 = 实现毛利（售价 − 种子成本），α=0.25（对齐 H5 收获更新；死亡惩罚仍用 0.3）
      const margin = price - CROPS[cropHarvested].seed;
      this.ai.q[cropHarvested] += 0.25 * (margin - this.ai.q[cropHarvested]);
      this.ai.harvests += units;
      this.ai.trades++;
      this.ai.last = `🧺 ${plotId + 1} 号地收获 ×${units}（入待售库存，待择机出售）`;
    }
    return n;
  }

  // 播种：已翻耕(tilled)地块种上 chooseCrop 选定作物，消耗 1 批种子单位 seedStock（对齐 H5 plant）
  private plantPlot(plotId: number) {
    const p = this.plots[plotId];
    if (!p || this.econ.seedStock <= 0) return;
    const crop = this.chooseCrop();
    let n = 0;
    for (const sl of p.slots) {
      if (sl.phase !== 'tilled') continue;
      n++;
      sl.phase = 'grow';
      sl.crop = crop;
      sl.growth = 0;
      sl.fallowMS = this.stress ? 1200 : 2200; // 播种后短暂出苗（裸土→新苗）
      sl.moist = 6; sl.dry = 0; sl.flood = 0; sl.frost = 0; sl.parch = 0; sl.age = 0;
    }
    if (n > 0) {
      this.econ.seedStock = Math.max(0, this.econ.seedStock - 1); // 一块地耗 1 批种子单位
      this.ai.plantings++;
      this.ai.explore = Math.max(0.05, this.ai.explore * 0.96); // 探索率随播种衰减
      this.ai.last = `🌱 ${plotId + 1} 号地播种「${CROPS[crop].name}」`;
    }
  }

  // 出售待售库存：按新鲜度 × 市值变现 → 经营资金（行情尖峰套利记入 spikeGain）
  private sellStock() {
    const e = this.econ;
    const n = this.cropCount(e.stock);
    if (n <= 0) { this.ai.last = '🪙 暂无可售收成'; return; }
    const spike = CROP_KEYS.some((c) => e.stock[c] > 0 && this.market[c] >= 1.35);
    const gain = Math.round(e.fresh * this.cropVal(e.stock));
    this.ai.funds += gain;
    if (spike) this.ai.spikeGain += gain;
    this.ai.sells++; this.ai.trades++;
    e.stock = emap(); e.fresh = 1;
    this.ai.last = `🪙 在商店售出收成 ×${n}（+${gain}🪙${spike ? ' · 趁高出手' : ''}）`;
    this.pushToast(this.ai.last);
  }

  // 清仓仓库：按市值变现 → 资金；据实现盈亏学习囤货倾向 storeBias
  private sellWh() {
    const e = this.econ;
    const n = this.cropCount(e.wh);
    if (n <= 0) { this.ai.last = '📦 仓库为空'; return; }
    const gain = Math.round(this.cropVal(e.wh));
    const realized = gain - e.whBasis;
    this.ai.funds += gain;
    if (realized > 0) this.ai.storeBias = Math.min(0.92, this.ai.storeBias + Math.min(0.12, realized / 600));
    else this.ai.storeBias = Math.max(0.1, this.ai.storeBias - Math.min(0.12, -realized / 600));
    this.ai.sells++; this.ai.trades++;
    e.wh = emap(); e.whBasis = 0;
    this.ai.last = `📦 清仓出售 ×${n}（+${gain}🪙 · 盈亏 ${realized >= 0 ? '+' : ''}${realized}）`;
    this.pushToast(this.ai.last);
  }

  // 入库：待售库存 → 仓库，锁定当前市值(whBasis)止住折损，但此后每 tick 按 fee 付仓储费
  private storeStock() {
    const e = this.econ;
    const n = this.cropCount(e.stock);
    if (n <= 0) { this.ai.last = '📦 暂无收成可入库'; return; }
    e.whBasis += Math.round(e.fresh * this.cropVal(e.stock));
    for (const k of CROP_KEYS) e.wh[k] = (e.wh[k] || 0) + (e.stock[k] || 0);
    e.stock = emap(); e.fresh = 1;
    this.ai.trades++;
    this.ai.last = `📦 入库收成 ×${n}（锁价止损，按费率付仓储费）`;
    this.pushToast(this.ai.last);
  }

  // 田间健康统计（杂草率 / 闲置率），供 HUD 健康条
  healthStats(): { weedPct: number; idlePct: number; overCount: number } {
    const tot = this.plots.length || 1;
    let weedUnits = 0;
    let idle = 0;
    let over = 0;
    for (const p of this.plots) {
      weedUnits += Math.min(3, p.weeds);
      if (!p.slots.some((sl) => sl.phase === 'grow' && !sl.dead)) idle++;
      if (p.idle > IDLE_LIMIT) over++;
    }
    return {
      weedPct: Math.round((weedUnits / (tot * 3)) * 100),
      idlePct: Math.round((idle / tot) * 100),
      overCount: over,
    };
  }

  // 慢 tick：市场行情 + 杂草累积 + 闲置计数 + AI 经济结算（托管）
  private slowTick() {
    this.marketTick();
    this.weedTick();
    for (const p of this.plots) {
      const productive = p.slots.some((sl) => sl.phase === 'grow' && !sl.dead);
      p.idle = productive ? 0 : p.idle + 1;
    }
    if (this.mode === 'auto') { this.econTick(); this.aiEconomyTick(); }
  }

  // 收成折损 + 仓储费结算 + 据此自适应 售卖阈值/囤货倾向（移植原型 tick 折损/仓储/学习段）
  private econTick() {
    const e = this.econ, ai = this.ai;
    // 折损率均值回归 0.05 + 噪声，clamp[0.02,0.12]
    e.decay = clampN(e.decay + (0.05 - e.decay) * 0.06 + (Math.random() - 0.5) * 0.03, 0.02, 0.12);
    // 待售库存随新鲜度折价（越陈损失越多）；空库存则新鲜度复位
    let spoil = 0;
    if (this.cropCount(e.stock) > 0) {
      const nf = Math.max(0.3, e.fresh * (1 - e.decay));
      spoil = Math.round(this.cropVal(e.stock) * (e.fresh - nf));
      e.fresh = nf;
    } else {
      e.fresh = 1;
    }
    // 仓储费率均值回归 3 + 噪声，clamp[1,10]
    e.fee = clampN(e.fee + (3 - e.fee) * 0.06 + (Math.random() - 0.5) * 1.4, 1, 10);
    let fees = 0;
    const whN = this.cropCount(e.wh);
    if (whN > 0) fees = Math.round(e.fee * whN);
    if (fees > 0) { ai.funds -= fees; ai.feesPaid += fees; }
    if (spoil > 0) ai.decayLoss += spoil;
    // 学习：折损 → 早卖（下调阈值）；无折损 → 容忍更多库存（上调阈值）
    if (spoil > 0) ai.sellThreshold = Math.max(2, ai.sellThreshold - 0.12 - spoil / 400);
    else ai.sellThreshold = Math.min(9, ai.sellThreshold + 0.03);
    // 学习：纯仓储费(无折损) → 少囤；折损发生 → 多囤(入库止损)
    if (fees > 0 && spoil === 0) ai.storeBias = Math.max(0.1, ai.storeBias - 0.03);
    else if (spoil > 0) ai.storeBias = Math.min(0.92, ai.storeBias + 0.02);
  }

  // 市场：均值回归 + 随机冲击 + 26% 概率暴涨/暴跌事件，clamp[0.3,2.8]
  private marketTick() {
    for (const k of CROP_KEYS) {
      this.marketPrev[k] = this.market[k];
      const drift = (1 - this.market[k]) * 0.035;
      const shock = (Math.random() - 0.5) * 0.34;
      this.market[k] = this.market[k] + drift + shock;
    }
    let evt: { k: CropKey; up: boolean } | null = null;
    if (Math.random() < 0.26) {
      const k = CROP_KEYS[(Math.random() * CROP_KEYS.length) | 0];
      if (Math.random() < 0.45) {
        this.market[k] *= 1.35 + Math.random() * 0.7;
        evt = { k, up: true };
      } else {
        this.market[k] *= 0.28 + Math.random() * 0.34;
        evt = { k, up: false };
      }
    }
    for (const k of CROP_KEYS) {
      this.market[k] = +Math.max(0.3, Math.min(2.8, this.market[k])).toFixed(3);
    }
    this.marketEvent = evt;
    if (evt) {
      const nm = CROPS[evt.k].name;
      const m = this.market[evt.k].toFixed(2);
      this.pushToast(evt.up ? `📈 行情：「${nm}」价格飙升至 ${m}×！趁高出手` : `📉 行情：「${nm}」价格暴跌至 ${m}×`);
    }
  }

  // 杂草：撂荒地（无活株）累积 weedProg → L1/L2/L3，L3 爬上道路并最终破坏路面
  private weedTick() {
    const wx = this.weather.type;
    for (const p of this.plots) {
      const hasLiving = p.slots.some((sl) => !sl.dead);
      // 有作物也会长草(慢)，撂荒地长得快；雨天更快 —— 杂草与作物争生长，需定期除草
      const rate = (hasLiving ? 0.5 : 1.1) * (wx === 'rain' ? 1.7 : 1);
      p.weedProg = Math.min(140, p.weedProg + rate);
      p.weeds = p.weedProg < 10 ? 0 : p.weedProg < 46 ? 1 : p.weedProg < 92 ? 2 : 3;
      if (p.weeds >= 3) {
        const over = Math.max(0, p.weedProg - 92);
        p.roadWeed = Math.min(3, Math.floor(over / 22));
        if (p.roadWeed >= 3) p.roadDmg = true;
      }
      // 恶性草(Yellow Dock)：已侵染地块快蔓延、干净地块缓慢被侵入；雨天更快（rule3 蔓延快）
      p.malign = Math.min(100, p.malign + (p.malign > 4 ? 1.25 : 0.13) * (wx === 'rain' ? 1.5 : 1));
      // 长在路上 → 快速毁路：重度侵染推高道路杂草并破坏路面（rule3）
      if (p.malign > 55) { p.roadWeed = Math.min(3, Math.max(p.roadWeed, Math.floor((p.malign - 55) / 14))); if (p.malign > 82) p.roadDmg = true; }
    }
    // 蔓延：中重度侵染地块向随机另一地块播散恶性草（rule3 蔓延快）；机器人压制源头与之拉锯
    if (this.plots.some((p) => p.malign > 45) && Math.random() < 0.07) {
      const t = this.plots[(Math.random() * this.plots.length) | 0];
      if (t) t.malign = Math.min(100, t.malign + 10);
    }
  }

  // AI 经济结算：闲置土地税 + 低资金设备老化 + 破产重置
  private aiEconomyTick() {
    const ai = this.ai;
    // 闲置土地税：仅当大量地块闲置（>7）才随机抽 3 块课税，轮换
    const overIds = this.plots.filter((p) => p.idle > IDLE_LIMIT).map((p) => p.id);
    if (overIds.length > 7 && Math.random() < 0.22) {
      const pool = overIds.slice();
      let hit = 0;
      for (let n = 0; n < 3 && pool.length; n++) {
        const id = pool.splice((Math.random() * pool.length) | 0, 1)[0];
        const pp = this.plots[id];
        if (pp) pp.idle = 0; // 课税后重置 → 轮换
        hit++;
      }
      const tax = Math.round(hit * (IDLE_TAX * (0.75 + Math.random() * 0.6)));
      ai.funds -= tax;
      ai.idleTaxPaid += tax;
      ai.last = `🪧 闲置土地税 −${tax}🪙 ×${hit}块 · 尽快复耕复种`;
      this.pushToast(ai.last);
    }
    // 低资金 → 无力养护 → 设备老化（充电/移动变慢）；资金回升则缓慢修复
    if (ai.funds < 1000) {
      ai.wear = Math.min(1, +(ai.wear + 0.012 + (1000 - Math.max(0, ai.funds)) / 1000 * 0.03).toFixed(3));
    } else if (ai.wear > 0) {
      ai.wear = Math.max(0, +(ai.wear - 0.018).toFixed(3)); // 对齐 H5：磨损恢复 -0.018/tick
    }
    // 破产：资金跌破 −20000 → 记失败 + 资金重置（学习记录保留）
    if (ai.funds < BANKRUPT) {
      ai.fails++;
      ai.funds = AI_START;
      ai.wear = 0;
      ai.last = `💥 破产！第 ${ai.fails} 次 · 资金已重置（AI 学习记录保留）`;
      this.pushToast('💥 机器人破产！资金重置，学习记录保留，继续经营');
    }
  }

  // 一次应激/致死 tick —— 逐项移植原型 tick()：湿度/缺水/涝渍/受冻/干旱 + 阶段耐旱阈值 + 致死概率 + 过熟老化
  private lifeTick() {
    const wInt = this.weatherIntensity();
    const wx = this.weather.type;
    const wxRate = 0.3 + wInt * 1.1; // 灾害累积速率随强度
    for (const p of this.plots) {
      for (const sl of p.slots) {
        if (sl.dead || sl.phase !== 'grow') continue; // 空置/已翻耕地块无应激
        // 非当前灾害的计数器缓解
        if (wx !== 'rain') sl.flood = Math.max(0, sl.flood - 1);
        if (wx !== 'frost') sl.frost = Math.max(0, sl.frost - 1);
        if (wx !== 'drought') sl.parch = Math.max(0, sl.parch - 1);
        const stage = Math.min(4, Math.floor(sl.growth / 100));
        if (sl.growth >= 400) {
          // 成熟：老化 → 过熟枯萎；托管模式留待机器人收获（不因老化致死，避免白白损耗）
          sl.age = Math.min(20, sl.age + 1);
          if (sl.age >= 16 && this.mode !== 'auto') this.kill(sl, 'aged');
          continue;
        }
        if (wx === 'rain') {
          sl.moist = Math.max(sl.moist, 2); sl.dry = 0;
          sl.flood += wxRate;
          if (sl.flood >= 4 && Math.random() < 0.18 * wInt) this.kill(sl, 'rot');
        } else if (wx === 'frost') {
          sl.frost += wxRate; sl.moist = Math.max(0, sl.moist - 1);
          if (sl.frost >= 4 && Math.random() < 0.17 * wInt) this.kill(sl, 'frozen');
        } else if (wx === 'drought') {
          sl.parch += wxRate;
          if (sl.moist > 0) { sl.moist = Math.max(0, sl.moist - (wInt > 0.5 ? 2 : 1)); sl.dry = 0; }
          else { sl.dry += wInt > 0.5 ? 2 : 1; if (sl.dry >= (DRY_DEATH[stage] || 5)) this.kill(sl, 'dry'); }
        } else if (wx === 'cloudy' || wx === 'lightrain') {
          sl.dry = 0; sl.moist = Math.max(sl.moist, 2); // 阴雨补水
        } else {
          // 晴：耗水，断水累积缺水 → 旱死
          if (sl.moist > 0) { sl.moist -= 1; sl.dry = 0; }
          else { sl.dry += 1; if (sl.dry >= (DRY_DEATH[stage] || 5)) this.kill(sl, 'dry'); }
        }
      }
    }
  }

  private kill(sl: Slot, kind: Slot['deathKind']) {
    sl.dead = true;
    sl.deathKind = kind;
    sl.respawnT = this.stress ? 1800 : 3400; // 短暂展示倒伏/枯死的"残株"，再补种
    // 托管：损失 → 计数 + 下调该作物 Q 评分（惩罚）
    if (this.mode === 'auto') {
      this.ai.deaths++;
      const pen = -CROPS[sl.crop].seed;
      this.ai.q[sl.crop] += 0.3 * (pen - this.ai.q[sl.crop]);
      this.ai.last = `⚠ 损失 1 株 · 下调「${CROPS[sl.crop].name}」评分（惩罚）`;
    }
  }

  private respawn(sl: Slot) {
    sl.dead = false; sl.deathKind = ''; sl.growth = 0; sl.fallowMS = 0; sl.phase = 'grow';
    sl.moist = 5; sl.dry = 0; sl.flood = 0; sl.frost = 0; sl.parch = 0; sl.age = 0;
  }

  // 浇水：复位该地块所有活株的缺水/湿度（机器人巡田到点 + 手动点地块）
  applyWater(plotId: number) {
    const p = this.plots[plotId];
    if (!p) return;
    for (const sl of p.slots) {
      if (sl.dead) continue;
      sl.moist = 6; sl.dry = 0;
      if (sl.parch > 0) sl.parch = Math.max(0, sl.parch - 2);
    }
  }

  // 天气决策：实时镜像农场天气（维持高潮 / 转晴消退 / 离线随机回退）；加速模式走合成随机灾害
  private decideWeather(dtMS: number, slowFired: boolean) {
    if (!this.live) {
      // —— 加速合成演示（与历史 DEMO 行为一致）——
      const w = this.weather;
      if (w.type === 'clear') {
        this.weatherCooldownMS -= dtMS;
        if (this.weatherCooldownMS <= 0) {
          const willTrigger = this.stress ? true : this.mode === 'auto' && Math.random() < 0.6;
          if (willTrigger) this.triggerWeather(this.randomDisaster());
          else this.weatherCooldownMS = this.stress ? 1200 : 6000;
        }
      } else {
        w.elapsedMS += dtMS;
        if (w.elapsedMS >= w.durMS) {
          this.weather = { type: 'clear', elapsedMS: 0, durMS: 0 };
          this.weatherCooldownMS = this.stress ? 1200 : 8000;
        }
      }
      return;
    }

    // —— 实时镜像 ——
    const rw = this.realWx;
    const realOn = !!(rw && rw.ok);
    const sustain = realOn && isDisaster(rw!.type);
    const w = this.weather;
    if (sustain) {
      const t = rw!.type;
      if (w.type !== t) {
        this.weather = { type: t, elapsedMS: 0, durMS: 16000 };
        this.weatherReal = true;
        this.pushToast(WX_LIVE_MSG[t] || '');
      } else {
        // 维持高潮：把 prog 锁在 ~0.5（climax 带），不让它走完消退
        const cap = w.durMS * 0.5;
        if (w.elapsedMS < cap) w.elapsedMS = Math.min(cap, w.elapsedMS + dtMS);
        this.weatherReal = true;
      }
      return;
    }
    // 未在维持实时灾害
    if (isDisaster(w.type)) {
      // 实时已转晴 / 离线随机灾害 → 自然走完生命周期消退
      w.elapsedMS += dtMS;
      if (w.elapsedMS >= w.durMS) {
        this.weather = { type: 'clear', elapsedMS: 0, durMS: 0 };
        this.weatherReal = false;
        this.pushToast(realOn ? '🌤️ 实时天气转晴' : '🌤️ 极端天气结束 · 天气转晴');
      }
      return;
    }
    // 环境天气（晴/多云/小雨）
    if (realOn) {
      const amb: WeatherType = rw!.type === 'cloudy' || rw!.type === 'lightrain' ? rw!.type : 'clear';
      this.weather = { type: amb, elapsedMS: 0, durMS: 0 };
      this.weatherReal = false;
    } else {
      // 离线回退：罕见随机起灾（雨80% · 旱10% · 冻10%），仅在慢 tick 抽签
      this.weather = { type: 'clear', elapsedMS: 0, durMS: 0 };
      if (slowFired && Math.random() < 0.12) {
        const t = this.randomDisaster();
        this.weather = { type: t, elapsedMS: 0, durMS: 16000 };
        this.weatherReal = false;
        this.pushToast(WX_OFFLINE_MSG[t] || '');
      }
    }
  }

  triggerWeather(type: WeatherType) {
    if (type === 'clear') {
      this.weather = { type: 'clear', elapsedMS: 0, durMS: 0 };
      this.weatherCooldownMS = this.stress ? 1200 : 8000;
      return;
    }
    const durMS = isDisaster(type) ? (this.stress ? 6000 : 16000) : 12000;
    this.weather = { type, elapsedMS: 0, durMS };
  }

  private randomDisaster(): WeatherType {
    const r = Math.random();
    return r < 0.8 ? 'rain' : r < 0.9 ? 'drought' : 'frost';
  }

  weatherProg(): number {
    const w = this.weather;
    if (w.type === 'clear' || w.durMS <= 0) return 0;
    return Math.min(1, w.elapsedMS / w.durMS);
  }

  weatherIntensity(): number {
    if (!isDisaster(this.weather.type)) {
      // 阴天/小雨：给一个柔和常量强度，驱动背景天气层淡入
      return this.weather.type === 'clear' ? 0 : 0.6;
    }
    return wxIntensity(this.weatherProg());
  }

  // 当前游戏天气是否由实时数据驱动（HUD 标注 实时/模拟）
  isLiveWeather(): boolean {
    return this.live && this.weatherReal;
  }

  // 触发一次手动浇水/施肥（点地块）
  burst(plotId: number, kind: 'water' | 'fert') {
    if (kind === 'water') this.applyWater(plotId);
    this.pendingBursts.push({ plotId, kind });
  }

  // 机器人是否正在充电站充电（供基站 UI）
  isCharging(): boolean {
    return this.rPhase === 'charge';
  }

  // 手动模式：按当前选中工具对地块执行操作（点地块触发）
  manualAction(plotId: number) {
    const p = this.plots[plotId];
    if (!p) return;
    switch (this.manualTool) {
      case 'water': this.applyWater(plotId); this.pendingBursts.push({ plotId, kind: 'water' }); break;
      case 'fert': this.fertPlot(plotId); this.pendingBursts.push({ plotId, kind: 'fert' }); break;
      case 'harvest': this.manualHarvest(plotId); this.pendingBursts.push({ plotId, kind: 'fert' }); break;
      case 'weed': this.weedPlot(plotId); this.pendingBursts.push({ plotId, kind: 'fert' }); break;
      case 'clear': this.clearPlot(plotId); break;
      case 'till': this.tillPlot(plotId); this.pendingBursts.push({ plotId, kind: 'fert' }); break;
      case 'cover': this.coverPlot(plotId); this.pendingBursts.push({ plotId, kind: 'fert' }); break;
      case 'drain': this.drainPlot(plotId); this.pendingBursts.push({ plotId, kind: 'water' }); break;
    }
  }
  // 手动收获：成熟株复位（手动模式不走 AI 经济）
  private manualHarvest(plotId: number): number {
    const p = this.plots[plotId];
    if (!p) return 0;
    let n = 0;
    for (const sl of p.slots) {
      if (!sl.dead && sl.growth >= 400) { n++; sl.growth = 0; sl.fallowMS = this.stress ? 2500 : 5000; sl.moist = 6; sl.dry = 0; sl.flood = 0; sl.frost = 0; sl.parch = 0; sl.age = 0; }
    }
    return n;
  }

  // 统计当前田间植株总数（给 HUD/stats 显示负载）
  plantCount(): number {
    let n = 0;
    for (const p of this.plots) n += p.slots.length;
    return n;
  }
}

function freshAI(): AIState {
  return {
    funds: AI_START,
    q: { tomato: 0, lettuce: 0, corn: 0, chili: 0, wheat: 0 },
    trades: 0, sells: 0, harvests: 0, deaths: 0, plantings: 0,
    explore: 0.35, sellThreshold: 5, storeBias: 0.5, wear: 0, fails: 0,
    decayLoss: 0, feesPaid: 0, idleTaxPaid: 0, spikeGain: 0,
    last: '等待托管…',
  };
}

function emap(): Record<CropKey, number> {
  return { tomato: 0, lettuce: 0, corn: 0, chili: 0, wheat: 0 };
}

function freshEcon(): EconState {
  return { stock: emap(), fresh: 1, wh: emap(), whBasis: 0, decay: 0.05, fee: 3, seedStock: 0 };
}

// 数值 clamp + 三位小数（折损率/仓储费均值回归用）
function clampN(v: number, a: number, b: number): number {
  return Math.max(a, Math.min(b, +v.toFixed(3)));
}
