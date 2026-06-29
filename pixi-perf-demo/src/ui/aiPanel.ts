import type { World, AiSnapshot, AiScoredCand, AiPlotDiag } from '../sim/world';

// ===== 2 号画布：AI 决策状态面板 =====
// 全屏 DOM 仪表盘，只读展示托管机器人的「确定性效用决策」全过程与经济自适应参数，逻辑分区清晰：
//   ① 顶部态势(模式/时钟/季节/天气/灯) ② 机器人(电量/动作/载重/资金)
//   ③ 决策核心(候选打分排名 + 公式，"为什么这么决策"一目了然) ④ 经济(库存/仓库/种子/行情/阈值)
//   ⑤ 在线自适应参数(售卖阈值/囤货倾向/密度偏置/ε/各作物 Q) ⑥ 遥测统计 ⑦ 逐地块传感器诊断
// 与 1 号画布(田地)互斥显示，按 1/2 切换；T 隐藏/显示当前画布。读 world.aiSnapshot()（纯只读，不改 sim）。
export class AiPanel {
  readonly el: HTMLDivElement;
  private body: HTMLDivElement;
  private acc = 9999; // 节流累加器
  private _visible = false;

  constructor(host: HTMLElement, private world: World) {
    if (!document.getElementById('fpai-style')) {
      const st = document.createElement('style');
      st.id = 'fpai-style';
      st.textContent = CSS;
      document.head.appendChild(st);
    }
    this.el = document.createElement('div');
    this.el.className = 'fpai-root';
    this.el.style.display = 'none';
    this.el.innerHTML = `<div class="fpai-head">
        <span class="fpai-title">🤖 AI 决策状态 · 2 号画布</span>
        <span class="fpai-hint">按 <b>1</b> 看田地 · 按 <b>2</b> 看此面板 · 按 <b>T</b> 隐藏当前画布</span>
      </div>
      <div class="fpai-body"></div>`;
    this.body = this.el.querySelector('.fpai-body') as HTMLDivElement;
    host.appendChild(this.el);
  }

  get visible() { return this._visible; }
  show() { this._visible = true; this.el.style.display = 'flex'; this.acc = 9999; this.render(); }
  hide() { this._visible = false; this.el.style.display = 'none'; }

  update(dtMS: number) {
    if (!this._visible) return;
    this.acc += dtMS;
    if (this.acc < 220) return; // ~4.5fps 刷新，足够看清且省开销
    this.acc = 0;
    this.render();
  }

  private render() {
    const s = this.world.aiSnapshot();
    const top = this.body.scrollTop;
    this.body.innerHTML = sectionTop(s) + sectionRobot(s) + sectionDecision(s) + sectionEcon(s) + sectionAdaptive(s) + sectionStats(s) + sectionPlots(s);
    this.body.scrollTop = top; // 行高固定 → 还原滚动位置不跳
  }
}

// —— 渲染小工具 ——
const esc = (x: unknown) => String(x).replace(/[&<>]/g, (c) => (c === '&' ? '&amp;' : c === '<' ? '&lt;' : '&gt;'));
const pct = (v: number, max: number) => Math.max(0, Math.min(100, (v / max) * 100));
const bar = (v: number, max: number, color: string) =>
  `<span class="fpai-bar"><span style="width:${pct(v, max).toFixed(0)}%;background:${color}"></span></span>`;
// 紧迫度配色：高=红、中=橙、低=灰
const urg = (v: number) => (v >= 2 ? '#ff6b5e' : v >= 1 ? '#f4b740' : '#8aa0b4');
const card = (title: string, inner: string, span = 1) =>
  `<section class="fpai-card" style="grid-column:span ${span}"><h3>${title}</h3>${inner}</section>`;
const kv = (k: string, v: string, cls = '') => `<div class="fpai-kv"><span>${k}</span><b class="${cls}">${v}</b></div>`;

function sectionTop(s: AiSnapshot): string {
  const modeTxt = s.mode === 'auto' ? '托管(AI)' : '手动';
  const speed = s.stress ? '压力档(加速)' : s.live ? '实时' : '静置';
  const inner =
    kv('运行模式', `${modeTxt} · ${speed}`) +
    kv('农场时钟', `${s.clock}`) +
    kv('季节', s.season) +
    kv('天气', `${zhWeather(s.weather)} · 强度 ${s.weatherInt}`) +
    kv('决策步数', String(s.step));
  const L = s.lights;
  const lightInner =
    kv('开灯', L.on ? '🟢 开' : '⚪ 关', L.on ? 'fpai-ok' : '') +
    kv('① 入夜判定', L.clockNight ? '是(已过日落/未到日出)' : '否(白昼)') +
    kv('日出 / 日落', `${L.sunrise} / ${L.sunset}`) +
    kv('② 环境亮度', `${L.visibility} （阈值 ${L.threshold}，低于则开灯）`);
  return `<div class="fpai-grid">${card('① 全局态势', inner, 2)}${card('💡 开灯决策（天气日出日落优先，亮度次之）', lightInner, 2)}</div>`;
}

function sectionRobot(s: AiSnapshot): string {
  const r = s.robot;
  const battColor = r.battery < 30 ? '#ff6b5e' : r.battery < 70 ? '#f4b740' : '#57c23f';
  const inner =
    `<div class="fpai-kv"><span>电量</span><b>${r.battery}% ${bar(r.battery, 100, battColor)}</b></div>` +
    `<div class="fpai-kv"><span>载重</span><b>${r.stockN}/${s.econ.stockCap} ${bar(r.carryFrac, 1, '#3d8fd0')}</b></div>` +
    kv('当前动作', esc(r.action)) +
    kv('充电中', r.charging ? '是' : '否') +
    kv('坐标', `${r.left}, ${r.top}${r.moving ? ' · 移动中' : ''}`);
  const fundColor = s.cashStrained ? 'fpai-warn' : 'fpai-ok';
  const fundInner =
    kv('经营资金', `¥${s.funds}`, fundColor) +
    kv('资金告急', s.cashStrained ? `是（< ¥${s.lowFunds} → 激进盈利模式）` : `否（≥ ¥${s.lowFunds}，正常轮作）`, fundColor) +
    `<div class="fpai-note">告急时：放弃轮作惩罚、单种高价作物、缓修路等长线投资、急于出售回血。</div>`;
  return `<div class="fpai-grid">${card('② 机器人状态', inner, 2)}${card('💰 资金策略', fundInner, 2)}</div>`;
}

function sectionDecision(s: AiSnapshot): string {
  const w = s.weights;
  const formula = `<div class="fpai-formula">得分 = <b>${w.value}</b>·价值 + <b>${w.urgency}</b>·紧迫 − <b>${w.power}</b>·耗电 + <b>${w.prox}</b>·近便度 　→　 取最高分（极小 ε 抖动防死板）</div>`;
  if (!s.decision || !s.decision.ranked.length) {
    return card('③ 决策核心 · 候选打分排名', formula + `<div class="fpai-note">暂无决策记录（手动模式或尚未开始托管）。切到「常规」档并设为托管即可看到实时打分。</div>`, 4);
  }
  const rows = s.decision.ranked.map((c, i) => rowCand(c, i)).join('');
  const tbl = `<table class="fpai-tbl"><thead><tr>
      <th>#</th><th>动作</th><th>对象</th>
      <th>价值</th><th>紧迫</th><th>耗电</th><th>近便</th><th>得分</th>
    </tr></thead><tbody>${rows}</tbody></table>`;
  const chosen = `<div class="fpai-note">本步选择：<b class="fpai-ok">${esc(s.decision.chosen)}</b>（绿色高亮行）。紧迫度由 传感器×生长阶段×天气×行情×资金 显式算出，非黑箱权重。</div>`;
  return card('③ 决策核心 · 候选打分排名（为什么这么决策）', formula + tbl + chosen, 4);
}

function rowCand(c: AiScoredCand, i: number): string {
  const obj = c.plotId >= 0 ? `${c.plotId + 1} 号地` : '建筑/全局';
  return `<tr class="${c.chosen ? 'fpai-chosen' : ''}">
    <td>${i + 1}</td><td>${esc(c.label)}</td><td>${obj}</td>
    <td>${c.value}</td><td style="color:${urg(c.urgency)}">${c.urgency}</td>
    <td>${c.power}</td><td>${c.prox}</td><td><b>${c.score}</b></td></tr>`;
}

function sectionEcon(s: AiSnapshot): string {
  const e = s.econ;
  const stockList = e.stock.length ? e.stock.map((x) => `${x.k} ${x.n}`).join('、') : '空';
  const whList = e.wh.length ? e.wh.map((x) => `${x.k} ${x.n}`).join('、') : '空';
  const inner =
    `<div class="fpai-kv"><span>待售库存</span><b>${e.stockN}/${e.stockCap} ${bar(e.stockN, e.stockCap, '#d8972f')}</b></div>` +
    kv('　明细', stockList) +
    kv('新鲜度', `${e.fresh}`) +
    kv('折损率 / 仓储费', `${e.decay} / ¥${e.fee}`) +
    kv('仓库库存', `${e.whN}（${whList}）`) +
    kv('种子库存', `${e.seedStock}`) +
    kv('种子行情', `${e.seedMkt}（低买划算）`);
  const mkt = s.market.map((m) => {
    const col = m.v >= 1.1 ? '#57c23f' : m.v < 0.95 ? '#ff6b5e' : '#cdd9e6';
    return `<div class="fpai-kv"><span>${m.k}${m.season ? ' <i class="fpai-season">应季</i>' : ''}</span><b style="color:${col}">×${m.v}</b></div>`;
  }).join('');
  return `<div class="fpai-grid">${card('④ 收成 / 仓储经济', inner, 2)}${card('📈 作物行情（高→急售 / 低→囤货）', mkt, 2)}</div>`;
}

function sectionAdaptive(s: AiSnapshot): string {
  const a = s.adaptive;
  const inner =
    kv('售卖阈值', `${a.sellThreshold} 件（折损/仓储盈亏自适应）`) +
    kv('囤货倾向', `${a.storeBias}（清仓盈亏自适应）`) +
    kv('密度偏置', `${a.densBias}（收获质量反推种疏/密）`) +
    kv('探索率 ε', `${a.eps}`);
  const q = a.q.map((x) => `<div class="fpai-kv"><span>${x.k}</span><b>${x.v}</b></div>`).join('');
  const note = `<div class="fpai-note">仅这些「经济参数」在线自适应；决策主干是确定性效用规则（非强化学习/黑箱）。</div>`;
  return `<div class="fpai-grid">${card('⑤ 在线自适应参数（保留的唯一“学习”）', inner + note, 2)}${card('🌾 各作物收益评分 Q', q, 2)}</div>`;
}

function sectionStats(s: AiSnapshot): string {
  const t = s.stats;
  const inner =
    kv('决策/交易次数', String(t.trades)) +
    kv('累计出售 / 收获株', `${t.sells} / ${t.harvests}`) +
    kv('损失株 / 播种次', `${t.deaths} / ${t.plantings}`) +
    kv('设备老化 / 破产次', `${t.wear} / ${t.fails}`) +
    kv('折损损失', `¥${t.decayLoss}`) +
    kv('仓储费 / 闲置税', `¥${t.feesPaid} / ¥${t.idleTaxPaid}`) +
    kv('行情套利收益', `¥${t.spikeGain}`);
  const last = `<div class="fpai-note">最近播报：${esc(t.last || '—')}</div>`;
  return card('⑥ 经营遥测', inner + last, 4);
}

function sectionPlots(s: AiSnapshot): string {
  const rows = s.plots.map((p) => rowPlot(p)).join('');
  const tbl = `<table class="fpai-tbl fpai-plots"><thead><tr>
      <th>地</th><th>作物</th><th>阶段</th><th>生长</th>
      <th>湿</th><th>缺水</th><th>涝</th><th>霜</th><th>健康</th>
      <th>杂草</th><th>恶性</th><th>路损</th><th>闲置</th>
      <th>需水</th><th>需肥</th><th>修路</th><th>近便</th><th>连作</th>
    </tr></thead><tbody>${rows}</tbody></table>`;
  const note = `<div class="fpai-note">需水/需肥/修路 = 该地块各任务的紧迫度（0..3）；>阈值才进候选。近便度=离 商店/仓库/基站 最近(0..1)。</div>`;
  return card('⑦ 逐地块传感器与需求诊断（决策的输入）', tbl + note, 4);
}

function rowPlot(p: AiPlotDiag): string {
  const hp = p.health >= 0.8 ? '#57c23f' : p.health >= 0.5 ? '#f4b740' : '#ff6b5e';
  const road = p.roadDmg ? '<b style="color:#ff6b5e">破损</b>' : p.roadWeed > 0 ? `草${p.roadWeed}` : '—';
  const num = (v: number, hot = 0) => (hot && v >= hot ? `<b style="color:${urg(v)}">${v}</b>` : `${v}`);
  return `<tr>
    <td>${p.id + 1}</td><td>${esc(p.crops)}</td><td class="fpai-sm">${esc(p.stageText)}</td><td>${p.growth}</td>
    <td>${p.moist}</td><td>${num(p.dry, 1)}</td><td>${num(p.flood, 1)}</td><td>${num(p.frost, 1)}</td>
    <td style="color:${hp}">${p.health}</td>
    <td>${p.weedProg}</td><td>${p.malign > 0 ? `<b style="color:#c97cff">${p.malign}</b>` : '0'}</td><td>${road}</td><td>${num(p.idle, 30)}</td>
    <td>${num(p.waterReq, 0.05)}</td><td>${num(p.fertReq, 0.05)}</td><td>${num(p.repairReq, 0.05)}</td><td>${p.prox}</td>
    <td>${p.lastCrop}${p.monoCount > 0 ? `·${p.monoCount}茬` : ''}</td></tr>`;
}

function zhWeather(t: string): string {
  return ({ clear: '晴', cloudy: '阴', lightrain: '小雨', rain: '雨', drought: '旱', frost: '霜冻' } as Record<string, string>)[t] || t;
}

const CSS = `
.fpai-root{position:fixed;inset:0;z-index:2000;display:none;flex-direction:column;
  background:linear-gradient(160deg,#0c1422 0%,#101b2e 60%,#0a1018 100%);color:#e7eefa;
  font-family:'Noto Sans SC',system-ui,sans-serif;font-size:13px;overflow:hidden;}
.fpai-head{flex:none;display:flex;align-items:center;justify-content:space-between;gap:12px;
  padding:10px 96px 10px 18px;border-bottom:1px solid rgba(120,150,190,.22);background:rgba(8,14,24,.6);}
.fpai-title{font-weight:900;font-size:16px;letter-spacing:.5px;color:#9fe0ff;}
.fpai-hint{font-size:12px;color:#8ea4ba;}
.fpai-hint b{color:#ffd66b;}
.fpai-body{flex:1;overflow-y:auto;padding:14px 18px 28px;}
.fpai-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:12px;}
.fpai-card{background:rgba(20,30,46,.72);border:1px solid rgba(110,140,180,.2);border-radius:12px;
  padding:11px 13px;box-shadow:0 3px 10px rgba(0,0,0,.25);}
.fpai-card>h3{font-size:13px;font-weight:800;color:#bcd4ee;margin-bottom:8px;
  border-bottom:1px dashed rgba(120,150,190,.25);padding-bottom:6px;}
.fpai-kv{display:flex;justify-content:space-between;gap:10px;padding:2px 0;line-height:1.7;}
.fpai-kv>span{color:#92a6bc;white-space:nowrap;}
.fpai-kv>b{font-weight:700;text-align:right;}
.fpai-kv i.fpai-season{font-style:normal;font-size:10px;color:#57c23f;border:1px solid #57c23f;border-radius:5px;padding:0 3px;margin-left:4px;}
.fpai-ok{color:#57c23f;}
.fpai-warn{color:#ff6b5e;}
.fpai-note{margin-top:7px;font-size:11px;color:#7e93a8;line-height:1.6;}
.fpai-formula{margin-bottom:9px;font-size:12.5px;color:#d8e6f4;background:rgba(40,70,110,.3);
  border:1px solid rgba(110,150,200,.28);border-radius:8px;padding:7px 10px;}
.fpai-formula b{color:#ffd66b;}
.fpai-bar{display:inline-block;width:70px;height:8px;border-radius:4px;background:rgba(255,255,255,.12);
  vertical-align:middle;margin-left:6px;overflow:hidden;}
.fpai-bar>span{display:block;height:100%;border-radius:4px;}
.fpai-tbl{width:100%;border-collapse:collapse;font-size:12px;}
.fpai-tbl th{color:#90a6bd;font-weight:700;text-align:right;padding:5px 7px;border-bottom:1px solid rgba(120,150,190,.28);position:sticky;top:0;background:#101b2e;}
.fpai-tbl td{text-align:right;padding:4px 7px;border-bottom:1px solid rgba(120,150,190,.1);
  font-variant-numeric:tabular-nums;font-family:'Baloo 2','Noto Sans SC',sans-serif;}
.fpai-tbl th:nth-child(2),.fpai-tbl td:nth-child(2),.fpai-tbl th:nth-child(3),.fpai-tbl td:nth-child(3){text-align:left;}
.fpai-chosen{background:rgba(60,150,80,.22);}
.fpai-chosen td{color:#bff0c0;font-weight:700;}
.fpai-plots td.fpai-sm{font-size:11px;color:#b6c6d8;}
.fpai-plots th,.fpai-plots td{padding:4px 5px;}
`;
