# 机器人行为差距分析 · Pixi 版 ↔ H5 权威原型

> 基准文件：`FieldPlay.dc.html`（权威原型，逐行为准）
> 对照实现：`pixi-perf-demo/src/sim/world.ts`、`pixi-perf-demo/src/scene/robot.ts`、`pixi-perf-demo/src/data/tokens.ts`
> 目的：在恢复"与原 H5 对齐"任务前，先把机器人（托管 AI）行为的差距盘清楚，给出按严重度排序的对齐路线图。本文只做分析，不改代码。

---

## 〇、总览（按严重度）

| # | 差距 | 严重度 | H5 位置 | Pixi 位置 | 一句话 |
|---|------|--------|---------|-----------|--------|
| 1 | **经济链：库存→折损→仓储→售卖阈值→囤货学习** 完全缺失 | 🔴 致命 | `econ`(867–869)、tick(1390–1454)、sell/store(1696–1739) | 无 `econ`；`harvestPlot` 收获即现金(694–726)；`sell` 任务空转(548) | Pixi 把"收获→存货→折价/仓储→择机出售"压成"收获瞬间变现"，整条经营学习闭环没了 |
| 2 | **播种/种子链**：无 `plant` 任务、`seedStock` 不在播种时消耗、收获原地即时复种 | 🟠 高 | `plant`(1870–1886)、`buy`(1741–1747)、till→plant 轮作 | 任务种类无 `plant`(97)；收获原地改种(710–716)；`res.seed` 反而在收获时扣(543) | 田块永不清空 → **闲置税形同虚设**、翻耕→播种轮作消失、种子经济失真 |
| 3 | **任务优先级链顺序**与门槛偏离 | 🟠 高 | `aiStep`(1942–1956) | `robotDecide`(439–467) | buy 被提到最前、harvest 抢在 water 前、cover/drain 压过 water、fert 门槛缺失、缺 store/sellwh/repair |
| 4 | **资源模型**：发明 `thermal` + 四资源 220 平价采购 | 🟡 中 | 只买种子(SEED_BATCH 9 / 990)，cover/drain 耗 `eco` | `res{water,eco,thermal,seed}` + 任意低料 220 补满(565–579) | 与原型"只补种子、覆盖保温吃生态肥"不符 |
| 5 | **缺 `repair` 修路任务** → `roadDmg` 永久不修复 | 🟡 中 | `robotRepair`(1527–1532)、优先级(1953) | 无 repair 分支；`weedTick` 只设不清(799,804) | 路面一旦被恶性草/杂草破坏，机器人永远不修 |
| 6 | **`wxTaskMod` 天气相位经济**（onset/climax/ending）缺失 | 🟡 中 | (1648–1651) | cover/drain 固定 workMs 900 / bat 4(454) | 抢险成本/时长不随灾害相位变化 |
| 7 | **移动耗电**模型不同（H5 移动免费，Pixi 移动持续耗电） | 🟢 低 | 仅作业扣电(2005) | move/work 每帧 `0.0016*dtMS`(417) | 行为可接受，但与原型口径不同 |
| 8 | **路网稀疏**（15 节点 vs H5 细分+桥接稠密图） | 🟢 低 | `derivedRoadGraph` SUB=5 桥接(1804–1817) | 12 停留点+3 建筑，最近 3 邻(604–619) | 走位略糙，绕路/穿地观感差一截 |
| 9 | **经济遥测计数**缺失（decayLoss/feesPaid/idleTaxPaid/spikeGain/sellThreshold/storeBias） | 🟢 低 | `ai`(862–864) | `AIState`(39–51) 只保留一半 | AI 面板可展示的学习指标少了一半 |

**已对齐良好的部分（无需动）**：Q 学习（α 收获 0.25 / 死亡 0.3、explore 0.96 衰减、ε-greedy `0.55*margin+0.45*q`）、市场模型（drift 0.035 / shock ±0.17 / 26% 事件 / clamp[0.3,2.8]）、闲置税（>7 块 / 0.22 / 抽 3 / 税基 44）、设备老化（funds<1000 加剧、否则 -0.018）、破产重置（<-20000 → 2500，学习保留）、电量回充阈值（<14 返回、≥60 复工）。

**Pixi 刻意新增 / 偏离（用户要求，不要回退对齐 H5）**：恶性草（Yellow Dock，`malign`）系统及其专属"清除恶性草"任务、`wheat` 作物、实时天气/锁农场当地时钟、`stress` 压力档、作物全量光影。

---

## 一、机器人状态字段对照

### H5 `state.robot`（876 / 1128）
```js
robot:{battery:86, action:'待命中…', pos:{left:89,top:73}, moveDur:1.2,
       moving:false, charging:false, module:null, face:2.6}   // + 运行期 hidden
```

### H5 `state.ai`（862–864）—— 经营大脑 / Q 学习 / 经济
```js
{funds, q:{tomato,lettuce,corn,chili}, trades, harvests, deaths, plantings,
 explore:0.35, sells, decayLoss, feesPaid, idleTaxPaid, spikeGain,
 sellThreshold:5, storeBias:0.5, wear, fails, last}
```

### H5 `state.econ`（867–869）—— 库存/仓储（**Pixi 完全没有**）
```js
{ stock:emap(), fresh:1, wh:emap(), whBasis:0, decay:0.05, fee:3, seedStock:0 }
```

### Pixi 对照
- `RobotState`（62–69）：`left/top/face/moving/module/hidden` —— 去掉了 `battery/charging/moveDur/action`，改放到 `World` 上（`robotBattery` 196、`rPhase==='charge'` 充电、`robotAction` 160）。**结构等价，无实质差距。**
- `AIState`（39–51）：保留 `funds/q/trades/sells/harvests/deaths/plantings/explore/wear/fails/last`；**缺** `decayLoss/feesPaid/idleTaxPaid/spikeGain/sellThreshold/storeBias`。
- **完全缺 `econ`**：没有 `stock/fresh/wh/whBasis/decay/fee/seedStock`。Pixi 另起了 `res:{water,eco,thermal,seed}`（195），这与 `econ.seedStock` 不是一回事——它是"作业物料"而非"待售收成库存"。

> **结论**：状态层最大的洞是 **`econ` 库存/仓储/折损 整块缺失**，以及 `ai` 上的 `sellThreshold/storeBias` 两个学习变量缺失。这直接决定了第四节的经济链没法实现。

---

## 二、任务决策循环（优先级链）对照

### H5 `aiStep()`（1.1s/次，1889–2013）
守卫：`mode!=='auto'` 退出 → `charging` 走充电 tick → `moving` 不打断 → `battery<14` 返回充电站。
随后**优先级 if/else 链**（1942–1956）：

```
water > harvest > clear > cover > drain > fert
      > sellWh > sell > store
      > weed > repair > till > buy > plant
（都不命中 → patrol 巡田回站 / 站内 +2 待命充电）
```

### Pixi `robotDecide()`（439–467）
```
battery<14 返回充电
> buy(任一物料低于阈值 且 funds>300)
> harvest
> drain(rain)
> cover(frost 且 thermal>0)
> water
> clear
> 清除恶性草(malign>=35)        ← Pixi 新增
> weed(weedProg>=40)
> till(weeds===1)
> fert(clear 且 eco>0)
> sell(harvestStreak>=3)
> idle 待命充电
```

### 关键顺序差异

| 行为 | H5 | Pixi | 影响 |
|------|-----|------|------|
| **buy 位置** | 倒数第 2，且仅"有待播地块 且 seedStock<3 且 funds≥990"才买**种子** | **提到最前**（仅次于充电），任一物料低于阈值即去补 | Pixi 机器人频繁往返商店补四种料，挤占田间作业 |
| **water vs harvest** | water 第 1，harvest 第 2 | harvest 在 water **之前** | Pixi 偏向先收割后浇水；H5 偏向先保命后收割 |
| **抢险 vs 浇水** | water 先于 cover/drain | cover/drain 先于 water | 优先级取向相反 |
| **fert 门槛** | `clear && eco≥20 && rand<0.5`（概率性、要够肥） | `clear && eco>0`（必施、无概率） | Pixi 施肥过于频繁 |
| **sellWh / store** | 有独立"清仓/入库"分支 | **无**（无仓储概念） | 见第四节 |
| **sell 触发** | 由 `wantSell`（库存阈值/价格尖峰/折损）驱动 | `harvestStreak>=3` 计数器，且**空转无收益**(548) | Pixi 的 sell 是装饰 |
| **repair** | `roadDmg||roadWeed>0 且 funds≥320` | **无** | 路坏不修 |
| **till** | `!tilled && weeds<2 && 空地，按 idle 最久优先` | `weeds===1`（仅轻草） | 语义窄化，且无后续 plant |
| **plant** | tilled 空地 且 seedStock>0，`chooseCrop` 选种 | **无**（收获时原地改种代替） | 见第三节 |

---

## 三、逐任务对照（触发 / workMs / 耗电 / 资源 / 效果）

| 任务 | H5 触发 & 数值 | Pixi 触发 & 数值 | 差距 |
|------|----------------|------------------|------|
| **water 浇水** | `mostThirstyPlot`，`water≥10`，非雨非霜；water−10；bat−3；workMs 720 | `thirstiest()`（同 urgency 公式 `dry*3+(3-moist)`）；`res.water−4`；bat 3；workMs 720 | 公式一致；耗水量 10→4，无 `water≥10` 门槛 |
| **fert 施肥** | clear & eco≥20 & rand<0.5；eco−20；workMs 720；效果"活株 stage+1（≤4）" | clear & eco>0；`res.eco−3`；workMs 720；效果"growth+18" | 门槛/概率缺失；H5 是阶段跳变，Pixi 是连续 +18（因 Pixi 用连续 growth，合理） |
| **harvest 采收** | stage≥4；bat−3；workMs 720；**入 `econ.stock`（不变现）**；+5 eco/+10 xp/株；Q α0.25 | growth≥400；bat 3；workMs 900；**直接 `funds+=gain` 变现**；原地改种扣 `seed`；Q α0.25 | 🔴 核心差异：变现路径完全不同；无 eco/xp 奖励 |
| **clear 清枯** | 有 dead；bat−3；workMs **600**；移除枯株 | 有 dead；bat 3；workMs 600；`respawn` 枯株 | 基本一致 |
| **weed 除草** | `weeds≥2 且 无活株`；bat−**5**；workMs **1600**；weeds/weedProg 清零 | `weedProg≥40`；bat 5；workMs 1600；清零 | 触发口径不同（H5 看等级+无活株，Pixi 看进度值） |
| **till 耕地** | `!tilled && weeds<2 && 空地`，idle 最久优先；workMs 720 | `weeds===1`；bat 4；workMs **1100** | 触发窄化；无"空地/idle 优先" |
| **cover 覆盖保温** | frost & eco≥8；eco−round(8·ecoMul)；bat 3·batMul；workMs 720·durMul；`cover:{frost,ticks}` | frost & `thermal>0`；`res.thermal−4`；bat 4；workMs 900；`frost-=4` | 耗料从 eco→thermal；无 wxTaskMod 相位；无 cover 计时态 |
| **drain 开沟排水** | rain & 有幼株；eco−round(6·ecoMul)…同上 | rain & 有幼株；`res.water−2`；bat 4；workMs 900；`flood-=4` | 同上；耗料 eco→water |
| **repair 修路** | `roadDmg||roadWeed>0 && funds≥320`；funds−320；workMs **1900**；清 roadWeed/roadDmg | **无此任务** | 🟡 路损永久 |
| **plant 播种** | tilled 空地 & seedStock>0；扣 seedStock（≤9）；`chooseCrop`；explore×0.96 | **无**（改种逻辑塞进 harvest 710–716） | 🟠 见第三节 |
| **buy 采购** | seedStock<3 & funds≥990；去商店；seedStock+9；bat−3 | 任一料<阈值 & funds>300；去商店；该料补满；funds−**220** | 🟡 只买种子 vs 买四料；990 批 vs 220 平价 |
| **sell 售卖** | `wantSell`；去商店；`gain=round(fresh·cropVal(stock))`；funds+=gain；清 stock | `harvestStreak>=3`；**execTask 空转**（只 ++计数 + toast，不动钱不动货，548） | 🔴 Pixi sell 无经济意义 |
| **sellwh 清仓** | `wantSellWh`；卖仓库；按 `realized` 调 storeBias | **无** | 🔴 |
| **store 入库** | `wantStore`；stock→wh，记 whBasis，止折损 | **无** | 🔴 |
| **charge 充电** | <14 返回；+7/tick（老化降至 2）；≥60 复工；站内待命 +2 | <14 返回；`7·(1-wear·0.7)·dtMS/700`；≥60 复工 / idle≥100 | ✅ 基本一致 |
| **patrol/idle 待命** | 回站，站内 +2/tick | `idle` 回站充电至 100 | ✅ 近似 |

---

## 四、经济链（最大缺口 · 🔴 致命）

这是 CLAUDE.md 待办里点名的"机器人经济链"缺口，也是本次差距分析的核心。

### H5 的完整闭环
```
收获 → econ.stock（带 fresh 新鲜度，不直接变现）
   ├─ 每 tick 折损：nf=max(0.3, fresh*(1-decay))，损失 round(cropVal*(fresh-nf))   // decay 在[0.02,0.12]均值回归0.05 (1392,1395)
   ├─ 决策 A · 入库 store：stock→wh，锁定 whBasis，停止折损，但每 tick 付仓储费 round(fee*whN)  // fee[1,10]回归3 (1393,1398)
   └─ 决策 B · 出售 sell：gain=round(fresh*cropVal(stock)) → funds
售卖时机由学习阈值驱动（1923–1934）：
   wantSell  = stock>0 && (价格尖峰 mk≥1.35 || 库存≥sellThreshold || 均价≥1.08 || (decay≥0.08 && 库存≥2))
   wantStore = 库存≥4 && 均价<0.95 && storeBias>0.4 && !尖峰
   wantSellWh= 仓库>0 && (尖峰 mk≥1.3 || 均价≥1.08)
学习（1430–1434, 1717–1719）：
   折损发生 → sellThreshold 下调（早卖）；纯仓储费 → storeBias 下调（少囤）
   仓库实现盈利 → storeBias 上调；亏损 → 下调（±min(0.12,|realized|/600)）
```

### Pixi 现状
- `harvestPlot`（694–726）：成熟株**当场** `funds += gain`，原地改种，没有 stock/fresh/wh/whBasis/decay/fee 任何一环。
- `execTask` 的 `sell`（548）：只 `ai.sells++; ai.trades++` + 一条 toast，**不转移任何货与钱**。
- 完全没有"折损惩罚→早卖"、"仓储费→少囤"、"尖峰→趁高出手"、"仓库盈亏→调 storeBias"的学习。

### 影响
- 机器人对"市场行情"几乎无反应：行情虽然在波动（marketTick 已对齐），但收益只在收获那一刻按当时价结算，机器人**不会择机囤货/清仓**，市场暴涨暴跌对它没有可学习的经营意义。
- AI 自我学习面板能展示的"经营智慧"被抽空——只剩 Q 选种，没有"囤/抛/入库"的权衡。
- 这是 Pixi 与 H5"托管 AI"观感差距最大的地方：原型像个会看行情的小商人，Pixi 像个只会即时结算的收割机。

---

## 五、资源与库存模型

| 维度 | H5 | Pixi |
|------|-----|------|
| 浇水耗料 | `state.water`（与手动共用的农场水池），−10/次 | `res.water`，−4/次 |
| 施肥/保温/排水耗料 | 统一吃 `state.eco`（生态肥）：fert−20、cover−8·、drain−6· | 拆成 `res.eco`(fert) / `res.thermal`(cover) / `res.water`(drain) |
| 种子 | `econ.seedStock`，**播种时**消耗，商店按 `SEED_BATCH=9` 批购（990🪙） | `res.seed`，**收获时**消耗(543，方向反了)，无播种消耗 |
| 商店采购 | **只买种子** | 四种料任一低于阈值都去买，平价 220 补满 |
| 物料上限 | 无显式 cap（大池） | `RES_MAX water120/eco80/thermal50/seed60` |

> Pixi 发明了"保温材料 thermal"这一原型不存在的资源，并把"只补种子"改成了"四料超市"。这让机器人跑商店的频率、采购经济与原型完全不同。**对齐时建议**：回到"水/生态肥两大农场池 + 仅种子可购"的口径，或至少把 thermal 并回 eco。

---

## 六、移动 / 寻路 / 路网

| 维度 | H5 | Pixi | 评价 |
|------|-----|------|------|
| 行进 | 逐路点 `setTimeout`，每段 `dur=max(0.55, d*0.058)*(1+wear*1.2)`（1836） | 每帧连续，`speed=0.0115·wearSlow`(489) | 模型不同但观感等价 |
| 寻路 | Dijkstra（1819–1828） | Dijkstra（622–648） | ✅ 一致 |
| 路网 | 12 地块**四边各细分 SUB=5** + 跨块桥接 BR=5 → 稠密图（1804–1817），或用户自绘 roadNet | 12 停留点 + 站/店/仓共 15 节点，最近 3 邻连边（604–619），或自绘 | Pixi 稀疏，走位较糙 |
| 朝向 | `d>0.4` 时 `atan2`（1838） | `dist>0.001` 时 `atan2`（含像素纵横比校正，486） | ✅ |
| 进建筑隐身 | shop/wh 走 `*_ROAD` 链到门口 → hidden → 1100ms → 原路返回（2016–2033） | `atBuilding` 到点 hidden → workMs → 显形回 decide（506–522） | ✅ 近似 |
| 透视缩放 | `depthScale=clamp(1+(top-72)*0.0188,0.36,1.18)`（2596） | `clamp(1+(top-73)*0.026,0.28,1.5)`（robot.ts 88，已按用户要求加强） | 刻意偏离，保留 |

> 路网稀疏是 CLAUDE.md 待办点名的"稠密路网图"。优先级低，但补上能明显改善巡田走位的真实感。

---

## 七、电量 / 充电（基本对齐 ✅）

| 项 | H5 | Pixi |
|----|-----|------|
| 返回充电阈值 | `battery<14`（1901） | `robotBattery<14`（441） |
| 充电速率 | `max(2, round(7*(1-wear*0.7)))`/tick（1894） | `7*(1-wear*0.7)*dtMS/700`（528） |
| 复工阈值 | `≥60` 停充复工（1896） | `≥60`（work）/`≥100`（idle）（531） |
| 站内待命 | `+2`/tick（1964） | idle 充到 100（531） |
| 作业耗电 | 统一 −3（weed −5），×batMul（cover/drain） | 每任务 3/4/5/9（malign 清除 9）+ **移动期连续 `0.0016*dtMS`** |

> 唯一口径差：H5 移动不耗电、只在执行作业时扣；Pixi 给移动/作业都加了缓慢耗电。属可接受的"更拟真"偏离，但若要严格对齐，应取消移动耗电、改为仅作业扣电。

---

## 八、学习（Q / explore / 阈值）—— 一半对齐

| 项 | H5 | Pixi | 状态 |
|----|-----|------|------|
| 收获 Q 更新 | α=0.25，奖励=price−seed（1685） | 同（708） | ✅ |
| 死亡 Q 惩罚 | α=0.3，pen=−seed（1418） | 同（896–897） | ✅ |
| explore | 0.35→×0.96→下限0.05（1881） | 同（713，282） | ✅ |
| 选种 ev | `0.55*margin+0.45*q` ε-greedy（1860） | 同（286） | ✅ |
| **sellThreshold** | init5，区间[2,9]，按折损/库存自适应（1430） | **无** | 🔴 缺 |
| **storeBias** | init0.5，区间[0.1,0.92]，按仓储盈亏自适应（1433,1718） | **无** | 🔴 缺 |

> 选种学习已完全对齐；**售卖/囤货学习整块缺失**（因第四节经济链未实现）。

---

## 九、衍生 Bug（即时复种 → 闲置税链条失效）

Pixi 的"收获原地即时改种"（710–716）有一条隐性副作用：

- `slowTick`(750–753) 判定地块"是否生产中"用 `slots.some(!dead)`；
- 收获不删 slot、死亡 3.4s 后 `respawn` 也不删 slot —— **田块的 slot 数恒定，永不清空**；
- 于是 `p.idle` 几乎永远被重置为 0，`idle>IDLE_LIMIT(45)` 的地块凑不到 `>7` 块；
- **结论：闲置土地税（aiEconomyTick 818）实际上基本不会触发**，尽管代码完全对齐 H5。

H5 因为有 harvest→空地→till→plant 的真实轮作，地块会经历"空闲"窗口，闲置税才有意义。Pixi 要让闲置税"活过来"，得先把第三节的播种链补上（收获后地块真正清空，等待翻耕+播种）。

---

## 十、视觉 / 模块 / 气泡（低优先）

- H5 `MOD` 映射 15 种任务各自的图标/配色/标签（2654）；Pixi `MOD_FOR`（123–126）只归并到 4 色（water/fert/harvest/patrol）。
- 机器人头顶气泡（电量条 + action）H5 有（151–172）；Pixi 按用户要求**已移除**头顶跟随 UI（不回退）。
- `robotAction` 文案 Pixi 已做近似（move/work/charge 各态）。

---

## 十一、建议的对齐路线图（按价值/成本排序）

> 下列为"建议"，具体做不做、做到哪一步，仍以你的取舍为准（经济链你此前曾选"保持简化"）。

**P0 · 经济链闭环（最大价值，工作量也最大）**
1. 在 `World` 增 `econ:{stock,fresh,wh,whBasis,decay,fee,seedStock}`；`AIState` 补 `sellThreshold/storeBias`（+ 可选 decayLoss/feesPaid/idleTaxPaid/spikeGain 遥测）。
2. `harvestPlot` 改为：成熟株入 `stock`（带 fresh），**不再即时变现**；保留 Q 更新与 +eco 奖励。
3. `slowTick` 增折损（`nf=max(0.3,fresh*(1-decay))`）与仓储费（`round(fee*whN)`），并据此自适应 `sellThreshold/storeBias`（对齐 1430–1434）。
4. `robotDecide` 插入 `sellWh > sell > store` 三分支（条件照 1923–1934）；`execTask` 的 `sell` 改为真实结算、新增 `sellwh/store`。

**P1 · 播种 / 种子链（顺带救活闲置税与轮作）**
5. 任务种类加 `plant`；`harvestPlot` 不再原地改种，收获后地块进入"空闲→翻耕→播种"流程。
6. `plant` 从 `seedStock` 扣种（≤9）、`chooseCrop` 选种、explore 衰减；`buy` 改回"仅在 seedStock<3 且 funds≥990 时买种子批"。
7. 修正 `res.seed` 在收获时被扣的方向错误（应在播种时扣）。

**P2 · 优先级与任务补全**
8. `robotDecide` 顺序对齐 H5：`water > harvest > clear > cover > drain > fert > (sellwh>sell>store) > weed > repair > till > buy > plant`；buy 从最前移到接近末尾。
9. 补 `repair` 任务（`roadDmg||roadWeed>0 && funds≥320`，funds−320，workMs 1900）。
10. `fert` 加门槛 `eco≥20 && rand<0.5`。

**P3 · 细节口径**
11. 资源模型：thermal 并回 eco（或回到 water/eco 两池）；cover/drain 改吃 eco。
12. `wxTaskMod` 天气相位（onset/climax/ending 的 ecoMul/durMul/batMul/ticks）接入 cover/drain。
13. 路网细分+桥接，提升巡田走位真实感；移动耗电改为仅作业扣电（可选）。

---

## 附：关键常量速查（对齐时照抄 H5）

```
AI_START=2500  IDLE_LIMIT=45  IDLE_TAX=44  SEED_BATCH=9  seedBatchCost=110*9=990  破产<-20000→2500
作物 seed/sell：tomato 120/260 · lettuce 80/180 · corn 150/330 · chili 100/220
workMs：weed 1600 · repair 1900 · clear 600 · 其余 720 · 进店 1100
电量：返回<14 · 充电+7(老化降至2) · 复工≥60 · 站内待命+2 · 作业-3(weed-5)
折损 decay∈[0.02,0.12]回归0.05 · 仓储费 fee∈[1,10]回归3 · 新鲜度 nf=max(0.3,fresh*(1-decay))
sellThreshold init5∈[2,9] · storeBias init0.5∈[0.1,0.92]
wantSell：尖峰mk≥1.35 || 库存≥sellTh || 均价≥1.08 || (decay≥0.08&&库存≥2)
wantStore：库存≥4 && 均价<0.95 && storeBias>0.4 && !尖峰
wantSellWh：仓库>0 && (尖峰mk≥1.3 || 均价≥1.08)
Q：收获α0.25(price-seed) · 死亡α0.3(-seed) · explore0.35×0.96↓0.05 · ev=0.55margin+0.45q
市场：drift(1-m)*0.035 · shock±0.17 · 事件26%(45%涨×1.35~2.05 / 55%跌×0.28~0.62) · clamp[0.3,2.8]
wxTaskMod onset{eco0.5,dur0.6,t8,bat0.6} climax{1.8,1.7,3,1.8} ending{0.5,0.5,2,0.5} none{1,1,6,1}
```
