import { Application } from 'pixi.js';
import { STAGE_W, STAGE_H } from './data/baseCorners';
import { installFitBoard } from './core/stage';
import { StatsMeter } from './core/stats';
import { PlantAtlas } from './core/assets';
import { World } from './sim/world';
import { Background } from './scene/background';
import { Field } from './scene/field';
import { Robot } from './scene/robot';
import { DayNight } from './scene/daynight';
import { WeatherOverlay } from './scene/weather';
import { Particles } from './scene/particles';
import { Hud, type SceneTier } from './ui/hud';
import { GameHud } from './ui/gameHud';
import type { WeatherType } from './data/scenes';

async function boot() {
  const root = document.getElementById('fp-root')!;
  const wrap = document.getElementById('fp-wrap')!;

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
  root.appendChild(app.canvas);
  installFitBoard(root);

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

  const atlas = new PlantAtlas();
  await atlas.build(app.renderer);

  // —— 场景图层 ——
  const background = new Background();
  const weatherOverlay = new WeatherOverlay();
  const field = new Field(atlas, (plotId) => world.burst(plotId, 'water'));
  field.buildHitAreas();
  field.rebuild(world);
  const robot = new Robot();
  const daynight = new DayNight();
  const particles = new Particles();

  // z 序（低→高）：背景 → 地面状态/杂草 → 作物 → 机器人机身 → 昼夜tint → 车灯光池 → 星空 → 粒子
  app.stage.addChild(background.view);
  app.stage.addChild(weatherOverlay.view);
  app.stage.addChild(field.view);
  app.stage.addChild(robot.bodyView);
  app.stage.addChild(daynight.view);
  app.stage.addChild(robot.poolView);
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
      world.mode = 'manual';
      world.todAuto = false;
      world.tod = 0.5; // 正午静置
      world.triggerWeather('clear');
    } else if (tier === 'normal') {
      setStress(false);
      world.mode = 'auto';
      world.todAuto = true;
      world.triggerWeather('clear');
    } else {
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
  const gameHud = new GameHud(root, world);

  // 默认进入「常规」档
  applyTier('normal');

  document.getElementById('fp-boot')?.remove();

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

    background.update(world.tod, world.weather.type as WeatherType, world.weatherIntensity(), world.toggles.bgFade, dtMS);
    weatherOverlay.update(world, dtMS);
    field.update(world);
    robot.update(world, dtMS);
    daynight.update(world.tod, world.toggles.dayTint, dtMS);
    particles.update(dtMS);
    gameHud.update(dtMS);

    // 仪表读数
    stats.tick(ticker.deltaMS);
    if ((sweepFrame++ & 31) === 0) {
      stats.setExtra(`株${field.spriteCount} 粒${particles.activeCount} 图${background.decodedCount}`);
      hud.refresh();
    }
  });

  // 调试句柄
  (window as unknown as { __fp: unknown }).__fp = { app, world, field, particles, stats };
}

boot().catch((e) => {
  console.error(e);
  const boot = document.getElementById('fp-boot');
  if (boot) boot.textContent = '加载失败：' + (e?.message || e);
});
