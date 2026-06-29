import { Application, Assets, Container, RenderTexture, Sprite, ColorMatrixFilter, BlurFilter, Texture } from 'pixi.js';
import { STAGE_W, STAGE_H } from './data/baseCorners';
import { installFitBoard } from './core/stage';
import { installPresentation } from './core/presentation';
import { StatsMeter } from './core/stats';
import { PlantAtlas } from './core/assets';
import { av } from './core/assetVer';
import { World } from './sim/world';
import { Background } from './scene/background';
import { Field, setShadowRenderer, type WeedKind } from './scene/field';
import { Robot } from './scene/robot';
import { DayNight } from './scene/daynight';
import { WeatherOverlay } from './scene/weather';
import { Particles } from './scene/particles';
import { Hud, type SceneTier } from './ui/hud';
import { GameHud } from './ui/gameHud';
import { dayState, type WeatherType } from './data/scenes';

async function boot() {
  const root = document.getElementById('fp-root')!;
  const wrap = document.getElementById('fp-wrap')!;
  // 缩放层：只有「画面」(Pixi 画布 + 路网 SVG)放进它、随双击缩放/平移；HUD 菜单留在 #fp-root 只受 fit 缩放
  // → 放大时菜单仍固定可见可点（修复"放大后看不到菜单"）。
  const gameLayer = document.createElement('div');
  gameLayer.id = 'fp-game';
  gameLayer.style.cssText = 'position:absolute; inset:0; width:1280px; height:720px; transform-origin:center center;';
  root.appendChild(gameLayer);

  // —— Pixi 应用（1280×720 逻辑舞台；resolution 跟随 DPR，autoDensity 自适配）——
  const app = new Application();
  await app.init({
    width: STAGE_W,
    height: STAGE_H,
    background: '#9ad3ee',
    antialias: true,
    resolution: Math.min(window.devicePixelRatio || 1, 2),
    autoDensity: true,
    powerPreference: 'high-performance',
    preference: 'webgl',
  });
  // 展示模式 3D 倾斜层：包住画布，承载「立体沙盘」透视变换（不碰 fitBoard 的 translate/scale）
  const depthLayer = document.createElement('div');
  depthLayer.id = 'fp-depth';
  depthLayer.style.cssText = 'position:absolute; inset:0; transform-origin:center center;';
  gameLayer.appendChild(depthLayer);
  depthLayer.appendChild(app.canvas);
  // 清晰度修复：fitBoard 用 CSS scale 把 1280 舞台放大铺满视口，位图画布被放大会糊。
  // 让画布按「实际显示像素」渲染：分辨率 = DPR × 适配缩放（带上限防 4K 过载），随窗口动态调整。
  const DPR = window.devicePixelRatio || 1;
  const RES_CAP = 2.5;
  let curRes = 0;
  installFitBoard(root, gameLayer, (scale) => {
    const res = Math.max(1, Math.min(RES_CAP, +(DPR * scale).toFixed(2)));
    if (Math.abs(res - curRes) > 0.05) {
      curRes = res;
      app.renderer.resolution = res;
      app.renderer.resize(STAGE_W, STAGE_H);
    }
  });

  // 尝试注册高级混合模式（color-dodge 严格还原光池）；失败则保持 screen/add
  let colorDodgeReady = false;
  try {
    await import('pixi.js/advanced-blend-modes');
    colorDodgeReady = true;
  } catch {
    /* 不可用则忽略，用 screen/add 近似 */
  }

  // —— 世界与图集 ——
  const world = new World();
  world.todSpeed = 1 / 60000; // 常规：约 60s 一个昼夜

  // 学习成果强制落盘：页面隐藏(切后台/锁屏)或卸载时存一次，避免节流(每20步)漏掉最后一段学习。
  const flushBrain = () => world.saveBrain();
  document.addEventListener('visibilitychange', () => { if (document.hidden) flushBrain(); });
  window.addEventListener('pagehide', flushBrain);

  const atlas = new PlantAtlas();
  await atlas.build(app.renderer);

  // 写实杂草贴图：只用「有完整生长过程」的三类；其余单图类型待用户补全分阶段后再全量启用。
  // 每类按阶段顺序加载（阶段数可不同，weed_8 为 4 阶段含开花）；缺某张则用同类已加载贴图兜底，整类全失败则丢弃。
  // 野草登记表：分类(田地/野地/恶性) + 尺寸层级 + 蔓延形态 + 可生长区域。习性按真实生态设定，可调。
  // growSec=野地中长到成熟的秒数（各物种不同→错落生长，不一起长大）。
  const WEED_DEFS: (Omit<WeedKind, 'stages' | 'hasWithered'> & { files: string[]; withered?: boolean })[] = [
    // 毛茛：田地类，喜水成片（rule4）
    { files: ['weed_8_baby', 'weed_8_grow', 'weed_8_flower', 'weed_8_mature'], category: 'field', sizeH: 42, growSec: 75, spread: 'patch', inField: true, inWild: true, onRoad: false, nearWater: true },
    { files: ['weed_9_baby', 'weed_9_grow', 'weed_9_mature'], category: 'wild', sizeH: 34, growSec: 95, spread: 'mix', inField: false, inWild: true, onRoad: false, nearWater: false },
    { files: ['weed_10_baby', 'weed_10_baby_grow', 'weed_10_mature'], category: 'wild', sizeH: 34, growSec: 85, spread: 'mix', inField: false, inWild: true, onRoad: false, nearWater: false },
    // 鬼针草：田地类（rule7 随机，可成片可单株）
    { files: ['weed_11_baby', 'weed_11_grow', 'weed_11_flower', 'weed_11_mature'], category: 'field', sizeH: 40, growSec: 110, spread: 'mix', inField: true, inWild: true, onRoad: false, nearWater: false },
    // 蛇莓 Potentilla：田/路/野皆可，匍匐成片、矮（rule5）；缩小40%(26→16)、放慢蔓延(growSec 大)（本轮 rule1）
    { files: ['weed_potentilla_baby', 'weed_potentilla_grow', 'weed_potentilla_growflower', 'weed_potentilla_mature', 'weed_potentilla_withered'], category: 'field', sizeH: 16, growSec: 155, spread: 'patch', inField: true, inWild: true, onRoad: true, nearWater: false },
    // 车前草 Asiatic plantain：主要路上、单株（rule6）；尺寸 = Yellow Dock 的 60%（rule8）
    { files: ['weed_plantain_baby', 'weed_plantain_grow', 'weed_plantain_flower', 'weed_plantain_withered'], category: 'wild', sizeH: 36, growSec: 120, spread: 'single', inField: false, inWild: false, onRoad: true, nearWater: false },
    // Yellow Dock：恶性类，最大≈番茄成熟期（rule8）；田/路/野皆可、快蔓延、抢营养、毁路（rule3）
    { files: ['weed_yellowdock_baby', 'weed_yellowdock_grow', 'weed_yellowdock_flower', 'weed_yellowdock_withered'], category: 'malignant', sizeH: 60, growSec: 90, spread: 'patch', inField: true, inWild: true, onRoad: true, nearWater: false },
    // —— 用户新增写实植物（已归一化 normplant.py → assets/newbg/np{1,2}_*）：4 生长帧(baby→young→before-flower→flower) + dry 枯萎帧 ——
    // 植物① 酸模(高挺单株)：田/野，单株或混生
    { files: ['newbg/np1_0', 'newbg/np1_1', 'newbg/np1_2', 'newbg/np1_3', 'newbg/np1_4'], withered: true, category: 'field', sizeH: 56, growSec: 105, spread: 'mix', inField: true, inWild: true, onRoad: false, nearWater: false },
    // 植物② 蛇莓(矮铺成片，黄花红果)：田/野/路，匍匐簇生
    { files: ['newbg/np2_0', 'newbg/np2_1', 'newbg/np2_2', 'newbg/np2_3', 'newbg/np2_4'], withered: true, category: 'field', sizeH: 24, growSec: 140, spread: 'patch', inField: true, inWild: true, onRoad: true, nearWater: false },
  ];
  const weedKinds = (await Promise.all(
    WEED_DEFS.map(async (def) => {
      const texs = await Promise.all(def.files.map((f) => Assets.load<Texture>(av(`assets/${f}.png`)).catch(() => null)));
      const present = texs.filter((t): t is Texture => !!t);
      if (present.length === 0) return null;
      const { files, withered, ...meta } = def;
      return { ...meta, hasWithered: withered ?? /withered/i.test(files[files.length - 1]), stages: texs.map((t) => t ?? present[present.length - 1]) as Texture[] } as WeedKind;
    }),
  )).filter((x): x is WeedKind => !!x);

  // —— 场景图层 ——
  const background = new Background();
  const weatherOverlay = new WeatherOverlay();
  const field = new Field(atlas, weedKinds, (plotId, xPct, yPct) => {
    if (world.mode === 'manual') {
      if (world.manualTool === 'plant') world.manualPlantPoint(plotId, xPct, yPct); // 种植工具：在落点逐点自定义种植
      else world.manualAction(plotId);
    } else world.burst(plotId, 'water');
  });
  field.buildHitAreas();
  field.rebuild(world);
  setShadowRenderer(app.renderer); // 供阴影系统用 extract 烤「填实软影」贴图（按 crop_stage 缓存）
  const robot = new Robot();
  // 车灯严格还原：color-dodge 强提亮（在黑暗中照亮地面/作物），而非 screen 的白团叠加
  if (colorDodgeReady) robot.setPoolBlend('color-dodge');
  const daynight = new DayNight();
  const particles = new Particles();

  // —— 夜间「被照对象增强」(backdrop ColorMatrix) ——
  // 不画一团光，而是把「被照到的场景(背景+天气+作物)」采样进 RT，做 提亮/对比(清晰度)↑/饱和(色彩)↑/暖化 的增强，
  // 再只透过机器人光照遮罩(柔边 + 噪点溶解)显示出来 → 被照对象本身更亮、更清晰、更艳、更暖（对齐 H5：不直接画灯，而是增强被照对象）。
  const sceneRT = RenderTexture.create({ width: STAGE_W, height: STAGE_H, resolution: Math.min(DPR, 2) });
  const enhanceSprite = new Sprite(sceneRT);
  const enhanceCM = new ColorMatrixFilter();
  enhanceCM.brightness(2.9, false);  // 提亮：再增强约 40%（2.1→2.9），被照作物/地面更亮（乘法，黑处仍黑、不发灰）
  enhanceCM.contrast(0.12, true);    // 清晰度：+12% 对比（Pixi contrast 形参是「增量」，v=amount+1）
  enhanceCM.saturate(0.2, true);     // 饱和 +20%（0.4→0.2 再降，避免夜路砖红/洋红被过饱和成红粉）
  enhanceSprite.filters = [enhanceCM];
  enhanceSprite.tint = 0xf4f2a0;     // 暖黄光：R≈G 高=黄、B 偏低=暖、R 略低于满=进一步压红
  // 滤镜放在精灵上、遮罩放在外层容器上 —— Pixi v8 中「同一对象同时 filter + spriteMask」会冲突导致整层不显示，故分离
  const enhance = new Container();
  enhance.addChild(enhanceSprite);
  enhance.eventMode = 'none';
  enhance.mask = robot.lightMask;    // 只在机器人光照遮罩(柔边+噪点)内显示增强

  // —— 作物全量光影（RT 冠层投影）——
  // 把作物层整体渲到 RT，向右下偏移+压黑+模糊后叠在作物之下：上层叶片剪影落到下层叶片/地面，
  // 密集处底部累积最深(顶亮底暗) → 解决密集作物"只有根部投影、像悬浮"。关则回退每株轻投影。
  const cropShadowRT = RenderTexture.create({ width: STAGE_W, height: STAGE_H, resolution: Math.min(DPR, 2) });
  const cropShadowSprite = new Sprite(cropShadowRT);
  cropShadowSprite.tint = 0x000000;        // 压成黑色冠层剪影
  cropShadowSprite.position.set(8, 16);    // 月在左上 → 冠层投影向右下偏移
  cropShadowSprite.filters = [new BlurFilter({ strength: 4, quality: 2 })]; // 柔化成投影
  cropShadowSprite.eventMode = 'none';

  // z 序（低→高）：背景 → 地面状态/杂草 → 作物冠层投影 → 作物(+机身按y深度排序) → 被照对象增强层 → 灯遮罩 → 昼夜tint(空) → 星空 → 粒子
  app.stage.addChild(background.view);
  app.stage.addChild(weatherOverlay.view);
  app.stage.addChild(cropShadowSprite); // 作物冠层投影(全量光影模式)：在作物之下、地面之上
  app.stage.addChild(field.view);
  field.addActor(robot.bodyView); // 机身放进作物层，按 y 纵深排序 → 走到高作物后会被其遮挡（真实 2.5D 前后关系）
  app.stage.addChild(enhance);
  app.stage.addChild(robot.poolView);
  app.stage.addChild(daynight.view);
  app.stage.addChild(daynight.stars);
  app.stage.addChild(particles.view);

  // 只让地块命中区接收点击，其余层不拦截指针
  for (const v of [background.view, weatherOverlay.view, robot.bodyView, daynight.view, robot.poolView, daynight.stars, particles.view]) {
    v.eventMode = 'none';
  }

  // —— 仪表 & HUD ——
  const stats = new StatsMeter(wrap);

  const setStress = (on: boolean) => {
    world.setStress(on);
    world.todSpeed = on ? 1 / 30000 : 1 / 60000;
    field.rebuild(world); // 压力档加密植株 → 重建精灵
    stats.resetMin();
  };

  const applyTier = (tier: SceneTier) => {
    if (tier === 'idle') {
      setStress(false);
      world.live = false; // 静置：固定正午，不走实时
      world.mode = 'manual';
      world.todAuto = false;
      world.tod = 0.5; // 正午静置
      world.triggerWeather('clear');
    } else if (tier === 'normal') {
      setStress(false);
      world.live = true; // 常规：实时天气 + 农场当地时（原型对齐默认）
      world.mode = 'auto';
      world.todAuto = true;
    } else {
      world.live = false; // 压力档：加速合成时间 + 强制灾害（性能压测）
      world.mode = 'auto';
      world.todAuto = true;
      setStress(true);
    }
  };

  const hud = new Hud(wrap, world, {
    onStressChange: setStress,
    onBlendChange: (mode) => {
      if (mode === 'color-dodge' && !colorDodgeReady) {
        robot.setPoolBlend('screen');
        console.warn('[blend] color-dodge 不可用，回退 screen');
      } else {
        robot.setPoolBlend(mode);
      }
    },
    onResetMin: () => stats.resetMin(),
    onTier: applyTier,
  });

  // 全量 HUD（DOM 叠加，挂在 #fp-root 内随舞台缩放）
  const gameHud = new GameHud(root, gameLayer, world);

  // —— 一键隐藏/显示全部 UI（桌面按 T；移动端三连击屏幕）→ 纯净田地视图，便于观赏/截图 ——
  let hideHint: HTMLDivElement | null = null;
  const toggleUi = () => {
    const hidden = gameHud.toggleUi();
    stats.el.style.display = hidden ? 'none' : '';   // FPS/性能表（右下）
    hud.el.style.display = hidden ? 'none' : '';      // 性能验证面板（压测档/混合模式/重置等）
    if (hideHint) { hideHint.remove(); hideHint = null; }
    if (hidden) { // 隐藏时给一条会自动消失的提示（独立于 HUD，不随其隐藏），告知如何恢复
      const hint = document.createElement('div');
      hint.textContent = '已隐藏界面 · 按 T 或 三连击屏幕 恢复';
      hint.style.cssText = 'position:absolute; top:18px; left:50%; transform:translateX(-50%); z-index:90; background:rgba(20,28,42,.82); color:#eaf2fb; font:700 12px/1 "Noto Sans SC",sans-serif; padding:8px 14px; border-radius:11px; box-shadow:0 4px 12px rgba(0,0,0,.3); pointer-events:none; transition:opacity .5s; opacity:1;';
      root.appendChild(hint);
      hideHint = hint;
      setTimeout(() => { hint.style.opacity = '0'; }, 1400);
      setTimeout(() => { if (hideHint === hint) { hint.remove(); hideHint = null; } }, 1950);
    }
  };
  // —— 大屏展示模式（裸眼 3D 近似）：进入时隐藏 HUD、做立体沙盘透视 + 层间视差；退出时恢复 ——
  // 层间视差：背景(含地面)作固定参考面，作物/天气/粒子等「近层」随视角多位移 → 作物「立起来、浮出地面」的纵深。
  // 捕获各层基准位移(默认 0)后叠加偏移；env→0 时偏移归零 → 关闭即复位、对游戏零影响。
  const baseFX = field.view.x, baseFY = field.view.y;
  const basePX = particles.view.x, basePY = particles.view.y;
  const baseWX = weatherOverlay.view.x, baseWY = weatherOverlay.view.y;
  let hidUiForPresent = false;
  const presentation = installPresentation({
    depthLayer,
    badgeHost: wrap,
    onEnter: () => { if (!gameHud.isUiHidden) { toggleUi(); hidUiForPresent = true; } },
    onExit: () => { if (hidUiForPresent) { toggleUi(); hidUiForPresent = false; } },
    onParallax: (nx, ny) => {
      // 近层反向位移（视角右移 → 近层左移）。位移量随「景深」递增：作物 < 天气 < 粒子
      field.view.x = baseFX - nx * 16; field.view.y = baseFY - ny * 7;
      weatherOverlay.view.x = baseWX - nx * 24; weatherOverlay.view.y = baseWY - ny * 10;
      particles.view.x = basePX - nx * 30; particles.view.y = basePY - ny * 13;
    },
  });

  // 桌面键盘：T=一键隐藏全部 UI；E=单独开关基站 UI；P=大屏展示模式（避开输入框/系统快捷键）
  window.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return; // 不抢系统快捷键
    const tag = (e.target as HTMLElement | null)?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    if (e.key === 't' || e.key === 'T') toggleUi();
    else if (e.key === 'e' || e.key === 'E') gameHud.toggleStation();
    else if (e.key === 'p' || e.key === 'P') presentation.toggle();
  });
  // 移动端：三连击屏幕（同一区域内 3 次快速点按 → 与正常分散的游戏点击区分）
  let taps: number[] = []; let tapX = 0; let tapY = 0;
  root.addEventListener('pointerdown', (e) => {
    const now = e.timeStamp;
    if (taps.length && (now - taps[taps.length - 1] > 500 || Math.abs(e.clientX - tapX) + Math.abs(e.clientY - tapY) > 60)) taps = []; // 超时/移位 → 重新计数
    tapX = e.clientX; tapY = e.clientY;
    taps.push(now);
    if (taps.length >= 3) { taps = []; toggleUi(); }
  }, { capture: true });

  // 默认进入「常规」档
  applyTier('normal');

  document.getElementById('fp-boot')?.remove();

  // —— 黑边「边缘采样补全」：取场景 左右边缘列 在 顶/中/底 的颜色 → 竖向渐变铺满整屏（仅有黑边时启用）——
  // 用「边缘列」而非中线：中线会扫到移动的绿色田块/机器人 → 侧边黑边出现"动画绿光斑"(用户反馈)；
  // 边缘列是天空/远山/草地边等稳定景物 → 渐变稳定、与画面边缘同色、随昼夜变。
  const backdropEl = document.getElementById('fp-backdrop') as HTMLDivElement | null;
  let backdropAcc = 9999;
  const updateBackdrop = () => {
    if (!backdropEl) return;
    const vw = window.innerWidth, vh = window.innerHeight;
    if (Math.abs(vw / vh - STAGE_W / STAGE_H) <= 0.02) { if (backdropEl.style.opacity !== '0') backdropEl.style.opacity = '0'; return; }
    try {
      const c = app.renderer.extract.canvas({ target: app.stage, resolution: 0.08 }) as HTMLCanvasElement;
      const ctx = c.getContext('2d');
      if (!ctx || !c.width || !c.height) return;
      const w = c.width, h = c.height, xl = 1, xr = Math.max(1, w - 2);
      const avg = (f: number) => {
        const y = Math.max(0, Math.min(h - 1, Math.round(h * f)));
        const a = ctx.getImageData(xl, y, 1, 1).data, b = ctx.getImageData(xr, y, 1, 1).data;
        return `rgb(${(a[0] + b[0]) >> 1},${(a[1] + b[1]) >> 1},${(a[2] + b[2]) >> 1})`;
      };
      backdropEl.style.background = `linear-gradient(${avg(0.06)} 0%, ${avg(0.5)} 50%, ${avg(0.94)} 100%)`;
      backdropEl.style.opacity = '1';
    } catch { /* extract/读像素失败 → 保留 #fp-wrap 渐变兜底 */ }
  };

  // —— 主循环 ——
  let sweepFrame = 0;
  app.ticker.add((ticker) => {
    const dtMS = Math.min(50, ticker.deltaMS); // 钳制，避免后台切回大跳

    world.update(dtMS);

    // 先同步粒子开关，再消费本帧爆发
    particles.setEnabled(world.toggles.particles);
    for (const b of world.pendingBursts) {
      if (b.kind === 'water') particles.water(b.plotId);
      else particles.fert(b.plotId);
    }

    background.update(world.tod, world.weather.type as WeatherType, world.bgWeatherIntensity(), world.toggles.bgFade, dtMS);
    weatherOverlay.update(world, dtMS);
    field.update(world, dtMS);
    robot.update(world, dtMS);

    // 作物全量光影：开 → 把作物层渲到 RT 做冠层投影(关每株轻投影避免重复)；关 → 用每株接地轻投影
    const fullShadow = world.toggles.cropFullShadow;
    field.setLightShadows(!fullShadow);
    cropShadowSprite.visible = fullShadow;
    if (fullShadow) {
      field.renderCanopyTo(app.renderer, cropShadowRT);
      cropShadowSprite.alpha = Math.min(0.66, field.shadowStrength * 1.2);
    }

    // 夜间「被照对象增强」：把当前场景(背景+天气+作物)采样进 RT，供 enhance 层透过光照遮罩显示增强版。
    // 仅夜间(light>0.04)且机器人在场时启用 → 白天/隐藏时关闭，零额外开销。
    const litNow = world.toggles.lightPool && dayState(world.tod).light > 0.04 && !world.robot.hidden;
    enhance.visible = litNow;
    if (litNow) {
      app.renderer.render({ container: background.view, target: sceneRT, clear: true });
      app.renderer.render({ container: weatherOverlay.view, target: sceneRT, clear: false });
      app.renderer.render({ container: field.view, target: sceneRT, clear: false });
    }

    daynight.update(world.tod, world.toggles.dayTint, dtMS);
    particles.update(dtMS);
    gameHud.update(dtMS);
    presentation.update(dtMS); // 展示模式立体沙盘透视/缓转/指针视差（关闭时早退、零开销）

    // 边缘补全背景：约每 700ms 刷新（节流）
    backdropAcc += dtMS;
    if (backdropAcc >= 700) { backdropAcc = 0; updateBackdrop(); }

    // 仪表读数
    stats.tick(ticker.deltaMS);
    if ((sweepFrame++ & 31) === 0) {
      stats.setExtra(`株${field.spriteCount} 粒${particles.activeCount} 图${background.decodedCount}`);
      hud.refresh();
    }
  });

  // 调试句柄
  (window as unknown as { __fp: unknown }).__fp = { app, world, field, atlas, particles, stats };
}

boot().catch((e) => {
  console.error(e);
  const boot = document.getElementById('fp-boot');
  if (boot) boot.textContent = '加载失败：' + (e?.message || e);
});
