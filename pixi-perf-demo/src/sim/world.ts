import { type CropKey } from '../data/crops';
import { type WeatherType, wxIntensity, isDisaster } from '../data/scenes';
import { MAP } from '../data/tokens';
import { autoPoints, getQuad, quadCenterPct, type PlantPoint } from './layout';

export interface Slot {
  pt: PlantPoint;
  crop: CropKey;
  growth: number; // 0..400（stage = floor/100）
  rate: number; // 个体生长速率 0.6..1.4
}

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
        return { pt, crop, growth: stage * 100, rate };
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

    // —— 作物生长 ——
    const gSpeed = (this.stress ? 0.06 : 0.022) * dtMS; // 每毫秒 growth 增量基准
    const wInt = this.weatherIntensity();
    const stall = this.weather.type === 'frost' ? 0.15 : this.weather.type === 'rain' ? 0.55 : 1; // 极端天气拖慢
    for (const p of this.plots) {
      for (const sl of p.slots) {
        sl.growth += gSpeed * sl.rate * (1 - wInt * (1 - stall) * 0.6);
        if (sl.growth >= 400) {
          // 成熟：压力档循环重置以持续换贴图；常规保持成熟
          sl.growth = this.stress ? 4 : 400;
        }
      }
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
        // 抵达路点：若是地块中心 → 触发浇水/施肥粒子
        if (b.plotId != null && this.toggles.particles) {
          const fert = Math.random() < 0.3;
          this.pendingBursts.push({ plotId: b.plotId, kind: fert ? 'fert' : 'water' });
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
    this.pendingBursts.push({ plotId, kind });
  }

  // 统计当前田间植株总数（给 HUD/stats 显示负载）
  plantCount(): number {
    let n = 0;
    for (const p of this.plots) n += p.slots.length;
    return n;
  }
}
