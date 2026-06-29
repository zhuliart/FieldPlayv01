import { Container, Sprite, Graphics, Texture, RenderTexture, type Renderer } from 'pixi.js';
import { PLANT_SIZE, PLANT_SIZE_DEFAULT, CROP_BOTTOM, CROPS, type CropKey } from '../data/crops';
import { STAGE_H, STAGE_W } from '../data/baseCorners';
import { sceneLum, type WeatherType } from '../data/scenes';
import { getQuad, plantHash, pctX, pctY } from '../sim/layout';
import { isBgVeg } from '../data/vegMask';
import { DRY_DEATH, type World, type Slot } from '../sim/world';
import type { PlantAtlas } from '../core/assets';
import { CornPlantView } from './cornPlant';

// 作物代表色（用于种植可视化的预览圈/标记芯）：优先果色、否则叶色
function cropColorOf(crop: CropKey): number {
  const hex = (CROPS[crop]?.fruit || CROPS[crop]?.leaf || '#7ec943').replace('#', '');
  const v = parseInt(hex, 16);
  return Number.isFinite(v) ? v : 0x7ec943;
}

// 植株记录：番茄/生菜/辣椒/小麦走双 Sprite 交叉淡入；玉米走预制图集 CornPlantView（独立叶/主干模块）。
interface PlantRecBase {
  plotId: number;
  slotIdx: number;
  depth: number;
  sizeJit: number;
  restAng: number;
  pdepPct: number;
  // 倒伏随机参数（移植原型 hash(1..4)）：方向 / 占比·延迟 / 最大角 / 倒速
  r1: number;
  r2: number;
  r3: number;
  r4: number;
  curLodge: number; // 当前倒伏角（平滑逼近目标）
  colorVar: number; // 每株自然色彩随机（乘法 tint）：有的更红/橙、有的偏黄绿
  shadow: ShadowRec; // 双层接地阴影（contact 接地 + cast 投射）
}
interface StandardPlantRec extends PlantRecBase {
  kind: 'standard';
  sprite: Sprite;
  sprite2: Sprite; // 下一阶段贴图（按阶段内进度 frac 交叉淡入，平滑形态过渡、消除突变）
}
interface CornPlantRec extends PlantRecBase {
  kind: 'corn';
  view: CornPlantView; // 预制图集玉米视图（阶段图 + 衰老叶/主干模块）
}
type PlantRec = StandardPlantRec | CornPlantRec;

// 玉米株高微调：新图集已裁掉大片透明边（旧图根锚 ~0.835、含留白），同 heightPx 下新图会偏大，
// 故乘一个系数把视觉尺寸拉回接近旧玉米。仅影响玉米，不动其它作物。
const CORN_HEIGHT_K = 0.72;

// 野草类型定义（习性分类 + 尺寸层级 + 蔓延形态 + 可生长区域）。由 main.ts 登记表加载贴图后构造。
export interface WeedKind {
  stages: Texture[];                          // 阶段贴图（baby→…→末，已统一画布归一化）
  category: 'field' | 'wild' | 'malignant';   // 田地类 / 野地类 / 恶性类（标签）
  sizeH: number;                              // 成熟目标高(px)：尺寸层级（Yellow Dock 最大≈番茄）
  growSec: number;                            // 野地长到成熟的秒数（各物种不同→错落生长）
  spread: 'patch' | 'single' | 'mix';         // 成片 / 单株 / 皆可
  inField: boolean;                           // 可长在田里
  inWild: boolean;                            // 可长在野地
  onRoad: boolean;                            // 可长在巡田路上
  nearWater: boolean;                         // 喜水（weed_8）
  hasWithered: boolean;                       // 末阶段是否为枯萎帧 → 生长期只到成熟，枯萎期才显末帧
}

// 水源位置（左下角，% 坐标，与 BASE_CORNERS 同系）—— 喜水野草(weed_8)在此成片密生。要挪改这一处即可。
const WATER_SRC = { x: 9, y: 89 };

// 各天气下「定向光强度」(0..1)：晴（含晴夜有月）→ 强投影；阴雨漫射 → 弱投影。
// 接地阴影强度据此对齐背景植物投影（晴夜背景投影也强，故夜里阴影不随亮度变弱）。
const SHADOW_CLEARNESS: Record<string, number> = { clear: 1, drought: 0.95, frost: 0.58, cloudy: 0.28, lightrain: 0.22, rain: 0.12 };

// 野草生命周期时长(ms)：成熟保持 / 枯萎(大幅延长) / 枯死后保留。按所在位置(田/野地/路)不同。
const W_MATURE = 9000, W_MATURE_RND = 16000;
const WITHER_FIELD = 34000, WITHER_OPEN = 38000, WITHER_ROAD = 24000; // 枯萎时长(大幅延长，rule3)
const DEAD_OPEN = 165000, FADE_ROAD = 12000;  // 野地枯株保留极长后原地重生(rule5)；路上枯株淡出(延长)后异地重生(rule5)
// 归一化时各阶段「植株占画布高」比例(与 weed_norm 脚本同公式)。渲染时补偿换阶段的尺寸跳变 → 连续生长无突变。
function stageRel(stage: number, n: number): number {
  return n > 1 ? 0.32 + 0.68 * Math.pow(stage / (n - 1), 0.8) : 1;
}

// 地块层：12 个可点多边形（点击=浇水）+ 全田作物精灵（共享图集 → 合批）。
// 含逐项移植的「倒伏（lodging）随机机制」与「应激滤镜（旱黄/冻蓝/涝暗/枯褐/过熟褪色）」。
export class Field {
  readonly view = new Container();
  private cropLayer = new Container();
  private hitLayer = new Container();
  private shadowLayer = new Container(); // 投影层（作物层之下、背景之上）：野草/作物的接地软阴影
  private recs: PlantRec[] = [];
  private kinds: WeedKind[] = [];
  private fieldKinds: number[] = []; // 可长在田里的类型索引
  private wildKinds: number[] = [];  // 可长在野地的类型索引
  private roadKinds: number[] = [];  // 可长在路上的类型索引
  // 田内杂草：随 weedProg 出现，出现后走个体生命周期(生长→成熟→枯萎转黑倒伏)，枯后保留为残株待机器人清枯(rule4)
  private weedRecs: { sprite: Sprite; sprite2: Sprite; plotId: number; order: number; appear: number; kind: WeedKind; targetH: number; cur: number; malign: boolean; shadow: ShadowRec; colorVar: number; restAng: number; growMul: number; life: number; phase: number; hold: number; wither: number; lodge: number }[] = [];
  // 野地杂草：田块外按习性长草，有完整生命周期（生长→成熟→枯萎→原地/异地重生）+ 多样性随机
  private wildRecs: { sprite: Sprite; sprite2: Sprite; shadow: ShadowRec; kind: WeedKind; onPath: boolean; bx: number; by: number; sizeJit: number; colorVar: number; restAng: number; growMul: number; cur: number; life: number; phase: number; hold: number; wither: number; lodge: number; pressed: boolean }[] = [];
  private roadNodes: { left: number; top: number }[] = []; // 供野草异地重生时判定 onPath
  private roadEdges: [number, number][] = [];
  private lastShadowAlpha = 0.3; // 当前接地阴影强度（随天气/昼夜），供全量光影冠层投影同步浓度
  private lastRelight = 0xffffff; // 当前环境色罩染（随天气/昼夜），供裸眼3D破框主角株匹配场景光照
  private actor: Container | null = null; // 机器人机身（放进作物层做深度排序；重建时需保留）
  private plantFx = new Graphics(); // 种植可视化：已种点位标记 + 落点预览光标 + 落定脉冲
  private w: World | null = null;   // 缓存最近 world，供指针事件读取（plant 模式判定/选种/株数）
  private previewPt: { x: number; y: number } | null = null; // 落点预览（% 坐标）
  private pdownClient: { x: number; y: number } | null = null; // 按下时的屏幕坐标（判定拖动→平移则撤预览）
  private tapDown: { x: number; y: number } | null = null; // 按下屏幕坐标（点击 vs 拖动判定：拖动=平移、不触发地块操作/种植）
  private pulse: { x: number; y: number; t: number } | null = null; // 落定脉冲（%, 剩余 ms）

  constructor(private atlas: PlantAtlas, kinds: WeedKind[], private onPlotTap: (plotId: number, xPct: number, yPct: number) => void) {
    this.kinds = kinds;
    this.fieldKinds = kinds.map((_, i) => i).filter((i) => kinds[i].inField);
    this.wildKinds = kinds.map((_, i) => i).filter((i) => kinds[i].inWild);
    this.roadKinds = kinds.map((_, i) => i).filter((i) => kinds[i].onRoad);
    if (this.fieldKinds.length === 0) this.fieldKinds = kinds.map((_, i) => i); // 兜底
    if (this.wildKinds.length === 0) this.wildKinds = kinds.map((_, i) => i);
    if (this.roadKinds.length === 0) this.roadKinds = this.wildKinds.slice();
    SHADOW_BLOB = makeShadowTexture();     // 模块级彗星团（投射层 LOD/兜底）
    SH_CONTACT_TEX = makeContactTexture(); // 模块级接地层软暗盘（程序生成、永不失败）
    this.cropLayer.sortableChildren = true; // 作物 + 杂草 + 机器人机身 共用此层，按 y 纵深统一排序
    this.view.addChild(this.shadowLayer); // 投影在最底（背景之上、作物之下）
    this.view.addChild(this.cropLayer);
    this.plantFx.eventMode = 'none';
    this.view.addChild(this.plantFx); // 种植可视化：作物之上、命中层之下（不拦截指针）
    this.view.addChild(this.hitLayer);
    // 落点预览的撤销（window 捕获，独立于 Pixi/stage 的事件吞掉）：抬手清除；拖动>10px(即变成平移)也清除 → 平移期间不残留预览圈
    const clearPreview = () => { this.previewPt = null; this.pdownClient = null; };
    window.addEventListener('pointerup', clearPreview, { capture: true });
    window.addEventListener('pointercancel', clearPreview, { capture: true });
    window.addEventListener('pointermove', (e) => { if (this.previewPt && this.pdownClient && Math.abs(e.clientX - this.pdownClient.x) + Math.abs(e.clientY - this.pdownClient.y) > 10) clearPreview(); }, { capture: true });
  }

  private isPlantMode(): boolean { return !!this.w && this.w.mode === 'manual' && this.w.manualTool === 'plant'; }

  // 种植可视化：已种点位标记(各活株小点) + 落点预览光标(圈+芯) + 落定脉冲(扩散环)。仅手动种植模式绘制。
  private drawPlantFx(world: World, dtMS: number): void {
    const g = this.plantFx; g.clear();
    if (!this.isPlantMode()) { this.previewPt = null; this.pulse = null; return; }
    // 已种点位标记（限量防密集卡顿）：白底小点 + 作物色芯 → 看清在哪儿、多密地种过
    let n = 0;
    for (const p of world.plots) {
      for (const sl of p.slots) {
        if (sl.phase !== 'grow' || sl.dead) continue;
        const mx = pctX(sl.pt.x), my = pctY(sl.pt.y);
        g.circle(mx, my, 3.1).fill({ color: 0xffffff, alpha: 0.4 });
        g.circle(mx, my, 1.7).fill({ color: cropColorOf(sl.crop), alpha: 0.95 });
        if (++n >= 140) break;
      }
      if (n >= 140) break;
    }
    const col = cropColorOf(world.manualSeed);
    if (this.previewPt) { // 落点预览光标：圈(株数大小) + 中心芯
      const px = pctX(this.previewPt.x), py = pctY(this.previewPt.y);
      const rad = Math.max(1, world.plantBrushN) > 1 ? 27 : 13;
      g.circle(px, py, rad).fill({ color: col, alpha: 0.13 });
      g.circle(px, py, rad).stroke({ color: col, width: 2, alpha: 0.92 });
      g.circle(px, py, 3.6).fill({ color: 0xffffff, alpha: 0.95 });
      g.circle(px, py, 2).fill({ color: col, alpha: 1 });
    }
    if (this.pulse) { // 落定脉冲：扩散环
      this.pulse.t -= dtMS;
      if (this.pulse.t <= 0) this.pulse = null;
      else { const k = 1 - this.pulse.t / 620; g.circle(pctX(this.pulse.x), pctY(this.pulse.y), 8 + k * 36).stroke({ color: col, width: 3, alpha: (1 - k) * 0.85 }); }
    }
  }

  private mkShadow(): ShadowRec {
    const cast = new Sprite(SHADOW_BLOB);  // 投射层：初始彗星团，setShadow 里换成剪影/或保持
    cast.anchor.set(SH_ANCHOR_X, 0.5); cast.eventMode = 'none'; cast.visible = false;
    const contact = new Sprite(SH_CONTACT_TEX); // 接地层：居中盖根的软暗盘
    contact.anchor.set(0.5, 0.5); contact.eventMode = 'none'; contact.visible = false;
    this.shadowLayer.addChild(cast, contact); // cast 在下、contact 在上（根部更深）
    return { contact, cast };
  }

  /** 把"演员"(机器人机身)放进作物层，按 zIndex=y 与作物一起纵深排序 → 走到更靠前高作物后会被遮挡（真实 2.5D）。 */
  addActor(c: Container): void {
    this.actor = c;
    this.cropLayer.addChild(c);
  }

  /** 全量光影：把作物层(含野草/机身)渲到 RT，供主程序做冠层投影（上叶投下叶/接地，密集处顶亮底暗）。 */
  renderCanopyTo(renderer: Renderer, rt: RenderTexture): void {
    renderer.render({ container: this.cropLayer, target: rt, clear: true });
  }
  /** 轻投影模式：开=显示每株接地阴影层；全量光影模式下关闭(改用 RT 冠层投影，避免重复)。 */
  setLightShadows(on: boolean): void { this.shadowLayer.visible = on; }
  /** 当前接地阴影强度(随天气/昼夜)。 */
  get shadowStrength(): number { return this.lastShadowAlpha; }
  // 裸眼3D破框主角株用：当前环境色罩(relight)与接地阴影强度 → 主角株跟随场景实时光影
  get relight(): number { return this.lastRelight; }
  get shadowAlpha(): number { return this.lastShadowAlpha; }

  buildHitAreas() {
    this.hitLayer.removeChildren();
    for (let id = 0; id < 12; id++) {
      const q = getQuad(id);
      const pts: number[] = [];
      for (const c of q) pts.push(pctX(c[0]), pctY(c[1]));
      const g = new Graphics();
      g.poly(pts).fill({ color: 0xffffff, alpha: 0.0001 });
      g.eventMode = 'static';
      g.cursor = 'pointer';
      // 点击=种植(种植模式)/作业(其他工具)；种植落点画脉冲。仅「轻点」触发——拖动(平移)从按下到抬起位移大则跳过(Pixi 同地块拖动仍会触发 pointertap，故自行判定)
      g.on('pointertap', (e) => {
        if (this.tapDown && Math.abs(e.clientX - this.tapDown.x) + Math.abs(e.clientY - this.tapDown.y) > 10) return; // 拖动=平移，不触发地块操作/种植
        const lp = e.getLocalPosition(this.hitLayer); const x = (lp.x / STAGE_W) * 100, y = (lp.y / STAGE_H) * 100;
        this.onPlotTap(id, x, y); if (this.isPlantMode()) this.pulse = { x, y, t: 620 };
      });
      // 按下记录屏幕坐标（点击/拖动判定）；种植模式额外显示落点预览光标（清空在 window 监听：抬起/拖动平移都撤销）
      g.on('pointerdown', (e) => {
        this.tapDown = { x: e.clientX, y: e.clientY };
        if (!this.isPlantMode()) return;
        const lp = e.getLocalPosition(this.hitLayer);
        this.previewPt = { x: (lp.x / STAGE_W) * 100, y: (lp.y / STAGE_H) * 100 };
        this.pdownClient = { x: e.clientX, y: e.clientY };
      });
      this.hitLayer.addChild(g);
    }
  }

  // 统一植株记录工厂（rebuild 与 rebindPlotCrops 共用 → 玉米/标准创建逻辑各只写一处）。
  private createPlantRec(plotId: number, idx: number, sl: Slot, pdepPct: number): PlantRec {
    const base = {
      plotId, slotIdx: idx, depth: sl.pt.depth,
      sizeJit: 0.84 + plantHash(plotId, idx, 11) * 0.34,
      restAng: (plantHash(plotId, idx, 12) - 0.5) * 16,
      pdepPct,
      r1: plantHash(plotId, idx, 1), r2: plantHash(plotId, idx, 2), r3: plantHash(plotId, idx, 3), r4: plantHash(plotId, idx, 4),
      curLodge: 0, colorVar: makeColorVar(plotId, idx), shadow: this.mkShadow(),
    };
    if (sl.crop === 'corn') {
      const view = new CornPlantView(this.atlas, plotId, idx);
      view.position.set(pctX(sl.pt.x), pctY(sl.pt.y));
      view.zIndex = sl.pt.y; // 整株作为一个纵深单位与作物/机身按 y 排序
      view.visible = false;
      this.cropLayer.addChild(view);
      return { kind: 'corn', view, ...base };
    }
    const mk = () => {
      const s = new Sprite(this.atlas.get(`plant_${sl.crop}_s1`));
      s.anchor.set(0.5, 0.68);
      s.position.set(pctX(sl.pt.x), pctY(sl.pt.y));
      s.zIndex = sl.pt.y; // 近(下)在前
      this.cropLayer.addChild(s);
      return s;
    };
    return { kind: 'standard', sprite: mk(), sprite2: mk(), ...base };
  }

  rebuild(world: World) {
    this.cropLayer.removeChildren();
    this.shadowLayer.removeChildren();
    if (this.actor) this.cropLayer.addChild(this.actor); // 重建作物时保留机身，否则被 removeChildren 清掉→机器人消失
    this.recs = [];
    this.weedRecs = [];
    // 田内杂草分两池：非恶性田草(weed_8/11/蛇莓) 占绝大多数槽位；恶性草(yellowdock) 仅极少数槽位
    const fieldRegular = this.fieldKinds.filter((i) => this.kinds[i].category !== 'malignant');
    const fieldMalign = this.fieldKinds.filter((i) => this.kinds[i].category === 'malignant');
    for (const p of world.plots) {
      const q = getQuad(p.id);
      const pdepPct = Math.abs(q[2][1] - q[0][1]) || 1;
      p.slots.forEach((sl, idx) => { this.recs.push(this.createPlantRec(p.id, idx, sl, pdepPct)); });
      // 田内杂草：每地块预置 12 株。恶性草仅占固定 2 槽位(k=4/9，低 appearAt→侵染中期才冒出)，其余 10 株全为非恶性田草
      // → 大幅降低恶性草在田里的密度；普通草用密集递进 appear，提高其出现率。
      let regIdx = 0;
      for (let k = 0; this.fieldKinds.length > 0 && k < 12; k++) {
        const wpt = quadPoint(q, 0.1 + plantHash(p.id, k, 21) * 0.8, 0.12 + plantHash(p.id, k, 22) * 0.76);
        const malignSlot = (k === 4 || k === 9) && fieldMalign.length > 0;
        const pool = malignSlot ? fieldMalign : (fieldRegular.length > 0 ? fieldRegular : this.fieldKinds);
        const kind = this.kinds[pool[Math.floor(plantHash(p.id, k, 23) * pool.length) % pool.length]];
        const appear = malignSlot ? (k === 4 ? 12 : 30) : (regIdx++ * 5 + 4); // 恶性: malign>12/>30；普通: weedProg>4,9,14… 密集冒出
        const s = new Sprite(kind.stages[0]);
        s.anchor.set(0.5, 0.99);
        s.position.set(pctX(wpt.x), pctY(wpt.y));
        s.zIndex = wpt.y; // 与作物/机身同层按 y 排序 → 身前的杂草遮挡机器人底部，身后的在其后
        s.visible = false;
        const s2 = new Sprite(kind.stages[0]); // 阶段交叉淡入用（下一阶段）
        s2.anchor.set(0.5, 0.99); s2.visible = false;
        this.cropLayer.addChild(s, s2);
        const sizeJit = 0.8 + plantHash(p.id, k, 24) * 0.5;
        const targetH = kind.sizeH * perspScale(wpt.y) * sizeJit; // 透视：远小近大 + 类型尺寸层级 + 随株大小
        this.weedRecs.push({ sprite: s, sprite2: s2, plotId: p.id, order: k, appear, kind, targetH, cur: -1, malign: kind.category === 'malignant', shadow: this.mkShadow(), colorVar: weedTint(plantHash(p.id, k, 26), plantHash(p.id, k, 27)), restAng: (plantHash(p.id, k, 28) - 0.5) * 22, growMul: 0.7 + plantHash(p.id, k, 25) * 0.8, life: 0, phase: 0, hold: W_MATURE + plantHash(p.id, k, 29) * W_MATURE_RND, wither: 0, lodge: 0 });
      }
    }
    this.buildWildWeeds(world);
  }

  // 野地杂草：在田块之外的地面(田埂/路边/前景空地)按自然习性散布长草。位置避开所有田块四边形，
  // 限定在地面带(纵向 50~99%，避开远山/天空)。贴近巡田路网节点者标 onPath → 经过的机器人会压除。
  private buildWildWeeds(world: World) {
    this.wildRecs = [];
    if (this.kinds.length === 0) return;
    const quads = Array.from({ length: 12 }, (_, i) => getQuad(i));
    const nodes = world.roadNet?.nodes ?? [];
    const edges = world.roadNet?.edges ?? [];
    this.roadNodes = nodes; this.roadEdges = edges; // 存一份供野草异地重生判定 onPath
    const inField = (x: number, y: number) => quads.some((q) => pointInQuad(x, y, q));
    const onPathOf = (x: number, y: number): boolean => {
      for (const [ia, ib] of edges) { const A = nodes[ia], B = nodes[ib]; if (A && B && distToSeg(x, y, A.left, A.top, B.left, B.top) < 3.5) return true; }
      return false;
    };
    // 落单株野草：避开田块/地面带外，按类型尺寸层级与 onPath 设定
    const spawn = (gx: number, gy: number, ki: number, h: number, ignoreVeg = false): boolean => {
      if (gx < 1 || gx > 99 || gy < 50 || gy > 99 || inField(gx, gy) || (!ignoreVeg && isBgVeg(gx, gy))) return false; // 避开田块；默认避开背景树/灌木(喜水水源簇例外)
      const kind = this.kinds[ki];
      const s = new Sprite(kind.stages[0]);
      s.anchor.set(0.5, 0.99);
      s.position.set(pctX(gx), pctY(gy));
      s.zIndex = gy; // 与作物/机身同层按 y 纵深排序
      s.visible = false;
      const s2 = new Sprite(kind.stages[0]); // 阶段交叉淡入用（下一阶段）
      s2.anchor.set(0.5, 0.99); s2.visible = false;
      this.cropLayer.addChild(s, s2);
      // 多样性随机(尺寸/色彩/方向/速度) + 初始生命阶段参差(野地长期无人打理)
      this.wildRecs.push({
        sprite: s, sprite2: s2, shadow: this.mkShadow(), kind, onPath: onPathOf(gx, gy),
        bx: gx, by: gy,
        sizeJit: 0.7 + wildHash(h, 4) * 0.7,
        colorVar: weedTint(wildHash(h, 9), wildHash(h, 10)),
        restAng: (wildHash(h, 11) - 0.5) * 22,
        growMul: 0.7 + wildHash(h, 12) * 0.8,
        cur: -1, life: 0.05 + wildHash(h, 6) * 0.7, phase: 0,
        hold: 4000 + wildHash(h, 8) * 12000, wither: 0, lodge: 0, pressed: false,
      });
      return true;
    };
    // 簇生：以 (cx,cy) 为中心按数量 n 撒同类成簇（n=1 即单株）
    const cluster = (cx: number, cy: number, ki: number, n: number, base: number, ignoreVeg = false) => {
      for (let j = 0; j < n; j++) {
        const h = base * 23 + j;
        spawn(j ? cx + (wildHash(h, 1) - 0.5) * 7 : cx, j ? cy + (wildHash(h, 2) - 0.5) * 4.5 : cy, ki, h, ignoreVeg);
      }
    };
    // 喜水成片（rule4）：水源角附近密集播 nearWater 类(weed_8) 几大簇
    const waterKi = this.kinds.findIndex((k) => k.nearWater && k.inWild);
    if (waterKi >= 0) {
      for (let c = 0; c < 7; c++) {
        const cx = WATER_SRC.x + (wildHash(901 + c, 1) - 0.5) * 22;
        const cy = WATER_SRC.y + (wildHash(901 + c, 2) - 0.5) * 12;
        cluster(cx, cy, waterKi, 5, 901 + c, true); // 喜水成片：水源角(湿地草甸)即使背景有灌木也长 → weed_8 大片
      }
    }
    // 通用散布：patch 类成簇(3~4)、single 单株、mix 1~2（rule5/6/7）
    let placed = this.wildRecs.length;
    for (let a = 1; placed < 130 && a < 800; a++) {
      const gx = 1 + wildHash(a, 1) * 98, gy = 50 + wildHash(a, 2) * 49;
      if (inField(gx, gy)) continue;
      const pool = onPathOf(gx, gy) ? this.roadKinds : this.wildKinds; // 路上用 onRoad 类(车前草/蛇莓/恶性)，开阔野地用 inWild 类
      if (pool.length === 0) continue;
      const ki = pool[Math.floor(wildHash(a, 3) * pool.length) % pool.length];
      const sp = this.kinds[ki].spread;
      const n = sp === 'single' ? 1 : sp === 'patch' ? 2 + Math.floor(wildHash(a, 7) * 2) : 1 + Math.floor(wildHash(a, 7) * 2);
      const before = this.wildRecs.length;
      cluster(gx, gy, ki, n, a);
      placed += this.wildRecs.length - before;
    }
  }

  // 重建单个地块的作物精灵：机器人改种不同作物后按新 autoPoints 布点重排（销毁旧精灵→建新精灵，不触碰野草）。
  private rebindPlotCrops(world: World, plotId: number): void {
    const keep: PlantRec[] = [];
    for (const rec of this.recs) {
      if (rec.plotId === plotId) { // 销毁旧记录的全部显示对象（玉米 Container / 标准双 Sprite）+ 阴影，不留失效引用
        if (rec.kind === 'corn') { this.cropLayer.removeChild(rec.view); rec.view.destroy(); }
        else { this.cropLayer.removeChild(rec.sprite); rec.sprite.destroy(); this.cropLayer.removeChild(rec.sprite2); rec.sprite2.destroy(); }
        this.shadowLayer.removeChild(rec.shadow.contact); rec.shadow.contact.destroy();
        this.shadowLayer.removeChild(rec.shadow.cast); rec.shadow.cast.destroy();
      } else keep.push(rec);
    }
    this.recs = keep;
    const p = world.plots[plotId];
    if (!p) return;
    const q = getQuad(plotId);
    const pdepPct = Math.abs(q[2][1] - q[0][1]) || 1;
    p.slots.forEach((sl, idx) => { this.recs.push(this.createPlantRec(plotId, idx, sl, pdepPct)); });
  }

  update(world: World, dtMS: number) {
    this.w = world; // 缓存供指针事件读取（plant 模式/选种/株数）
    // 机器人改种了不同作物的地块：按新作物布点重建该地块作物精灵（不动野草，避免整田重建闪烁）
    if (world.dirtyPlots.length) {
      for (const id of world.dirtyPlots) this.rebindPlotCrops(world, id);
      world.dirtyPlots.length = 0;
    }
    this.drawPlantFx(world, dtMS); // 种植可视化（已种标记/落点预览/落定脉冲）
    const wx = world.weather.type as WeatherType;
    const lum = world.toggles.cropRelight
      ? sceneLum(world.tod, wx, world.weatherIntensity())
      : 1;
    const relight = ambientTint(lum); // 环境色罩染：白天近中性、夜里转冷蓝 → 与场景融为一体
    // 接地阴影强度对齐背景：随天气「定向光强度」(晴/晴夜强、阴雨弱)，夜里仅轻微减弱（晴夜有月投影仍强）
    const shadowAlpha = (0.2 + 0.52 * (SHADOW_CLEARNESS[wx] ?? 0.5)) * (0.85 + 0.15 * lum);
    this.lastShadowAlpha = shadowAlpha;
    this.lastRelight = relight;
    shadowLum = lum; // 投影模糊度据环境光选档：越亮越锐(见 getSilShadow / SH_CAST_BLUR)

    for (const rec of this.recs) {
      const plot = world.plots[rec.plotId];
      const sl = plot?.slots[rec.slotIdx];
      // 高密度种植 → 根部接地阴影叠加成黑团 → 按地块株数弱化接地层(株越密越弱，保 SH_DENSITY_FLOOR 下限)
      const contactK = plot ? Math.max(SH_DENSITY_FLOOR, Math.min(1, Math.sqrt(SH_DENSITY_NORM / Math.max(1, plot.slots.length)))) : 1;
      if (!sl) { hideShadow(rec.shadow); if (rec.kind === 'corn') rec.view.visible = false; else { rec.sprite.visible = false; rec.sprite2.visible = false; } continue; }
      // 收割后空置 / 翻耕 / 出苗期：隐藏作物，露出裸土（收割→翻耕→播种 轮作过程可见）
      const bare = sl.fallowMS > 0 || sl.phase !== 'grow';
      const growthCont = Math.max(0, Math.min(4, sl.growth / 100));
      const stage = Math.min(4, Math.floor(growthCont));
      const frac = growthCont - stage; // 阶段内进度 0..1
      const upper = Math.min(4, stage + 1);
      const gScale = 0.4 + 0.6 * (growthCont / 4); // 近大远小 + 随生长连续平滑变大（高度连续）

      // —— 玉米：预制图集视图（5 阶段完整图 + 衰老叶；采收后转残茬：主干+落叶）——
      if (rec.kind === 'corn') {
        // 残茬态：收割/清枯后空置(phase==='empty')→ 露枯萎主干 + 落叶满地；其余 bare(翻耕/出苗)仍隐藏露裸土
        const harvested = sl.phase === 'empty' && !sl.dead;
        if (bare && !harvested) { rec.view.visible = false; hideShadow(rec.shadow); continue; }
        rec.view.visible = true;
        const sizeBase = PLANT_SIZE.corn ?? PLANT_SIZE_DEFAULT;
        const wither = harvested ? 1 : cornWither(sl, wx, stage); // 残茬按全枯算(枯萎主干+全落叶)
        // 高度：① 幼苗期(growthCont→0)×0.05 平滑长到 ×1；② 残茬主干 ×0.5（对齐原枯萎主干高度，用户要求保持一致）。
        //  枯萎(站立)期不再压低 → 保持完整株高(枯萎=正常株型+枯黄+枯叶，非变矮的秃秆)。
        const seedK = 0.05 + 0.95 * Math.min(1, growthCont);
        const stubbleK = harvested ? 0.5 : 1;
        const hPct = rec.pdepPct * (sizeBase + 0.18 * rec.depth) * rec.sizeJit * gScale;
        const heightPx = (hPct / 100) * STAGE_H * CORN_HEIGHT_K * seedK * stubbleK;
        const bend = harvested ? 0 : computeBend(sl, wx, stage); // 残茬不再倒伏（已是切株）；其余同标准倒伏
        const durMS = (0.85 + rec.r4 * 1.9) * 1000;
        rec.curLodge += (computeLodgeTarget(bend, rec.r1, rec.r2, rec.r3, sl.dead) - rec.curLodge) * Math.min(1, dtMS / durMS);
        const rotation = ((rec.restAng + rec.curLodge) * Math.PI) / 180;
        // #1 枯黄化(随 wither 渐显)：整株(阶段图)从绿渐染枯黄 → 枯萎=正常株逐渐黄化。
        //   死亡也走枯黄(冻死除外走冷调)——不再乘深褐 deathTintOf(那会把绿叶压成近黑=用户看到的"黑色叠加")。
        const frozen = sl.dead && sl.deathKind === 'frozen';
        let cornBody = frozen ? 0xb9c4d8 : lerpColor(0xffffff, 0xc7a24e, clamp01(wither) * 0.85); // 枯黄渐显(透明度递减)
        // #2 渐进失色(灰化)：深枯萎(>0.85)起，按每株随机量把色调拉向暖灰 → 久枯渐渐褪色发灰
        const cornGray = clamp01((wither - 0.85) / 0.15) * (0.25 + 0.5 * plantHash(rec.plotId, rec.slotIdx, 200));
        cornBody = lerpColor(cornBody, 0x8c847a, cornGray);
        const baseTint = multiplyColor(multiplyColor(multiplyColor(relight, cornStress(sl, wx, stage)), cornBody), rec.colorVar);
        const partTint = (sl.dead || harvested) ? multiplyColor(relight, cornDeathTint(harvested ? 'dry' : sl.deathKind)) : relight; // 主干/落叶：枯黄干色；活株叶用环境光
        rec.view.update({ stage, upper, frac, heightPx, wither, rotation, baseTint, partTint, dead: sl.dead, harvested, gray: clamp01((wither - 0.8) / 0.2) });
        // 阴影：玉米主体在 Container 内(局部 0,0)，故用根部世界坐标 view.x/y + 当前主导基底贴图绘制（不随 Container 旋转）
        applyShadow(rec.shadow, rec.view.baseTex, 0.5, rec.view.baseAnchorY, rec.view.baseScaleX, rec.view.baseScaleY, rec.view.x, rec.view.y, heightPx, Math.abs(rec.view.baseTex.width * rec.view.baseScaleX), shadowAlpha * 0.72, contactK);
        continue;
      }

      // —— 标准作物（番茄/生菜/辣椒/小麦）：双 Sprite 交叉淡入 ——
      const a = rec.sprite, b = rec.sprite2;
      // 小麦·残茬（玉米式）：采收/清枯后空置(phase empty) → 露 drystubble 留茬 + ~30% 株落穗/落叶散布，而非裸土
      if (sl.crop === 'wheat' && bare && sl.phase === 'empty' && !sl.dead) {
        const matureH = (rec.pdepPct * (PLANT_SIZE.wheat + 0.18 * rec.depth) * rec.sizeJit) / 100 * STAGE_H; // 满生长参考高(残茬据此定矮)
        const stub = this.atlas.get('plant_wheat_stubble');
        const stubTint = lerpColor(multiplyColor(relight, rec.colorVar), 0x8c847a, 0.35); // 枯草偏灰
        a.visible = true; a.texture = stub; a.anchor.set(0.5, 0.994); a.rotation = 0;
        a.scale.set(matureH / (stub.height || 1)); a.tint = stubTint; a.alpha = 1;
        const fh = plantHash(rec.plotId, rec.slotIdx, 70);
        if (fh < 0.3) { // ~30% 株落一片穗/叶(躺地随机角)
          const ear = fh < 0.15; const ft = this.atlas.get(ear ? 'plant_wheat_ear' : 'plant_wheat_leaf');
          b.visible = true; b.texture = ft; b.anchor.set(0.5, 0.62);
          b.scale.set((matureH * (ear ? 0.32 : 0.4)) / (ft.height || 1));
          b.rotation = (plantHash(rec.plotId, rec.slotIdx, 71) - 0.5) * 2.4; b.tint = stubTint; b.alpha = 1;
        } else b.visible = false;
        setShadow(rec.shadow, a, matureH * 0.28, a.texture.width * a.scale.x, shadowAlpha * 0.6, contactK);
        continue;
      }
      a.visible = !bare; b.visible = !bare;
      if (bare) { hideShadow(rec.shadow); continue; }

      const sizeBase = PLANT_SIZE[sl.crop] ?? PLANT_SIZE_DEFAULT;
      const hPct = rec.pdepPct * (sizeBase + 0.18 * rec.depth) * rec.sizeJit * gScale;
      const heightPx = (hPct / 100) * STAGE_H;

      // 交叉淡入：下层=当前阶段(alpha 1)，上层=下一阶段(alpha=frac) → 形态平滑过渡，消除"突然变样/突然变大"
      a.texture = this.atlas.get(`plant_${sl.crop}_s${stage + 1}`);
      a.anchor.set(0.5, CROP_BOTTOM[sl.crop][stage] ?? 0.68);
      a.scale.set(heightPx / (a.texture.height || 1));
      b.texture = this.atlas.get(`plant_${sl.crop}_s${upper + 1}`);
      b.anchor.set(0.5, CROP_BOTTOM[sl.crop][upper] ?? 0.68);
      b.scale.set(heightPx / (b.texture.height || 1));

      // —— 倒伏（lodging）：受灾/缺水/过熟/死亡 → bend，方向/幅度/速度/延迟各株不同（两层同步）——
      const bend = computeBend(sl, wx, stage);
      const durMS = (0.85 + rec.r4 * 1.9) * 1000; // 每株倒速 0.85–2.75s（hash4），平滑逼近
      rec.curLodge += (computeLodgeTarget(bend, rec.r1, rec.r2, rec.r3, sl.dead) - rec.curLodge) * Math.min(1, dtMS / durMS);
      const rot = ((rec.restAng + rec.curLodge) * Math.PI) / 180;
      a.rotation = rot; b.rotation = rot;

      // —— 应激滤镜（tint 近似，不破合批）：旱黄 / 冻蓝 / 涝暗 / 枯褐 / 过熟褪色 ——
      let stress = 0xffffff;
      if (sl.dead) {
        // 枯死色：原值偏深(rot 0x5c6b46/旱褐 0x6f5530)，叠夜间暗环境光后近黑、显脏。改用明亮枯草调 →
        // 冻死 浅冷蓝灰 / 烂根 暗橄榄黄(提亮) / 旱·过熟 枯黄褐(提亮) → 像自然干枯而非烧黑。
        stress = sl.deathKind === 'frozen' ? 0xbcc8dc : sl.deathKind === 'rot' ? 0x9aa066 : 0xc2a062;
      } else if (sl.growth >= 400 && sl.age > 5) {
        stress = lerpColor(0xffffff, 0xc9a85a, Math.min(1, (sl.age - 5) / 11) * 0.7);
      } else if (stage < 4) {
        if (wx === 'drought' && (sl.parch > 0 || sl.dry > 0)) stress = 0xe6cb5e;
        else if (wx === 'frost' && sl.frost > 0) stress = 0xbcd6f2;
        else if (wx === 'rain' && sl.flood > 0) stress = 0x9fb58e;
        if (sl.dry > 0) {
          const thr = DRY_DEATH[stage] || 5;
          stress = lerpColor(stress, 0xd8b84a, Math.min(1, sl.dry / thr) * 0.7);
        }
      }
      let tint = multiplyColor(multiplyColor(relight, stress), rec.colorVar);
      // #2 久枯渐进失色(灰化)：死亡/过熟越久 → 按每株随机量把色调拉向暖灰
      const cropGray = (sl.dead ? 0.4 : (sl.growth >= 400 ? clamp01((sl.age - 7) / 12) * 0.45 : 0)) * (0.5 + 0.5 * plantHash(rec.plotId, rec.slotIdx, 200));
      if (cropGray > 0.01) tint = lerpColor(tint, 0x8c847a, Math.min(0.6, cropGray));
      a.tint = tint; b.tint = tint;
      a.alpha = 1;
      // 上层(下一阶段)仅在每阶段最后 30% 才淡入 → 其余 70% 完全只显当前阶段(不透明)，
      // 消除"整株半透明"观感（此前 alpha=frac 让上层贴图常年半透叠在下层上，露出背景而发虚）。
      b.alpha = stage >= 4 ? 0 : Math.max(0, (frac - 0.7) / 0.3);
      // 小麦·站立枯死/过熟（玉米式）：成熟期交叉淡入 dry 真枯图(冻死除外，保留 marture+冷蓝)；不再仅靠 tint 染褐
      if (sl.crop === 'wheat' && stage >= 4) {
        let dryW = 0;
        if (sl.dead && sl.deathKind !== 'frozen') dryW = 1;
        else if (!sl.dead && sl.growth >= 400 && sl.age > 6) dryW = clamp01((sl.age - 6) / 12);
        if (dryW > 0.02) {
          const dryTex = this.atlas.get('plant_wheat_dry');
          b.texture = dryTex; b.anchor.set(0.5, 0.994); b.scale.set(heightPx / (dryTex.height || 1));
          b.rotation = rot; b.tint = lerpColor(multiplyColor(relight, rec.colorVar), 0x8c847a, Math.min(0.4, cropGray)); b.alpha = smooth01(dryW); b.visible = true;
        }
      }
      setShadow(rec.shadow, a, heightPx, a.texture.width * a.scale.x, shadowAlpha * 0.72, contactK); // 作物接地阴影（剪影优先、远小株回退彗星团；高密度根部弱化）
    }

    // —— 杂草：按地块 weedProg 逐株出现(蔓延)，按生长进度换阶段贴图(幼→中→熟)并连续长高；跟随昼夜明暗 ——
    for (const wr of this.weedRecs) {
      const plot = world.plots[wr.plotId];
      const sp = wr.sprite;
      if (!plot) { sp.visible = false; wr.sprite2.visible = false; hideShadow(wr.shadow); continue; }
      const wp = wr.malign ? plot.malign : plot.weedProg; // 恶性株按 malign 出现，普通株按 weedProg
      const appearAt = wr.appear; // 每株自带出现阈值（普通密集递进、恶性低阈值且仅 2 株）
      if (wp <= appearAt) { // 未冒出 / 已被除草翻耕 → 隐藏并复位生命周期
        sp.visible = false; wr.sprite2.visible = false; hideShadow(wr.shadow);
        wr.life = 0; wr.phase = 0; wr.wither = 0; wr.lodge = 0; wr.cur = -1; continue;
      }
      const kind = wr.kind;
      // 个体生命周期：生长→成熟→枯萎；枯死后保留为黑残株(rule4，不自动消失，待机器人清枯/翻耕清除)
      if (wr.phase === 0) { wr.life += dtMS / (kind.growSec * wr.growMul * 1000); if (wr.life >= 1) { wr.life = 1; wr.phase = 1; } }
      else if (wr.phase === 1) { wr.hold -= dtMS; if (wr.hold <= 0) wr.phase = 2; }
      else if (wr.phase === 2) { wr.wither += dtMS / WITHER_FIELD; if (wr.wither >= 1) { wr.wither = 1; wr.phase = 3; } }
      const lodgeTarget = wr.phase >= 2 ? 52 * Math.min(1, wr.wither) : 0; // 枯萎渐渐倒伏
      wr.lodge += (lodgeTarget - wr.lodge) * Math.min(1, dtMS / 800);
      drawWeed(sp, wr.sprite2, wr.shadow, kind, wr.targetH, wr.life, wr.phase, wr.wither, wr.lodge, wr.restAng, wr.colorVar, relight, shadowAlpha, 1);
    }

    // —— 野地杂草生命周期：生长→成熟→枯萎(倒伏/转黑/缩)→枯死。野地枯株保留极长后原地重生(rule5)；
    //    路上枯株淡出(延长)后异地重生(rule5)；被机器人压过的路草进入枯萎并死后异地(rule4) ——
    const rob = this.actor && this.actor.visible && this.actor.x > 0 ? this.actor : null;
    for (const wr of this.wildRecs) {
      const kind = wr.kind, sp = wr.sprite;
      if (rob && wr.onPath && wr.phase < 2 && Math.hypot(rob!.x - sp.x, rob!.y - sp.y) < 50) { wr.phase = 2; wr.pressed = true; }
      let fade = 1;
      if (wr.phase === 0) { wr.life += dtMS / (kind.growSec * wr.growMul * 1000); if (wr.life >= 1) { wr.life = 1; wr.phase = 1; } }
      else if (wr.phase === 1) { wr.hold -= dtMS; if (wr.hold <= 0) wr.phase = 2; }
      else if (wr.phase === 2) { // 枯萎(大幅延长)：路上较快、野地较慢
        wr.wither += dtMS / (wr.onPath ? WITHER_ROAD : WITHER_OPEN);
        if (wr.wither >= 1) { wr.wither = 1; wr.phase = 3; wr.hold = wr.onPath ? FADE_ROAD : DEAD_OPEN; } // 枯死后保留计时
      } else { // phase 3 枯死保留
        wr.hold -= dtMS;
        if (wr.onPath) fade = Math.max(0, wr.hold / FADE_ROAD);                 // 路上：缓慢淡出(延长)
        else if (wr.hold < 9000) fade = Math.max(0, wr.hold / 9000);            // 野地：保留极久，末段才淡出
        if (wr.hold <= 0) { // 重生：路上异地、野地原地
          if (wr.onPath) { const ns = this.randomWildSpot(); if (ns) { wr.bx = ns.x; wr.by = ns.y; wr.onPath = ns.onPath; sp.position.set(pctX(ns.x), pctY(ns.y)); sp.zIndex = ns.y; } }
          wr.life = 0; wr.phase = 0; wr.wither = 0; wr.pressed = false; wr.lodge = 0; wr.cur = -1;
          wr.hold = W_MATURE + Math.random() * W_MATURE_RND;
          wr.sizeJit = 0.7 + Math.random() * 0.7; wr.growMul = 0.7 + Math.random() * 0.8;
          wr.colorVar = weedTint(Math.random(), Math.random()); wr.restAng = (Math.random() - 0.5) * 22;
        }
      }
      const lodgeTarget = wr.phase >= 2 ? (wr.pressed ? 82 : 50) * Math.min(1, wr.wither) : 0;
      wr.lodge += (lodgeTarget - wr.lodge) * Math.min(1, dtMS / 800);
      const targetH = kind.sizeH * perspScale(wr.by) * wr.sizeJit; // 透视：远小近大（动态，随重生位置更新）
      drawWeed(sp, wr.sprite2, wr.shadow, kind, targetH, wr.life, wr.phase, wr.wither, wr.lodge, wr.restAng, wr.colorVar, relight, shadowAlpha, fade);
    }
  }

  // 为被压枯死的野草找一个开阔野地(非田块/非背景植被/非路)的重生点
  private randomWildSpot(): { x: number; y: number; onPath: boolean } | null {
    for (let t = 0; t < 24; t++) {
      const x = 1 + Math.random() * 98, y = 50 + Math.random() * 49;
      let bad = isBgVeg(x, y);
      for (let i = 0; !bad && i < 12; i++) if (pointInQuad(x, y, getQuad(i))) bad = true;
      for (const [ia, ib] of this.roadEdges) { const A = this.roadNodes[ia], B = this.roadNodes[ib]; if (A && B && distToSeg(x, y, A.left, A.top, B.left, B.top) < 3.5) { bad = true; break; } }
      if (!bad) return { x, y, onPath: false };
    }
    return null;
  }

  get spriteCount(): number {
    return this.recs.length;
  }
}

// 环境色罩染：按昼夜给作物/野草统一的环境光乘法色 —— 白天近中性、夜里转冷蓝，让贴图融入场景而非"贴上去"。
function ambientTint(lum: number): number {
  const b = 0.32 + 0.68 * lum;               // 基础明度（同原 relight 灰度）
  const night = 1 - Math.min(1, lum / 0.5);  // 0(昼)..1(夜)
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v * 255)));
  return (c(b * (1 - night * 0.20)) << 16) | (c(b * (1 - night * 0.08)) << 8) | c(b * (1 + night * 0.12));
}
// 透视：野草按所在纵向位置(y%)缩放 —— 远(上,y小)显著小、近(下,y大)大，正向对齐背景纵深（消除远近一样大）。
function perspScale(yPct: number): number {
  const t = Math.max(0, Math.min(1, (yPct - 46) / 52)); // 46%(远)..98%(近)
  return 0.4 + 1.15 * Math.pow(t, 1.15);
}
// 野草健康/色彩随机（乘法 tint）：偏黄绿(健康) / 偏枯褐(不健康) / 中性微暖
function weedTint(h: number, s: number): number {
  const amt = 0.10 + s * 0.16;
  let r = 1, g = 1, b = 1;
  if (h > 0.66) { r = 1 - amt * 0.15; g = 1 - amt * 0.5; b = 1 - amt; }   // 偏枯黄褐
  else if (h < 0.4) { r = 1 - amt * 0.5; b = 1 - amt * 0.5; }             // 偏黄绿
  else { b = 1 - amt * 0.4; }                                             // 中性微暖
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v * 255)));
  return (c(r) << 16) | (c(g) << 8) | c(b);
}
// —— 接地定向阴影（写实化重写）——
// 旧版"整株按株高画一枚对称扁椭圆、略偏右下"无法表达"接地点不动、影子只把尾巴甩向地面"，
// 配合默认的 RT 整层平移更显悬浮。现：每株一枚"彗星"软阴影——近端浓团贴根=接地(contact AO)，
// 主体沿固定光向(左上→右下，匹配背景烘焙树影)延展=投射(cast)；长随株高(越高影越长)、宽随冠幅、浓随天气/昼夜。
// 锚点钉在浓团(接地点) → 旋转/缩放时根部不动，只有远端尾巴摆向地面，从根本上消除"悬浮"。
const SH_TEX_W = 128, SH_TEX_H = 64;
const SH_ANCHOR_X = 0.22;  // 浓团(接地点)在贴图长轴 22% 处：少量在根后(软接地)、多数向光背面延展
const SH_ANGLE = 0.42;     // 投射方向(rad,≈24°)：右下对角，匹配背景树影方向
const SH_FOOT = 0.46;      // 渲染宽→实际冠幅(贴图含透明边，打折)
const SH_WID = 0.92;       // 冠幅→阴影宽
const SH_LEN_BASE = 0.6;   // 冠幅→基础长(矮株也有接地团)
const SH_LEN_H = 0.5;      // 株高→附加长度(高株投影更长)

// —— 剪影阴影（P0：复用植株自身贴图作"植株剪影"，零新增美术/纹理内存）——
// 把植株当前阶段贴图乘平整深色→正面色/细节消失只剩枝叶轮廓；竖向翻转(scale.y 取负)使枝叶从根部投向右下地面、
// 再压扁(FLATTEN)铺展、沿固定光向切变(SKEW)躺地。比通用水滴团多了"枝叶形状"，且根部直接拷植株锚点 → 不悬浮。
// —— 双层接地阴影（v2）：接地层(contact/AO，钉住植株不悬浮) + 投射层(cast，朝光向拉出、根深尖淡) ——
const SH_MODE: 'silhouette' | 'blob' = 'silhouette'; // 投射层形态；'blob' = 投射层也用彗星团(不烤剪影)
const SH_TINT = 0x1c241e;     // 平整深色(偏环境冷绿、非纯黑)：两层共用
const SH_SIL_MIN_PX = 22;     // 株高(px)阈值：低于此只画接地层、跳过投射层 → 省+干净，兼作 LOD
const SH_SIL_DS = 0.5;        // 烤制投射剪影的降采样(便宜+放大更软)
// 接地层(根部 AO 浓团)
const SH_CONTACT_W = 0.62;    // 接地盘直径 / 冠幅(>茎基、包住四周)
const SH_CONTACT_SQUASH = 0.55; // 竖向压扁成椭圆(俯视地面)
const SH_CONTACT_ALPHA = 1.0; // 接地层最深(× shadowAlpha)
// 投射层(冠层剪影/彗星团)
const SH_CAST_FLATTEN = 0.50; // 纵向压扁(控制投射长度)
const SH_CAST_WIDEN = 1.05;   // 横向略加宽(防细条)
const SH_CAST_SKEW = 0.40;    // 切变(rad)：躺向地面、与 SH_ANGLE 同向(右下)、不随昼夜转
const SH_CAST_ALPHA = 0.55;   // 投射层比接地层浅
// 投射剪影模糊度：按环境光分 3 档(暗/中/亮) → 越亮越锐(硬光锐影、漫射软影)；整体已大幅下调(原 0.035 → 0.010~0.022 不再糊)
const SH_CAST_BLUR = [0.022, 0.015, 0.010] as const; // [暗, 中, 亮] 模糊占贴图宽比例
// 高密度种植(如小麦密植)根部接地阴影叠加成黑团 → 按密度弱化接地层 alpha，避免"作物悬浮在黑色上"
const SH_DENSITY_NORM = 24;   // "正常密度"基准(株/地块)：高于此启用根部投影弱化
const SH_DENSITY_FLOOR = 0.20; // 弱化下限(再密接地层也保留 20% → 仍有接地感、不全黑)；小麦(~400株/块) contactK≈0.24
let shadowLum = 1;            // 当前环境光(0夜..1正午)：field.update 每帧设；投影模糊度据此选档
// 共享彗星团贴图 + 接地层贴图(模块级，程序生成、永不失败)；在 Field 构造里赋值。
let SHADOW_BLOB: Texture;
let SH_CONTACT_TEX: Texture;
// 接地层软径向盘：中心最深→边缘透明。用「白底 + alpha 渐变」→ 这样 setShadow 的 tint=SH_TINT 才能上色
// (纯黑底被 tint 乘仍是黑 → 失去"非纯黑"环境冷绿调)。竖向压扁在 setShadow 里用 scale 控制。
function makeContactTexture(): Texture {
  const S = 96;
  const cv = document.createElement('canvas'); cv.width = S; cv.height = S;
  const ctx = cv.getContext('2d')!;
  const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0, 'rgba(255,255,255,0.95)');
  g.addColorStop(0.45, 'rgba(255,255,255,0.55)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, S, S);
  return Texture.from(cv);
}
type ShadowRec = { contact: Sprite; cast: Sprite };
function hideShadow(sh: ShadowRec) { sh.contact.visible = false; sh.cast.visible = false; }

// —— 预烤「膨胀填实 + 模糊」阴影贴图，按源贴图(Texture 引用 = 每作物每阶段唯一)缓存，全场共享、只烤一次 ——
// 上一版直接拿植株 alpha 当剪影：细叶(玉米/小麦)压扁切变后散成一把斜丝(叶间空隙原样透出)。
// 真实接地软影应「填实」：先膨胀闭合叶间空隙 → 模糊软边 → 染平深色，只留外轮廓。
let shadowRenderer: Renderer | null = null;
export function setShadowRenderer(r: Renderer) { shadowRenderer = r; } // main.ts 在 app 初始化后调用一次
// 按 [源贴图 → 各光照档烤图] 缓存：每 crop_stage × 每光照档只烤一次（≤3 档 → 全场仍只几十~百来张小图）
const silShadowCache = new Map<Texture, Texture[]>();
export function clearSilShadowCache() { for (const arr of silShadowCache.values()) for (const t of arr) { try { t?.destroy(true); } catch { /* ignore */ } } silShadowCache.clear(); }
function silBlurBucket(lum: number): number { return lum > 0.66 ? 2 : lum > 0.33 ? 1 : 0; } // 亮→2(锐)/中→1/暗→0(软)
function getSilShadow(srcTex: Texture): Texture | null {
  const bucket = silBlurBucket(shadowLum);
  const arr = silShadowCache.get(srcTex);
  if (arr && arr[bucket]) return arr[bucket];
  if (!shadowRenderer) return null; // 渲染器未就绪 → 走彗星团兜底
  try {
    // 用 extract 取该帧像素（兼容 atlas/RenderTexture/预制图集 等所有来源，无需各自判断 .resource）
    const tmp = new Sprite(srcTex);
    const baseCv = shadowRenderer.extract.canvas(tmp) as HTMLCanvasElement;
    try { tmp.destroy(); } catch { /* ignore */ }
    if (!baseCv || !baseCv.width || !baseCv.height) return null;
    const sw = Math.max(8, Math.round(srcTex.width * SH_SIL_DS));
    const shh = Math.max(8, Math.round(srcTex.height * SH_SIL_DS));
    const cv = document.createElement('canvas'); cv.width = sw; cv.height = shh;
    const ctx = cv.getContext('2d'); if (!ctx) return null;
    const bw = baseCv.width, bh = baseCv.height;
    // (1) 膨胀填实：源帧在一圈小偏移上叠绘 → 闭合叶间空隙(够闭合即可、别糊：R/STEPS/alpha 都收小)
    const R = Math.max(2, Math.round(sw * 0.025)), STEPS = 8;
    ctx.globalAlpha = 0.5;
    for (let i = 0; i < STEPS; i++) { const a = (i / STEPS) * Math.PI * 2; ctx.drawImage(baseCv, 0, 0, bw, bh, Math.cos(a) * R, Math.sin(a) * R, sw, shh); }
    ctx.globalAlpha = 1;
    ctx.drawImage(baseCv, 0, 0, bw, bh, 0, 0, sw, shh); // 中心补一张
    // (2) 模糊软边（模糊度按光照档 SH_CAST_BLUR[bucket]：越亮越锐；整体已大幅下调不再糊。Safari 老版无 ctx.filter → 跳过）
    if ('filter' in ctx) {
      const blurPx = Math.max(1, Math.round(sw * SH_CAST_BLUR[bucket]));
      const t2 = document.createElement('canvas'); t2.width = sw; t2.height = shh;
      const tctx = t2.getContext('2d');
      if (tctx) { tctx.drawImage(cv, 0, 0); ctx.clearRect(0, 0, sw, shh); ctx.filter = `blur(${blurPx}px)`; ctx.drawImage(t2, 0, 0); ctx.filter = 'none'; }
    }
    // (3) 根深尖淡：沿 底(根,y=shh)→顶(尖,y=0) 乘一道 alpha 渐变(根 1.0、尖 0.3) → 投射影根深尖淡、不均匀washout
    const grad = ctx.createLinearGradient(0, shh, 0, 0);
    grad.addColorStop(0, 'rgba(0,0,0,1)');
    grad.addColorStop(1, 'rgba(0,0,0,0.3)');
    ctx.globalCompositeOperation = 'destination-in';
    ctx.fillStyle = grad; ctx.fillRect(0, 0, sw, shh);
    // (4) 染平深色：source-in 把成形 alpha 团整体替换为单色（抹掉正面颜色/细节）
    ctx.globalCompositeOperation = 'source-in';
    ctx.fillStyle = '#' + SH_TINT.toString(16).padStart(6, '0');
    ctx.fillRect(0, 0, sw, shh);
    ctx.globalCompositeOperation = 'source-over';
    const tex = Texture.from(cv);
    const slot = arr || []; slot[bucket] = tex; silShadowCache.set(srcTex, slot);
    return tex;
  } catch { return null; } // 任何失败 → null → 调用方走彗星团 fallback，绝不崩
}

// 彗星软阴影贴图：长轴 128 × 短轴 64；近端(≈22%处)浓团=接地，向远端渐隐成尾=投射。
function makeShadowTexture(): Texture {
  const W = SH_TEX_W, H = SH_TEX_H;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d')!;
  // 接地浓团：径向渐变，圆心在长轴 22%(接地点)
  const cx = W * SH_ANCHOR_X, cy = H * 0.5;
  const g = ctx.createRadialGradient(cx, cy, 1, cx, cy, H * 0.72);
  g.addColorStop(0, 'rgba(0,0,0,0.64)');
  g.addColorStop(0.5, 'rgba(0,0,0,0.30)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  // 投射尾巴：远端再叠一片更淡更扁的椭圆 → 整体呈水滴/彗星形向投射方向拖出
  const tx = W * 0.60;
  const g2 = ctx.createRadialGradient(tx, cy, 1, tx, cy, H * 0.44);
  g2.addColorStop(0, 'rgba(0,0,0,0.20)');
  g2.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g2; ctx.fillRect(0, 0, W, H);
  return Texture.from(cv);
}
// 双层阴影：把 contact(接地 AO) + cast(投射) 两个 Sprite 摆到植株根 (worldX,worldY)。
//  · 接地层：程序生成软暗盘，居中盖茎基、压扁成椭圆、不偏移不倾斜、最深 → 把植株「钉」在地上(不悬浮)。永不失败。
//  · 投射层：近/大株用预烤填实剪影(竖向翻转投向右下、WIDEN/FLATTEN/SKEW 控形、根深尖淡)；烤制失败→彗星团兜底；
//    小/远株(<MIN_PX)直接跳过投射层、只留接地层(省+干净，兼作 LOD)。方向固定右下、不随昼夜转，浓度走 alpha。
// 显式参数版 → 既支持精灵(标准作物/野草)，也支持玉米(主体在 Container 内、用根部世界坐标 worldX/worldY)。
function applyShadow(sh: ShadowRec, tex: Texture, anchorX: number, anchorY: number, scaleX: number, scaleY: number, worldX: number, worldY: number, hPx: number, renderW: number, alpha: number, contactK = 1) {
  const footW = Math.max(6, Math.abs(renderW));
  // —— 接地层 ——（居中盖根、压扁、最深；始终绘制）。contactK<1=高密度弱化(防根部叠成黑团)
  const c = sh.contact;
  c.visible = true;
  if (c.texture !== SH_CONTACT_TEX) c.texture = SH_CONTACT_TEX;
  c.position.set(worldX, worldY);
  c.rotation = 0; c.skew.x = 0;
  c.scale.set((footW * SH_CONTACT_W) / 96, (footW * SH_CONTACT_W * SH_CONTACT_SQUASH) / 96);
  c.tint = SH_TINT;
  c.alpha = alpha * SH_CONTACT_ALPHA * contactK;

  // —— 投射层 ——（大株才画；剪影优先、失败→彗星团；小株 null → 隐藏）
  const ca = sh.cast;
  if (hPx < SH_SIL_MIN_PX) { ca.visible = false; return; }
  const silTex = SH_MODE === 'silhouette' ? getSilShadow(tex) : null;
  ca.visible = true;
  ca.position.set(worldX, worldY); // 根端与接地层同点 → 不悬浮
  if (silTex) {
    if (ca.texture !== silTex) ca.texture = silTex;
    ca.anchor.set(anchorX, anchorY); // 植株锚点 → 根重合
    ca.rotation = 0; ca.skew.x = SH_CAST_SKEW;
    // 负 scale.y 翻转 → 投向右下地面；÷DS 抵消烤图降采样；WIDEN 防细条、FLATTEN 控长
    ca.scale.set((scaleX / SH_SIL_DS) * SH_CAST_WIDEN, -(Math.abs(scaleY) / SH_SIL_DS) * SH_CAST_FLATTEN);
    ca.tint = 0xffffff;              // 色(含根深尖淡)已烤进贴图
    ca.alpha = alpha * SH_CAST_ALPHA * (0.4 + 0.6 * contactK); // 高密度时投射层也轻度弱化(比接地层缓)
  } else { // 彗星团兜底（接地层照常 → 即便退化也不悬浮）
    if (ca.texture !== SHADOW_BLOB) ca.texture = SHADOW_BLOB;
    ca.anchor.set(SH_ANCHOR_X, 0.5);
    ca.skew.x = 0;
    ca.tint = SH_TINT;
    const foot = Math.max(4, footW * SH_FOOT);
    const len = Math.min(hPx * 1.25, foot * SH_LEN_BASE + hPx * SH_LEN_H);
    const wid = Math.max(foot * SH_WID, len * 0.34);
    ca.rotation = SH_ANGLE;
    ca.scale.set(len / SH_TEX_W, wid / SH_TEX_H);
    ca.alpha = alpha * SH_CAST_ALPHA * (0.4 + 0.6 * contactK);
  }
}
// 精灵版（标准作物/野草）：从精灵自身世界坐标 + 贴图/锚点/缩放取参，转交 applyShadow。contactK<1=高密度根部弱化。
function setShadow(sh: ShadowRec, src: Sprite, hPx: number, renderW: number, alpha: number, contactK = 1) {
  applyShadow(sh, src.texture, src.anchor.x, src.anchor.y, src.scale.x, src.scale.y, src.x, src.y, hPx, renderW, alpha, contactK);
}
function smooth01(t: number): number { t = t < 0 ? 0 : t > 1 ? 1 : t; return t * t * (3 - 2 * t); }
// 渲染一株野草：连续平滑爬升生长 + 强化双 Sprite 过渡 + 枯萎转枯褐/缩/倒 + 接地阴影。两株贴图按 relH 归一(换阶段不跳大小)。
// 两类过渡都平滑(消除 yellowdock/plantain 的"突然变样")：
//  ① 生长阶段间：base=当前帧(不透明)、over=下一帧，alpha 用 smoothstep 在阶段 30%→100% 渐显(加宽更柔，base 不透明→无重影)。
//  ② 成熟→枯萎：原为瞬间换帧(最突兀)。改 base=成熟帧、over=枯萎帧，随 wither 0→0.55 做"真交叉溶解"(base 同步淡出)→ 平滑枯萎。
function drawWeed(sp: Sprite, sp2: Sprite, sh: ShadowRec, kind: WeedKind, targetH: number, life: number, phase: number, wither: number, lodge: number, restAng: number, colorVar: number, relight: number, shadowAlpha: number, fade: number): void {
  const stg = kind.stages, N = stg.length, growN = kind.hasWithered ? N - 1 : N;
  const Lc = Math.min(1, life);
  const withering = phase >= 2;
  // 幼苗极小(0.02)→平滑爬升到成熟(1.0)
  const plantH = targetH * (0.02 + 0.98 * Math.pow(Lc, 1.15)) * (1 - wither * 0.22);
  if (plantH < 0.6 || fade <= 0.01) { sp.visible = false; sp2.visible = false; hideShadow(sh); return; }
  const rot = ((restAng + lodge) * Math.PI) / 180;
  let dark = wither > 0 ? lerpColor(0xffffff, 0x7a5f38, Math.min(1, wither) * 0.85) : 0xffffff; // 枯萎转枯褐(枯草色，非近黑)
  const wdeep = clamp01((Math.min(1, wither) - 0.6) / 0.4); // #2 久枯(深枯>0.6)渐进失色：枯褐再拉向暖灰
  if (wdeep > 0) dark = lerpColor(dark, 0x8c847a, wdeep * 0.5);
  const tint = multiplyColor(multiplyColor(relight, colorVar), dark);

  let baseStage: number, overStage: number, overAlpha: number, dissolve: boolean;
  if (withering) { // 成熟帧 → 枯萎帧 交叉溶解（hasWithered 才有独立枯萎帧；否则仅 tint/倒伏表现枯萎）
    baseStage = growN - 1; overStage = N - 1;
    overAlpha = kind.hasWithered ? smooth01(wither / 0.55) : 0;
    dissolve = true; // base 同步淡出 → 真溶解（成熟绿叶溶为枯褐残株）
  } else {          // 生长阶段间交叉淡入
    const fStage = Lc * growN;
    baseStage = Math.min(growN - 1, Math.floor(fStage));
    const frac = Math.min(1, fStage - baseStage);
    overStage = Math.min(growN - 1, baseStage + 1);
    overAlpha = baseStage < growN - 1 ? smooth01((frac - 0.3) / 0.7) : 0; // 加宽到 30%→100% + smoothstep
    dissolve = false; // base 保持不透明 → 相邻生长帧叠加、无重影
  }

  if (sp.texture !== stg[baseStage]) sp.texture = stg[baseStage];
  sp.scale.set(plantH / (stageRel(baseStage, N) * (stg[baseStage].height || 1))); // ÷relH → 换阶段不跳大小
  sp.rotation = rot; sp.tint = tint; sp.visible = true;
  sp.alpha = dissolve ? fade * (1 - overAlpha) : fade; // 溶解态 base 淡出；生长态 base 不透明
  if (overAlpha > 0.003 && overStage !== baseStage) {
    if (sp2.texture !== stg[overStage]) sp2.texture = stg[overStage];
    sp2.anchor.copyFrom(sp.anchor); sp2.position.copyFrom(sp.position); sp2.zIndex = sp.zIndex;
    sp2.scale.set(plantH / (stageRel(overStage, N) * (stg[overStage].height || 1)));
    sp2.rotation = rot; sp2.tint = tint; sp2.alpha = fade * overAlpha; sp2.visible = true;
  } else sp2.visible = false;
  setShadow(sh, sp, plantH, sp.texture.width * sp.scale.x, shadowAlpha * (1 - wither * 0.55));
}
function lerpColor(a: number, b: number, t: number): number {
  const ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255;
  const br = (b >> 16) & 255, bg = (b >> 8) & 255, bb = b & 255;
  const r = Math.round(ar + (br - ar) * t);
  const g = Math.round(ag + (bg - ag) * t);
  const bl = Math.round(ab + (bb - ab) * t);
  return (r << 16) | (g << 8) | bl;
}
function multiplyColor(a: number, b: number): number {
  const r = (((a >> 16) & 255) * ((b >> 16) & 255)) / 255;
  const g = (((a >> 8) & 255) * ((b >> 8) & 255)) / 255;
  const bl = ((a & 255) * (b & 255)) / 255;
  return (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(bl);
}
function clamp01(v: number): number { return v < 0 ? 0 : v > 1 ? 1 : v; }
// 倒伏强度 bend(0..1)：受灾(涝/旱/冻) / 缺水 / 过熟 / 死亡。标准作物与玉米共用 → 表现一致。
function computeBend(sl: Slot, wx: WeatherType, stage: number): number {
  const wsev = wx === 'rain' ? sl.flood : wx === 'drought' ? sl.parch : wx === 'frost' ? sl.frost : 0;
  let bend = 0;
  if (wsev > 0) bend = Math.max(bend, Math.min(1, wsev / 4));
  if (!sl.dead && stage < 4 && sl.dry > 0) bend = Math.max(bend, Math.min(0.9, sl.dry / (DRY_DEATH[stage] || 5)));
  if (!sl.dead && sl.growth >= 400) { const ag = Math.max(0, sl.age - 5); if (ag > 0) bend = Math.max(bend, Math.min(0.65, ag / 11)); }
  if (sl.dead) bend = Math.max(bend, sl.deathKind === 'frozen' ? 0.78 : 0.96);
  return bend;
}
// 倒伏目标角(度)：方向/幅度/最大角各株不同（hash r1..r3）→ 不会所有枯株向同一方向倒。
function computeLodgeTarget(bend: number, r1: number, r2: number, r3: number, dead: boolean): number {
  if (bend <= 0.002) return 0;
  const sgn = r1 < 0.5 ? -1 : 1;
  const amt = 0.4 + 0.6 * r2;
  const mag = bend * (dead ? 46 + r2 * 34 : 24 + r3 * 30);
  return sgn * amt * mag + (r3 - 0.5) * 18;
}
// 玉米衰老强度(0..1)：由 Slot 真实状态统一计算（过熟老化 / 缺水 / 旱·冻·涝 / 死亡）→ 驱动黄化/干枯/缺叶/枯萎主干。
function cornWither(sl: Slot, wx: WeatherType, stage: number): number {
  if (sl.dead) return 1;
  let w = 0;
  if (sl.growth >= 400) w = Math.max(w, clamp01((sl.age - 5) / 11));
  if (stage < 4 && sl.dry > 0) w = Math.max(w, clamp01(sl.dry / (DRY_DEATH[stage] || 5)));
  if (wx === 'drought' && sl.parch > 0) w = Math.max(w, clamp01(sl.parch / 4));
  if (wx === 'frost' && sl.frost > 0) w = Math.max(w, clamp01(sl.frost / 4) * 0.85);
  if (wx === 'rain' && sl.flood > 0) w = Math.max(w, clamp01(sl.flood / 4) * 0.7);
  return w;
}
// 玉米阶段图的轻应激色（非死亡；明显干枯/黄化主要靠真实模块叶表现，故 base 只轻染、不与模块叠成同色）。
function cornStress(sl: Slot, wx: WeatherType, stage: number): number {
  if (sl.dead || (sl.growth >= 400 && sl.age > 5)) return 0xffffff; // 过熟/死亡靠衰老叶+主干，不强染 base
  if (stage < 4) {
    if (wx === 'drought' && (sl.parch > 0 || sl.dry > 0)) return 0xecd89a;
    if (wx === 'frost' && sl.frost > 0) return 0xd2e2f3;
    if (wx === 'rain' && sl.flood > 0) return 0xc0cdab;
  }
  return 0xffffff;
}
// 玉米枯死部件色（仅玉米用）：干叶/枯主干贴图本就是金棕/枯黄（自然玉米秸秆 stover 色），
// 故只做「轻度」色偏、几乎不压暗——不像标准作物那样用深褐死亡色重染。否则金棕贴图被
// 深褐 deathTintOf multiply 二次压暗、再叠夜间冷暗环境光 → 叶片近黑（用户实测枯萎与正常差距过大）。
// 目标：枯死玉米呈金黄/枯褐的干秸样、与场景同明度，只是颜色由绿转枯，而非塌成一团黑。
function cornDeathTint(kind: Slot['deathKind']): number {
  return kind === 'frozen' ? 0xcdd6e4   // 冻死：冷调微蓝、整体仍明亮
       : kind === 'rot'    ? 0xc2c293   // 烂根：略暗的橄榄枯黄，但保持明亮
       :                     0xe6d9bb;  // 旱/过熟：贴近金棕本色、几乎不压暗
}
// 每株自然色彩随机（乘法 tint，确定性）：约 38% 偏红/橙、40% 偏黄绿、22% 中性微暖 →
// 同一作物里有的更红、有的橙红、有的黄绿，像真实田里的个体差异。
// 在地块四边形(q)内按 (u,v)∈[0,1] 双线性取点（u 横向、v 纵深；q 顺序 TL,TR,BR,BL）
function quadPoint(q: number[][], u: number, v: number): { x: number; y: number } {
  const tx = q[0][0] + (q[1][0] - q[0][0]) * u, ty = q[0][1] + (q[1][1] - q[0][1]) * u;
  const bxp = q[3][0] + (q[2][0] - q[3][0]) * u, byp = q[3][1] + (q[2][1] - q[3][1]) * u;
  return { x: tx + (bxp - tx) * v, y: ty + (byp - ty) * v };
}
// 野地杂草布点的确定性伪随机（与 plantHash 独立，避免强刷位置漂移）
function wildHash(i: number, n: number): number {
  let x = (i * 0x9e3779b1 + n * 0x85ebca77 + 0x27d4eb2f) >>> 0;
  x = Math.imul(x ^ (x >>> 15), 0x2c1b3c6d) >>> 0;
  x = Math.imul(x ^ (x >>> 13), 0x297a2d39) >>> 0;
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}
// 点到线段最短距离（用于判断野草是否长在巡田路边）
function distToSeg(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 > 1e-9 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}
// 点 (px,py) 是否在凸四边形 q 内（顺/逆时针均可：要求各边叉积同号）
function pointInQuad(px: number, py: number, q: number[][]): boolean {
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const a = q[i], b = q[(i + 1) % 4];
    const cross = (b[0] - a[0]) * (py - a[1]) - (b[1] - a[1]) * (px - a[0]);
    if (Math.abs(cross) < 1e-9) continue;
    const s = cross > 0 ? 1 : -1;
    if (sign === 0) sign = s;
    else if (s !== sign) return false;
  }
  return true;
}
function makeColorVar(id: number, idx: number): number {
  const h = plantHash(id, idx, 7); // 0..1 色相倾向
  const s = plantHash(id, idx, 8); // 0..1 强度
  const amt = 0.08 + s * 0.14;     // 0.08..0.22
  let vr = 1, vg = 1, vb = 1;
  if (h > 0.62) { vg = 1 - amt * 0.45; vb = 1 - amt; }            // 偏红/橙：压绿压蓝
  else if (h < 0.4) { vr = 1 - amt * 0.5; vb = 1 - amt * 0.55; }  // 偏黄绿：压红压蓝
  else { vb = 1 - amt * 0.5; }                                    // 中性微暖：略压蓝
  return (Math.round(vr * 255) << 16) | (Math.round(vg * 255) << 8) | Math.round(vb * 255);
}
