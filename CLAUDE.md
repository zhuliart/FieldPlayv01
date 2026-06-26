# CLAUDE.md — 田游智耕 FieldPlay

> 本文件供 Claude Code 每次会话开头自动读取，作为本项目的协作约定。

## 一、项目简介

FieldPlay（田游智耕 · 铁娃子果蔬园）是一款真实天气驱动的农场经营游戏，含两个系统：

- **系统 A · 虚拟农场**：纯虚拟经营游戏，含「手动模拟」与「AI 机器人托管模拟」两种方式，可加速、不涉及真人耕种。
- **系统 B · 真实农场**：游戏 + 真实农田，真实时间/产出/人民币结算，第一期真人执行、后续接入真实机器人。

技术方向：**H5 优先**（前端 React/TS 业务层 + PixiJS/WebGL 渲染农田场景），**服务端权威结算**，已**放弃微信小程序游戏方案**。设计基准为仓库内的高保真原型与说明书。

## 二、沟通与交付约定

- 与用户沟通使用**简体中文**。
- 交付文档默认 **Markdown（.md）** 格式，不用 docx。
- 改动前先看 `CLAUDE.md` 与相关说明书，保持口径一致；不确定先问，不臆造业务数字。

## 三、工程与技术栈

- 前端：Vite + TypeScript + PixiJS（农田场景）/ React（业务与电商 UI）。
- 后端：Node + API，服务端权威结算（资源/经济/生长/托管 AI 均后端计算，客户端乐观更新 + 校正）。
- 资源纪律：背景**按需加载/解码**（只热当前 + 过渡 2–4 张，禁止一次性解码 36 张高清图）；小图打**图集**合批；按设备分辨率选背景尺寸。
- 固定 1280×720 设计舞台 + 等比缩放；自托管字体。

## 四、Git 工作流（每轮任务完成后自动推送并合并 main）

**每完成一轮任务，自动执行以下流程（无需再询问用户）：**

1. **自检**：跑通安全闸门（见下）。
2. **提交**：`git add -A` 后用规范信息提交，例如
   `git commit -m "feat: <本轮做了什么>"`（类型用 feat/fix/chore/docs/refactor 等）。
3. **同步远端**：切到 main 并 `git pull --rebase origin main`，避免落后/冲突。
4. **合并**：
   - 若在任务分支开发：`git checkout main` → `git merge --no-ff <任务分支>`。
   - 若直接在 main 开发：跳过合并，保持 main 线性。
5. **推送**：`git push origin main`。
6. **汇报**：向用户报告**提交哈希 + 改动摘要 + 推送结果**。

### 提交前安全闸门（必须通过才提交）

- 若存在 `build`/`lint`/`test` 脚本，**必须先跑通**；失败则**不提交**，先修复或报告。
- **绝不提交**：密钥、`.env`、`node_modules/`、构建产物（已在 `.gitignore` 覆盖；提交前再确认 `git status` 干净）。

### 冲突与失败处理（红线）

- `pull` / `merge` / `push` 出现**冲突或失败**时：**立即停止、向用户报告，绝不对 main 使用 `--force` 强推或强制覆盖**。
- 涉及历史改写（rebase 已推送内容、reset 远端）前，先征得用户确认。

### 首次配置检查（仓库未就绪时）

- 先 `git remote -v` 确认远端指向正确仓库；未初始化则 `git init`、设置 `origin`、建 `main` 分支后再按上述流程执行。

## 五、合规红线（贯穿所有开发）

- **农业贡献值不可交易**：不可购买、转让、提现、兑换。
- **虚拟金币 ≠ 人民币**，永不互兑；系统 A 虚拟经济与系统 B 真实结算严格分离。
- **不硬编码业务数字**：所有动态数值绑定真实字段/配置，设计稿与代码不出现写死的金额/进度。
- **真实农产品价值不与游戏分数/贡献值折算**；不得宣称"玩游戏即训练真实机器人"。

## 六、相关文档（仓库内 / 交付物）

- 第一期说明书（合并版）、CODE 任务步骤书、双系统产品方案、落地形式分析、H5 与游戏引擎路线分析、Pixi 性能验证 DEMO 任务书。

## 七、Pixi 性能版 DEMO（`pixi-perf-demo/`）现状与约定

> 这是用 PixiJS/WebGL 复刻 DOM 高保真原型的渲染验证版，正与 DOM 基准版做 A/B 观感对比。

### 权威基准
- **`FieldPlay.dc.html`（仓库根，227K）= 唯一权威原型**：React 类组件（`<script data-dc-script>` 行 794–2741 为逻辑 + computed getter，行 ~46–793 为模板，行 14–45 为 CSS；`support.js` 仅是 DC/React 运行时，不含游戏逻辑）。**所有"对齐原型"以此文件逐行为准**，不要凭记忆臆造数值。

### 部署（两个独立站，互不覆盖）
- **Pixi 版** → 域名 `fp.lidoartcenter.com`，目录 `/usr/share/nginx/html/fieldplay-pixi`（阿里云 ECS，Nginx conf.d）。
- **DOM 基准版** → `fieldplay.lidoartcenter.com`，`/usr/share/nginx/html/fieldplay` —— **基准对照，绝不要动**。
- **交付方式**：构建产物打成 `fieldplay-pixi-dist.tar.gz`（仓库根，~48M，已剔除未用的 `crop_*`/`soil.png` 及暂未用的单图杂草 `weed_?.png`/`weed_??.png`）提交进仓库；用户用 **GitHub Desktop 拉取**后上传服务器 `tar xzf … -C /usr/share/nginx/html/fieldplay-pixi`。（用户本机无 Node、CLI git 受限、SendUserFile 链接在其客户端打不开 —— 故走 tar 入库这条路。）每轮改完照 `pixi-perf-demo/` 跑 `npm run build` → 刷新该 tar（打包用 `tar -C` 绝对路径，避免在子目录误生成空壳 tar）。
- **图片缓存失效（必看）**：图片是固定文件名、无内容哈希，部署后浏览器/CDN 会吃旧图（"拉了/传了却看不到变化"的元凶）。已加自动失效：`core/assetVer.ts` 的 `av(url)` 给所有图片 URL 加 `?v=<构建戳>`（vite `define: __ASSET_VER__`），每次构建版本号变→强制取新。验收：部署后 Ctrl+U 看 `assets/index-<hash>.js` 是否为本轮新 hash（JS 主包带哈希、图片靠 ?v=）。

### 关键实现决策（改前必读，勿走回头路）
- **夜间灯光 = "被照对象增强"，不是画一团光**（`main.ts` enhance 层 + `robot.ts` 遮罩 + `textures.ts` 遮罩纹理）：每帧把场景(背景+天气+作物)采样进 RenderTexture，经 `ColorMatrixFilter`（brightness 2.9 / contrast +0.12 / saturate +0.2）+ 暖黄 `tint 0xf4f2a0`，**仅透过机器人光照遮罩**(柔边+噪点溶解、`scale ×1.5`)显示 → 被照的作物/地面更亮/更清晰/更暖。⚠️ 注意 Pixi `contrast(amount)` 形参是增量(v=amount+1)；filter 与 spriteMask **不能放同一对象**（要拆：滤镜在精灵、mask 在外层容器）；遮罩纹理用非预乘会出彩边、过曝 —— 这些坑都踩过，别复发。
- **夜=真实美术**：`daynight.ts` 的 multiply 与 add 整屏 tint **都禁用**（`visible=false`），夜黑全靠夜景底图（对齐 H5 dayOverlay/dayAdd 运行时 `display:none`）。
- **背景兜底底图**：`background.ts` 最底层常驻一张"最近已解码主场景"，并把缓存 grace 提到 600 帧 —— 修了加速档夜间快切露 `#fp-root` 蓝底的蓝屏。
- **巡田路网持久化**：`world.ts` 存 `localStorage['fp_pixi_roadnet']`，每次编辑/点保存即落盘，开局优先加载 —— 强刷不丢（对齐 H5 `fp_roadnet`）。
- **野草系统（全 Pixi 原创，H5 无）**：写实 PNG 多类 —— weed_8(毛茛喜水) / 9 / 10 / 11(鬼针草) / potentilla(蛇莓匍匐) / plantain(车前草) / yellowdock(恶性·最大≈番茄)。
  - **尺寸归一化（必看，否则"幼苗发大/越长越小"）**：各阶段(baby→…→mature/withered)按 `relH=0.32+0.68×(i/(N-1))^0.8` 缩到统一画布、底部对齐（脚本见 `scratchpad/weed_norm.cjs`，wheat 同法 `wheat_norm.cjs`）。渲染 `drawWeed` 用 **plantH ÷ stageRel(阶段relH) ÷ 贴图实高** → 换阶段只换形态不跳大小（连续生长）。新草接入务必先归一化。
  - **登记表 `WeedKind`(main.ts `WEED_DEFS`)**：category 田地/野地/恶性 + `sizeH` 尺寸层级(YellowDock 60 / plantain 36 / 蛇莓 16…) + spread patch/single/mix + inField/inWild/onRoad + nearWater + hasWithered。文件名带 `withered` 末帧→hasWithered=真(生长只到成熟、枯萎才显末帧)。
  - **放置**：田内随 `plot.weedProg` 出现(仅 inField 类)；野地散布在田块外地面带(纵 50~99%)，**避开背景树/灌木**(`data/vegMask.ts` 采样 `bg_normal_noon` 64×36 烘焙的 `isBgVeg`)；onRoad 类(车前草/蛇莓/恶性)长路边(到路网线段<3.5%)；喜水类(weed_8)在 `WATER_SRC`(左下水源，**豁免 isBgVeg**)成片。patch 簇生 2~3、single 单株。
  - **生命周期**：生长→成熟→枯萎(倒伏/转黑/缩)。**田内**枯后留黑残株、不自消失→待机器人除草/翻耕(weedProg 清零)清；**野地**枯株保留极长(`DEAD_OPEN`)后原地重生；**路上**枯株淡出(`FADE_ROAD`)后异地重生；**机器人压过** onPath 草→枯死后异地重生。各物种 `growSec` 不同 + 株速/色彩(健康)/方向随机(不齐刷刷)。
  - **恶性草 Yellow Dock**：`world.ts plot.malign(0..100)` 快蔓延+向邻块播散；田里 `malignFactor` 抢营养(作物近乎停长)；malign>55 毁路；机器人「清除恶性草」任务(workMs2800/bat9、优先级高于普通除草、**只压制不根除**→清后回落~22 复发)。
- **投影 / 环境色罩染（`field.ts`+`main.ts`，Pixi 原创）**：
  - **接地软阴影**：每株野草/作物一枚软椭圆(shadowLayer 在作物层下)，强度随**天气定向光** `SHADOW_CLEARNESS`(晴/晴夜有月=强、阴雨=弱，**夜里不随亮度变弱**，对齐背景树影)；月在左上→影落右下。
  - **环境色罩染**：`ambientTint(lum)` 取代灰度 relight，夜里转冷蓝让贴图融入夜景。
  - **作物全量光影**（性能面板开关 `toggles.cropFullShadow`，默认开）：作物层渲到 RT、右下偏移+压黑+模糊叠在作物之下 → 冠层自投影(顶亮底暗，密集作物不悬浮)；关=每株轻接地阴影。**较重**(每帧多一次 RT+blur)，掉帧就关回轻投影。
- **机器人**：头顶跟随气泡已去(与底部状态栏重复)；`robot.ts depthScale` 透视加强(斜率 0.026/下限 0.28)→去商店/仓库(top~45)明显缩小，不再和房子一样大。

### 刻意偏离原型之处（用户明确要求，勿"对齐 H5"改回）
- **作物尺寸放大**：`crops.ts` `PLANT_SIZE` 玉米 1.804 / 番茄 0.99 / 辣椒 0.588（H5 原值 1.64 / 0.66 / 0.42）。
- **小麦走自己的密度/尺寸**：`PLANT_SIZE.wheat 0.85`（矮密谷物，非玉米式大株）+ `DENSITY_CAP.wheat 20`（约 400 株/块密植苗毯，按作物覆盖 `DENSITY_CAP`）+ 接小麦写实图 `plant_wheat_s1..5`。
- **左侧 HUD 整体缩 0.78**：`gameHud.ts`（H5 是 1:1）—— 用户嫌 1:1 盖住田地。
- **野草系统 / 恶性草 / 投影罩染 / 图片缓存失效**：全是 Pixi 原创（H5 无），按用户真实生态需求迭代而成，**勿"对齐 H5"删掉**。习性/尺寸/分类等默认值是合理猜测，可按用户实情调（都是单数值/登记表项）。

### 待办对齐清单（五份 H5↔Pixi 审计后仍未做）
- **机器人经济链**（最大缺口）：H5 有"库存→折损→仓储→售卖阈值/囤货倾向学习"，Pixi 现为"收获即时卖现金"简化版（用户暂选保持简化）。
- **极端天气动画 overlay**：H5 有屏幕级雨丝/雪/热浪动画，Pixi 仅用 state PNG。
- **HUD 小件**：AI 面板的 待售/仓库/政策/罚没卡片、破产徽标；闲置风险徽标；仓库存量徽标；模式按钮按下阴影 等。（注：机器人头顶气泡已**刻意去掉**，与底部状态栏重复，勿再加回。）
- 机器人若干常量/任务（charge 节流、fert 50% 门、cover/drain 的 wxTaskMod 相位经济、repair/plant 任务、稠密路网图）—— 详见会话审计记录。
