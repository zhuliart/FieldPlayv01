import { CROPS, CROP_KEYS, type CropKey } from '../data/crops';
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
  respawnT: number; // 死亡后重生计时(ms)，保持田间持续繁忙
}

// 各 stage 的耐旱阈值（发芽/幼苗脆弱、生长期更耐旱），移植原型 DRY_DEATH
export const DRY_DEATH = [3, 4, 6, 8];

export interface Plot {
  id: number;
  slots: Slot[];
  weeds: number; // 0..3（撂荒杂草等级）
  weedProg: number; // 杂草累积进度（撂荒越久越高）
  roadWeed: number; // 0..3 杂草爬上道路
  roadDmg: boolean; // 路面被杂草破坏
  idle: number; // 闲置 tick 计数（无活株则累加）→ 闲置土地税
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
  wear: number; // 设备老化（低资金时上升 → 机器人变慢）
  fails: number; // 破产次数
  last: string; // 最近一条学习/经营播报
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
}

export interface Toggles {
  lightPool: boolean;
  bgFade: boolean;
  particles: boolean;
  dayTint: boolean;
  overlays: boolean;
  cropRelight: boolean;
}

export interface Burst {
  plotId: number;
  kind: 'water' | 'fert';
}

interface Waypoint {
  left: number;
  top: number;
  plotId?: number;
}

// 初始种子田（作物 + 起始阶段），移植自原型 seed 表的作物分布意图
const SEED: [CropKey, number][] = [
  ['corn', 4], ['tomato', 4], ['lettuce', 4], ['chili', 4],
  ['lettuce', 3], ['tomato', 2], ['corn', 4], ['chili', 3],
  ['tomato', 3], ['lettuce', 4], ['corn', 2], ['chili', 1],
];

// 经济常量（原样移植原型）
const AI_START = 2500;
const IDLE_LIMIT = 45; // 闲置达此 tick 数才进入课税池
const IDLE_TAX = 44; // 单块闲置税基（每次随机浮动）
const BANKRUPT = -20000; // 资金跌破即破产重置

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
  market: Record<CropKey, number> = { tomato: 1, lettuce: 1, corn: 1, chili: 1 };
  marketPrev: Record<CropKey, number> = { tomato: 1, lettuce: 1, corn: 1, chili: 1 };
  marketEvent: { k: CropKey; up: boolean } | null = null;

  // —— AI 自主经营学习 ——
  ai: AIState = freshAI();

  // 待消费的播报（HUD 取走后清空）
  pendingToasts: string[] = [];

  plots: Plot[] = [];
  robot: RobotState = { ...MAP.robotHome, face: Math.PI, moving: false, module: null };

  toggles: Toggles = {
    lightPool: true,
    bgFade: true,
    particles: true,
    dayTint: true,
    overlays: true,
    cropRelight: true,
  };

  // 本帧产生的粒子爆发事件（renderer 消费后清空）
  pendingBursts: Burst[] = [];

  // 机器人巡田路径
  private path: Waypoint[] = [];
  private segIdx = 0;
  private segElapsed = 0;
  private segDur = 1;

  constructor() {
    this.seed();
    this.buildPatrol();
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
          moist: stage < 4 ? 3 : 0, dry: 0, flood: 0, frost: 0, parch: 0, age: 0,
          dead: false, deathKind: '' as const, respawnT: 0,
        };
      });
      const weeds = i % 4 === 0 ? 2 : i % 3 === 0 ? 1 : 0;
      // 初始 weedProg 与起始 weeds 等级对齐（撂荒进度的反推）
      const weedProg = weeds === 2 ? 60 : weeds === 1 ? 24 : 0;
      this.plots.push({ id: i, slots, weeds, weedProg, roadWeed: 0, roadDmg: false, idle: 0 });
    }
  }

  // 全量重置（HUD「重置」按钮）：农田 + 市场 + AI 学习记录全部清空
  resetAll() {
    this.seed(this.stress ? 3 : 0);
    this.market = { tomato: 1, lettuce: 1, corn: 1, chili: 1 };
    this.marketPrev = { tomato: 1, lettuce: 1, corn: 1, chili: 1 };
    this.marketEvent = null;
    this.ai = freshAI();
  }

  private buildPatrol() {
    // 蛇形遍历 12 地块中心 + 起止于充电站，形成闭环巡田路线
    const order = [3, 7, 11, 10, 6, 2, 1, 5, 9, 8, 4, 0];
    const wps: Waypoint[] = [{ left: MAP.station.left, top: MAP.station.top }];
    for (const id of order) {
      const c = quadCenterPct(getQuad(id));
      wps.push({ left: c.x, top: c.y, plotId: id });
    }
    wps.push({ left: MAP.station.left, top: MAP.station.top });
    this.path = wps;
    this.segIdx = 0;
    this.segElapsed = 0;
    this.startSeg();
  }

  private startSeg() {
    const a = this.path[this.segIdx];
    const b = this.path[(this.segIdx + 1) % this.path.length];
    const dx = ((b.left - a.left) / 100) * 1280;
    const dy = ((b.top - a.top) / 100) * 720;
    const dpx = Math.hypot(dx, dy);
    this.robot.face = Math.atan2(dy, dx);
    // 速度：常规慢巡，压力档更快；设备老化（低资金）拖慢移动 —— 原型「资金<1000 设备老化」可视惩罚
    const wearSlow = 1 - Math.min(0.5, this.ai.wear * 0.5);
    const speed = (this.stress ? 0.9 : 0.45) * wearSlow;
    this.segDur = Math.max(450, dpx / speed);
    this.segElapsed = 0;
  }

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
    const gSpeed = (this.stress ? 0.06 : 0.022) * dtMS;
    const stall = wx === 'frost' ? 0.15 : wx === 'rain' ? 0.55 : 1; // 极端天气拖慢
    for (const p of this.plots) {
      for (const sl of p.slots) {
        if (sl.dead) {
          sl.respawnT -= dtMS;
          if (sl.respawnT <= 0) this.respawn(sl); // 重生 → 田间持续繁忙
          continue;
        }
        if (sl.growth < 400) {
          const waterFactor = sl.dry > 0 ? 0.25 : 1; // 缺水拖慢生长
          sl.growth += gSpeed * sl.rate * (1 - wInt * (1 - stall) * 0.6) * waterFactor;
          if (sl.growth >= 400) sl.growth = 400;
        }
      }
    }
    // 应激/致死按固定节奏跑，保留原型离散阈值与概率
    this.lifeTickAcc += dtMS;
    const tickMS = this.stress ? 280 : 700;
    while (this.lifeTickAcc >= tickMS) {
      this.lifeTickAcc -= tickMS;
      this.lifeTick();
    }

    // —— 机器人巡田（仅托管模式）——
    if (this.mode === 'auto') {
      this.robot.moving = true;
      this.robot.module = 'water';
      this.segElapsed += dtMS;
      const a = this.path[this.segIdx];
      const b = this.path[(this.segIdx + 1) % this.path.length];
      const t = Math.min(1, this.segElapsed / this.segDur);
      this.robot.left = a.left + (b.left - a.left) * t;
      this.robot.top = a.top + (b.top - a.top) * t;
      this.robotAction = b.plotId != null ? `巡田作业 · ${b.plotId + 1} 号地…` : '返回充电站补能…';
      if (t >= 1) {
        if (b.plotId != null) this.serviceePlot(b.plotId);
        this.segIdx = (this.segIdx + 1) % this.path.length;
        this.startSeg();
      }
    } else {
      this.robot.moving = false;
      this.robot.module = null;
      this.robotAction = '待命中…';
    }
  }

  // 机器人抵达地块：收获成熟作物（→ 售出入账）/ 除草 / 浇水施肥
  private serviceePlot(plotId: number) {
    const p = this.plots[plotId];
    if (!p) return;
    const harvested = this.harvestPlot(plotId);
    if (p.weeds >= 2) {
      // 杂草覆盖过半 → 专门除草（清 weedProg；路面破坏需另行修路）
      p.weeds = 0;
      p.weedProg = 0;
      p.roadWeed = p.roadDmg ? p.roadWeed : 0;
      this.ai.last = '🌿 清除杂草，恢复可耕作';
      this.robotAction = '除草作业中…';
      if (this.toggles.particles) this.pendingBursts.push({ plotId, kind: 'fert' });
      return;
    }
    const fert = Math.random() < 0.3;
    if (!fert) this.applyWater(plotId);
    if (this.toggles.particles) this.pendingBursts.push({ plotId, kind: fert ? 'fert' : 'water' });
    this.robotAction = harvested > 0 ? '收获装车中…' : fert ? '精准施肥中…' : '定点浇水中…';
  }

  // 收获该地块所有成熟株 → 按实时市价售出入账 + 更新 Q 值 + 原地复种（消耗种子成本）
  private harvestPlot(plotId: number): number {
    if (this.mode !== 'auto') return 0;
    const p = this.plots[plotId];
    if (!p) return 0;
    let n = 0;
    let gain = 0;
    for (const sl of p.slots) {
      if (sl.dead || sl.growth < 400) continue;
      n++;
      const price = this.priceOf(sl.crop);
      gain += price;
      // Q 学习：奖励 = 实现毛利（售价 − 种子成本），α=0.3
      const margin = price - CROPS[sl.crop].seed;
      this.ai.q[sl.crop] += 0.3 * (margin - this.ai.q[sl.crop]);
      // 原地复种：扣种子成本，探索率衰减
      this.ai.funds -= CROPS[sl.crop].seed;
      this.ai.plantings++;
      this.ai.explore = Math.max(0.05, this.ai.explore * 0.96);
      sl.growth = 0;
      sl.moist = 4; sl.dry = 0; sl.flood = 0; sl.frost = 0; sl.parch = 0; sl.age = 0;
    }
    if (n > 0) {
      this.ai.funds += gain;
      this.ai.harvests += n;
      this.ai.sells++;
      this.ai.trades++;
      this.ai.last = `🪙 收获并售出 ×${n}（+${gain}🪙）`;
    }
    return n;
  }

  // 田间健康统计（杂草率 / 闲置率），供 HUD 健康条
  healthStats(): { weedPct: number; idlePct: number; overCount: number } {
    const tot = this.plots.length || 1;
    let weedUnits = 0;
    let idle = 0;
    let over = 0;
    for (const p of this.plots) {
      weedUnits += Math.min(3, p.weeds);
      if (!p.slots.some((sl) => !sl.dead)) idle++;
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
      const productive = p.slots.some((sl) => !sl.dead);
      p.idle = productive ? 0 : p.idle + 1;
    }
    if (this.mode === 'auto') this.aiEconomyTick();
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
      if (hasLiving) continue;
      p.weedProg += wx === 'rain' ? 1 : 0.5; // 雨天长得更快
      p.weeds = p.weedProg < 10 ? 0 : p.weedProg < 46 ? 1 : p.weedProg < 92 ? 2 : 3;
      if (p.weeds >= 3) {
        const over = Math.max(0, p.weedProg - 92);
        p.roadWeed = Math.min(3, Math.floor(over / 22));
        if (p.roadWeed >= 3) p.roadDmg = true;
      }
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
      ai.last = `🪧 闲置土地税 −${tax}🪙 ×${hit}块 · 尽快复耕复种`;
      this.pushToast(ai.last);
    }
    // 低资金 → 无力养护 → 设备老化（充电/移动变慢）；资金回升则缓慢修复
    if (ai.funds < 1000) {
      ai.wear = Math.min(1, +(ai.wear + 0.012 + (1000 - Math.max(0, ai.funds)) / 1000 * 0.03).toFixed(3));
    } else if (ai.wear > 0) {
      ai.wear = Math.max(0, +(ai.wear - 0.01).toFixed(3));
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
        if (sl.dead) continue;
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
    sl.dead = false; sl.deathKind = ''; sl.growth = 0;
    sl.moist = 3; sl.dry = 0; sl.flood = 0; sl.frost = 0; sl.parch = 0; sl.age = 0;
  }

  // 浇水：复位该地块所有活株的缺水/湿度（机器人巡田到点 + 手动点地块）
  applyWater(plotId: number) {
    const p = this.plots[plotId];
    if (!p) return;
    for (const sl of p.slots) {
      if (sl.dead) continue;
      sl.moist = 4; sl.dry = 0;
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
    q: { tomato: 0, lettuce: 0, corn: 0, chili: 0 },
    trades: 0, sells: 0, harvests: 0, deaths: 0, plantings: 0,
    explore: 0.35, wear: 0, fails: 0,
    last: '等待托管…',
  };
}
