import { Container, ParticleContainer, Particle, Texture } from 'pixi.js';
import { getQuad, pctX, pctY } from '../sim/layout';
import { makeDropletTexture, makeGrainTexture, makeRingTexture } from '../core/textures';

// 浇水/施肥粒子 —— 用 Pixi v8 ParticleContainer + 预分配对象池（避免每帧 new、零 GC 抖动）。
// 三个容器各自共享一张纹理 → 各 1 个 draw call：水滴 / 颗粒(tint) / 涟漪环(tint)。
// 动效节奏对齐原型 fpRain / fpRipple / fpGrain。

interface PState {
  p: Particle;
  active: boolean;
  age: number;
  life: number;
  x0: number;
  y0: number;
  vx: number;
  scBase: number;
  kind: 'drop' | 'ring' | 'grain';
  tint: number;
}

interface PlotGeom {
  cx: number;
  cy: number;
  spanX: number; // 半宽(px)
  spanY: number; // 半深(px)
}

const GRAIN_COLORS = [0xc7e08a, 0xa7cf5e, 0xe0b94a, 0xcaa23c];

export class Particles {
  readonly view = new Container();
  private drops: ParticleContainer;
  private grains: ParticleContainer;
  private rings: ParticleContainer;
  private dropPool: PState[] = [];
  private grainPool: PState[] = [];
  private ringPool: PState[] = [];
  private geom: PlotGeom[] = [];
  enabled = true;

  constructor() {
    const dyn = { position: true, vertex: true, rotation: true, color: true };
    const dropTex = makeDropletTexture();
    const grainTex = makeGrainTexture('#ffffff');
    const ringTex = makeRingTexture('#ffffff');
    this.drops = new ParticleContainer({ texture: dropTex, dynamicProperties: dyn });
    this.grains = new ParticleContainer({ texture: grainTex, dynamicProperties: dyn });
    this.rings = new ParticleContainer({ texture: ringTex, dynamicProperties: dyn });
    this.view.addChild(this.rings, this.drops, this.grains);

    this.alloc(this.drops, this.dropPool, 420, 'drop', dropTex);
    this.alloc(this.grains, this.grainPool, 500, 'grain', grainTex);
    this.alloc(this.rings, this.ringPool, 64, 'ring', ringTex);

    // 预计算每块地几何（px）
    for (let id = 0; id < 12; id++) {
      const q = getQuad(id);
      const cxp = (q[0][0] + q[1][0] + q[2][0] + q[3][0]) / 4;
      const cyp = (q[0][1] + q[1][1] + q[2][1] + q[3][1]) / 4;
      const spanXpct = Math.max(4, Math.abs(q[1][0] - q[3][0]));
      const spanYpct = Math.max(3, Math.abs(q[2][1] - q[0][1]));
      this.geom.push({
        cx: pctX(cxp),
        cy: pctY(cyp),
        spanX: (pctX(spanXpct) - pctX(0)),
        spanY: (pctY(spanYpct) - pctY(0)),
      });
    }
  }

  private alloc(pc: ParticleContainer, pool: PState[], n: number, kind: PState['kind'], tex: Texture) {
    for (let i = 0; i < n; i++) {
      const p = new Particle(tex);
      p.anchorX = 0.5;
      p.anchorY = 0.5;
      p.alpha = 0;
      p.scaleX = 0;
      p.scaleY = 0;
      pc.addParticle(p);
      pool.push({ p, active: false, age: 0, life: 1, x0: 0, y0: 0, vx: 0, scBase: 1, kind, tint: 0xffffff });
    }
    pc.update();
  }

  private take(pool: PState[]): PState | null {
    for (const st of pool) if (!st.active) return st;
    return null;
  }

  water(plotId: number) {
    if (!this.enabled) return;
    const g = this.geom[plotId];
    if (!g) return;
    // 12 滴水
    for (let k = 0; k < 12; k++) {
      const st = this.take(this.dropPool);
      if (!st) break;
      const ox = (Math.random() - 0.5) * g.spanX * 0.78;
      const oy = (Math.random() - 0.5) * g.spanY * 0.62;
      st.active = true;
      st.age = 0;
      st.life = 850 + Math.random() * 200;
      st.x0 = g.cx + ox;
      st.y0 = g.cy + oy;
      st.vx = 0;
      st.scBase = 0.7 + Math.random() * 0.25;
      st.tint = 0xffffff;
    }
    // 1 涟漪环
    this.ring(g, 0x78c8f5);
  }

  fert(plotId: number) {
    if (!this.enabled) return;
    const g = this.geom[plotId];
    if (!g) return;
    for (let k = 0; k < 14; k++) {
      const st = this.take(this.grainPool);
      if (!st) break;
      const ox = (Math.random() - 0.5) * g.spanX * 0.82;
      const oy = (Math.random() - 0.5) * g.spanY * 0.66;
      st.active = true;
      st.age = 0;
      st.life = 900 + Math.random() * 150;
      st.x0 = g.cx + ox;
      st.y0 = g.cy + oy;
      st.vx = 0;
      st.scBase = 0.8 + Math.random() * 0.6;
      st.tint = GRAIN_COLORS[k % GRAIN_COLORS.length];
    }
    this.ring(g, 0x96cd5a);
  }

  private ring(g: PlotGeom, tint: number) {
    const st = this.take(this.ringPool);
    if (!st) return;
    st.active = true;
    st.age = 0;
    st.life = 850;
    st.x0 = g.cx;
    st.y0 = g.cy + g.spanY * 0.16;
    st.scBase = (g.spanX * 1.25) / 128; // 环纹理宽 128
    st.tint = tint;
  }

  update(dtMS: number) {
    this.stepPool(this.dropPool, dtMS);
    this.stepPool(this.grainPool, dtMS);
    this.stepPool(this.ringPool, dtMS);
  }

  private stepPool(pool: PState[], dtMS: number) {
    for (const st of pool) {
      if (!st.active) continue;
      st.age += dtMS;
      const t = st.age / st.life;
      if (t >= 1) {
        st.active = false;
        st.p.alpha = 0;
        st.p.scaleX = 0;
        st.p.scaleY = 0;
        continue;
      }
      const p = st.p;
      p.tint = st.tint;
      if (st.kind === 'drop') {
        // fpRain：y -22→+20，scale .85→1.05，alpha 0→1(22%)→0
        const yOff = -22 + 42 * t;
        const sc = st.scBase * (0.85 + 0.2 * t);
        p.x = st.x0;
        p.y = st.y0 + yOff;
        p.scaleX = sc;
        p.scaleY = sc;
        p.alpha = t < 0.22 ? t / 0.22 : 1 - (t - 0.22) / 0.78;
      } else if (st.kind === 'grain') {
        // fpGrain：y -16→0，scale .4→1，alpha 0→1(28%)→1(72%)→0
        const yOff = -16 + 16 * Math.min(1, t / 0.72);
        const sc = st.scBase * (0.4 + 0.6 * Math.min(1, t / 0.72));
        p.x = st.x0;
        p.y = st.y0 + yOff;
        p.scaleX = sc;
        p.scaleY = sc;
        p.alpha = t < 0.28 ? t / 0.28 : t < 0.72 ? 1 : 1 - (t - 0.72) / 0.28;
      } else {
        // fpRipple：scale .25→1.5，alpha .65→0
        const k = 0.25 + 1.25 * t;
        p.x = st.x0;
        p.y = st.y0;
        p.scaleX = st.scBase * k;
        p.scaleY = st.scBase * k;
        p.alpha = 0.65 * (1 - t);
      }
    }
  }

  setEnabled(on: boolean) {
    if (this.enabled === on) return; // 仅在状态切换时处理，避免每帧空转
    this.enabled = on;
    this.view.visible = on;
    if (!on) {
      for (const pool of [this.dropPool, this.grainPool, this.ringPool]) {
        for (const st of pool) {
          st.active = false;
          st.p.alpha = 0;
          st.p.scaleX = 0;
          st.p.scaleY = 0;
        }
      }
    }
  }

  get activeCount(): number {
    let n = 0;
    for (const pool of [this.dropPool, this.grainPool, this.ringPool]) for (const st of pool) if (st.active) n++;
    return n;
  }
}
