// 自实现 FPS / 帧时 / 内存表（不依赖 stats.js），由 Pixi Ticker 每帧驱动。
// 右上角常驻；显示 当前/平均/最低 FPS、帧时(ms)、JS 堆内存(Chrome)、绘制对象数，并画 60 帧 sparkline。
export class StatsMeter {
  readonly el: HTMLDivElement;
  private fpsText: HTMLSpanElement;
  private msText: HTMLSpanElement;
  private memText: HTMLSpanElement;
  private extraText: HTMLSpanElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;

  private samples: number[] = [];
  private history: number[] = [];
  private acc = 0;
  private frames = 0;
  private cur = 0;
  private avg = 0;
  private min = 999;
  private readonly histLen = 96;

  constructor(parent: HTMLElement) {
    const el = document.createElement('div');
    el.style.cssText = [
      'position:fixed', 'bottom:8px', 'right:8px', 'z-index:1000',
      'font-family:"Baloo 2",ui-monospace,monospace', 'font-size:12px', 'line-height:1.45',
      'color:#bff05f', 'background:rgba(11,24,32,.82)', 'border:1px solid rgba(150,206,77,.35)',
      'border-radius:10px', 'padding:7px 9px', 'min-width:148px', 'pointer-events:none',
      'box-shadow:0 6px 16px rgba(0,0,0,.4)', 'backdrop-filter:blur(2px)',
    ].join(';');

    const mk = (label: string, val: string, color = '#bff05f') => {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;justify-content:space-between;gap:10px;';
      const l = document.createElement('span');
      l.textContent = label;
      l.style.color = '#9fb8a0';
      const v = document.createElement('span');
      v.textContent = val;
      v.style.color = color;
      v.style.fontWeight = '800';
      row.appendChild(l);
      row.appendChild(v);
      el.appendChild(row);
      return v;
    };
    this.fpsText = mk('FPS', '—');
    this.msText = mk('帧时 ms', '—', '#ffd76a');
    this.memText = mk('内存 MB', '—', '#7ec9ff');
    this.extraText = mk('对象', '—', '#cfe0d4');

    this.canvas = document.createElement('canvas');
    this.canvas.width = 144;
    this.canvas.height = 30;
    this.canvas.style.cssText = 'display:block;margin-top:5px;width:144px;height:30px;border-radius:4px;background:rgba(0,0,0,.3);';
    el.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d')!;

    parent.appendChild(el);
    this.el = el;
  }

  private extra = '';
  setExtra(text: string) {
    this.extra = text;
  }

  /** 每帧调用，传入本帧耗时(ms) */
  tick(deltaMS: number) {
    this.samples.push(deltaMS);
    this.acc += deltaMS;
    this.frames++;
    // 每 ~250ms 刷新一次读数
    if (this.acc >= 250) {
      const avgMs = this.acc / this.frames;
      this.cur = avgMs > 0 ? 1000 / avgMs : 0;
      // 取本窗口最差帧时 → 最低瞬时 FPS
      const worst = Math.max(...this.samples);
      const lowFps = worst > 0 ? 1000 / worst : 0;
      this.min = Math.min(this.min, lowFps);
      // 平滑平均
      this.avg = this.avg === 0 ? this.cur : this.avg * 0.8 + this.cur * 0.2;

      this.history.push(this.cur);
      if (this.history.length > this.histLen) this.history.shift();

      const col = this.cur >= 50 ? '#bff05f' : this.cur >= 30 ? '#ffd76a' : '#ff8a7a';
      this.fpsText.textContent = `${this.cur.toFixed(0)} / 均${this.avg.toFixed(0)} / 低${this.min < 999 ? this.min.toFixed(0) : '—'}`;
      this.fpsText.style.color = col;
      this.msText.textContent = avgMs.toFixed(1);
      const perf = performance as Performance & { memory?: { usedJSHeapSize: number; jsHeapSizeLimit: number } };
      if (perf.memory) {
        this.memText.textContent = `${(perf.memory.usedJSHeapSize / 1048576).toFixed(0)} / ${(perf.memory.jsHeapSizeLimit / 1048576).toFixed(0)}`;
      } else {
        this.memText.textContent = 'N/A';
      }
      this.extraText.textContent = this.extra || '—';

      this.acc = 0;
      this.frames = 0;
      this.samples.length = 0;
      this.draw();
    }
  }

  /** 重置最低值（切换档位时调用，便于按档记录） */
  resetMin() {
    this.min = 999;
    this.avg = 0;
    this.history.length = 0;
  }

  private draw() {
    const { ctx, canvas } = this;
    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    // 60fps 基准线
    ctx.strokeStyle = 'rgba(150,206,77,.25)';
    ctx.beginPath();
    const y60 = h - (60 / 70) * h;
    ctx.moveTo(0, y60);
    ctx.lineTo(w, y60);
    ctx.stroke();
    // 30fps 警戒线
    ctx.strokeStyle = 'rgba(255,138,122,.25)';
    ctx.beginPath();
    const y30 = h - (30 / 70) * h;
    ctx.moveTo(0, y30);
    ctx.lineTo(w, y30);
    ctx.stroke();
    // 折线
    const n = this.history.length;
    if (n > 1) {
      ctx.beginPath();
      for (let i = 0; i < n; i++) {
        const x = (i / (this.histLen - 1)) * w;
        const v = Math.min(70, this.history[i]);
        const y = h - (v / 70) * h;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = '#bff05f';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
  }
}
