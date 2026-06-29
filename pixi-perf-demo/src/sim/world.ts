import { CROPS, CROP_KEYS, GROW_SEC, CROP_SEASON, SEASON_NAME, type CropKey } from '../data/crops';
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
  health: number; // 健康值 0..1：肥害/涝害/灾害降低 → 拖慢生长；随时间缓慢恢复
  plantQual: number; // 种植考核分 0.2..1：行距评分 × 应季时机（持久）→ 影响生长速度与收获量
  // 托管轮作生命周期：grow 生长中 / empty 收割后空置(待翻耕) / tilled 已翻耕(待播种)。手动模式恒为 grow。
  phase: 'grow' | 'empty' | 'tilled';
}

// 各 stage 的耐旱阈值（发芽/幼苗脆弱、生长期更耐旱）。较原型上调：作物缺水不再轻易枯死，给机器人轮巡浇水留足缓冲
export const DRY_DEATH = [28, 32, 38, 46];

export interface Plot {
  id: number;
  slots: Slot[];
  weeds: number; // 0..3（撂荒杂草等级）
  weedProg: number; // 杂草累积进度（撂荒越久越高）
  roadWeed: number; // 0..3 杂草爬上道路
  roadDmg: boolean; // 路面被杂草破坏
  idle: number; // 闲置 tick 计数（无活株则累加）→ 闲置土地税
  malign: number; // 恶性草(Yellow Dock)侵染度 0..100：快蔓延 / 田里抢营养 / 路上毁路 / 难根除
  fertCd: number; // 施肥冷却(ms)：近期施过 → 暂不需要再施（任务按生长需求设定）
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

// 玩家手动模式资源（与机器人 res/ai.funds 严格分离）：金币 / 体力(随时间恢复) / 水 / 生态肥。
// 每个手动动作消耗其中之一，不足即拦截 → 杜绝"无限重复"。对齐 H5 state.coins/energy/water/eco（H5 体力不回血，本版加缓慢恢复让手动可持续）。
export interface PlayerRes {
  coins: number;
  energy: number;
  energyMax: number;
  water: number;
  eco: number;
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
  charging: boolean; // 在基站充电中 → 机器人头部显示充电进度，离站自动关闭
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
export type ManualTool = 'plant' | 'water' | 'fert' | 'harvest' | 'weed' | 'clear' | 'till' | 'cover' | 'drain';

// 田间道路网络（巡田路径）：节点 + 连线，机器人沿道路寻路
export interface RoadNet {
  nodes: { left: number; top: number }[];
  edges: [number, number][];
}

// 机器人当前任务（需求驱动决策的产物）
interface RobotTask {
  kind: 'water' | 'fert' | 'cover' | 'drain' | 'harvest' | 'clear' | 'weed' | 'till' | 'plant' | 'repair' | 'buy' | 'sell' | 'sellwh' | 'store' | 'charge' | 'idle';
  label: string;
  plotId: number; // -1 表示建筑/无地块
  workMs: number; // 到点作业停顿时长（对齐原型 workMs）
  bat: number; // 作业耗电
  atBuilding: boolean; // 目标是建筑（商店/充电站）
}

// 初始种子田（作物 + 起始阶段），移植自原型 seed 表的作物分布意图
// 起始阶段错峰分布（0~4），避免开局多块同时成熟→同时收割→同时空置→任务扎堆；错峰后机器人自然在各田间穿插作业
const SEED: [CropKey, number][] = [
  ['corn', 1], ['tomato', 3], ['lettuce', 0], ['chili', 2],
  ['wheat', 4], ['tomato', 1], ['corn', 3], ['chili', 0],
  ['tomato', 2], ['lettuce', 4], ['wheat', 1], ['chili', 3],
];

// 学习成果存档 schema 版本：结构变更时 +1 → 旧档自动作废（不读、回落 fresh），防版本错配注入脏数据
const BRAIN_SAVE_V = 3; // schema/语义版本：+1 自动作废旧档。v2=情境偏置 ctxKind；v3=养护类回报语义修正(浇水等不再被学成亏本→作废旧的负偏置)

// 经济常量（原样移植原型）
const AI_START = 2500;
const IDLE_LIMIT = 45; // 闲置达此 tick 数才进入课税池
const IDLE_TAX = 44; // 单块闲置税基（每次随机浮动）
const BANKRUPT = -3000; // 资金跌破即破产重置

// —— 学习型机器人新机制 ——
const STOCK_CAP = 30; // 随身携带收获上限(单位)：满了不能再收，必须出售/入库（迫使学习何时清货）
const SEED_BASE = 990; // 种子批基准价；实际价随种子行情 seedMkt 浮动
const POWER_VALUE = 0.5; // 每 1% 电量的金币当量(用于回报中给耗电计价)
const CARRY_WORK_MUL = 1.5; // 满载时作业耗电额外倍率(载货越多越费电)
const CARRY_MOVE_DRAIN = 0.03; // 载货移动每 1% 距离的耗电(空载几乎免费，对齐 H5；载货才耗)
const FERT_CD = 16000; // 施肥冷却(ms)：施过后一段时间作物不再"需要"施肥（按生长需求设任务）

// 学习型机器人「大脑」：对候选动作打分 U=wValue·收益+wUrgency·紧迫−wPower·耗电+各类偏置；
// 回报(净资产增量/省电/省税)反向更新权重 → 全局以"最大化经营盈利、最省电高效"为目标自我学习。
export interface BrainState {
  wValue: number; // 收益权重
  wUrgency: number; // 紧迫度权重
  wPower: number; // 耗电(负向)权重
  kind: Record<string, number>; // 各动作类型的学习偏置(经验价值)
  densBias: number; // 学习的种植密度偏置(-3..3)：按收获质量调，过密则减、有余则增 → 学最优行距
  eps: number; // 探索率(随经验衰减)
  steps: number; // 决策步数
  netReward: number; // 累计净回报
  ctxKind: Record<string, Record<string, number>>; // 情境化偏置：情境键(电量/载重/行情分桶) → (动作类型 → 学习偏置)。全局 kind 学共性、ctxKind 学情境差异
}

// 候选动作（大脑每步枚举全部可做的事，打分择优）
interface Cand {
  ck: string; // 类别键(学习偏置/提交路由用，如 harvest/sell/buyseed/buyres)
  task: RobotTask;
  dest: { left: number; top: number };
  value: number; // 收益特征(金币当量/1000 量级)
  urgency: number; // 紧迫特征(0..3)
  power: number; // 估计耗电(含距离+载重)
  res?: ResKey; // buyres 用：补给哪种物料
  score: number;
}

// 机器人物料库存：作业消耗、去商店补给
// 机器人作业物料（对齐 H5 双池：水 + 生态肥）。保温/排水均吃生态肥；种子走 econ.seedStock。
type ResKey = 'water' | 'eco';
const RES_MAX: Record<ResKey, number> = { water: 120, eco: 80 };
const RES_NAME: Record<ResKey, string> = { water: '水', eco: '生态肥' };
// 任务 → 机器人作业配件模块（robot.ts 读 module 画对应工具图标）。各任务用专属配件，便于一眼看出在干什么。
const MOD_FOR: Record<string, string> = {
  water: 'water', drain: 'water',     // 浇水/排水 → 喷头水滴
  fert: 'fert',                       // 施肥 → 颗粒肥
  cover: 'cover',                     // 覆盖保温 → 篷布
  harvest: 'harvest',                 // 采收 → 收获篮
  clear: 'clear',                     // 清枯 → 耙
  weed: 'weed',                       // 除草 → 除草剪
  till: 'till',                       // 翻耕 → 旋耕齿
  plant: 'plant',                     // 播种 → 幼苗
  repair: 'repair',                   // 修路 → 螺母扳手
  buy: 'haul', sell: 'haul', sellwh: 'haul', store: 'haul', // 买卖/出入库 → 货箱
  charge: 'charge', idle: 'charge',   // 充电/待命 → 闪电
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
  calDay = 80; // 合成日历(0..359，初始≈春)：加速模式推进；live 模式季节按农场真实月份
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
  private lifeN = 0; // lifeTick 计数（阴天半速耗水用）
  private slowAcc = 0; // 慢 tick（市场/杂草/经济）累积器

  // —— 市场行情（均值回归 + 暴涨暴跌），权威模型 ——
  market: Record<CropKey, number> = { tomato: 1, lettuce: 1, corn: 1, chili: 1, wheat: 1 };
  marketPrev: Record<CropKey, number> = { tomato: 1, lettuce: 1, corn: 1, chili: 1, wheat: 1 };
  marketEvent: { k: CropKey; up: boolean } | null = null;
  seedMkt = 1; // 种子行情指数(均值回归+波动)：低时买种划算，机器人学习择时采购

  // —— AI 自主经营学习 ——
  ai: AIState = freshAI();
  brain: BrainState = freshBrain(); // 学习型决策大脑（打分择优 + 回报更新权重）

  // —— 收成库存 / 仓储经济（收获入此，机器人择机出售/入库）——
  econ: EconState = freshEcon();

  // —— 玩家手动模式资源（金币/体力/水/生态肥）——
  player: PlayerRes = freshPlayer();
  manualSeed: CropKey = 'tomato'; // 手动「种植」工具当前选的作物
  plantBrushN = 5; // 手动种植每次落点的株数：5=一簇 / 1=单株精修（UI 可切）
  pendingConfirm: { plotId: number; tool: 'water' | 'fert' } | null = null; // 作物不需要却强行 → 二次确认弹窗

  // 待消费的播报（HUD 取走后清空）
  pendingToasts: string[] = [];

  // 机器人改种不同作物后、需按新作物布点(autoPoints)重建精灵的地块（field 渲染层消费后清空）
  dirtyPlots: number[] = [];

  plots: Plot[] = [];
  robot: RobotState = { ...MAP.robotHome, face: Math.PI, moving: false, module: null, hidden: false, charging: false };

  toggles: Toggles = {
    lightPool: true,
    bgFade: true,
    particles: true,
    dayTint: true,
    overlays: true,
    cropRelight: true,
    cropFullShadow: false, // 默认每株「接地定向阴影」(写实+更省GPU)；开=RT冠层整层投影(较重，会整体平移而略显悬浮)
  };

  // 本帧产生的粒子爆发事件（renderer 消费后清空）
  pendingBursts: Burst[] = [];

  // 机器人 AI 状态机（需求驱动：扫描田地选最高优先级任务 → 移动 → 作业/买卖 → 充电）
  res: Record<ResKey, number> = { water: 100, eco: 60 };
  robotBattery = 86;
  private rPhase: 'decide' | 'move' | 'work' | 'charge' = 'decide';
  private rTask: RobotTask | null = null;
  private rPend: { ck: string; value: number; urgency: number; power: number; nw0: number; bat0: number; ctx: string } | null = null; // 待结算动作(回报学习)；ctx=决策时情境键
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
  private roadHashTimer: ReturnType<typeof setTimeout> | 0 = 0; // URL hash 写入防抖
  private rPath: { left: number; top: number }[] = [];
  private rPathIdx = 0;

  constructor() {
    this.seed();
    if (!this.loadRoadNet()) this.seedRoadNet(); // 优先加载本地已保存的巡田路径，没有才用默认路网
    this.loadBrain(); // 在 freshBrain()/freshAI() 之后：把上次会话学到的策略合并进来（脏档/无档则保持 fresh）
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
      // 行情毛利 + 学习 Q + 应季加成（应季作物长得快产量高 → 优先种当季）
      const ev = 0.55 * (c.sell * (this.market[k] || 1) - c.seed) + 0.45 * (this.ai.q[k] || 0) + (this.seasonFit(k) - 0.7) * 180;
      if (ev > bestV) { bestV = ev; best = k; }
    }
    return best;
  }

  seed(capBoost = 0) {
    this.plots = [];
    this.dirtyPlots.length = 0;
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
          dead: false, deathKind: '' as const, respawnT: 0, fallowMS: 0, health: 1, plantQual: 1, phase: 'grow' as const,
        };
      });
      const weeds = i % 4 === 0 ? 2 : i % 3 === 0 ? 1 : 0;
      // 初始 weedProg 与起始 weeds 等级对齐（撂荒进度的反推）
      const weedProg = weeds === 2 ? 60 : weeds === 1 ? 24 : 0;
      // 恶性草初始：仅 1 块低度侵染做"种源"(起点低于机器人清除阈值，缓慢爬升)，整体保持稀少
      this.plots.push({ id: i, slots, weeds, weedProg, roadWeed: 0, roadDmg: false, idle: 0, malign: i === 5 ? 12 : 0, fertCd: 0 });
    }
  }

  // 全量重置（HUD「重置」按钮）：农田 + 市场 + AI 学习记录全部清空
  resetAll() {
    this.seed(this.stress ? 3 : 0);
    this.market = { tomato: 1, lettuce: 1, corn: 1, chili: 1, wheat: 1 };
    this.marketPrev = { tomato: 1, lettuce: 1, corn: 1, chili: 1, wheat: 1 };
    this.marketEvent = null;
    this.seedMkt = 1;
    this.ai = freshAI();
    this.brain = freshBrain();
    this.econ = freshEcon();
    this.player = freshPlayer();
    try { localStorage.removeItem('fp_pixi_brain'); } catch { /* 隐私模式忽略 */ } // 清学习存档，否则"重置"后下次启动又被旧档复活
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

    // 玩家体力随时间缓慢恢复（手动模式劳动门槛 → 不能无限作业；约 80s 回满）
    if (this.player.energy < this.player.energyMax) {
      this.player.energy = Math.min(this.player.energyMax, this.player.energy + 0.0015 * dtMS);
    }

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
    if (!this.live) this.calDay = (this.calDay + dtMS * 0.0003) % 360; // 加速：合成日历推进（一年≈20分钟，四季流转）

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
      if (p.fertCd > 0) p.fertCd -= dtMS; // 施肥冷却倒计时
      // 杂草拖慢生长：杂草率 >30% 起拖慢，最多降到 0.35（必须除草，对齐用户要求）
      const weedRate = Math.min(1, p.weedProg / 100);
      const weedFactor = weedRate > 0.3 ? Math.max(0.35, 1 - (weedRate - 0.3) * 1.2) : 1;
      // 恶性草抢营养：侵染 >30 起急剧拖慢，重度几乎让作物长不动（rule3「无法正常生长」）
      const malignFactor = p.malign > 30 ? Math.max(0.08, 1 - ((p.malign - 30) / 100) * 1.4) : 1;
      for (const sl of p.slots) {
        if (sl.dead) continue; // 枯死残株保留：待清枯转空地→翻耕→播种（手动玩家/托管机器人都走轮作，不自动重生）
        if (sl.phase !== 'grow') continue; // 空置/已翻耕地块不生长（待播种）
        // 收获后翻耕/休耕期：先显示裸土翻耕，暂不生长（让"耕地→育苗"过程看得见，而非收完瞬间满田新苗）
        if (sl.fallowMS > 0) { sl.fallowMS -= dtMS; continue; }
        if (sl.growth < 400) {
          // 每作物按自身生长周期(GROW_SEC 秒)连续推进：growth 0→400；各株再乘个体 rate(0.6~1.4) → 平滑爬升、每株不同
          const gPerMs = (400 / ((GROW_SEC[sl.crop] || 130) * 1000)) * stressMul;
          const waterFactor = sl.dry > 0 ? 0.25 : 1; // 缺水拖慢生长
          sl.growth += gPerMs * dtMS * sl.rate * (1 - wInt * (1 - stall) * 0.6) * waterFactor * weedFactor * malignFactor * (0.5 + 0.5 * sl.health) * sl.plantQual;
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
      this.rPend = null;
      return;
    }
    switch (this.rPhase) {
      case 'decide': this.robotBrain(); break;
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
  private plotTilled(p: Plot): boolean { return p.slots.length > 0 && p.slots.every((sl) => sl.phase === 'tilled'); } // 整块已翻耕待播（与 plantPlot 守卫一致 → 避免半块翻耕时反复空播种卡死）

  // 天气相位经济（移植 H5 wxTaskMod）：抢险任务(保温/排水)在灾害高潮期更费料、更费时、更耗电，起势/消退期省。
  private wxTaskMod(): { ecoMul: number; durMul: number; batMul: number } {
    if (!isDisaster(this.weather.type)) return { ecoMul: 1, durMul: 1, batMul: 1 };
    const prog = this.weatherProg();
    if (prog < 0.34) return { ecoMul: 0.5, durMul: 0.6, batMul: 0.6 }; // 起势
    if (prog < 0.7) return { ecoMul: 1.8, durMul: 1.7, batMul: 1.8 }; // 高潮
    return { ecoMul: 0.5, durMul: 0.5, batMul: 0.5 }; // 消退
  }

  // ===== 学习型决策大脑（替代固定优先级 robotDecide）=====
  // 每步枚举全部可做的事 → 打分 U = wValue·收益 + wUrgency·紧迫 − wPower·耗电 + 类别偏置 → ε-greedy 择优。
  // 动作完成后用「净资产增量 − 耗电成本」当回报反向更新权重（learnFromTask）→ 全局自学：最大化盈利、最省电高效、避闲置税。
  private robotBrain() {
    if (this.robotBattery < 12) { // 反射层：电量临界强制充电（防探索把自己困死）
      this.commit({ ck: 'charge', task: { kind: 'charge', label: '返回充电', plotId: -1, workMs: 0, bat: 0, atBuilding: true }, dest: MAP.station, value: 0, urgency: 3, power: 0, score: 0 });
      return;
    }
    const cands = this.candidates();
    const b = this.brain;
    const ctx = this.contextKey();
    const cb = b.ctxKind[ctx] || (b.ctxKind[ctx] = {}); // 当前情境的偏置表(按需建)
    let best = cands[0], bestScore = -Infinity;
    for (const c of cands) {
      c.score = b.wValue * c.value + b.wUrgency * c.urgency - b.wPower * c.power
              + (b.kind[c.ck] || 0)   // 全局偏置(学共性)
              + (cb[c.ck] || 0);      // 情境偏置(学差异：低电量更想充电、满载更想清货…)
      if (c.score > bestScore) { bestScore = c.score; best = c; }
    }
    this.commit((Math.random() < b.eps) ? cands[(Math.random() * cands.length) | 0] : best); // ε-greedy
  }

  // 情境分桶 → 情境键(如 "b1c2m0")：电量/载重/行情各三档，最多 27 桶(字典稀疏，实际更少)。
  // 粗粒度是刻意的——控制状态数、避免把连续量直接当 key 导致桶爆炸学不动。
  private contextKey(): string {
    const bat = this.robotBattery < 30 ? 0 : this.robotBattery < 70 ? 1 : 2;
    const cf = this.carryFrac();
    const carry = cf < 0.34 ? 0 : cf < 0.8 ? 1 : 2;
    const avgMkt = CROP_KEYS.reduce((s, k) => s + (this.market[k] || 1), 0) / CROP_KEYS.length;
    const mkt = avgMkt < 0.95 ? 0 : avgMkt < 1.1 ? 1 : 2;
    return `b${bat}c${carry}m${mkt}`;
  }

  // 枚举候选动作（含收益/紧迫/耗电特征）。耗电 = 作业电×载重倍率 + 距离×载重 → 距离近、空载更省电。
  private candidates(): Cand[] {
    const out: Cand[] = [];
    const wx = this.weather.type;
    const e = this.econ;
    const stockN = this.cropCount(e.stock);
    const whN = this.cropCount(e.wh);
    const carry = Math.min(1, stockN / STOCK_CAP);
    const carryMul = 1 + carry * CARRY_WORK_MUL;
    const avgMkt = CROP_KEYS.reduce((s, k) => s + (this.market[k] || 1), 0) / CROP_KEYS.length;
    const room = STOCK_CAP - stockN;
    const add = (ck: string, task: RobotTask, dest: { left: number; top: number }, value: number, urgency: number, workBat: number, res?: ResKey) => {
      const power = workBat * 0.6 * carryMul + this.distTo(dest) * 0.01 * carryMul; // 耗电特征(降权重，避免压垮播种/翻耕等养护)，仍保留距离/载重感知
      out.push({ ck, task, dest, value, urgency, power, res, score: 0 });
    };
    for (const p of this.plots) {
      const ap = this.approachPoint(p.id);
      const idleR = Math.min(1.6, p.idle / IDLE_LIMIT); // 闲置税风险
      if (room > 0) { // 采收（携带未满才收 → 满了被迫先清货）
        const ripe = p.slots.filter((sl) => sl.phase === 'grow' && !sl.dead && sl.growth >= 400);
        if (ripe.length) add('harvest', { kind: 'harvest', label: '采收', plotId: p.id, workMs: 900, bat: 3, atBuilding: false }, ap, Math.min(9, ripe.length, room) * this.priceOf(ripe[0].crop) / 1000, 1.1, 3);
      }
      if (p.slots.some((sl) => sl.dead)) add('clear', { kind: 'clear', label: '清枯', plotId: p.id, workMs: 600, bat: 3, atBuilding: false }, ap, 0.2, 0.7 + idleR, 3);
      if (this.res.water > 0 && this.needWater(p)) { const u = this.plotThirst(p); add('water', { kind: 'water', label: '浇水', plotId: p.id, workMs: 720, bat: 3, atBuilding: false }, ap, 0.3, Math.max(1, Math.min(3, u * 0.5)), 3); }
      if (wx === 'rain' && this.hasYoung(p)) { const tm = this.wxTaskMod(); add('drain', { kind: 'drain', label: '开沟排水', plotId: p.id, workMs: Math.round(900 * tm.durMul), bat: Math.max(1, Math.round(4 * tm.batMul)), atBuilding: false }, ap, 0.5, 1.6, 4); }
      if (wx === 'frost' && this.res.eco >= 8 && this.hasYoung(p)) { const tm = this.wxTaskMod(); add('cover', { kind: 'cover', label: '覆盖保温', plotId: p.id, workMs: Math.round(900 * tm.durMul), bat: Math.max(1, Math.round(4 * tm.batMul)), atBuilding: false }, ap, 0.5, 1.6, 4); }
      if (this.res.eco >= 20 && this.needFert(p)) add('fert', { kind: 'fert', label: '施肥', plotId: p.id, workMs: 720, bat: 3, atBuilding: false }, ap, 0.35, 0.5, 3);
      if (p.malign >= 35) add('weedm', { kind: 'weed', label: '清除恶性草', plotId: p.id, workMs: 2800, bat: 9, atBuilding: false }, ap, 0.6, 1.4, 9);
      else if (p.weedProg >= 50 && this.hasYoung(p)) add('weed', { kind: 'weed', label: '除草', plotId: p.id, workMs: 1600, bat: 5, atBuilding: false }, ap, 0.3, 0.6, 5);
      if ((p.roadDmg || p.roadWeed > 0) && this.ai.funds >= 320) add('repair', { kind: 'repair', label: '修路', plotId: p.id, workMs: 1900, bat: 3, atBuilding: false }, ap, -0.6, 0.7, 3);
      if (this.plotHasEmpty(p) && !this.hasYoung(p) && !p.slots.some((sl) => sl.dead)) add('till', { kind: 'till', label: '翻耕整地', plotId: p.id, workMs: 1100, bat: 4, atBuilding: false }, ap, 1.1, 1.0 + idleR * 1.3, 4); // 空出即翻耕(基础紧迫够高、不必等闲置攒够)；越久越紧迫 → 及时复种
      if (this.plotTilled(p) && this.econ.seedStock > 0) add('plant', { kind: 'plant', label: '播种', plotId: p.id, workMs: 720, bat: 3, atBuilding: false }, ap, 1.6, 0.9 + idleR * 1.3, 3); // 播种=投资未来收成，价值/紧迫足够高 → 不撂荒
    }
    // 经营：出售(行情高/库存陈/载重满 → 卖) vs 入库(行情低 → 囤等涨) —— 学习何时哪个划算
    if (stockN > 0) { const base = e.fresh * this.cropVal(e.stock); add('sell', { kind: 'sell', label: '去商店出售', plotId: -1, workMs: 1100, bat: 3, atBuilding: true }, MAP.shop, base * Math.max(0, avgMkt - 1.0) / 1000 + base * e.decay / 1000 + carry * 1.5, carry * 2 + (e.decay >= 0.09 ? 1 : 0), 3); }
    if (stockN >= 3) { const base = e.fresh * this.cropVal(e.stock); add('store', { kind: 'store', label: '去仓库入库', plotId: -1, workMs: 1100, bat: 3, atBuilding: true }, MAP.warehouse, base * e.decay / 1000 + (avgMkt < 1.0 ? this.ai.storeBias * 2.2 : -0.5) + carry * 1.2, carry * 1.5, 3); }
    if (whN > 0) add('sellwh', { kind: 'sellwh', label: '去商店清仓', plotId: -1, workMs: 1100, bat: 3, atBuilding: true }, MAP.shop, this.cropVal(e.wh) * Math.max(0, avgMkt - 1.0) / 1000 + (avgMkt >= 1.05 ? 1 : 0), avgMkt >= 1.1 ? 1.2 : 0.2, 3);
    // 种子供给：按「待复种地块(空地+已翻耕)」的需求采购 —— 缺口越大越紧迫，行情仅微调价值不致其转负。
    // 修复"翻耕好的地因没种子而长期撂荒"：有地等着种、种子又不够时，采购种子是高紧迫动作而非可有可无的小事
    // （旧版 urgency 固定 0.6、行情高时 value 转负 → buyseed 常年打不过其它任务 → 永远缺种 → 地一直空着）。
    let replantDemand = 0;
    for (const p of this.plots) if (this.plotHasEmpty(p) || this.plotTilled(p)) replantDemand++;
    if (replantDemand > 0 && this.econ.seedStock < replantDemand + 1) {
      const cost = this.seedBatchCost();
      if (this.ai.funds >= cost) {
        const gap = replantDemand + 1 - this.econ.seedStock; // 种子缺口(地块数)
        add('buyseed', { kind: 'buy', label: '采购种子', plotId: -1, workMs: 1100, bat: 3, atBuilding: true }, MAP.shop, 1.4 + Math.max(-0.3, (SEED_BASE - cost) / 1000), 1.2 + Math.min(2.2, gap * 0.7), 3);
      }
    }
    const low = this.lowestRes();
    if (low && this.ai.funds > 200) { const ratio = this.res[low] / RES_MAX[low]; add('buyres', { kind: 'buy', label: '采购' + RES_NAME[low], plotId: -1, workMs: 1100, bat: 3, atBuilding: true }, MAP.shop, 0.4, Math.min(2, (0.2 - ratio) * 6 + 0.4), 3, low); }
    add('charge', { kind: 'charge', label: '返回充电', plotId: -1, workMs: 0, bat: 0, atBuilding: true }, MAP.station, 0, Math.max(0, (62 - this.robotBattery) / 18), 0);
    add('idle', { kind: 'idle', label: '待命充电', plotId: -1, workMs: 0, bat: 0, atBuilding: true }, MAP.station, 0, 0.08, 0);
    return out;
  }

  // 提交选定动作：记录待结算特征(回报学习) + 设置买货标志 + 启动任务
  private commit(c: Cand) {
    if (c.ck === 'buyseed') this.buySeed = true;
    else if (c.ck === 'buyres') { this.buyResKey = c.res || null; this.buySeed = false; }
    this.rPend = { ck: c.ck, value: c.value, urgency: c.urgency, power: c.power, nw0: this.netWorth(), bat0: this.robotBattery, ctx: this.contextKey() };
    this.startTask(c.task, c.dest);
  }

  // 动作完成后结算回报并更新权重（线性回报回归：打分逼近真实回报）
  private learnFromTask() {
    const la = this.rPend; if (!la) return;
    const b = this.brain;
    const powerSpent = Math.max(0, la.bat0 - this.robotBattery);
    const batGain = Math.max(0, this.robotBattery - la.bat0);
    // 投资/养护类收益在「未来收成」(作物存活/生长/护苗)、当下净资产不升甚至降(种子/料/电不计入 netWorth)→
    // 若用净资产增量当回报，会把它们学成"亏本"→ 越学越不愿做：机器人不肯种地撂荒、且【晴天该浇水也不浇】(浇水不涨净资产只耗电→kind['water'] 被学到 −3 压制)。
    // 故这些任务用其预期价值(value)作正向塑形回报。养护类(浇水/施肥/排水/保温/除草)只在 needWater/needFert/天气 门控满足时才进候选 → 正向塑形不会导致过量养护。
    const invest = la.ck === 'plant' || la.ck === 'till' || la.ck === 'buyseed' || la.ck === 'buyres' || la.ck === 'clear'
      || la.ck === 'water' || la.ck === 'fert' || la.ck === 'drain' || la.ck === 'cover' || la.ck === 'weed' || la.ck === 'weedm';
    const r = invest
      ? Math.max(0.4, la.value) - powerSpent * POWER_VALUE * 0.05
      : (this.netWorth() - la.nw0) / 1000 - powerSpent * POWER_VALUE * 0.1 + batGain * POWER_VALUE * 0.02; // 其余(收/卖/入库/充电)按净资产增量 − 耗电 + 充电价值
    const pred = b.wValue * la.value + b.wUrgency * la.urgency - b.wPower * la.power + (b.kind[la.ck] || 0);
    const err = Math.max(-3, Math.min(3, r - pred)); // 误差截断 → 稳定
    const a = 0.015;
    b.wValue = clampW(b.wValue + a * err * la.value);
    b.wUrgency = clampW(b.wUrgency + a * err * la.urgency);
    b.wPower = clampW(b.wPower - a * err * la.power); // power 负向特征
    b.kind[la.ck] = Math.max(-3, Math.min(3, (b.kind[la.ck] || 0) + a * err)); // 全局偏置(共性)
    const cb = b.ctxKind[la.ctx] || (b.ctxKind[la.ctx] = {}); // 情境偏置(差异)：同一动作在不同情境下学到不同价值
    cb[la.ck] = Math.max(-3, Math.min(3, (cb[la.ck] || 0) + a * err));
    b.steps++;
    b.netReward += r;
    b.eps = Math.max(0.05, b.eps * 0.9992); // 探索率缓慢衰减 → 越学越笃定
    if (b.steps % 20 === 0) this.saveBrain(); // 节流落盘：每 20 次决策存一次（关页/隐藏时另强存一次，见 main.ts）
    this.rPend = null;
  }

  private netWorth(): number { return this.ai.funds + this.econ.fresh * this.cropVal(this.econ.stock) + this.cropVal(this.econ.wh); }
  private distTo(d: { left: number; top: number }): number { return Math.hypot(d.left - this.robot.left, d.top - this.robot.top); }
  private carryFrac(): number { return Math.min(1, this.cropCount(this.econ.stock) / STOCK_CAP); }
  private plotThirst(p: Plot): number {
    let u = 0;
    for (const sl of p.slots) { if (sl.phase !== 'grow' || sl.dead || sl.growth >= 400) continue; if (sl.moist <= 2 || sl.dry > 0) u = Math.max(u, sl.dry * 1.2 + (3 - sl.moist)); }
    return u;
  }
  // 作物是否「需要浇水」：阴雨/霜冻/夜间植物蒸腾弱基本不需；晴/旱白天且有干燥活株才需（按天气+生长设任务，非看库存）
  needWater(p: Plot): boolean {
    const wx = this.weather.type;
    if (wx === 'rain' || wx === 'lightrain' || wx === 'frost') return false; // 降水(雨/小雨)作物自得水、霜冻休眠 → 不浇；阴天会慢慢变干，按需浇（不再一律豁免阴天）
    // 不再硬排除夜间：夜里作物本就不耗水(lifeTick)→自然不渴；但若白天遗留了"真渴"的株(dry>0)，夜里也允许补救浇水，避免枯死
    return p.slots.some((sl) => sl.phase === 'grow' && !sl.dead && sl.growth < 400 && (sl.moist <= 2 || sl.dry > 0));
  }
  // 作物是否「需要施肥」：生长期(过了发芽、未将熟)且未在施肥冷却内（生长期勤施、其余基本不需）
  needFert(p: Plot): boolean {
    if (p.fertCd > 0) return false;
    return p.slots.some((sl) => sl.phase === 'grow' && !sl.dead && sl.growth >= 60 && sl.growth < 380);
  }
  // 种子批实时价（随种子行情 seedMkt 浮动）
  seedBatchCost(): number { return Math.round(SEED_BASE * this.seedMkt); }

  // ===== 种植考核：四季 + 行距/时机评分 =====
  // 当前季节(0春1夏2秋3冬)：live 按农场真实月份，加速按合成日历
  season(): number {
    if (this.live) {
      const n = new Date();
      const m = new Date(n.getTime() + n.getTimezoneOffset() * 60000 + 8 * 3600000).getMonth(); // 上海时月份 0-11
      return (m === 11 || m <= 1) ? 3 : m <= 4 ? 0 : m <= 7 ? 1 : 2; // 冬(12/1/2) 春(3-5) 夏(6-8) 秋(9-11)
    }
    return Math.min(3, Math.floor((this.calDay / 360) * 4));
  }
  seasonName(): string { return SEASON_NAME[this.season()]; }
  // 应季契合度(0.4..1)：当前季在适播季→1；差 1 季→0.7；差 2 季→0.4
  seasonFit(crop: CropKey): number {
    const s = this.season();
    if (CROP_SEASON[crop].includes(s)) return 1;
    let dmin = 2;
    for (const i of CROP_SEASON[crop]) { const d = Math.min(Math.abs(s - i), 4 - Math.abs(s - i)); if (d < dmin) dmin = d; }
    return Math.max(0.4, 1 - dmin * 0.3);
  }
  // 作物理想株距（从 autoPoints 理想密度反推平均最近邻距，缓存）
  private idealGapCache: Partial<Record<CropKey, number>> = {};
  private idealGap(crop: CropKey): number {
    const c = this.idealGapCache[crop]; if (c != null) return c;
    const pts = autoPoints(6, crop, getQuad(6), 0);
    let sum = 0, cnt = 0;
    for (let i = 0; i < pts.length; i++) {
      let nn = Infinity;
      for (let j = 0; j < pts.length; j++) { if (i === j) continue; const d = Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y); if (d < nn) nn = d; }
      if (nn < Infinity) { sum += nn; cnt++; }
    }
    const g = cnt > 0 ? sum / cnt : 3;
    this.idealGapCache[crop] = g;
    return g;
  }
  // 评估整块种植考核 → 各活株 plantQual = 行距评分 × 应季时机。混种时邻居含异种(物理拥挤)；过密→分低。
  private assessPlanting(p: Plot) {
    const grows = p.slots.filter((sl) => sl.phase === 'grow' && !sl.dead);
    if (grows.length > 140) { // 密植(如小麦~400株)跳过 O(n²) 最近邻：均匀网格行距本就一致，质量由应季主导 → 防每次播种/收获卡顿一下
      for (const sl of grows) sl.plantQual = +Math.max(0.2, this.seasonFit(sl.crop)).toFixed(3);
      return;
    }
    for (const sl of grows) {
      let nn = Infinity;
      for (const o of grows) { if (o === sl) continue; const d = Math.hypot(sl.pt.x - o.pt.x, sl.pt.y - o.pt.y); if (d < nn) nn = d; }
      const ideal = this.idealGap(sl.crop);
      const space = nn === Infinity ? 1 : (nn >= ideal ? 1 : Math.max(0.3, 0.3 + 0.7 * (nn / ideal))); // 过密线性惩罚至 0.3
      sl.plantQual = +(Math.max(0.2, space * this.seasonFit(sl.crop))).toFixed(3);
    }
  }

  // 手动逐点种植：在地块落点(% 坐标)撒一小簇当前选种(可混种)，按株扣金币、落点即重评行距 → 玩家自定义种多密/种什么/种哪里
  manualPlantPoint(plotId: number, xPct: number, yPct: number) {
    const p = this.plots[plotId]; if (!p) return;
    const crop = this.manualSeed;
    const per = Math.max(2, Math.round(CROPS[crop].seed / 14));
    const N = Math.max(1, this.plantBrushN); // 5=一簇 / 1=单株精修（plantBrushN 由 UI 切换）
    if (this.player.coins < per * N) return this.pushToast(`🪙 金币不足（${N > 1 ? '每簇' : '每株'}约 ${per * N}🪙）`);
    const q = getQuad(plotId);
    const top = q[0][1], pdep = Math.abs(q[2][1] - q[0][1]) || 1;
    const ig = this.idealGap(crop);
    p.slots = p.slots.filter((sl) => sl.phase === 'grow' && !sl.dead); // 清掉空地/枯株，保留在长作物(支持混种)
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2, r = i === 0 ? 0 : ig * (0.5 + 0.4 * ((i * 7) % 3));
      const x = Math.max(q[3][0], Math.min(q[1][0], xPct + Math.cos(a) * r));
      const y = Math.max(top + 0.3, Math.min(top + pdep - 0.3, yPct + Math.sin(a) * r * 0.6));
      const depth = Math.max(0, Math.min(1, (y - top) / pdep));
      const gh = (((Math.round(x * 7.3 + y * 13.1) % 100) + 100) % 100) / 100;
      p.slots.push({
        pt: { x, y, depth }, crop, growth: 0, rate: 0.6 + gh * 0.8,
        moist: 8, dry: 0, flood: 0, frost: 0, parch: 0, age: 0,
        dead: false, deathKind: '' as const, respawnT: 0, fallowMS: this.stress ? 1200 : 2200,
        health: 1, plantQual: 1, phase: 'grow' as const,
      });
    }
    this.player.coins -= per * N;
    p.weeds = 0; p.weedProg = 0;
    this.assessPlanting(p); // 落点即重评（过密→各株质量下降）
    this.dirtyPlots.push(plotId);
    const fit = this.seasonFit(crop);
    this.pushToast(fit >= 1 ? `🌱 种下「${CROPS[crop].name}」×${N}（应季✓）` : `🌱 种下「${CROPS[crop].name}」×${N}（非适播季·${this.seasonName()}，长势打折）`);
  }

  private startTask(task: RobotTask, dest: { left: number; top: number }) {
    this.rTask = task;
    this.rDest = { left: dest.left, top: dest.top };
    this.rPath = this.routeTo({ left: this.robot.left, top: this.robot.top }, dest);
    this.rPathIdx = 0;
    this.rDidTask = false;
    this.rPhase = 'move';
    this.robot.charging = false; // 离站去新任务 → 关闭头部充电 UI
    this.robot.module = MOD_FOR[task.kind] || null;
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
    const carry = this.carryFrac();
    if (carry > 0) this.robotBattery = Math.max(0, this.robotBattery - CARRY_MOVE_DRAIN * carry * Math.min(dist, step)); // 载货移动耗电（空载几乎免费）→ 学习少载多跑/就近清货
  }

  private robotWork(dtMS: number) {
    const t = this.rTask!;
    this.robot.moving = false;
    if (!this.rDidTask) {
      this.rDidTask = true;
      const cf = this.carryFrac(); // 作业前的载重（载货越多作业越费电）
      if (t.atBuilding) this.robot.hidden = true; // 进入商店/仓库（视觉消失）
      this.execTask(t);
      this.robotBattery = Math.max(0, this.robotBattery - t.bat * (1 + cf * CARRY_WORK_MUL));
    }
    this.robotAction = (t.atBuilding ? t.label + '·办理' : `${t.plotId + 1} 号地 · ${t.label}`) + '中…';
    this.rWork -= dtMS;
    if (this.rWork <= 0) {
      this.robot.hidden = false; // 办完出现在门口，随后返回田地
      this.learnFromTask(); // 结算回报 → 更新大脑权重
      this.rPhase = 'decide';
      this.rTask = null;
    }
  }

  private robotCharge(dtMS: number) {
    const t = this.rTask!;
    this.robot.moving = false;
    this.robot.module = null;
    this.robot.charging = true; // 头部充电进度 UI 开关（robot.ts 读取）
    const rate = 7 * (1 - this.ai.wear * 0.7) * (dtMS / 700); // 每 ~700ms +7（老化拖慢充电）
    this.robotBattery = Math.min(100, this.robotBattery + rate);
    this.robotAction = (t.kind === 'idle' ? '待命充电 ' : '充电中 ') + Math.round(this.robotBattery) + '%';
    if (this.robotBattery >= (t.kind === 'idle' ? 100 : 60)) { this.robot.charging = false; this.learnFromTask(); this.rPhase = 'decide'; this.rTask = null; }
  }

  // 执行作业：资源消耗 + 经济入账 + 粒子
  private execTask(t: RobotTask) {
    const id = t.plotId;
    const burst = (kind: 'water' | 'fert') => { if (this.toggles.particles && id >= 0) this.pendingBursts.push({ plotId: id, kind }); };
    switch (t.kind) {
      case 'water': this.applyWater(id); this.res.water = Math.max(0, this.res.water - 4); burst('water'); break;
      case 'drain': this.drainPlot(id); this.res.eco = Math.max(0, this.res.eco - Math.round(6 * this.wxTaskMod().ecoMul)); burst('water'); break;
      case 'fert': this.fertPlot(id); this.res.eco = Math.max(0, this.res.eco - 3); burst('fert'); break;
      case 'cover': this.coverPlot(id); this.res.eco = Math.max(0, this.res.eco - Math.round(8 * this.wxTaskMod().ecoMul)); burst('fert'); break;
      case 'harvest': this.harvestPlot(id); burst('fert'); break;
      case 'clear': this.clearPlot(id); burst('fert'); break;
      case 'weed': this.weedPlot(id); burst('fert'); break;
      case 'till': this.tillPlot(id); burst('fert'); break;
      case 'plant': this.plantPlot(id); burst('fert'); break;
      case 'repair': this.repairPlot(id); break;
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
  private fertPlot(id: number) { const p = this.plots[id]; if (!p) return; for (const sl of p.slots) if (!sl.dead && sl.growth < 400) sl.growth = Math.min(400, sl.growth + 18); p.fertCd = FERT_CD; this.ai.last = '🌿 精准施肥，加速生长'; }
  private clearPlot(id: number) {
    const p = this.plots[id]; if (!p) return; let n = 0;
    for (const sl of p.slots) if (sl.dead) { sl.dead = false; sl.deathKind = ''; sl.phase = 'empty'; n++; } // 清枯→空地，待翻耕（手动/托管同）
    if (n > 0) this.ai.last = `🥀 清除 ${n} 株枯株（空出待翻耕）`;
  }
  private weedPlot(id: number) {
    const p = this.plots[id]; if (!p) return;
    p.weeds = 0; p.weedProg = 0; p.roadWeed = p.roadDmg ? p.roadWeed : 0;
    if (p.malign >= 35) { p.malign = Math.max(6, p.malign - 70); this.ai.last = '☠️ 清除恶性草（难根除，仍会缓慢复发）'; } // 大幅压制回落低位，长时间才复发（rule3 难根除）
    else this.ai.last = '🌿 清除杂草，恢复可耕作';
  }
  private tillPlot(id: number) {
    const p = this.plots[id]; if (!p) return;
    for (const sl of p.slots) if (sl.phase === 'empty') sl.phase = 'tilled'; // 空地→已翻耕（手动/托管同）
    p.weeds = 0; p.weedProg = 0; // 翻耕同时清除杂草
    this.ai.last = '🚜 翻耕整地，准备播种';
  }
  // 修路：清除道路杂草/破损，扣 320🪙（对齐 H5 robotRepair）
  private repairPlot(id: number) {
    const p = this.plots[id]; if (!p) return;
    const cost = 320;
    if (this.ai.funds < cost) { this.ai.last = '💰 资金不足，无法修路'; return; }
    this.ai.funds -= cost;
    p.roadWeed = 0; p.roadDmg = false;
    this.ai.last = `🛠 修补受损道路（-${cost}🪙）`;
    this.pushToast(this.ai.last);
  }
  private buyResource() {
    if (this.buySeed) { // 采购种子批：seedStock +9（价格随种子行情 seedMkt 浮动 → 学习择时低价采购）
      const cost = this.seedBatchCost();
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
  private lowestRes(): ResKey | null {
    const thr: Record<ResKey, number> = { water: 16, eco: 12 }; // 仅水/生态肥（对齐 H5 双池）；种子由 econ.seedStock 接管
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
    // 已基本到达目的地：直接到点，不要绕去最近路网节点再折返。
    // 修复"充电结束在基站前来回抖动"：基站常不在某个路网节点上，routeTo(站,站) 旧逻辑会返回 [站,最近节点,站]
    // 的"出门又回来"路径；ε-greedy 在满电时偶尔反复选 idle/充电 → 机器人就在基站与最近节点间反复横跳。
    if (Math.hypot(to.left - from.left, to.top - from.top) < 1.2) return [to];
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
  resetRoadNet() { this.seedRoadNet(); try { localStorage.removeItem('fp_pixi_roadnet'); } catch { /* 隐私模式忽略 */ } try { if (this.roadHashTimer) clearTimeout(this.roadHashTimer); history.replaceState(null, '', location.pathname + location.search); } catch { /* ignore */ } } // 恢复默认并清除本地覆盖 + URL hash
  clearRoadNet() { this.roadNet = { nodes: [], edges: [] }; this.saveRoadNet(); }

  // 巡田路径持久化（localStorage，强刷/重开浏览器都不丢；对齐 H5 的 fp_roadnet 机制）
  private saveRoadNet() {
    try { localStorage.setItem('fp_pixi_roadnet', JSON.stringify(this.roadNet)); } catch { /* 隐私模式忽略 */ }
    // 同步写 URL hash（防抖 350ms）：hash 随 URL 保留 → 强刷/书签/跨窗口(含无痕，打开同一 URL)都不丢；
    // 防抖避免拖动节点时高频 replaceState 触发 Safari 节流。
    try {
      if (this.roadHashTimer) clearTimeout(this.roadHashTimer);
      this.roadHashTimer = setTimeout(() => this.writeRoadHash(), 350);
    } catch { /* ignore */ }
  }
  // 紧凑编码进 URL hash：#r={n:[l,t,...], e:[a,b,...]}（坐标保留 1 位小数，控制长度）
  private writeRoadHash() {
    try {
      const n = this.roadNet.nodes.flatMap((p) => [Math.round(p.left * 10) / 10, Math.round(p.top * 10) / 10]);
      const e = this.roadNet.edges.flat();
      history.replaceState(null, '', '#r=' + encodeURIComponent(JSON.stringify({ n, e })));
    } catch { /* ignore */ }
  }
  private decodeRoadHash(): RoadNet | null {
    try {
      const m = /(?:^|[#&])r=([^&]+)/.exec(location.hash || '');
      if (!m) return null;
      const o = JSON.parse(decodeURIComponent(m[1])) as { n: number[]; e: number[] };
      if (!o || !Array.isArray(o.n) || !Array.isArray(o.e)) return null;
      const nodes: { left: number; top: number }[] = [];
      for (let i = 0; i + 1 < o.n.length; i += 2) { const l = o.n[i], t = o.n[i + 1]; if (!Number.isFinite(l) || !Number.isFinite(t)) return null; nodes.push({ left: l, top: t }); }
      const edges: [number, number][] = [];
      for (let i = 0; i + 1 < o.e.length; i += 2) { const a = o.e[i], b = o.e[i + 1]; if (!Number.isFinite(a) || !Number.isFinite(b)) return null; edges.push([a, b]); }
      return { nodes, edges };
    } catch { return null; }
  }
  private loadRoadNet(): boolean {
    // 1) URL hash 优先：hash 随 URL 保留 → 强刷/书签/分享/跨窗口都能恢复（无痕窗口打开带 hash 的 URL 亦可）。
    const fromHash = this.decodeRoadHash();
    if (fromHash && fromHash.nodes.length) { this.roadNet = fromHash; this.saveRoadNet(); return true; }
    // 2) localStorage：普通窗口便捷恢复（无需 URL 带 hash）；命中后回写 hash → 之后强刷走 hash 兜底。
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
        this.writeRoadHash();
        return true;
      }
    } catch { /* 解析失败 → 回退默认路网 */ }
    return false;
  }

  // —— 学习成果持久化（localStorage，跨会话累积"越用越聪明"）——
  // 只存「学到的策略」(权重/偏置/作物 Q/阈值/探索率)，不存 funds/stock/plots 等游戏局面（那会破坏重置语义）。
  // 沿用路网的 fp_pixi_ 前缀与 try/catch（隐私模式不崩）；重置由 resetAll() 清档；关页/隐藏强存见 main.ts。
  // public：供 main.ts 在 visibilitychange/pagehide 时强制 flush。
  saveBrain(): void {
    try {
      const blob = {
        v: BRAIN_SAVE_V,
        brain: this.brain,                  // 权重 wValue/wUrgency/wPower + 全局偏置 kind + 情境偏置 ctxKind + densBias/eps/steps/netReward
        q: this.ai.q,                       // 各作物 Q（选种学习量）
        sellThreshold: this.ai.sellThreshold,
        storeBias: this.ai.storeBias,
        explore: this.ai.explore,
      };
      localStorage.setItem('fp_pixi_brain', JSON.stringify(blob));
    } catch { /* 隐私模式忽略 */ }
  }
  // 启动时读取并「带校验合并」：读不到/版本不符/结构不符 → 保持 fresh；逐字段 Number.isFinite + clamp、缺字段用默认
  // → 脏档绝不崩、绝不注入 NaN 污染打分。在 constructor 的 freshBrain()/freshAI() 之后调用。
  private loadBrain(): void {
    try {
      const raw = localStorage.getItem('fp_pixi_brain');
      if (!raw) return;
      const s = JSON.parse(raw);
      if (!s || s.v !== BRAIN_SAVE_V || typeof s.brain !== 'object') return; // 版本/结构不符 → 用 fresh
      const b = s.brain;
      if (Number.isFinite(b.wValue)) this.brain.wValue = clampW(b.wValue);
      if (Number.isFinite(b.wUrgency)) this.brain.wUrgency = clampW(b.wUrgency);
      if (Number.isFinite(b.wPower)) this.brain.wPower = clampW(b.wPower);
      if (Number.isFinite(b.densBias)) this.brain.densBias = Math.max(-3, Math.min(3, b.densBias));
      if (Number.isFinite(b.eps)) this.brain.eps = Math.max(0.05, Math.min(0.5, b.eps));
      if (Number.isFinite(b.steps)) this.brain.steps = b.steps;
      if (Number.isFinite(b.netReward)) this.brain.netReward = b.netReward;
      if (b.kind && typeof b.kind === 'object') this.brain.kind = sanitizeBias(b.kind); // 清洗：丢非有限数、clamp[-3,3]
      if (b.ctxKind && typeof b.ctxKind === 'object') this.brain.ctxKind = sanitizeCtx(b.ctxKind); // 情境偏置：逐桶清洗(任务 B)
      if (s.q && typeof s.q === 'object') for (const k of CROP_KEYS) if (Number.isFinite(s.q[k])) this.ai.q[k] = s.q[k];
      if (Number.isFinite(s.sellThreshold)) this.ai.sellThreshold = Math.max(2, Math.min(9, s.sellThreshold));
      if (Number.isFinite(s.storeBias)) this.ai.storeBias = Math.max(0.1, Math.min(0.92, s.storeBias));
      if (Number.isFinite(s.explore)) this.ai.explore = Math.max(0.05, Math.min(0.5, s.explore));
    } catch { /* 损坏存档忽略，用 fresh */ }
  }

  // 收获该地块所有成熟株 → 入待售库存 econ.stock（不即时变现，带新鲜度）+ 更新 Q 值 + 回补生态肥。
  // 收成以「地块单位」计（封顶 9，对齐 H5 每块≤9 株的经济口径）：与视觉密度解耦，避免密植麦田刷爆库存使售卖阈值失效。
  // 原地复种暂保留（P1 将改为 翻耕→播种 轮作，并救活闲置税）。
  private harvestPlot(plotId: number): number {
    if (this.mode !== 'auto') return 0;
    const p = this.plots[plotId];
    if (!p) return 0;
    if (STOCK_CAP - this.cropCount(this.econ.stock) <= 0) return 0; // 满载收不进 → 先清货
    // 按作物分组成熟株（支持混种）：株数 + 累计种植质量(plantQual×健康)
    const byCrop = new Map<CropKey, { n: number; q: number }>();
    let totalN = 0;
    for (const sl of p.slots) {
      if (sl.phase !== 'grow' || sl.dead || sl.growth < 400) continue;
      const g = byCrop.get(sl.crop) || { n: 0, q: 0 };
      g.n++; g.q += sl.plantQual * (0.5 + 0.5 * sl.health);
      byCrop.set(sl.crop, g);
      sl.phase = 'empty'; sl.fallowMS = 0; totalN++;
    }
    if (totalN === 0) return 0;
    let totUnits = 0;
    for (const [crop, g] of byCrop) {
      const room = STOCK_CAP - this.cropCount(this.econ.stock); if (room <= 0) break;
      const avgQ = g.q / g.n; // 平均种植质量 → 产量缩放（行距/应季差 → 产量低）
      const units = Math.min(room, Math.max(1, Math.round(Math.min(9, g.n) * avgQ)));
      this.econ.stock[crop] = (this.econ.stock[crop] || 0) + units;
      const had = this.cropCount(this.econ.stock) - units;
      this.econ.fresh = had > 0 ? (had * this.econ.fresh + units * 1) / (had + units) : 1;
      this.res.eco = Math.min(RES_MAX.eco, this.res.eco + 5);
      this.ai.q[crop] += 0.25 * ((this.priceOf(crop) - CROPS[crop].seed) - this.ai.q[crop]);
      this.ai.harvests += units;
      // 学最优行距(仅应季时学：离季的低分是季节造成、非行距)：质量低(过密拥挤)→种稀；质量回升→缓回理想但不超理想(densBias≤0)→ 不增精灵/卡顿，且收成封顶9单位、再密无益
      if (this.seasonFit(crop) > 0.9) {
        if (avgQ < 0.85) this.brain.densBias = +Math.max(-2, this.brain.densBias - 0.12).toFixed(3);
        else if (avgQ > 0.97 && this.brain.densBias < 0) this.brain.densBias = +Math.min(0, this.brain.densBias + 0.06).toFixed(3);
      }
      totUnits += units;
    }
    this.ai.trades++;
    this.ai.last = `🧺 ${plotId + 1} 号地收获 ×${totUnits}（种植质量影响产量）`;
    return totalN;
  }

  // 播种：已翻耕(tilled)地块种上 chooseCrop 选定作物，消耗 1 批种子单位 seedStock（对齐 H5 plant）。
  // 关键：按「新作物」自身的行距/密度规则(autoPoints)重建种植点 —— 小麦密、玉米疏、辣椒更密… 不再沿用上一茬的布点。
  private plantPlot(plotId: number) {
    const p = this.plots[plotId];
    if (!p || this.econ.seedStock <= 0) return;
    if (!p.slots.length || !p.slots.every((sl) => sl.phase === 'tilled')) return; // 仅整块已翻耕才播种（避免误伤在长作物）
    const crop = this.chooseCrop();
    const q = getQuad(plotId);
    const pts = autoPoints(plotId, crop, q, (this.stress ? 3 : 0) + Math.min(0, Math.round(this.brain.densBias))); // densBias 只向「更稀」学(≤0)：理想密度已够繁茂，再密只增精灵不增产(收成封顶9单位)→ 限精灵数防卡顿
    p.slots = pts.map((pt) => {
      const gh = (((Math.round(pt.x * 7.3 + pt.y * 13.1) % 100) + 100) % 100) / 100;
      const rate = 0.6 + gh * 0.8;
      return {
        pt, crop, growth: 0, rate,
        moist: 8, dry: 0, flood: 0, frost: 0, parch: 0, age: 0,
        dead: false, deathKind: '' as const, respawnT: 0,
        fallowMS: this.stress ? 1200 : 2200, health: 1, plantQual: 1, phase: 'grow' as const,
      };
    });
    this.assessPlanting(p); // 种植考核：行距 × 应季 → 各株 plantQual
    this.dirtyPlots.push(plotId); // 通知渲染层按新布点重建该地块作物精灵
    this.econ.seedStock = Math.max(0, this.econ.seedStock - 1); // 一块地耗 1 批种子单位
    this.ai.plantings++;
    this.ai.explore = Math.max(0.05, this.ai.explore * 0.96); // 探索率随播种衰减
    this.ai.last = `🌱 ${plotId + 1} 号地播种「${CROPS[crop].name}」`;
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
    // 种子行情：均值回归 1.0 + 噪声，clamp[0.6,1.8]（低时买种划算，机器人/玩家学习择时采购）
    this.seedMkt = +Math.max(0.6, Math.min(1.8, this.seedMkt + (1 - this.seedMkt) * 0.04 + (Math.random() - 0.5) * 0.16)).toFixed(3);
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
      // 恶性草(Yellow Dock)：仅已侵染地块缓慢生长(频率大幅降低)；干净地块不自发起草，仅靠偶发播散；雨天略快
      if (p.malign > 1) p.malign = Math.min(100, p.malign + 0.35 * (wx === 'rain' ? 1.4 : 1));
      // 长在路上 → 毁路：仅重度侵染(阈值抬高)才推高道路杂草/破坏路面，几乎不触发
      if (p.malign > 60) { p.roadWeed = Math.min(3, Math.max(p.roadWeed, Math.floor((p.malign - 60) / 16))); if (p.malign > 85) p.roadDmg = true; }
    }
    // 播散：仅重度侵染(>55)地块偶尔(1.5%)向另一干净地块少量播散、且封顶很低 → 整体保持稀少，不再全田蔓延
    if (this.plots.some((p) => p.malign > 55) && Math.random() < 0.015) {
      const t = this.plots[(Math.random() * this.plots.length) | 0];
      if (t && t.malign < 25) t.malign = Math.min(25, t.malign + 6);
    }
  }

  // AI 经济结算：闲置土地税 + 低资金设备老化 + 破产重置
  private aiEconomyTick() {
    const ai = this.ai;
    // 闲置土地税：持续闲置(idle>IDLE_LIMIT)≥3 块即开始课税，块数越多税越重 → 给"撂荒"实打实的经济惩罚
    // （旧版要 >7 块才课税 → 12 块地撂荒一半也不交税；且课税后把 idle 清零 → 翻耕紧迫度 idleR 被打回 0、越交税越不想耕，自相矛盾）。
    // 现：不清 idle，让其持续累积 → 翻耕/播种紧迫度保持高位；机器人一旦复耕复种→该地转生产→slowTick 自动清零 idle→自然停税。
    const overIds = this.plots.filter((p) => p.idle > IDLE_LIMIT).map((p) => p.id);
    if (overIds.length >= 3 && Math.random() < 0.35) {
      const hit = Math.min(overIds.length, 5);
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
    this.lifeN++;
    const wInt = this.weatherIntensity();
    const wx = this.weather.type;
    const night = this.tod < 0.27 || this.tod > 0.80; // 夜间：作物蒸腾弱 → 基本不耗水、不旱死（与 needWater 口径一致，修"夜里不浇水却枯死")
    const wxRate = 0.3 + wInt * 1.1; // 灾害累积速率随强度
    for (const p of this.plots) {
      for (const sl of p.slots) {
        if (sl.dead || sl.phase !== 'grow') continue; // 空置/已翻耕地块无应激
        sl.health = Math.min(1, sl.health + 0.04); // 健康缓慢恢复（肥害/涝害后回血）
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
          if (!night) { // 白天才耗水/旱死，夜间蒸腾弱
            if (sl.moist > 0) { sl.moist = Math.max(0, sl.moist - (wInt > 0.5 ? 2 : 1)); sl.dry = 0; }
            else { sl.dry += wInt > 0.5 ? 2 : 1; if (sl.dry >= (DRY_DEATH[stage] || 5)) this.kill(sl, 'dry'); }
          }
        } else if (wx === 'lightrain') {
          sl.dry = 0; sl.moist = Math.max(sl.moist, 2); // 小雨=降水：作物自得水
        } else if (wx === 'cloudy') {
          // 阴天：无降水、蒸发弱但仍会慢慢变干（白天·半速）→ 久阴不浇也会渴/枯，需机器人偶尔补水（与 needWater 一致）
          if (!night && (this.lifeN & 1) === 0) {
            if (sl.moist > 0) { sl.moist -= 1; sl.dry = 0; }
            else { sl.dry += 1; if (sl.dry >= (DRY_DEATH[stage] || 5)) this.kill(sl, 'dry'); }
          }
        } else if (!night) {
          // 晴·白天：全速耗水，断水累积缺水 → 旱死（夜间不耗水、不旱死 → 机器人夜里不浇水也不会枯）
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


  // 浇水：复位该地块所有活株的缺水/湿度（机器人巡田到点 + 手动点地块）
  applyWater(plotId: number) {
    const p = this.plots[plotId];
    if (!p) return;
    for (const sl of p.slots) {
      if (sl.dead) continue;
      sl.moist = 8; sl.dry = 0; // 浇透：湿度上调，延长两次浇水之间的耐受窗口
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
      // 阴天/小雨：给一个柔和常量强度，驱动作物重打光/生长等玩法（背景另用 bgWeatherIntensity）
      return this.weather.type === 'clear' ? 0 : 0.6;
    }
    return wxIntensity(this.weatherProg());
  }

  // 背景层专用强度：阴天/小雨等「稳态非灾害」天气，背景应「完整」显示该天气的天空场景，
  // 不能像玩法那样只给 0.6 → 否则会常驻把 40% 的「晴空场景」混进来，晴空与阴云两套天空叠在一起、
  // 山脊/云团错位 → 看起来像两张图重叠发晕（用户实测）。灾害(雨/旱/霜)仍用渐变强度，保留风暴渐起渐消的过渡。
  bgWeatherIntensity(): number {
    if (this.weather.type === 'clear') return 0;
    if (!isDisaster(this.weather.type)) return 1; // 阴天/小雨：满强度 → 背景只显该天气场景，无晴空层穿透
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

  // 手动模式：按当前选中工具对地块执行（点地块触发）。每个动作消耗玩家资源(体力/水/生态肥/金币)，
  // 不足即拦截并播报 —— 杜绝"无限重复"；劳动类(除草/清枯/耕地)受体力约束，体力随时间恢复。
  manualAction(plotId: number) {
    const p = this.plots[plotId];
    if (!p) return;
    const pl = this.player;
    // g=true: 有"在长且未熟"的作物；g=false: 有任意在长作物(含成熟)
    const grow = (g = true) => p.slots.some((sl) => sl.phase === 'grow' && !sl.dead && (!g || sl.growth < 400));
    switch (this.manualTool) {
      case 'plant':
        if (grow(false)) return this.pushToast('🌱 地里还有作物，先收获/清理再播种');
        this.plantManual(plotId);
        break;
      case 'water':
        if (!grow(true)) return this.pushToast('🌱 空地无需浇水');
        if (pl.water < 10) return this.pushToast('💧 水量不足（点资源条 + 补给）');
        if (this.needWater(p)) { pl.water -= 10; this.applyWater(plotId); this.pendingBursts.push({ plotId, kind: 'water' }); }
        else this.pendingConfirm = { plotId, tool: 'water' }; // 阴雨/夜间/已湿 → 作物不需要，弹窗确认（强行=涝害风险）
        break;
      case 'fert':
        if (!grow(true)) return this.pushToast('🌱 空地/已成熟，无需施肥');
        if (pl.eco < 15) return this.pushToast('🌿 生态肥不足（点资源条 + 补给）');
        if (pl.energy < 6) return this.pushToast('⚡ 体力不足，稍候恢复');
        if (this.needFert(p)) { pl.eco -= 15; pl.energy -= 6; this.fertManual(plotId); this.pendingBursts.push({ plotId, kind: 'fert' }); }
        else this.pendingConfirm = { plotId, tool: 'fert' }; // 非生长期/刚施过 → 作物不需要，弹窗确认（强行=肥害风险）
        break;
      case 'harvest':
        if (this.manualHarvest(plotId) <= 0) return this.pushToast('🌾 尚无成熟作物');
        this.pendingBursts.push({ plotId, kind: 'fert' });
        break;
      case 'weed':
        if (p.weedProg < 10 && p.malign < 20) return this.pushToast('🌿 这块地没有杂草');
        if (pl.energy < 20) return this.pushToast('⚡ 体力不足，除草较累，稍候');
        pl.energy -= 20; this.weedPlot(plotId); this.pendingBursts.push({ plotId, kind: 'fert' });
        break;
      case 'clear':
        if (!p.slots.some((sl) => sl.dead)) return this.pushToast('🥀 这块地没有枯死的植株');
        if (pl.energy < 8) return this.pushToast('⚡ 体力不足，无法清枯');
        pl.energy -= 8; this.clearPlot(plotId);
        break;
      case 'till':
        if (grow(false)) return this.pushToast('🚜 有作物正在生长，无法耕地');
        if (!this.plotHasEmpty(p)) return this.pushToast('🚜 无需耕地（先收获/清枯空出地块）');
        if (pl.energy < 12) return this.pushToast('⚡ 体力不足，无法耕地');
        pl.energy -= 12; this.tillPlot(plotId); this.pendingBursts.push({ plotId, kind: 'fert' });
        break;
      case 'cover':
        if (!grow(true)) return this.pushToast('🧣 空地无需保温');
        if (pl.eco < 8) return this.pushToast('🧣 保温材料不足');
        pl.eco -= 8; this.coverPlot(plotId); this.pendingBursts.push({ plotId, kind: 'fert' });
        break;
      case 'drain':
        if (!grow(true)) return this.pushToast('🌊 空地无需排水');
        if (pl.eco < 6) return this.pushToast('🌊 排水材料不足');
        pl.eco -= 6; this.drainPlot(plotId); this.pendingBursts.push({ plotId, kind: 'water' });
        break;
    }
  }

  // 手动施肥：一次性小幅催长(约 1/5 个阶段，非整阶段秒拔)；配合体力+生态肥门槛 → 点几下不会就成熟
  private fertManual(plotId: number) {
    const p = this.plots[plotId]; if (!p) return;
    for (const sl of p.slots) if (sl.phase === 'grow' && !sl.dead && sl.growth < 400) sl.growth = Math.min(400, sl.growth + 20);
    p.fertCd = FERT_CD;
  }

  // 手动收获：成熟株卖出得金币 + 回补少量生态肥；地块空出(待翻耕→播种)，给手动玩家完整轮作
  private manualHarvest(plotId: number): number {
    const p = this.plots[plotId]; if (!p) return 0;
    const byCrop = new Map<CropKey, { n: number; q: number }>();
    let totalN = 0;
    for (const sl of p.slots) {
      if (sl.phase !== 'grow' || sl.dead || sl.growth < 400) continue;
      const g = byCrop.get(sl.crop) || { n: 0, q: 0 };
      g.n++; g.q += sl.plantQual * (0.5 + 0.5 * sl.health);
      byCrop.set(sl.crop, g);
      sl.phase = 'empty'; totalN++;
    }
    if (totalN === 0) return 0;
    let coins = 0, units = 0;
    for (const [crop, g] of byCrop) {
      const u = Math.max(1, Math.round(Math.min(9, g.n) * (g.q / g.n))); // 产量按种植质量缩放
      coins += Math.round(u * this.priceOf(crop)); units += u;
      this.player.eco = Math.min(400, this.player.eco + u * 2);
    }
    this.player.coins += coins;
    this.pushToast(`🧺 收获 ×${units} 卖得 +${coins}🪙（种植质量影响产量）`);
    return totalN;
  }

  // 手动播种：空地/已翻耕地块种下当前选种(manualSeed)，扣金币(种子成本)，按作物密度布点(autoPoints)
  plantManual(plotId: number) {
    const p = this.plots[plotId]; if (!p) return;
    if (p.slots.some((sl) => sl.phase === 'grow' && !sl.dead)) return this.pushToast('🌱 地里还有作物');
    const crop = this.manualSeed;
    const cost = CROPS[crop].seed;
    if (this.player.coins < cost) return this.pushToast(`🪙 金币不足（播种「${CROPS[crop].name}」需 ${cost}🪙）`);
    this.player.coins -= cost;
    const q = getQuad(plotId);
    const pts = autoPoints(plotId, crop, q, this.stress ? 3 : 0);
    p.slots = pts.map((pt) => {
      const gh = (((Math.round(pt.x * 7.3 + pt.y * 13.1) % 100) + 100) % 100) / 100;
      const rate = 0.6 + gh * 0.8;
      return {
        pt, crop, growth: 0, rate,
        moist: 8, dry: 0, flood: 0, frost: 0, parch: 0, age: 0,
        dead: false, deathKind: '' as const, respawnT: 0,
        fallowMS: this.stress ? 1200 : 2200, health: 1, plantQual: 1, phase: 'grow' as const,
      };
    });
    p.weeds = 0; p.weedProg = 0; // 播种即整地清杂草
    this.assessPlanting(p); // 种植考核：行距 × 应季 → 各株 plantQual
    this.dirtyPlots.push(plotId);
    this.pushToast(`🌱 播种「${CROPS[crop].name}」(-${cost}🪙)`);
  }

  // 手动补给：花金币补水/生态肥（资源 HUD 的 + 按钮）
  refillRes(kind: 'water' | 'eco') {
    const pl = this.player;
    const cfg = kind === 'water' ? { amt: 100, cost: 60, cap: 300, name: '水' } : { amt: 100, cost: 100, cap: 400, name: '生态肥' };
    if (pl.coins < cfg.cost) return this.pushToast(`🪙 金币不足（补给${cfg.name}需 ${cfg.cost}🪙）`);
    pl.coins -= cfg.cost;
    pl[kind] = Math.min(cfg.cap, pl[kind] + cfg.amt);
    this.pushToast(`🛒 补给${cfg.name} +${cfg.amt}（-${cfg.cost}🪙）`);
  }

  // 手动「作物不需要却强行」二次确认：确定→照常扣料执行 + 随机肥害/涝害降健康；取消→放弃
  confirmManual(yes: boolean) {
    const pc = this.pendingConfirm; this.pendingConfirm = null;
    if (!pc || !yes) return;
    const p = this.plots[pc.plotId]; if (!p) return;
    const pl = this.player;
    if (pc.tool === 'water') {
      if (pl.water < 10) return this.pushToast('💧 水量不足');
      pl.water -= 10; this.applyWater(pc.plotId); this.pendingBursts.push({ plotId: pc.plotId, kind: 'water' });
      this.overApplyDamage(pc.plotId, 'water');
    } else {
      if (pl.eco < 15 || pl.energy < 6) return this.pushToast('🌿 体力/生态肥不足');
      pl.eco -= 15; pl.energy -= 6; this.fertManual(pc.plotId); this.pendingBursts.push({ plotId: pc.plotId, kind: 'fert' });
      this.overApplyDamage(pc.plotId, 'fert');
    }
  }

  // 过量浇水/施肥 → 55% 概率致害：降作物健康(健康→生长更慢)，涝害另加涝渍。AI 探索若过量同样受罚 → 学会按需作业。
  overApplyDamage(plotId: number, kind: 'water' | 'fert') {
    const p = this.plots[plotId]; if (!p) return;
    if (Math.random() >= 0.55) { this.pushToast(kind === 'water' ? '💧 这次侥幸没涝着（仍是浪费）' : '🌿 这次侥幸没肥害（仍是浪费）'); return; }
    let hit = 0;
    for (const sl of p.slots) {
      if (sl.phase !== 'grow' || sl.dead) continue;
      sl.health = Math.max(0.15, sl.health - (0.12 + Math.random() * 0.2));
      if (kind === 'water') sl.flood = Math.min(6, sl.flood + 2);
      hit++;
    }
    if (hit > 0) { const msg = kind === 'water' ? '🌊 过度浇水！作物涝渍、健康下降、生长变慢' : '🔥 肥害！作物灼伤、健康下降、生长变慢'; this.ai.last = msg; this.pushToast(msg); }
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
  return { stock: emap(), fresh: 1, wh: emap(), whBasis: 0, decay: 0.05, fee: 3, seedStock: 6 }; // 起步给少量种子 → 首轮复种立即可播，不必空等经济爬升
}

function freshPlayer(): PlayerRes {
  return { coins: 5000, energy: 120, energyMax: 120, water: 200, eco: 200 };
}

function freshBrain(): BrainState {
  return { wValue: 1, wUrgency: 1.1, wPower: 0.7, kind: {}, densBias: 0, eps: 0.22, steps: 0, netReward: 0, ctxKind: {} };
}

// 数值 clamp + 三位小数（折损率/仓储费均值回归用）
function clampN(v: number, a: number, b: number): number {
  return Math.max(a, Math.min(b, +v.toFixed(3)));
}

// 大脑权重 clamp（恒正、有界 → 学习稳定不发散）
function clampW(v: number): number { return Math.max(0.05, Math.min(4, +v.toFixed(4))); }

// 清洗学习偏置字典（载入存档用）：丢掉非有限数的值、把数值 clamp 到 [-3,3] → 脏档不会注入 NaN 污染打分
function sanitizeBias(o: Record<string, unknown>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const k in o) { const v = o[k]; if (typeof v === 'number' && Number.isFinite(v)) out[k] = Math.max(-3, Math.min(3, v)); }
  return out;
}

// 清洗情境偏置表(载入存档用)：逐情境桶各自走 sanitizeBias，空桶丢弃 → 脏档不会注入 NaN 污染情境打分
function sanitizeCtx(o: Record<string, unknown>): Record<string, Record<string, number>> {
  const out: Record<string, Record<string, number>> = {};
  for (const k in o) {
    const v = o[k];
    if (v && typeof v === 'object') { const bucket = sanitizeBias(v as Record<string, unknown>); if (Object.keys(bucket).length) out[k] = bucket; }
  }
  return out;
}
