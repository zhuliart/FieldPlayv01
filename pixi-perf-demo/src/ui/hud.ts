import type { World } from '../sim/world';
import type { WeatherType } from '../data/scenes';
import { WEATHER_META } from '../data/scenes';

export type SceneTier = 'idle' | 'normal' | 'stress';

export interface HudCallbacks {
  onStressChange(on: boolean): void;
  onBlendChange(mode: 'screen' | 'add' | 'color-dodge'): void;
  onResetMin(): void;
  onTier(tier: SceneTier): void;
}

// 最简 HUD（任务书二.7：模式切换 / 天气切换 / 昼夜滑块 / 效果开关 / 压力模式）。
// 固定在视口左下，可折叠，避免遮挡测量。
export class Hud {
  readonly el: HTMLDivElement;
  private tierLabel: HTMLSpanElement;
  private wxButtons: Record<string, HTMLButtonElement> = {};
  private toggleRefs!: HTMLElement;

  constructor(parent: HTMLElement, private world: World, private cb: HudCallbacks) {
    const el = document.createElement('div');
    el.style.cssText = [
      'position:fixed', 'left:8px', 'bottom:8px', 'z-index:1000', 'width:236px', 'max-height:90vh',
      'overflow:auto', 'font-family:"Noto Sans SC",sans-serif', 'font-size:12px', 'color:#eaf6e0',
      'background:rgba(11,24,32,.86)', 'border:1px solid rgba(150,206,77,.3)', 'border-radius:12px',
      'padding:10px', 'box-shadow:0 6px 16px rgba(0,0,0,.4)', 'backdrop-filter:blur(3px)',
      'user-select:none',
    ].join(';');

    // —— 标题 + 折叠 ——
    const head = document.createElement('div');
    head.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;';
    const title = document.createElement('div');
    title.innerHTML = '<b class="fp-logo" style="font-size:15px;color:#bff05f">铁娃子 · 性能验证</b>';
    const collapse = btn('▾', () => {
      body.style.display = body.style.display === 'none' ? 'block' : 'none';
      collapse.textContent = body.style.display === 'none' ? '▸' : '▾';
    });
    collapse.style.width = '26px';
    head.appendChild(title);
    head.appendChild(collapse);
    el.appendChild(head);

    const body = document.createElement('div');
    el.appendChild(body);
    // 默认折叠，保持"看起来像截图"的干净游戏视图；点 ▸ 展开做性能测试
    body.style.display = 'none';
    collapse.textContent = '▸';

    // —— 测量三档预设 ——
    body.appendChild(section('测量档位（对比协议）'));
    const tierRow = document.createElement('div');
    tierRow.style.cssText = 'display:flex;gap:5px;margin-bottom:4px;';
    const setTier = (t: SceneTier, label: string) => {
      const b = btn(label, () => {
        this.cb.onTier(t);
        this.cb.onResetMin();
        this.tierLabel.textContent = label;
        this.syncWeatherButtons();
        this.syncToggles();
        slider.value = String(Math.round(world.tod * 1000));
        autoChk.checked = world.todAuto;
      });
      b.style.flex = '1';
      return b;
    };
    tierRow.appendChild(setTier('idle', '静置'));
    tierRow.appendChild(setTier('normal', '常规'));
    tierRow.appendChild(setTier('stress', '压力'));
    body.appendChild(tierRow);
    const tierInfo = document.createElement('div');
    tierInfo.style.cssText = 'font-size:11px;color:#9fb8a0;margin-bottom:8px;';
    this.tierLabel = document.createElement('span');
    this.tierLabel.textContent = '常规';
    this.tierLabel.style.color = '#bff05f';
    tierInfo.append('当前：', this.tierLabel, ' · 切档自动清零最低FPS');
    body.appendChild(tierInfo);

    // —— 模式 ——
    body.appendChild(section('经营模式'));
    const modeRow = document.createElement('div');
    modeRow.style.cssText = 'display:flex;gap:5px;margin-bottom:8px;';
    const manualBtn = btn('手动', () => { world.mode = 'manual'; mark(); });
    const autoBtn = btn('机器人托管', () => { world.mode = 'auto'; mark(); });
    manualBtn.style.flex = '1';
    autoBtn.style.flex = '1.4';
    const mark = () => {
      manualBtn.style.background = world.mode === 'manual' ? '#54992c' : 'rgba(255,255,255,.08)';
      autoBtn.style.background = world.mode === 'auto' ? '#3f7fd0' : 'rgba(255,255,255,.08)';
    };
    modeRow.appendChild(manualBtn);
    modeRow.appendChild(autoBtn);
    body.appendChild(modeRow);
    mark();

    // —— 天气 ——
    body.appendChild(section('天气切换（触发背景交叉淡入）'));
    const wxRow = document.createElement('div');
    wxRow.style.cssText = 'display:flex;flex-wrap:wrap;gap:5px;margin-bottom:8px;';
    this.wxButtons = {};
    (['clear', 'cloudy', 'lightrain', 'rain', 'drought', 'frost'] as WeatherType[]).forEach((t) => {
      const meta = WEATHER_META[t];
      const b = btn(meta.icon + meta.label, () => {
        world.triggerWeather(t);
        this.syncWeatherButtons();
      });
      b.style.fontSize = '11px';
      this.wxButtons[t] = b;
      wxRow.appendChild(b);
    });
    body.appendChild(wxRow);
    this.syncWeatherButtons();

    // —— 昼夜 ——
    body.appendChild(section('昼夜（tod 驱动 tint / 车灯）'));
    const slider = document.createElement('input');
    slider.type = 'range';
    slider.min = '0';
    slider.max = '1000';
    slider.value = String(Math.round(world.tod * 1000));
    slider.style.cssText = 'width:100%;margin:2px 0 4px;';
    slider.addEventListener('input', () => {
      world.tod = parseInt(slider.value, 10) / 1000;
    });
    body.appendChild(slider);
    const autoRow = document.createElement('label');
    autoRow.style.cssText = 'display:flex;align-items:center;gap:6px;margin-bottom:8px;cursor:pointer;';
    const autoChk = checkbox(world.todAuto, (v) => (world.todAuto = v));
    autoRow.appendChild(autoChk);
    autoRow.append('昼夜自动推进');
    body.appendChild(autoRow);
    // 让滑块跟随自动推进
    setInterval(() => {
      if (world.todAuto) slider.value = String(Math.round(world.tod * 1000));
    }, 200);

    // —— 效果开关 ——
    body.appendChild(section('效果开关（定位各效果开销）'));
    const tg = world.toggles;
    body.appendChild(toggleRow('🔦 车灯光池', tg.lightPool, (v) => (tg.lightPool = v)));
    body.appendChild(toggleRow('🌅 背景交叉淡入', tg.bgFade, (v) => (tg.bgFade = v)));
    body.appendChild(toggleRow('💧 浇水/施肥粒子', tg.particles, (v) => (tg.particles = v)));
    body.appendChild(toggleRow('🌗 昼夜 tint', tg.dayTint, (v) => (tg.dayTint = v)));
    body.appendChild(toggleRow('🌿 杂草/状态叠加', tg.overlays, (v) => (tg.overlays = v)));
    body.appendChild(toggleRow('🎨 作物重打光', tg.cropRelight, (v) => (tg.cropRelight = v)));

    // —— 光池混合模式 ——
    const blendRow = document.createElement('label');
    blendRow.style.cssText = 'display:flex;align-items:center;gap:6px;margin:4px 0 8px;';
    blendRow.append('光池混合');
    const sel = document.createElement('select');
    sel.style.cssText = 'flex:1;background:#16242c;color:#eaf6e0;border:1px solid #3a4a44;border-radius:6px;padding:3px;';
    [['screen', 'screen（默认·快）'], ['add', 'add（辉光）'], ['color-dodge', 'color-dodge（严格还原）']].forEach(([v, l]) => {
      const o = document.createElement('option');
      o.value = v;
      o.textContent = l;
      sel.appendChild(o);
    });
    sel.addEventListener('change', () => this.cb.onBlendChange(sel.value as 'screen' | 'add' | 'color-dodge'));
    blendRow.appendChild(sel);
    body.appendChild(blendRow);

    // —— 压力模式 ——
    body.appendChild(section('压力模式（一键拉满）'));
    const stressBtn = btn('⚡ 开启压力模式', () => {
      const on = !world.stress;
      this.cb.onStressChange(on);
      stressBtn.textContent = on ? '⚡ 压力模式：开' : '⚡ 开启压力模式';
      stressBtn.style.background = on ? '#c2452f' : 'rgba(255,255,255,.08)';
      this.syncToggles();
    });
    stressBtn.style.cssText += 'width:100%;font-weight:800;margin-bottom:8px;';
    body.appendChild(stressBtn);

    // —— 手动触发粒子（测试） ——
    body.appendChild(section('手动触发'));
    const fxRow = document.createElement('div');
    fxRow.style.cssText = 'display:flex;gap:5px;';
    const water = btn('💧 全田浇水', () => { for (let i = 0; i < 12; i++) world.burst(i, 'water'); });
    const fert = btn('🌿 全田施肥', () => { for (let i = 0; i < 12; i++) world.burst(i, 'fert'); });
    water.style.flex = '1';
    fert.style.flex = '1';
    fxRow.appendChild(water);
    fxRow.appendChild(fert);
    body.appendChild(fxRow);

    const hint = document.createElement('div');
    hint.style.cssText = 'font-size:11px;color:#9fb8a0;margin-top:8px;line-height:1.5;';
    hint.innerHTML = '点击任意地块 = 浇水。<br>右上角为 FPS/内存表。';
    body.appendChild(hint);

    parent.appendChild(el);
    this.el = el;
    this.toggleRefs = body;
  }

  private syncWeatherButtons() {
    for (const [t, b] of Object.entries(this.wxButtons)) {
      const active = this.world.weather.type === t;
      b.style.background = active ? '#3f7fd0' : 'rgba(255,255,255,.08)';
      b.style.borderColor = active ? '#5aa0e8' : 'transparent';
    }
  }

  // 切档/压力后，复选框状态需回灌
  private syncToggles() {
    const checks = this.toggleRefs.querySelectorAll('input[type=checkbox][data-toggle]');
    const tg = this.world.toggles as unknown as Record<string, boolean>;
    checks.forEach((c) => {
      const key = (c as HTMLInputElement).dataset.toggle!;
      (c as HTMLInputElement).checked = tg[key];
    });
  }

  /** 每帧由 main 调用刷新天气按钮高亮（天气自动变化时） */
  refresh() {
    this.syncWeatherButtons();
  }
}

// —— 小工具 ——
function btn(label: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.textContent = label;
  b.style.cssText = [
    'background:rgba(255,255,255,.08)', 'color:#eaf6e0', 'border:1px solid transparent',
    'border-radius:8px', 'padding:6px 8px', 'font-size:12px', 'cursor:pointer',
    'font-family:inherit', 'transition:.12s', 'white-space:nowrap',
  ].join(';');
  b.addEventListener('click', onClick);
  return b;
}

function section(label: string): HTMLDivElement {
  const d = document.createElement('div');
  d.textContent = label;
  d.style.cssText = 'font-size:11px;color:#7fae6e;font-weight:700;margin:2px 0 5px;letter-spacing:.5px;';
  return d;
}

function checkbox(checked: boolean, onChange: (v: boolean) => void): HTMLInputElement {
  const c = document.createElement('input');
  c.type = 'checkbox';
  c.checked = checked;
  c.style.cssText = 'width:15px;height:15px;accent-color:#7ec943;cursor:pointer;';
  c.addEventListener('change', () => onChange(c.checked));
  return c;
}

function toggleRow(label: string, checked: boolean, onChange: (v: boolean) => void): HTMLLabelElement {
  const row = document.createElement('label');
  row.style.cssText = 'display:flex;align-items:center;gap:7px;margin-bottom:4px;cursor:pointer;';
  const c = checkbox(checked, onChange);
  const key = label.replace(/^[^\w一-龥]+/, '');
  // data-toggle 用于切档后回灌；映射到 toggles 键
  const map: Record<string, string> = {
    车灯光池: 'lightPool', 背景交叉淡入: 'bgFade', '浇水/施肥粒子': 'particles',
    '昼夜 tint': 'dayTint', '杂草/状态叠加': 'overlays', 作物重打光: 'cropRelight',
  };
  c.dataset.toggle = map[key] || '';
  row.appendChild(c);
  row.append(label);
  return row;
}
