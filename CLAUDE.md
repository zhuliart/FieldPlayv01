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
- **背景天气强度与玩法解耦（`world.bgWeatherIntensity()`）**：背景层用它、玩法仍用 `weatherIntensity()`。阴天/小雨这类稳态非灾害天气，玩法给柔和 0.6，但**背景必须给满 1.0**——否则 `bgLayers` 会常驻把 40% 的「晴空场景」混进阴云场景里，晴空云团与阴云两套天空错位叠加 → 像两张图重叠发晕（已修）。灾害(雨/旱/霜)背景仍用渐变强度，保留风暴渐起渐消的过渡。**勿把背景强度改回 `weatherIntensity()`**。
- **巡田路网持久化**：`world.ts` 存 `localStorage['fp_pixi_roadnet']`，每次编辑/点保存即落盘，开局优先加载 —— 强刷不丢（对齐 H5 `fp_roadnet`）。
- **野草系统（全 Pixi 原创，H5 无）**：写实 PNG 多类 —— weed_8(毛茛喜水) / 9 / 10 / 11(鬼针草) / potentilla(蛇莓匍匐) / plantain(车前草) / yellowdock(恶性·最大≈番茄)。
  - **尺寸归一化（必看，否则"幼苗发大/越长越小"）**：各阶段(baby→…→mature/withered)按 `relH=0.32+0.68×(i/(N-1))^0.8` 缩到统一画布、底部对齐（脚本见 `scratchpad/weed_norm.cjs`，wheat 同法 `wheat_norm.cjs`）。渲染 `drawWeed` 用 **plantH ÷ stageRel(阶段relH) ÷ 贴图实高** → 换阶段只换形态不跳大小（连续生长）。新草接入务必先归一化。
  - **登记表 `WeedKind`(main.ts `WEED_DEFS`)**：category 田地/野地/恶性 + `sizeH` 尺寸层级(YellowDock 60 / plantain 36 / 蛇莓 16…) + spread patch/single/mix + inField/inWild/onRoad + nearWater + hasWithered。文件名带 `withered` 末帧→hasWithered=真(生长只到成熟、枯萎才显末帧)。
  - **放置**：田内随 `plot.weedProg` 出现(仅 inField 类)；野地散布在田块外地面带(纵 50~99%)，**避开背景树/灌木**(`data/vegMask.ts` 采样 `bg_normal_noon` 64×36 烘焙的 `isBgVeg`)；onRoad 类(车前草/蛇莓/恶性)长路边(到路网线段<3.5%)；喜水类(weed_8)在 `WATER_SRC`(左下水源，**豁免 isBgVeg**)成片。patch 簇生 2~3、single 单株。
  - **生命周期**：生长→成熟→枯萎(倒伏/转黑/缩)。**田内**枯后留黑残株、不自消失→待机器人除草/翻耕(weedProg 清零)清；**野地**枯株保留极长(`DEAD_OPEN`)后原地重生；**路上**枯株淡出(`FADE_ROAD`)后异地重生；**机器人压过** onPath 草→枯死后异地重生。各物种 `growSec` 不同 + 株速/色彩(健康)/方向随机(不齐刷刷)。
  - **恶性草 Yellow Dock**：`world.ts plot.malign(0..100)` 快蔓延+向邻块播散；田里 `malignFactor` 抢营养(作物近乎停长)；malign>55 毁路；机器人「清除恶性草」任务(workMs2800/bat9、优先级高于普通除草、**只压制不根除**→清后回落~22 复发)。
- **投影 / 环境色罩染（`field.ts`+`main.ts`，Pixi 原创）**：
  - **接地定向阴影（默认·写实重写）**：每株野草/作物一枚「彗星」软阴影(`makeShadowTexture` 128×64 水滴贴图：近端浓团=接地 contact、远端渐隐尾=投射 cast；`setShadow` 锚点钉接地点、旋到右下 `SH_ANGLE`、**长随株高/宽随冠幅**、浓随 `SHADOW_CLEARNESS`×昼夜)。**关键：锚点在根、只有尾巴摆向地面 → 接地点不动、不悬浮**。强度天气定向光(晴/晴夜有月=强、阴雨=弱，**夜里不随亮度变弱**，对齐背景树影)；光左上→影右下。1 株 1 精灵、同贴图合批、无每帧 RT → 比旧版更省。**勿改回"对称扁椭圆"或"整层 RT 平移"——会复发悬浮**。
  - **剪影阴影（默认·`SH_MODE='silhouette'`，复用植株贴图作"植株剪影"）**：把通用彗星团升级为带枝叶轮廓的剪影——`setShadow(sh, src, …)` 直接拿植株 Sprite，**复用其当前阶段贴图**(零新增 PNG/纹理内存)：锚点 `copyFrom(src.anchor)` 与根严丝合缝、`tint=SH_SIL_TINT 0x1c241e`(平整冷绿深色→正面色/细节消失只剩轮廓)、**竖向翻转 `scale.y=-|s|×SH_SIL_FLATTEN` 使枝叶从根投向右下地面** + `skew.x=SH_SIL_SKEW`(切变躺地，落地角 θ≈90°−deg(SKEW)≈27°、与 `SH_ANGLE` 同向右下)、`rotation=0`(**不叠加植株休止角/倒伏旋转，否则影子"站起来"**)、alpha×`SH_SIL_ALPHA_K`。**LOD 兜底**：株高<`SH_SIL_MIN_PX`(22px) 的远/小株回退彗星团(模块级 `SHADOW_BLOB`)。**关键几何坑**：scale.y 必须取负翻转——用正值会让剪影直立在根上→复发悬浮(任务书示例代码的正值是 bug，已修正)；θ 由 skew 定、长度由 flatten 定(二者解耦)。透明度仍走 `shadowAlpha` 天气×昼夜模型，方向固定不随昼夜转。`SH_MODE='blob'` 可一键回退到纯彗星团(行为与升级前完全一致)。
  - **环境色罩染**：`ambientTint(lum)` 取代灰度 relight，夜里转冷蓝让贴图融入夜景。
  - **作物全量光影**（性能面板开关 `toggles.cropFullShadow`，**默认关**）：作物层渲到 RT、固定右下平移+压黑+模糊叠在作物之下。**因「整层统一平移」会把阴影连根带冠一起搬走 → 悬浮**，已弃为默认（用户实测"像悬浮在地上"）；仅留作可选重档(每帧多一次 RT+blur、较重)。默认改用上面的每株接地定向阴影。
- **机器人**：头顶跟随气泡已去(与底部状态栏重复)；`robot.ts depthScale` 透视加强(斜率 0.026/下限 0.28)→去商店/仓库(top~45)明显缩小，不再和房子一样大。
- **机器人作业配件模块（`robot.ts drawModule`）**：右侧「机械臂」位按当前任务画专属白色矢量工具图标 + 彩色背板，弃旧的单色方块。`world.ts MOD_FOR` 把 task.kind 映射到 11 类配件：水滴(浇水/排水) / 颗粒肥(施肥) / 篷布(保温) / 收获篮(采收) / 耙(清枯) / 除草剪(除草) / 旋耕齿(翻耕) / 幼苗(播种) / 螺母(修路) / 货箱(买卖入出库) / 闪电(充电待命)。`module` 变化时才重绘(省开销)，夜间随 `bodyView.tint` 一并压暗。
- **移动端触摸坐标（两条铁律，均已真机确认）**：横屏满屏可玩、手动点地块与路网编辑落点精准。
  - **① 不旋转**：`stage.ts fitBoard` 始终「不旋转、等比缩放」。**勿为"竖屏铺满"再加 `rotate(90°)`** —— CSS 旋转会破坏触摸坐标：Pixi 命中用画布「轴对齐」的 `getBoundingClientRect`、不认旋转 → 点地块落点全错（手动模式"点不动、无反馈"）；SVG `getScreenCTM` 在祖先旋转下坍塌 → 节点全堆到画面最左边(x≈0)。竖屏改为「只缩放 + 非阻断提示横屏」(`index.html#fp-rotate-hint`，fitBoard 据 portrait 显隐)。
  - **② 坐标换算用 `getBoundingClientRect`，勿用 `getScreenCTM`**：`gameHud.ts toPct`（路网加/移节点）按 SVG 实际屏幕矩形换算百分比 `left=(clientX-r.left)/r.width*100`。**iOS Safari/WebKit 的 `getScreenCTM` 不计入祖先 HTML 元素的 CSS transform**(`#fp-root` 的 scale) → 即便不旋转，落点也全错、节点堆到左上角天空（这是去掉旋转后仍残留的第二个坑）。`getBoundingClientRect` 各浏览器都返回真实渲染矩形(含 scale/letterbox 偏移)，与 `renderRoad` 的 percent→viewBox 映射一致 → 点哪落哪。Pixi 命中本就用它，故手动点地块在 iOS 正常。
- **移动端双指捏合缩放 + 单指平移（`stage.ts` + 分层）**：
  - **分层**：`main.ts` 在 `#fp-root` 内建 `#fp-game`（画布 + 路网 SVG），捏合的 `zoom+pan` 只作用于 `#fp-game`；HUD 菜单留在 `#fp-root` 仅受 fit 缩放 → **放大时菜单固定可见可点**（修复"放大后看不到菜单"）。`#fp-root=scale(baseScale)`、`#fp-game=translate(pan÷baseScale) scale(zoom)`，净缩放 baseScale×zoom。
  - **双指捏合**（取代旧的双击放大，更自然）：两指张开=放大 / 合拢=缩小复原，**连续无级**变焦；缩放比 = 当前两指间距 ÷ 起始间距 × 起始 zoom，**锚定两指中点的世界点**（`toWorld` 把中点对应的舞台坐标钉住、缩放时反算 pan 让该点始终在中点之下 → 放大对准手指处）。范围 `[ZOOM_MIN=1, ZOOM_MAX=3]`（1=贴合复原、3=上限，手机看细节足够又不过糊/过载）；抬指时 zoom<1.06 则吸附复原归零。捏合需两指(`pts` Map 跟踪多点)，与单指平移/单指操作天然不冲突。`preventDefault+stopPropagation` 吞掉手势避免误触发作业。
  - **单指平移**：放大态(zoom>1)单指拖动画面 → 平移（拖动>8px 激活，`stopPropagation` 吞掉以免误操作）；起点在路网节点(`data-node`)上则不平移、让节点自身拖动。平移上限含「过卷余量」(`clampPan` overX≈0.4W / overY≈0.28H)——让最贴边的地块能再多拖进视口一段，**否则贴边地块卡在屏幕边、被左侧 HUD 面板挡住，表现为"拖不到最左/最右"**（代价是边缘会露出田块外的草地，可接受）。
  - **坐标自洽**：Pixi/SVG 命中都用 getBoundingClientRect（返回叠加变换后的真实屏幕矩形）→ **放大+平移后点击坐标自动仍正确**（无头实测：放大且画布平移后，路网/地块落点仍精确吻合）。`onScale(baseScale×zoom)` 提分辨率(封顶 2.5)→ 放大清晰。
  - **世界锚定浮标**：仓库/商店/基站牌（`.fp-world`）随 `body.fp-zoomed` 隐藏（菜单层不缩放，留着会与放大后的画面错位）。**勿把这些牌或 SVG 移回 `#fp-root` 菜单层，也勿改回 rotate/getScreenCTM**。

### 玉米预制图集 + 衰老模块（`CornPlantView`，仅玉米；其它 4 作物不变）
> 玉米改用美术预制的 **`corn_atlas`（20 帧）** 重做，弃用旧的 `plant_corn_s1..5.png`（已删，git 历史可回溯）。其它作物仍走旧的运行时打包 + 双 Sprite。
- **资源位置**：`assets/corn/corn_atlas.png` + `corn_atlas.json`（随 `assets/**` 被 vite 复制进 `dist/assets/corn/`、经 `av()` 加 `?v=` 失效）；配置 `pixi-perf-demo/src/data/corn_config.ts`（`CORN_FRAMES`/`CORN_STAGE_CONFIG`/`getCornAgingVariant`）。**源图层** `plant_corn_{leaves,trunk,dead_leaves}.png` 移到 `assets-src/corn/`（**不在 `assets/` → 不进 dist**，仅留作可编辑源）。
- **加载（`assets.ts`）**：`buildCorn()` = `fetch(av(json))` + `Assets.load(av(png))` + Pixi `Spritesheet.parse()`；玉米**排除**出运行时打包列表；校验 20 帧齐全(缺帧 `console.error` + 阶段图兜底，**绝不 Texture.WHITE/不崩**)；`getCorn/hasCornFrame/cornAnchor`；`get('plant_corn_sN')` 兼容映射到 `corn_stage_0N`。所有帧共享 atlas 单一 TextureSource。
- **视图（`scene/cornPlant.ts` `CornPlantView extends Container`）**：根钉在 Container 原点(基底 anchor≈0.5,0.98，**用图集锚点、不用旧 `CROP_BOTTOM.corn`**)。`baseA`=当前阶段图、`baseB`=下一阶段(生长交叉淡入)/枯萎主干(枯萎交叉淡入替换阶段图)、`leaves[]`=衰老叠加叶。整株一个 zIndex=y 纵深单位(机器人遮挡正确)；倒伏=Container 旋转(叶随之转)。**无每株 Ticker/RAF**，由 `Field.update()` 驱动。
- **衰老强度 `wither`(0..1)**：`field.ts cornWither()` 由 **Slot 真实状态**算（过熟 age / 缺水 dry / 旱 parch·冻 frost·涝 flood / dead），不脱节。视觉分段：<0.18 纯阶段图(带穗)；0.18~0.55 叠黄叶(不同株不同挂点)；0.55~0.86 阶段图交叉淡出为**主干** + 干/卷叶；≥0.86 主干为主 + 干叶；dead 叠死亡色(冻蓝/烂橄榄/旱褐)。
- **固定个体差异**：选哪些挂点黄化/缺叶、叶型、左右翻转、尺寸/角度抖动、主干变体、倒伏方向，全用 `plantHash(plotId,slotIdx,channel)` → **刷新/重建后同株外观一致**；逐帧逻辑**无 `Math.random()`**。可见叶集仅在枯萎档/阶段跨阈值时重选(不每帧重建)。
- **阴影**：`setShadow` 拆出 `applyShadow(显式 贴图/锚点/缩放/世界坐标…)`——玉米主体在 Container 内(局部 0,0)，必须传 `view.x/y` 根部世界坐标 + 当前主导基底贴图(否则阴影跑到舞台 (0,0))；不随 Container 旋转。标准作物/野草走精灵版 `setShadow` 包装。
- **尺寸**：`CORN_HEIGHT_K=0.72`(field.ts) 把新图(裁了透明边)视觉拉回接近旧玉米；叶 `LEAF_SCALE=0.74`(cornPlant.ts) 防图集大叶过度铺张。**幼苗期/枯萎主干各减半**（用户实测太高）：field.ts 算 `heightPx` 时乘 `seedK`(幼苗 growthCont→0 ×0.5，出苗≥1 平滑回 ×1) 与 `witherK`(随 stemBlend 0.55→0.86 渐缩到 ×0.5)；两者作用于 heightPx → 主干/叶/落叶等比同缩、不squash。**回退**：无；要调观感改这两常量或 `corn_config` 挂点/`cornPlant` 的 WITHER_*/STEM_* 阈值。

### 刻意偏离原型之处（用户明确要求，勿"对齐 H5"改回）
- **作物尺寸放大**：`crops.ts` `PLANT_SIZE` 玉米 1.804 / 番茄 0.99 / 辣椒 0.588（H5 原值 1.64 / 0.66 / 0.42）。**玉米锚点改用图集 anchor + `CORN_HEIGHT_K`，不再用 `CROP_BOTTOM.corn`**（后者仅其它作物用）。
- **小麦走自己的密度/尺寸**：`PLANT_SIZE.wheat 0.85`（矮密谷物，非玉米式大株）+ `DENSITY_CAP.wheat 20`（约 400 株/块密植苗毯，按作物覆盖 `DENSITY_CAP`）+ 接小麦写实图 `plant_wheat_s1..5`。
- **左侧 HUD 整体缩 0.78**：`gameHud.ts`（H5 是 1:1）—— 用户嫌 1:1 盖住田地。
- **野草系统 / 恶性草 / 投影罩染 / 图片缓存失效**：全是 Pixi 原创（H5 无），按用户真实生态需求迭代而成，**勿"对齐 H5"删掉**。习性/尺寸/分类等默认值是合理猜测，可按用户实情调（都是单数值/登记表项）。

### 机器人行为对齐 H5（差距分析 → P0~P3 已落地）
> 完整差距分析见仓库根 `机器人行为差距分析_Pixi对齐H5.md`。以下为已对齐 / 仍未做。
- ✅ **P0 经济链（最大缺口·已补）**：`econ.stock`(带新鲜度 fresh)←收获入库（不再即时变现）→每 tick 折损(`decay`[0.02,0.12])→`store` 入库 `wh`(锁价 `whBasis`、付仓储费 `fee`[1,10])→按 `sellThreshold`[2,9]/`storeBias`[0.1,0.92]/行情尖峰 择机 `sell`/`sellwh`/`store`；折损/仓储盈亏反哺两阈值（移植 H5 1390-1434/1696-1739/1923-1934）。HUD AI 面板加 待售/仓储/折损/阈值 行。
- ✅ **P1 播种/种子链（已补·救活闲置税）**：托管模式 收割→空地(`phase:empty`)→翻耕(`tilled`)→播种(`grow`) 真实轮作；`plant` 任务从 `econ.seedStock` 扣种、`buy` 按 990/9 批购种子；田块真正空置→`idle` 累积→闲置税生效。**手动模式仍原地复种保持繁茂**（无 plant 工具）。收成/种子按「地块单位(封顶 9)」计，与视觉密植(麦 400 株)解耦，避免刷爆库存使售卖阈值失效。渲染：`phase!=='grow'` 复用 fallow 路径露裸土，无需重建精灵池。
- ✅ **P2 优先级 + repair + fert 门槛**：决策顺序对齐 H5（充电>浇水>采收>清枯>保温>排水>施肥>清仓/售/入库>除恶性草/除草>修路>翻耕>买种>播种>(补料)>待命）；新增 `repair`(roadDmg||roadWeed>0 且 funds≥320，-320，workMs1900)；fert 加门槛 `eco≥20 && rand<0.5`。
- ✅ **P3 资源口径 + wxTaskMod + 移动耗电**：资源回到 水/生态肥 双池（thermal 并回 eco，cover/drain 均吃 eco，cover 门 eco≥8）；`wxTaskMod` 天气相位(起势/高潮/消退)缩放 cover/drain 的料/时/电；**移动不耗电、仅作业扣电**（对齐 H5）。
- ✅ **除草死循环修复 + 改种按作物行距**：除草仅针对"在长作物"地块（空地交翻耕清杂，否则空地反复刷草→机器人永远除草不翻耕）；翻耕/播种按"闲置最久"轮替；起始阶段错峰；机器人/手动**改种不同作物时按新作物 `autoPoints` 重排布点**（`world.dirtyPlots`→`field.rebindPlotCrops` 局部重建精灵，不动野草）。

### 手动模式（玩家亲自经营，与托管机器人并行）
- **玩家资源模型 `PlayerRes`**（金币/体力energy/水/生态肥，与机器人 `res`/`ai.funds` 严格分离）。体力**随时间恢复**（≈80s 回满；H5 体力不回血、靠商店补，本版加恢复让手动可持续）。`freshPlayer` coins5000/energy120/water200/eco200。
- **动作门槛（治理"无限刷"）**：`manualAction` 每个工具扣资源、不足即拦截播报 —— 浇水−10水、施肥−15肥−6体力、除草−20体力、清枯−8体力、耕地−12体力、保温/排水−肥、播种−金币(种子成本)。**修复 fert 每点+18growth 秒成熟**：手动施肥改 `fertManual` 一次性 +20growth(约 1/5 阶段)、并受体力+生态肥双门槛 → 点几下不会就成熟。
- **手动收获**→ 成熟株按市价卖出得**金币**(units 封顶9) + 回补少量生态肥；地块**空出**(phase empty)→ 玩家翻耕→播种，与托管同一套 phase 轮作（`clearPlot`/`tillPlot` 已去模式分支、统一 dead→empty / empty→tilled；**取消枯死自动重生**，手动玩家/机器人都清枯补种）。
- **手动播种**：选「种植」工具→底部选种 brush(5作物+种子价)→点空地 `plantManual`，扣金币、按作物密度 `autoPoints` 布点。
- **手动 HUD（补齐"UI 缺失"）**：底部资源条 🪙金币/⚡体力/💧水(+)/🌿生态肥(+)（`buildResChips`，+按钮花金币补给 `refillRes`）；选种 brush（`buildSeedBrush`，仅「种植」工具时显示）；顶部工具条加「🌱种植」。
- **一键隐藏全部 UI（纯净田地视图）**：`GameHud.toggleUi()` 切 `this.root`(整层 HUD)+`svgRoad` 显隐；`main.ts` 里再切 `stats.el`(FPS/性能表)+`hud.el`(性能验证面板) → **连同性能/FPS UI 一起隐藏**。绑桌面 **T 键** / 移动端 **三连击屏幕**（同区域 ≤500ms 内 3 次 pointerdown，与分散的游戏点击区分）。隐藏时弹一条 1.4s 自动淡出的恢复提示（独立于 HUD，不随其隐藏）。**基站 UI（充电站牌 `r.chargeStation`）刻意挂在 `#fp-root`(`this.host`)而非 `this.root` → 一键隐藏时仍保留可见**（用户要求从隐藏中移除）；另有 **E 键单独开关基站 UI**（`GameHud.toggleStation()`）。
- **机器人头部充电进度 UI（`robot.ts drawChargeUi` + `RobotState.charging`）**：`world.ts robotCharge` 置 `robot.charging=true`、`startTask` 离站置 false。充电时机器人头顶显示「气泡+电池条(按 `robotBattery` 填充/分级变色 红<30/黄<70/绿)+充电闪电」，电量变化才重绘；离站 `charging=false` 自动隐藏。

### 学习型机器人大脑（替代固定优先级 robotDecide）+ 按需作业 + 作物健康
- **学习大脑 `BrainState`/`robotBrain`/`candidates`/`learnFromTask`**：每步枚举全部可做的事 → 打分 `U=wValue·收益+wUrgency·紧迫−wPower·耗电+类别偏置` → ε-greedy 择优；动作完成后用「净资产增量 − 耗电」当回报反向更新权重（线性回报回归 + 误差截断 + 权重 clamp[0.05,4]，稳定不发散）。`netWorth=funds+fresh·cropVal(stock)+cropVal(wh)`，目标=最大化它。**优先级不再写死、从学习权重涌现**；距离/载重进入 power 特征 → 就近作业、空载多跑、就近清货更省电。仅保留「电量<12 强制充电」反射兜底。HUD「探索」改读 `brain.eps`（随经验衰减）。
- **学习成果跨会话持久化（`saveBrain`/`loadBrain`，key `fp_pixi_brain`，沿用路网 `fp_pixi_` 前缀 + try/catch）**：只存**学到的策略**（`brain` 全量含权重/动作偏置 `kind`/`densBias`/`eps`/`steps`/`netReward` + `ai.q`/`sellThreshold`/`storeBias`/`explore`），**绝不存 funds/stock/plots 等局面**（那会破坏重置语义）。`BRAIN_SAVE_V` schema 版本（现 v2，结构变更 +1 自动作废旧档；v2=新增情境偏置 `ctxKind`），落盘三时机：`learnFromTask` 末尾每 20 步节流存 + `main.ts` `visibilitychange(hidden)`/`pagehide` 强制 flush（故 `saveBrain` 是 public）。`loadBrain` 在 constructor 的 `freshBrain()/freshAI()` 之后**带校验合并**：版本/结构不符或脏档(乱码/NaN/null) → 逐字段 `Number.isFinite`+clamp 跳过、回落 fresh，**绝不崩、绝不注入 NaN**（`sanitizeBias` 清洗全局偏置、`sanitizeCtx` 逐桶清洗情境偏置）；隐私模式 localStorage 抛错被 try/catch 吞。`resetAll()` 里 `removeItem('fp_pixi_brain')` 清档（照 `resetRoadNet`）→ 重置后不被旧档复活。
- **情境化在线学习（contextual bandit，任务 B 已落地）**：在全局 `brain.kind`（学共性）之外加一张按情境分桶的偏置表 `brain.ctxKind`（学差异）。`contextKey()` 把 电量(<30/<70/≥70) × 载重(`carryFrac`<0.34/<0.8/≥0.8) × 行情(均价<0.95/<1.1/≥1.1) 各分三档 → 情境键如 `b1c2m0`（最多 27 桶、字典稀疏）。`robotBrain()` 打分 `= wValue·value+wUrgency·urgency−wPower·power + kind[ck] + ctxKind[ctx][ck]`；`rPend` 记录决策时 `ctx`，`learnFromTask` 用同一 LMS delta 同时更新全局 `kind` 与情境 `ctxKind[ctx]`（均 clamp[-3,3]）。于是「低电量情境 charge 偏置升高、满载情境 sell/store 偏置升高」是**学**出来的、非写死。**口径**：现在准确表述是「**情境化在线学习**——线性 contextual bandit + ε-greedy + 经验值估计，策略跨会话持久化」；仍**不是** 时序 RL/MDP（无 V(s')/折扣/信用分配）/神经网络，pitch 勿写"强化学习/深度学习"。
- **新经济压力（迫使学习取舍）**：携带上限 `STOCK_CAP=30`（满载收不进 → 必须先卖/入库）；**载货耗电**（作业 ×(1+载重×1.5)、移动按载重计 `CARRY_MOVE_DRAIN`，空载几乎免费）；**种子行情 `seedMkt`** 浮动 → `seedBatchCost` 变价，学习择时低价买种。配合既有 闲置税/折损/仓储费/作物行情 → 学习"何时卖 vs 入库、何时买种、怎么走省电、最大化用地避闲置税"。
- **按需作业（关键修复"反复施肥/浇水"）**：任务按**植物需求 + 天气 + 生长期**设定，不只看玩家体力/库存。`needWater`：**降水(雨/小雨)/霜冻 → 不需要**(作物自得水/休眠)；晴/旱/**阴天**白天有干燥活株 → 需要。`needFert`：仅生长期(growth 60~380)且过了 `FERT_CD=16s` 冷却才需要。**AI 候选按 needWater/needFert 门控**。
- **天气×作物×AI 三者口径必须一致（改前必读）**：`lifeTick` 的「耗水/旱死」与 `needWater` 的「该不该浇」要对齐，否则会出现"某天气不浇水却枯死"。当前口径：**晴=白天全速耗水**；**阴天=白天半速耗水**(`lifeN&1`，蒸发弱但无降水仍会渐干 → 久阴不浇也会渴/枯，故 `needWater` 阴天**不再豁免**、按需浇)；**小雨/雨=降水补水**(dry清零)；**霜冻=休眠不旱死**；**夜间=不耗水不旱死**(与 `needWater` 夜间不主动浇一致)。`DRY_DEATH=[28,32,38,46]` 给足缓冲。**勿把阴天改回"完全不耗水+不浇水"**——那样作物被冻结在水循环外，一旦哪版让阴天耗水就会枯死（用户实测"阴天白天不浇水→枯死"即源于此）。
- **作物健康 `Slot.health`(0..1) + 肥害/涝害**：健康拖慢生长 `×(0.5+0.5·health)`、随时间 +0.04/lifeTick 恢复。手动对"不需要"的地块点浇水/施肥 → **二次确认弹窗 `pendingConfirm`/`confirmManual`/`buildConfirmModal`**；强行执行 55% 概率 `overApplyDamage`（肥害灼伤/涝害涝渍 → 降健康）。AI 因 need 门控不会过量（已按需自律）。

### 种植考核系统（四季 + 行距/时机评分 + 自定义种植点 + AI学习）
- **四季日历**：`world.calDay`/`season()`(0春1夏2秋3冬)。**live 模式按农场真实月份**（南江·上海时），加速模式 `calDay` 合成历推进(一年≈20分钟)。HUD 右下角常驻季节牌；选种 brush 标「✓应季」并淡化非应季。`crops.ts CROP_SEASON` 各作物适播季(番茄/玉米春夏、辣椒夏、生菜春秋、小麦秋冬)。
- **考核评分 `Slot.plantQual`(0.2..1) = 行距评分 × 应季时机**（`assessPlanting`，播种/落点即评）：行距=每株最近邻距 vs `idealGap`(从 autoPoints 理想密度反推、缓存)，**过密→线性惩罚至 0.3**；时机=`seasonFit`(应季1、差1季0.7、差2季0.4)。`plantQual` **持久**，乘进生长速度，并在收获时**缩放产量**(units×avgQ，avgQ=plantQual×健康)。混种时邻居含异种=物理拥挤。
- **自定义种植点（玩家）**：选「🌱种植」工具 → 选种 brush → **点地块落点**即在该处撒一小簇(`manualPlantPoint`，株数 `world.plantBrushN`、按株扣金币)，**可混种**（切 brush 在同块地种不同作物）、密度由点击疏密决定；落点即重评行距。`field.ts onPlotTap` 传回点击 %坐标，`main.ts` 路由 plant 工具→`manualPlantPoint`。收获 `manualHarvest`/`harvestPlot` 改为**按作物分组**入库/变现(支持混种)。
- **种植点可视化 UI（`field.ts plantFx` + `gameHud buildPlantHint`）**：仅手动「种植」工具时显示。① **落点预览光标**：按下/移动(桌面悬停或触摸按住)在触点画作物色预览圈(株数大小)+白芯，松手清除 → 看清"种在哪/几株"；② **已种点位标记**：各活株一颗小点(限量 140 防密集卡顿)；③ **落定脉冲**：种下时一圈扩散环；④ **底部说明条**：`🌱{作物} ×N/簇·应季✓·点地块落点种下` + 「一簇5株/单株精修」切换(`plantBrushN` 5↔1)。预览/标记画在 **`#fp-game` 内的 Pixi 层**(随缩放对齐)。**种植模式下平移/缩放照常可用**：靠手势区分——**点击=种植、拖动=平移(放大态)、双击=缩放**(双击的"近同一点"判定天然区别于"在不同点连续种植")。落点预览在「按下」时出现，**抬手或拖动超 10px(即转为平移)时由 `field.ts` 的 window 监听自动撤销**(独立于 stage 的事件吞掉，避免平移时残留预览圈)。
- **AI 学最优行距**：`plantPlot` 用 `autoPoints(... capBoost+round(brain.densBias))`；收获时按 avgQ 调 `brain.densBias`(过密→种稀、有余→种密) → 学到不挤又不浪费的最优密度。AI 仍单块单作物(按 chooseCrop)，靠学习+应季(seasonFit 进生长)趋于种对。
- **极端天气动画 overlay**（未做）：H5 有屏幕级雨丝/雪/热浪动画，Pixi 仅用 state PNG。
- **HUD 小件**（未做）：政策/罚没卡片、破产徽标、闲置风险徽标 等。（机器人头顶气泡**刻意去掉**，勿加回。）
- **稠密路网图**（暂缓）：H5 细分地块边 SUB=5 + 桥接；Pixi 仍 15 节点最近 3 邻（仅默认网；用户多有自绘持久化网，改默认收益低）。
