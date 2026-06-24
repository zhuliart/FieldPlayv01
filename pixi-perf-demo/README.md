# FieldPlay · PixiJS(WebGL) 性能验证 DEMO

> 用 **PixiJS v8 + TypeScript + Vite** 1:1 复刻现有 DOM/CSS 原型（`FieldPlay.dc.html`）的**画面与动效**，
> 在**同一部手机**上与 DOM 版对比帧率，验证 WebGL 路线能否消除掉帧。
> 对应任务书：`../FieldPlay_Pixi性能验证DEMO任务书.md`。

**唯一变量 = 渲染方式（DOM/CSS → PixiJS/WebGL）。** 美术、布局、动效观感、舞台尺寸、运动节奏全部对齐原型，
复用仓库根目录同一套 `assets/`（36 背景 / 作物 / 状态 / 杂草），保证对比公平。

---

## 一、快速开始

```bash
cd pixi-perf-demo
npm install
npm run dev        # 开发预览：http://localhost:5173 （手机连同一 WiFi 用电脑 IP 访问）
# 或产出自包含构建（可丢到任意静态服务器 / 手机直接打开）
npm run build      # 类型检查 + 打包 + 自动把 ../assets 拷进 dist/assets
npm run preview -- --host   # 本地预览构建产物
```

> 资源复用：`vite.config.ts` 内置插件在**开发期**用中间件直出 `../assets/**`，**构建期**把整套 `assets/`
> 拷进 `dist/assets/` —— 仓库里**不重复存美术**，画面又与原型同图。

---

## 二、内建测量工具（任务书五 / 六章）

- **右上角 FPS / 内存表**（自实现，基于 Pixi Ticker）：当前 / 平均 / 最低 FPS、帧时(ms)、JS 堆内存(Chrome)、
  在场对象数（株/粒/已解码背景），并画 60 帧 sparkline（含 60 / 30fps 基准线）。
- **左下 HUD 控制面板**：
  - **测量三档**一键切换（切档自动清零最低 FPS，便于按档记录）：
    - **静置**：仅背景 + 静态地块（正午、手动、无巡田）。
    - **常规**：tick 全开、机器人巡田、昼夜推进、偶发天气。
    - **压力**：一键拉满（植株加密 + 连续天气切换 + 机器人巡田 + 粒子齐发 + 昼夜加速）。
  - **经营模式**：手动 / 机器人托管（托管 = 机器人沿巡田路线移动，光池跟随）。
  - **天气切换**：晴 / 阴天 / 小雨 / 暴雨 / 干旱 / 霜冻（触发背景交叉淡入 + 状态叠加）。
  - **昼夜滑块** + 自动推进（驱动 tint 与夜间车灯）。
  - **效果开关**（定位各效果开销）：车灯光池 / 背景交叉淡入 / 粒子 / 昼夜 tint / 杂草·状态叠加 / 作物重打光。
  - **光池混合模式**：`screen`（默认·快）/ `add`（辉光）/ `color-dodge`（严格还原原型）。
  - **压力模式**按钮、全田浇水/施肥手动触发。
- **交互**：点击任意地块 = 浇水（触发水花粒子）。

---

## 三、必须复刻的「重效果」对照（任务书三章）

| 效果 | 原型（DOM，贵） | 本 DEMO（PixiJS/WebGL 做法） | 代码 |
|---|---|---|---|
| **车灯光池** | `mix-blend-mode:color-dodge` + 径向渐变 + `mask`，每帧随机器人移动（整屏重合成） | 把原型两段 CSS 渐变（glow + ellipse mask）**烘焙进单张纹理**，`screen`/`add`/`color-dodge` 混合，按朝向旋转、按景深缩放、夜间按 light 显隐 | `core/textures.ts` `makeLightPoolTexture` · `scene/robot.ts` |
| **背景天气×时段交叉淡入** | 多层全屏图 `opacity` 过渡 | 最多 4 张候选场景按 over 合成做交叉淡入；**只 request 当前+过渡 1–4 张**，闲置即卸载 | `scene/background.ts` · `core/assets.ts OnDemandTextureCache` |
| **昼夜 tint + 夜间车灯** | 半透明叠加层 + filter | 整屏 `multiply`（压暗/偏冷）+ `add`（暖/冷洗）双 Sprite，由 `tod`(0–1) 驱动；外加程序化星空 | `scene/daynight.ts` · `data/scenes.ts dayState` |
| **浇水/施肥粒子** | DOM 节点动画（重排重绘） | `ParticleContainer` + **预分配对象池**（零 GC 抖动），3 容器各 1 draw call | `scene/particles.ts` |
| **杂草/极端天气叠加** | `state/*`、`wd/*` png 叠加 | 全屏状态 Sprite 叠加，帧/透明度随生命周期强度，按需解码 | `scene/weather.ts` |
| **作物生长** | 换 `img src` | 换图集帧（atlas 子纹理），近大远小 + 随生长平滑变大 | `scene/field.ts` |

> 关键认知：这些效果在 DOM 里逼浏览器做昂贵的**合成/重排/重绘**，在 WebGL 里是 GPU 的家常便饭。

---

## 四、性能纪律（任务书五章，已内建）

- **图集合批**：运行时把 20 张 `plant_*.png` 打进一张 atlas（`RenderTexture`），全田作物共享同一 base texture → **1 个 draw call**（控制台日志 `[atlas] 作物图集已打包`）；打包失败自动回退逐张纹理。
- **背景按需解码**：`OnDemandTextureCache` 只热「当前 + 过渡」2–4 张，长期未用即 `Assets.unload` 释放 —— 严禁一次性解码 36 张（iOS Safari 会内存溢出，见原型实测）。
- **对象池 / 避免每帧 new**：粒子预分配复用；纹理一次性生成；逐帧只改 transform/alpha。
- **按设备分辨率选背景尺寸**：`pickBgTier()` 预留多分辨率档接入位（当前仓库仅 1 档实拍图）。
- `resolution = min(devicePixelRatio, 2)` + `autoDensity`，移动端清晰又不过度填充。

---

## 五、舞台与适配（任务书一章）

- 固定 **1280×720 设计舞台**；`fitBoard` 等比缩放铺满视口（`scale=min(W/1280,H/720)`）。
- 移动端竖屏自动 `rotate(90°)` 横屏适配（`scale=min(W/720,H/1280)`），与原型一致。
- 所有图层挂在 `#fp-root` 内，与缩放坐标系一致。

---

## 六、目录结构

```
src/
  data/        baseCorners(12地块) · crops(作物) · scenes(昼夜/天气/背景算法) · tokens(设计令牌)
  core/        stage(fitBoard) · stats(FPS表) · textures(程序化纹理) · assets(图集+按需解码)
  sim/         layout(autoPoints布点) · world(状态+tick假数据驱动)
  scene/       background · field · robot(含光池) · daynight · weather · particles
  ui/          hud(控制面板)
  main.ts      编排图层、ticker、三档预设
```

源算法（`BASE_CORNERS`、`CROPS`、`dayState`、`bgLayers`、`autoPoints`、光池渐变参数等）均从
`../FieldPlay.dc.html` 精确移植，详见各文件头注释。

---

## 七、测量与对比

按 `PERF_RESULTS.md` 的协议，在真机上分别打开本 Pixi 版与 DOM 原型，三档各记录 FPS / 内存 / 首屏。

> 注：在 PC 无头/软件渲染（SwiftShader 无 GPU）下帧率会很低，**不代表真机**；真机 GPU 下差距才显现。

---

## 八、合规（CLAUDE.md 红线）

本 DEMO 仅做**渲染性能验证**：所有数值为**假数据驱动画面**，不涉及真实经济/结算/AI；
不出现写死的业务金额与真实兑换；售价/成本字段仅用于让画面"繁忙"，与人民币/贡献值无关。
