import { dayState, WEATHER_META, isDisaster, wxPhase } from '../data/scenes';
import { CROP_KEYS, type CropKey } from '../data/crops';
import { pctX, pctY } from '../sim/layout';
import type { World } from '../sim/world';

// 全量 HUD（DOM）—— 像素还原 FieldPlay.dc.html 的 HUD，挂在 #fp-root 内随舞台缩放。
// 场景仍由 Pixi/WebGL 渲染；本层只画 UI 面板/木牌/状态条，由 world 假数据驱动、轻交互。
// 指针事件默认穿透（pointer-events:none），仅交互件设 auto，保证地块点击仍由 Pixi 接收。

const CROP_ICON: Record<CropKey, string> = { tomato: '🍅', lettuce: '🥬', corn: '🌽', chili: '🌶️' };
const CROP_CN: Record<CropKey, string> = { tomato: '番茄', lettuce: '生菜', corn: '玉米', chili: '辣椒' };

// AI 经营起始资金（与 world AI_START 对齐）—— 用于「本期盈亏」基准
const AI_BASE = 2500;

export class GameHud {
  readonly root: HTMLDivElement;
  private aiOpen = true;

  // 动态引用
  private r: Record<string, HTMLElement> = {};
  private toastBox: HTMLDivElement;

  constructor(parent: HTMLElement, private world: World) {
    const root = E('div', 'position:absolute; inset:0; width:1280px; height:720px; z-index:10; pointer-events:none; font-family:"Noto Sans SC",sans-serif;');
    this.root = root as HTMLDivElement;

    this.buildClockChip();
    this.buildFullscreen();
    this.buildHealth();
    this.buildModeToggle();
    this.buildPathButton();
    this.buildReset();
    this.buildLogo();
    this.buildAiPanel();
    this.buildMarketPanel();
    this.buildStatusBar();
    this.buildWeatherPill();
    this.buildCodexNav();
    this.buildBuildings();
    this.buildRobotBubble();

    this.toastBox = E('div', 'position:absolute; left:16px; bottom:64px; z-index:60; display:flex; flex-direction:column; gap:6px; pointer-events:none;') as HTMLDivElement;
    root.appendChild(this.toastBox);

    parent.appendChild(root);
  }

  // ============ 顶部左：昼夜时钟 + 实时天气 芯片 ============
  private buildClockChip() {
    const box = E('div', 'position:absolute; top:14px; left:14px; width:188px; display:flex; align-items:center; gap:8px; background:linear-gradient(rgba(38,52,74,.92),rgba(26,38,58,.92)); border:1.5px solid rgba(176,134,63,.45); border-radius:13px; padding:6px 12px 6px 10px; box-shadow:0 5px 14px rgba(0,0,0,.26); pointer-events:auto;');
    this.r.dayIcon = E('span', 'font-size:18px;', { text: '🌤️' });
    const col1 = E('div', 'display:flex; flex-direction:column; line-height:1.1;');
    this.r.clock = E('span', 'font-size:14px; font-weight:800; color:#fff; letter-spacing:.5px;', { text: '10:48', cls: 'fp-num' });
    this.r.phase = E('span', 'font-size:10px; font-weight:700; color:#bcd0e8;', { text: '上午' });
    col1.append(this.r.clock, this.r.phase);
    const div = E('div', 'width:1px; align-self:stretch; background:rgba(255,255,255,.18); margin:0 1px;');
    this.r.wxIcon = E('span', 'font-size:16px;', { text: '🌦️' });
    const col2 = E('div', 'display:flex; flex-direction:column; line-height:1.1;');
    this.r.wxCond = E('span', 'font-size:12px; font-weight:800; color:#eaf2fb; white-space:nowrap;', { text: '小雨 22°', cls: 'fp-num' });
    this.r.wxPlace = E('span', 'font-size:9px; font-weight:700; color:#a9e6b1; white-space:nowrap; cursor:pointer;', { text: '⇄ 南江·实时' });
    this.r.wxPlace.title = '点击切换 实时 / 加速演示';
    this.r.wxPlace.onclick = () => this.toggleLive();
    col2.append(this.r.wxCond, this.r.wxPlace);
    box.append(this.r.dayIcon, col1, div, this.r.wxIcon, col2);
    this.root.appendChild(box);
  }

  // ============ 全屏按钮 ============
  private buildFullscreen() {
    const b = E('button', 'position:absolute; top:14px; left:214px; width:76px; height:76px; border:3px solid #b78a4e; border-radius:16px; background:linear-gradient(#f7ead0,#ecd6ab); cursor:pointer; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:5px; box-shadow:0 4px 0 #b78a4e, 0 6px 12px rgba(0,0,0,.2); pointer-events:auto;');
    b.append(E('span', 'font-size:30px; line-height:1; color:#5a431f;', { text: '⛶' }));
    this.r.fsLabel = E('span', 'font-size:13px; font-weight:800; color:#5a431f;', { text: '全屏' });
    b.append(this.r.fsLabel);
    b.onclick = () => this.toggleFullscreen();
    this.root.appendChild(b);
  }

  // ============ 顶部中：土地健康（杂草率/闲置率）============
  private buildHealth() {
    const box = E('div', 'position:absolute; top:16px; left:50%; transform:translateX(-50%); width:296px; display:flex; align-items:stretch; justify-content:space-between; gap:7px; padding:4px 14px; border-radius:11px; background:linear-gradient(rgba(74,116,44,.92),rgba(50,86,30,.92)); border:2px solid rgba(176,134,63,.5); box-shadow:0 6px 16px rgba(0,0,0,.28); pointer-events:auto;');
    const mk = (icon: string, label: string) => {
      const g = E('div', 'display:flex; align-items:center; gap:7px;');
      g.append(E('span', 'font-size:13px;', { text: icon }));
      const col = E('div', 'display:flex; flex-direction:column; gap:3px;');
      const row = E('div', 'display:flex; align-items:baseline; gap:6px;');
      row.append(E('span', 'font-size:11px; font-weight:800; color:#eaf6e0;', { text: label }));
      const pct = E('span', 'font-size:12px; font-weight:800; color:#bff05f;', { text: '0%', cls: 'fp-num' });
      row.append(pct);
      const barBg = E('div', 'width:60px; height:5px; border-radius:5px; background:rgba(255,255,255,.14); overflow:hidden;');
      const bar = E('div', 'height:100%; width:0%; background:#bff05f; border-radius:5px; transition:width .4s ease, background .4s ease;');
      barBg.append(bar);
      col.append(row, barBg);
      g.append(col);
      return { g, pct, bar };
    };
    const weed = mk('🌿', '杂草率');
    const sep = E('div', 'width:1.5px; background:rgba(255,255,255,.18);');
    const idle = mk('🏜️', '闲置率');
    box.append(weed.g, sep, idle.g);
    this.r.weedPct = weed.pct; this.r.weedBar = weed.bar;
    this.r.idlePct = idle.pct; this.r.idleBar = idle.bar;
    this.root.appendChild(box);
  }

  // ============ 模式切换 ============
  private buildModeToggle() {
    const box = E('div', 'position:absolute; top:62px; left:50%; transform:translateX(-50%); display:flex; align-items:center; gap:6px; background:linear-gradient(rgba(74,116,44,.9),rgba(50,86,30,.9)); border:1.5px solid rgba(176,134,63,.5); border-radius:24px; padding:4px; box-shadow:0 5px 14px rgba(0,0,0,.24); pointer-events:auto;');
    this.r.manualBtn = this.modeBtn('🧑‍🌾', '手动模式', () => { this.world.mode = 'manual'; });
    this.r.autoBtn = this.modeBtn('🤖', '机器人托管', () => { this.world.mode = 'auto'; });
    box.append(this.r.manualBtn, this.r.autoBtn);
    this.root.appendChild(box);
  }
  private modeBtn(icon: string, label: string, onClick: () => void): HTMLButtonElement {
    const b = E('button', 'display:flex; align-items:center; gap:7px; border:none; border-radius:22px; padding:10px 19px; font-size:15.5px; font-weight:800; cursor:pointer; white-space:nowrap; transition:.15s; color:#cfe0d4; background:transparent;') as HTMLButtonElement;
    b.append(E('span', 'font-size:18px;', { text: icon }), document.createTextNode(label));
    b.onclick = onClick;
    return b;
  }

  // ============ 巡田路径 按钮（托管模式）============
  private buildPathButton() {
    const b = E('button', 'position:absolute; top:116px; left:709px; transform:translateX(-50%); display:flex; align-items:center; gap:6px; border:3px solid #3f7fd0; border-radius:14px; background:linear-gradient(#5aa0e8,#3f7fd0); color:#fff; font-size:13px; font-weight:800; padding:11px 16px; cursor:pointer; box-shadow:0 4px 0 #2f63aa, 0 6px 14px rgba(0,0,0,.25); pointer-events:auto;');
    b.append(E('span', 'font-size:17px;', { text: '🛣️' }), document.createTextNode('巡田路径'));
    b.onclick = () => this.toast('巡田路径编辑为完整版功能（本性能 DEMO 仅演示画面）');
    this.r.pathBtn = b;
    this.root.appendChild(b);
  }

  // ============ 重置按钮 ============
  private buildReset() {
    const b = E('button', 'position:absolute; top:11px; right:327px; width:90px; height:90px; border:3px solid #b06a3f; border-radius:16px; background:linear-gradient(#f7d9c8,#eebda3); cursor:pointer; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:5px; box-shadow:0 4px 0 #b06a3f, 0 6px 12px rgba(0,0,0,.2); pointer-events:auto;');
    b.append(E('span', 'font-size:30px; line-height:1; color:#9a3b2c;', { text: '↺' }), E('span', 'font-size:13px; font-weight:800; color:#9a3b2c;', { text: '重置' }));
    b.onclick = () => { this.world.resetAll(); this.toast('🔄 农田 / 市场 / AI 学习记录已全部重置'); };
    this.root.appendChild(b);
  }

  // ============ Logo 木牌 ============
  private buildLogo() {
    const wrap = E('div', 'position:absolute; top:11px; right:72px; display:flex; flex-direction:column; align-items:flex-end; pointer-events:auto;');
    const plaque = E('div', 'display:inline-flex; align-items:center; height:90px; gap:11px; padding:6px 17px 6px 7px; background:linear-gradient(#f4e7c8,#e7d09e); border:3px solid #b0863f; border-radius:18px; box-shadow:0 6px 14px rgba(0,0,0,.25), inset 0 2px 0 rgba(255,255,255,.5); cursor:pointer;');
    const avatar = E('div', 'position:relative; width:52px; height:52px; border-radius:50%; background:radial-gradient(circle at 50% 32%, #8fd24a, #4e7a2e); border:2.5px solid #fff; box-shadow:0 3px 7px rgba(0,0,0,.22), inset 0 -3px 6px rgba(0,0,0,.18); display:flex; align-items:center; justify-content:center; flex-shrink:0;');
    avatar.append(E('span', 'font-size:27px; filter:drop-shadow(0 1px 1px rgba(0,0,0,.3));', { text: '🤖' }), E('span', 'position:absolute; right:-3px; bottom:-3px; font-size:17px;', { text: '🌱' }));
    const txt = E('div', 'display:flex; flex-direction:column; align-items:flex-start; line-height:1;');
    const row1 = E('div', 'display:flex; align-items:center; gap:5px; margin-bottom:5px;');
    row1.append(E('span', 'font-size:20px; color:#3f6b22; white-space:nowrap; text-shadow:0 1px 0 #fff; letter-spacing:.5px;', { text: '田游智耕', cls: 'fp-logo' }), E('span', 'font-size:12px; color:#a8803f; font-weight:800;', { text: '之' }));
    txt.append(row1, E('div', 'font-size:27px; color:#4e7a2e; line-height:.95; white-space:nowrap; text-shadow:0 2px 0 #fff;', { text: '铁娃子果蔬园', cls: 'fp-logo' }));
    plaque.append(avatar, txt);
    plaque.onclick = () => this.toast('🌾 田游智耕 · 真实天气驱动的农场经营游戏');
    wrap.appendChild(plaque);
    this.root.appendChild(wrap);
  }

  // ============ AI 自主经营学习 面板（托管模式·可折叠）============
  private buildAiPanel() {
    const panel = E('div', 'position:absolute; top:58px; left:14px; width:188px; border-radius:14px; background:linear-gradient(rgba(74,116,44,.93),rgba(50,86,30,.93)); border:2px solid rgba(176,134,63,.5); box-shadow:0 12px 28px rgba(0,0,0,.32); overflow:hidden; pointer-events:auto;');
    // 头
    const head = E('div', 'display:flex; align-items:center; gap:7px; padding:7px 11px; background:linear-gradient(rgba(78,122,46,.9),rgba(62,103,38,.9)); cursor:pointer;');
    head.append(E('span', 'font-size:14px;', { text: '🤖' }), E('span', 'color:#fff; font-size:13.5px; white-space:nowrap; text-shadow:0 1px 0 rgba(0,0,0,.2);', { text: 'AI 自主经营学习', cls: 'fp-logo' }));
    const dot = E('span', 'margin-left:auto; display:flex; align-items:center; gap:7px;');
    dot.append(E('span', 'width:7px; height:7px; border-radius:50%; background:#bff05f; box-shadow:0 0 8px #bff05f;'));
    this.r.aiChevron = E('span', 'color:#eaf6e0; font-size:12px; font-weight:800;', { text: '▾' });
    dot.append(this.r.aiChevron);
    head.append(dot);
    head.onclick = () => { this.aiOpen = !this.aiOpen; this.r.aiChevron.textContent = this.aiOpen ? '▾' : '▸'; this.r.aiBody.style.display = this.aiOpen ? 'flex' : 'none'; };
    // 常驻摘要
    const sum = E('div', 'display:flex; align-items:center; gap:8px; padding:7px 11px;');
    const c1 = E('div', 'flex:1;'); c1.append(E('div', 'font-size:9px; color:#dfeed2;', { text: '经营资金' }));
    this.r.aiFunds = E('div', 'font-size:15px; font-weight:800; color:#fff;', { text: '🪙 10,778', cls: 'fp-num' }); c1.append(this.r.aiFunds);
    const c2 = E('div', 'text-align:right;'); c2.append(E('div', 'font-size:9px; color:#dfeed2;', { text: '本期盈亏' }));
    this.r.aiNet = E('div', 'font-size:15px; font-weight:800; color:#bff05f;', { text: '+8,278', cls: 'fp-num' }); c2.append(this.r.aiNet);
    sum.append(c1, c2);
    // 可折叠体
    const body = E('div', 'padding:0 11px 10px; display:flex; flex-direction:column; gap:7px;');
    const rowDec = E('div', 'display:flex; justify-content:space-between; font-size:10px; color:#eaf6e0;');
    this.r.aiTrades = numb('#fff'); this.r.aiSells = numb('#bff05f'); this.r.aiDeaths = numb('#ff9a8a'); this.r.aiExplore = numb('#fff');
    rowDec.append(lbl('决策 ', this.r.aiTrades), lbl('出售 ', this.r.aiSells), lbl('损失 ', this.r.aiDeaths), lbl('探索 ', this.r.aiExplore));
    // 学习摘要
    this.r.aiLast = E('div', 'font-size:10px; color:#eef6ea; background:rgba(126,201,67,.16); border:1px solid rgba(126,201,67,.3); border-radius:8px; padding:5px 8px; min-height:26px; display:flex; align-items:center; gap:5px; line-height:1.3;', { text: '🧠 行情看涨玉米…' });
    // 作物评分
    const cropsTitle = E('div', 'font-size:9px; color:#dfeed2; margin-bottom:2px; display:flex; justify-content:space-between;');
    cropsTitle.append(E('span', '', { text: '作物收益评分（学习中）' }), E('span', '', { text: '实时市价' }));
    const cropsWrap = E('div', 'display:flex; flex-direction:column; gap:5px;');
    this.r.aiCrops = cropsWrap;
    for (const k of CROP_KEYS) {
      const row = E('div', 'display:flex; align-items:center; gap:6px;');
      row.append(E('span', 'font-size:13px; width:16px; text-align:center;', { text: CROP_ICON[k] }));
      const barBg = E('div', 'flex:1; height:8px; border-radius:6px; background:rgba(255,255,255,.12); overflow:hidden;');
      const bar = E('div', 'height:100%; width:40%; background:linear-gradient(90deg,#bff05f,#5da32e); border-radius:6px;');
      barBg.append(bar);
      const score = E('span', 'font-size:10px; font-weight:700; color:#fff; width:20px; text-align:right;', { text: '50', cls: 'fp-num' });
      const price = E('span', 'font-size:10px; font-weight:700; color:#7ee07e; width:54px; text-align:right;', { text: '1.0× ▲', cls: 'fp-num' });
      row.append(barBg, score, price);
      cropsWrap.appendChild(row);
      this.r['aiCropBar_' + k] = bar; this.r['aiCropScore_' + k] = score; this.r['aiCropPrice_' + k] = price;
    }
    body.append(rowDec, this.r.aiLast, cropsTitle, cropsWrap);
    this.r.aiBody = body;
    panel.append(head, sum, body);
    this.r.aiPanel = panel;
    this.root.appendChild(panel);
  }

  // ============ 市场行情 面板（手动模式）============
  private buildMarketPanel() {
    const panel = E('div', 'position:absolute; top:58px; left:14px; width:188px; border-radius:14px; background:linear-gradient(rgba(74,116,44,.93),rgba(50,86,30,.93)); border:2px solid rgba(176,134,63,.5); box-shadow:0 12px 28px rgba(0,0,0,.32); overflow:hidden; pointer-events:auto; display:none;');
    const head = E('div', 'display:flex; align-items:center; gap:7px; padding:8px 11px; background:linear-gradient(rgba(78,122,46,.9),rgba(62,103,38,.9));');
    head.append(E('span', 'font-size:14px;', { text: '📈' }), E('span', 'color:#fff; font-size:13.5px; white-space:nowrap;', { text: '市场行情 · 实时收购价', cls: 'fp-logo' }));
    const body = E('div', 'padding:10px 11px 11px; display:flex; flex-direction:column; gap:9px;');
    for (const k of CROP_KEYS) {
      const row = E('div', 'display:flex; align-items:center; gap:9px;');
      row.append(E('span', 'font-size:18px; width:22px; text-align:center;', { text: CROP_ICON[k] }));
      const mid = E('div', 'flex:1; min-width:0;');
      const nm = E('div', 'display:flex; align-items:baseline; gap:6px;');
      nm.append(E('span', 'font-size:12px; font-weight:800; color:#fff;', { text: CROP_CN[k] }));
      const mult = E('span', 'font-size:10px; color:#dfeed2;', { text: '1.0×', cls: 'fp-num' });
      nm.append(mult);
      const barBg = E('div', 'height:6px; margin-top:4px; border-radius:5px; background:rgba(255,255,255,.12); overflow:hidden;');
      const bar = E('div', 'height:100%; width:50%; background:linear-gradient(90deg,#bff05f,#5da32e); border-radius:5px;');
      barBg.append(bar);
      mid.append(nm, barBg);
      const right = E('div', 'text-align:right; white-space:nowrap;');
      const price = E('div', 'font-size:14px; font-weight:800; color:#fff;', { text: '🪙260', cls: 'fp-num' });
      const trend = E('div', 'font-size:10px; font-weight:800; color:#bff05f;', { text: '▲ +0%', cls: 'fp-num' });
      right.append(price, trend);
      row.append(mid, right);
      body.append(row);
      this.r['mkMult_' + k] = mult; this.r['mkBar_' + k] = bar; this.r['mkPrice_' + k] = price; this.r['mkTrend_' + k] = trend;
    }
    panel.append(head, body);
    this.r.marketPanel = panel;
    this.root.appendChild(panel);
  }

  // ============ 托管状态条（底部居中）============
  private buildStatusBar() {
    const bar = E('div', 'position:absolute; bottom:16px; left:50%; transform:translateX(-50%); display:flex; align-items:center; gap:8px; background:linear-gradient(rgba(74,116,44,.94),rgba(50,86,30,.94)); border:1.5px solid rgba(176,134,63,.5); color:#fff; border-radius:16px; padding:6px 16px; font-size:12.5px; font-weight:700; box-shadow:0 4px 11px rgba(0,0,0,.25); white-space:nowrap; pointer-events:auto;');
    bar.append(E('span', 'width:8px; height:8px; border-radius:50%; background:#bff05f; box-shadow:0 0 8px #bff05f;'));
    this.r.statusText = E('span', '', { text: '托管中 · 待命中…' });
    bar.append(this.r.statusText);
    this.r.statusBar = bar;
    this.root.appendChild(bar);
  }

  // ============ 极端天气预告条 ============
  private buildWeatherPill() {
    const pill = E('div', 'position:absolute; top:58px; left:14px; display:none; flex-direction:column; gap:5px; border:2px solid rgba(255,255,255,.55); color:#fff; border-radius:15px; padding:7px 15px 8px; width:188px; box-shadow:0 6px 16px rgba(0,0,0,.34); pointer-events:auto;');
    const row1 = E('div', 'display:flex; align-items:center; gap:8px; font-size:13px; font-weight:800; white-space:nowrap;');
    this.r.wxPillIcon = E('span', 'font-size:16px;', { text: '🌧️' });
    this.r.wxPillLabel = E('span', '', { text: '连续暴雨' });
    this.r.wxPillPhase = E('span', 'margin-left:auto; background:rgba(0,0,0,.26); border-radius:9px; padding:1.5px 9px; font-size:11px; font-weight:800;', { text: '初起' });
    row1.append(this.r.wxPillIcon, this.r.wxPillLabel, this.r.wxPillPhase);
    const row2 = E('div', 'display:flex; align-items:center; gap:8px;');
    row2.append(E('span', 'font-size:10px; font-weight:700; opacity:.85; white-space:nowrap;', { text: '强度' }));
    const barBg = E('span', 'flex:1; height:7px; border-radius:5px; background:rgba(0,0,0,.28); overflow:hidden;');
    this.r.wxPillBar = E('span', 'display:block; height:100%; width:0%; background:#ffe08a; border-radius:5px; transition:width 1s ease;');
    barBg.append(this.r.wxPillBar);
    this.r.wxPillPct = E('span', 'font-size:11px; font-weight:800; min-width:34px; text-align:right;', { text: '0%', cls: 'fp-num' });
    row2.append(barBg, this.r.wxPillPct);
    pill.append(row1, row2);
    this.r.wxPill = pill;
    this.root.appendChild(pill);
  }

  // ============ 右侧图鉴导航 ============
  private buildCodexNav() {
    const box = E('div', 'position:absolute; top:152px; right:16px; display:flex; flex-direction:column; gap:7px; opacity:0.55; pointer-events:auto;');
    const items: [string, string][] = [['🤖', '机器人'], ['🌱', '作物'], ['📊', '数据']];
    for (const [icon, label] of items) {
      const b = E('button', 'width:40px; height:40px; border:2px solid #b78a4e; border-radius:11px; background:linear-gradient(#f7ead0,#ecd6ab); cursor:pointer; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:1px; box-shadow:0 4px 0 #b78a4e, 0 6px 12px rgba(0,0,0,.2);');
      b.append(E('span', 'font-size:15px;', { text: icon }), E('span', 'font-size:7px; font-weight:800; color:#5a431f;', { text: label }));
      b.onclick = () => this.toast(`${label}图鉴为完整版功能`);
      box.appendChild(b);
    }
    this.root.appendChild(box);
  }

  // ============ 场景内房屋/充电站标牌 ============
  private buildBuildings() {
    this.signLabel('🏚️', '仓库', '#fff', 19.5, 30.5, () => this.toast('🏚️ 仓库 · 收成囤货保值'));
    this.signLabel('🏪', '商店', '#fff', 82, 33, () => this.toast('🏪 商店 · 买种 / 卖货'), '买卖');
    // 充电站标牌
    const charge = E('div', `position:absolute; left:${91}%; top:${64}%; transform:translate(-50%,0); display:flex; align-items:center; gap:4px; background:#fff; border:1.5px solid #cdb98c; border-radius:9px; padding:2px 8px; font-size:11px; font-weight:800; color:#3a7d2c; box-shadow:0 2px 5px rgba(0,0,0,.2); pointer-events:auto; white-space:nowrap;`);
    charge.append(E('span', 'font-size:12px;', { text: '⚡' }), document.createTextNode('充电中'));
    this.root.appendChild(charge);
  }
  private signLabel(icon: string, name: string, color: string, leftPct: number, topPct: number, onClick: () => void, tag?: string) {
    const wrap = E('div', `position:absolute; left:${leftPct}%; top:${topPct}%; transform:translate(-50%,0); cursor:pointer; display:flex; flex-direction:column; align-items:center; pointer-events:auto;`);
    const sign = E('div', 'display:flex; align-items:center; gap:5px; background:linear-gradient(rgba(74,116,44,.86),rgba(50,86,30,.86)); border:2px solid rgba(176,134,63,.5); border-radius:11px; padding:4px 10px; box-shadow:0 5px 12px rgba(0,0,0,.28); white-space:nowrap;');
    sign.append(E('span', 'font-size:15px;', { text: icon }), E('span', `font-size:14px; color:${color};`, { text: name, cls: 'fp-logo' }));
    if (tag) sign.append(E('span', 'font-size:9px; font-weight:800; color:#eaffd6; background:rgba(126,201,67,.3); border-radius:6px; padding:1px 5px;', { text: tag }));
    const tri = E('div', 'width:0; height:0; border-left:6px solid transparent; border-right:6px solid transparent; border-top:8px solid rgba(60,96,36,.86); margin-top:-1px;');
    wrap.append(sign, tri);
    wrap.onclick = onClick;
    this.root.appendChild(wrap);
  }

  // ============ 机器人头顶动作气泡 ============
  private buildRobotBubble() {
    const bub = E('div', 'position:absolute; transform:translate(-50%,-100%); display:none; align-items:center; gap:4px; background:#fff; border:1.5px solid #cdb98c; border-radius:10px; padding:3px 9px; font-size:11px; font-weight:800; color:#5a431f; box-shadow:0 3px 8px rgba(0,0,0,.25); white-space:nowrap; pointer-events:none; z-index:20;');
    this.r.bubbleText = E('span', '', { text: '巡田中…' });
    bub.append(E('span', 'font-size:12px;', { text: '💬' }), this.r.bubbleText);
    this.r.bubble = bub;
    this.root.appendChild(bub);
  }

  // ============ 每帧刷新 ============
  update(_dtMS: number) {
    const w = this.world;
    const auto = w.mode === 'auto';

    // 昼夜时钟（live 模式即农场当地时间）
    const dn = dayState(w.tod);
    this.r.clock.textContent = dn.clock;
    this.r.phase.textContent = dn.phase;
    this.r.dayIcon.textContent = dn.icon;
    // 天气芯片：实时数据可用→实测天气+实测气温；否则游戏天气+合成气温
    const rw = w.realWx;
    if (w.live && rw && rw.ok) {
      const wm = WEATHER_META[rw.type] || WEATHER_META.clear;
      this.r.wxIcon.textContent = wm.icon;
      this.r.wxCond.textContent = `${rw.label} ${Math.round(rw.temp)}°`;
      this.r.wxPlace.textContent = '⇄ 南江·实时';
      this.r.wxPlace.style.color = '#a9e6b1';
    } else {
      const wm = WEATHER_META[w.weather.type] || WEATHER_META.clear;
      this.r.wxIcon.textContent = wm.icon;
      const temp = Math.round(12 + 10 * (1 - dn.mul.a) + (w.weather.type === 'frost' ? -8 : w.weather.type === 'drought' ? 8 : 0));
      this.r.wxCond.textContent = `${wm.label} ${temp}°`;
      this.r.wxPlace.textContent = w.live ? '⇄ 南江·连接中' : '⇄ 南江·加速';
      this.r.wxPlace.style.color = w.live ? '#d8c08a' : '#a9c6b1';
    }

    // 健康条
    const hs = w.healthStats();
    this.setBar(this.r.weedPct, this.r.weedBar, hs.weedPct);
    this.setBar(this.r.idlePct, this.r.idleBar, hs.idlePct);

    // 模式高亮
    this.r.manualBtn.style.background = auto ? 'transparent' : 'linear-gradient(#7ec943,#54992c)';
    this.r.manualBtn.style.color = auto ? '#cfe0d4' : '#fff';
    this.r.autoBtn.style.background = auto ? 'linear-gradient(#5aa0e8,#3f7fd0)' : 'transparent';
    this.r.autoBtn.style.color = auto ? '#fff' : '#cfe0d4';

    // 面板显隐（托管→AI面板+状态条+巡田路径；手动→行情面板）
    this.r.aiPanel.style.display = auto ? 'block' : 'none';
    this.r.statusBar.style.display = auto ? 'flex' : 'none';
    this.r.pathBtn.style.display = auto ? 'flex' : 'none';
    this.r.marketPanel.style.display = auto ? 'none' : 'block';

    // 灾害预告条 + 让位（面板下移到 124）
    const disaster = isDisaster(w.weather.type);
    this.r.wxPill.style.display = disaster ? 'flex' : 'none';
    const panelTop = disaster ? '124px' : '58px';
    this.r.aiPanel.style.top = panelTop;
    this.r.marketPanel.style.top = panelTop;
    if (disaster) {
      const dm = WEATHER_META[w.weather.type] || WEATHER_META.clear;
      const wInt = w.weatherIntensity();
      const ph = wxPhase(w.weatherProg());
      this.r.wxPill.style.background = w.weather.type === 'rain' ? 'linear-gradient(#3f7fd0,#2a5da0)' : w.weather.type === 'drought' ? 'linear-gradient(#e08a2a,#c25f1f)' : 'linear-gradient(#5aa6c8,#3f7fa0)';
      this.r.wxPillIcon.textContent = dm.icon;
      this.r.wxPillLabel.textContent = dm.label + (w.isLiveWeather() ? '·实时' : '');
      this.r.wxPillPhase.textContent = ph === 'onset' ? '初起·渐强' : ph === 'climax' ? '高潮·肆虐' : '尾声·减弱';
      const pct = Math.round(wInt * 100);
      (this.r.wxPillBar as HTMLElement).style.width = pct + '%';
      this.r.wxPillPct.textContent = pct + '%';
    }

    // 状态条 / 气泡
    this.r.statusText.textContent = '托管中 · ' + w.robotAction;
    if (auto) {
      this.r.bubble.style.display = 'flex';
      this.r.bubbleText.textContent = w.robotAction;
      this.r.bubble.style.left = pctX(w.robot.left) + 'px';
      this.r.bubble.style.top = (pctY(w.robot.top) - 58) + 'px';
    } else {
      this.r.bubble.style.display = 'none';
    }

    // world 推送的播报（行情暴涨暴跌 / 学习 / 破产 / 实时天气切换）→ toast
    if (w.pendingToasts.length) {
      for (const m of w.pendingToasts) if (m) this.toast(m);
      w.pendingToasts.length = 0;
    }
    this.renderBiz(auto);
  }

  // 面板数据：直接读取 world 的权威市场 / AI 学习状态（不再用假数据漂移）
  private renderBiz(auto: boolean) {
    const w = this.world;
    const mk = w.market, mkPrev = w.marketPrev;
    if (auto) {
      const ai = w.ai;
      this.r.aiFunds.textContent = '🪙 ' + fmt(ai.funds);
      const net = ai.funds - AI_BASE;
      this.r.aiNet.textContent = (net >= 0 ? '+' : '−') + fmt(Math.abs(net));
      this.r.aiNet.style.color = net >= 0 ? '#bff05f' : '#ff9a8a';
      this.r.aiTrades.textContent = String(ai.trades);
      this.r.aiSells.textContent = String(ai.sells);
      this.r.aiDeaths.textContent = String(ai.deaths);
      this.r.aiExplore.textContent = Math.round(ai.explore * 100) + '%';
      this.r.aiLast.textContent = '🧠 ' + ai.last;
      for (const k of CROP_KEYS) {
        // 收益评分（学习中）= Q 值归一化（原型 (q+150)/528）；右侧为实时市价
        const score = clamp(2, 100, Math.round(((ai.q[k] + 150) / 528) * 100));
        const mult = mk[k];
        const up = mult >= mkPrev[k];
        (this.r['aiCropBar_' + k] as HTMLElement).style.width = score + '%';
        this.r['aiCropScore_' + k].textContent = String(score);
        this.r['aiCropPrice_' + k].textContent = mult.toFixed(2) + '× ' + (up ? '▲' : '▼');
        this.r['aiCropPrice_' + k].style.color = up ? '#7ee07e' : '#ff9a8a';
      }
    } else {
      for (const k of CROP_KEYS) {
        const mult = mk[k];
        const up = mult >= mkPrev[k];
        const price = w.priceOf(k);
        const pct = mkPrev[k] ? ((mult - mkPrev[k]) / mkPrev[k]) * 100 : 0;
        this.r['mkMult_' + k].textContent = mult.toFixed(2) + '×';
        (this.r['mkBar_' + k] as HTMLElement).style.width = Math.max(6, Math.min(100, Math.round((mult / 2) * 100))) + '%';
        this.r['mkPrice_' + k].textContent = '🪙' + price;
        this.r['mkTrend_' + k].textContent = (up ? '▲' : '▼') + ' ' + (up ? '+' : '') + pct.toFixed(1) + '%';
        this.r['mkTrend_' + k].style.color = up ? '#bff05f' : '#ff9a8a';
      }
    }
  }

  // 切换 实时 / 加速演示
  private toggleLive() {
    const w = this.world;
    w.live = !w.live;
    if (!w.live) w.todAuto = true; // 加速：恢复昼夜动画
    this.toast(w.live ? '🛰 已切到实时：农场当地时间 + 实时天气' : '⏩ 已切到加速演示：合成昼夜与天气');
  }

  private setBar(pctEl: HTMLElement, barEl: HTMLElement, pct: number) {
    pctEl.textContent = pct + '%';
    const color = pct <= 50 ? '#bff05f' : mixHealth((pct - 50) / 50);
    pctEl.style.color = color;
    barEl.style.width = pct + '%';
    barEl.style.background = color;
  }

  private toggleFullscreen() {
    const root = document.getElementById('fp-wrap') || document.documentElement;
    if (!document.fullscreenElement) {
      root.requestFullscreen?.().catch(() => {});
      this.r.fsLabel.textContent = '退出';
    } else {
      document.exitFullscreen?.().catch(() => {});
      this.r.fsLabel.textContent = '全屏';
    }
  }

  private toast(msg: string) {
    const t = E('div', 'background:rgba(40,28,14,.92); color:#ffe9bf; border:1px solid rgba(176,134,63,.5); border-radius:10px; padding:7px 13px; font-size:12px; font-weight:700; box-shadow:0 4px 12px rgba(0,0,0,.35); opacity:0; transition:opacity .2s;');
    t.textContent = msg;
    this.toastBox.appendChild(t);
    requestAnimationFrame(() => (t.style.opacity = '1'));
    // 限制同屏堆叠数量（市场/天气/学习播报较频繁）
    while (this.toastBox.childElementCount > 3) this.toastBox.firstElementChild?.remove();
    setTimeout(() => {
      t.style.opacity = '0';
      setTimeout(() => t.remove(), 250);
    }, 2600);
  }
}

// —— 小工具 ——
function E(tag: string, css: string, opts?: { text?: string; cls?: string }): HTMLElement {
  const e = document.createElement(tag);
  e.style.cssText = css;
  if (opts?.cls) e.className = opts.cls;
  if (opts?.text != null) e.textContent = opts.text;
  return e;
}
function numb(color: string): HTMLElement {
  return E('b', `color:${color};`, { text: '0', cls: 'fp-num' });
}
function lbl(text: string, valueEl: HTMLElement): HTMLElement {
  const s = E('span', '');
  s.append(document.createTextNode(text), valueEl);
  return s;
}
function clamp(lo: number, hi: number, v: number): number {
  return Math.max(lo, Math.min(hi, v));
}
function fmt(n: number): string {
  return Math.round(n).toLocaleString('en-US');
}
function mixHealth(t: number): string {
  t = clamp(0, 1, t);
  const G = [150, 206, 77], A = [230, 170, 52], R = [214, 64, 48];
  let c: number[];
  if (t < 0.5) { const u = t * 2; c = G.map((g, i) => Math.round(g + (A[i] - g) * u)); }
  else { const u = (t - 0.5) * 2; c = A.map((a, i) => Math.round(a + (R[i] - a) * u)); }
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}
