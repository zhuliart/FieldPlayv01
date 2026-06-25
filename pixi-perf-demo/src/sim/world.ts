import { type CropKey } from '../data/crops';
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
  weeds: number; // 0..3
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

export class World {
  tod = 0.34; // 初始上午（原型默认）
  todAuto = true;
  todSpeed = 0.0; // 每毫秒推进量（main 里按 dayLengthSec 设定）

  mode: 'manual' | 'auto' = 'auto';
  stress = false;

  robotAction = '待命中…'; // 托管状态条/气泡文案（假数据，仅供画面）

  weather: { type: WeatherType; elapsedMS: number; durMS: number } = { type: 'clear', elapsedMS: 0, durMS: 0 };
  private weatherCooldownMS = 4000;
  private lifeTickAcc = 0;

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
      this.plots.push({ id: i, slots, weeds: i % 4 === 0 ? 2 : i % 3 === 0 ? 1 : 0 });
    }
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
    // 速度：常规慢巡，压力档更快（让光池/粒子更繁忙）
    const speed = this.stress ? 0.9 : 0.45; // px per ms 比例基准
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

    // —— 昼夜 ——
    if (this.todAuto) {
      this.tod = (this.tod + this.todSpeed * dtMS) % 1;
      if (this.tod < 0) this.tod += 1;
    }

    // —— 天气生命周期（连续 prog，平滑 初起→高潮→尾声）——
    const w = this.weather;
    if (w.type === 'clear') {
      this.weatherCooldownMS -= dtMS;
      if (this.weatherCooldownMS <= 0) {
        // 压力档：冷却到点必触发灾害；常规托管：偶发；静置(手动)：不自动触发
        const willTrigger = this.stress ? true : this.mode === 'auto' && Math.random() < 0.6;
        if (willTrigger) this.triggerWeather(this.randomDisaster());
        else this.weatherCooldownMS = this.stress ? 1200 : 6000; // 稍后重试
      }
    } else {
      w.elapsedMS += dtMS;
      if (w.elapsedMS >= w.durMS) {
        w.type = 'clear';
        w.elapsedMS = 0;
        w.durMS = 0;
        this.weatherCooldownMS = this.stress ? 1200 : 8000;
      }
    }

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
        // 抵达路点：地块中心 → 浇水复位缺水（务实作业）+ 触发粒子
        if (b.plotId != null) {
          const fert = Math.random() < 0.3;
          if (!fert) this.applyWater(b.plotId);
          if (this.toggles.particles) this.pendingBursts.push({ plotId: b.plotId, kind: fert ? 'fert' : 'water' });
          this.robotAction = fert ? '精准施肥中…' : '定点浇水中…';
        }
        this.segIdx = (this.segIdx + 1) % this.path.length;
        this.startSeg();
      }
    } else {
      this.robot.moving = false;
      this.robot.module = null;
      this.robotAction = '待命中…';
    }
  }

  // 田间健康统计（杂草率 / 闲置率），供 HUD 健康条
  healthStats(): { weedPct: number; idlePct: number; overCount: number } {
    const tot = this.plots.length || 1;
    let weedUnits = 0;
    let idle = 0;
    for (const p of this.plots) {
      weedUnits += Math.min(3, p.weeds);
      if (!p.slots.some((sl) => sl.growth > 0)) idle++;
    }
    return {
      weedPct: Math.round((weedUnits / (tot * 3)) * 100),
      idlePct: Math.round((idle / tot) * 100),
      overCount: 0,
    };
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
          // 成熟：老化 → 过熟枯萎
          sl.age += 1;
          if (sl.age >= 16) this.kill(sl, 'aged');
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
