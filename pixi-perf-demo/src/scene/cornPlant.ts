import { Container, Sprite, Texture } from 'pixi.js';
import { CORN_STAGE_CONFIG, CORN_FRAMES, getCornAgingVariant, type CornAttachmentSide } from '../data/corn_config';
import { plantHash } from '../sim/layout';
import type { PlantAtlas } from '../core/assets';

// ============================================================================
// 玉米专用视图（预制图集版）—— 一个 Container 作为「一株玉米」纵深单位：
//   baseA  当前生长阶段图（5 张完整玉米：发芽→…→抽穗/成熟，自带叶/穗）
//   baseB  生长态=下一阶段图（交叉淡入）；枯萎态=缺叶/枯萎主干（再次交叉淡入，平滑替换阶段图）
//   leaves 衰老/应激叠加的独立叶片（健康/黄化/干枯/卷曲），按固定随机种子选点 → 稳定个体差异
// 根部钉在 Container 原点(0,0)（基底 anchor 取自图集，≈0.5,0.98）→ 换阶段/翻转/倒伏根部不漂移。
// 不注册任何 Ticker/RAF/定时器；全部由 Field.update() 驱动。阴影由 Field 读取 base* 几何后单独绘制。
// ============================================================================

const WITHER_AGING = 0.18; // 低于此：纯阶段图（健康），不叠加衰老叶
const STEM_START = 0.55;    // 枯萎到此开始把阶段图交叉淡出为主干
const STEM_FULL = 0.86;     // 到此主干完全取代阶段图
const MAX_LEAVES = 6;       // 叠加叶片硬上限（性能 + 「保留 3~6 片」）
const LEAF_SCALE = 0.74;    // 叠加叶片相对株高的缩放（图集叶片偏大，缩一点更贴合主体、不过度铺张）
// 各叶帧「长度归一化」基准（像素，取健康/黄叶平均最长边≈410）：干枯/卷曲叶帧本身比健康/黄叶
// 大很多（干叶 maxdim≈527、卷叶≈488 vs 健康/黄≈410），同一 LEAF_SCALE 下会渲染得明显更大
// → 枯萎株比正常株「大很多」(用户实测)。按各帧最长边归一到此基准，所有叶型渲染长度一致，
// 健康/黄叶几乎不变、干枯/卷曲叶缩到与之相称。
const LEAF_REF_LEN = 410;
// 各叶型相对缩放（在最长边归一基础上再缩）：用户实测黄叶仍偏大、且真实玉米枯萎时叶片皱缩变小，
// 故枯/卷曲叶应比健康叶更小。healthy 基准 1.0；yellow −40%、dry −30%、curled −45%。
const LEAF_TYPE_SCALE: Record<'healthy' | 'yellow' | 'dry' | 'curled', number> = {
  healthy: 1.0,
  yellow: 0.60,
  dry: 0.70,
  curled: 0.55,
};
function leafTypeScale(frame: string): number {
  if (frame.includes('yellow')) return LEAF_TYPE_SCALE.yellow;
  if (frame.includes('dry')) return LEAF_TYPE_SCALE.dry;
  if (frame.includes('curled')) return LEAF_TYPE_SCALE.curled;
  return LEAF_TYPE_SCALE.healthy;
}

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

// 按衰老类型 + 挂点朝向挑具体帧。healthy/yellow 的 01/03 锚点已编码左右朝向(无需翻转)，02 与 dry/curled 居中竖叶按 side 镜像。
function pickLeafFrame(type: 'healthy' | 'yellow' | 'dry' | 'curled', side: CornAttachmentSide, roll: number): { frame: string; flip: boolean } {
  if (type === 'healthy') {
    if (side === 'left') return { frame: CORN_FRAMES.leaves.healthy[0], flip: false };
    if (side === 'right') return { frame: CORN_FRAMES.leaves.healthy[2], flip: false };
    return { frame: CORN_FRAMES.leaves.healthy[1], flip: roll < 0.5 };
  }
  if (type === 'yellow') {
    if (side === 'left') return { frame: CORN_FRAMES.leaves.yellow[0], flip: false };
    if (side === 'right') return { frame: CORN_FRAMES.leaves.yellow[2], flip: false };
    return { frame: CORN_FRAMES.leaves.yellow[1], flip: roll < 0.5 };
  }
  if (type === 'curled') {
    const arr = CORN_FRAMES.leaves.curled;
    return { frame: arr[Math.floor(roll * arr.length) % arr.length], flip: side === 'left' };
  }
  const arr = CORN_FRAMES.leaves.dry;
  return { frame: arr[Math.floor(roll * arr.length) % arr.length], flip: side === 'left' };
}

export interface CornUpdate {
  stage: number;   // 当前阶段 0..4
  upper: number;   // 下一阶段 0..4（交叉淡入用）
  frac: number;    // 阶段内进度 0..1
  heightPx: number;// 目标显示株高
  wither: number;  // 衰老/枯萎强度 0..1（由 Field 据 Slot 状态统一计算）
  rotation: number;// 整株旋转(休止角+倒伏，rad)
  baseTint: number;// 阶段图色（环境光×个体色×轻应激）
  partTint: number;// 主干/叶片色（环境光×死亡色；不强行染黄已是黄/干的叶）
  dead: boolean;
}

interface LeafEntry { ai: number; frame: string; flipX: boolean; sJit: number; yJit: number; rJit: number; }

export class CornPlantView extends Container {
  // 供 Field 阴影系统读取的「当前主导基底」几何（每帧 update 刷新）：贴图 + 缩放 + 锚点 y。
  baseTex: Texture;
  baseScaleX = 1;
  baseScaleY = 1;
  baseAnchorY = 0.98;

  private baseA: Sprite;
  private baseB: Sprite;
  private leavesC = new Container();
  private leaves: Sprite[] = [];
  private aTexName = '';
  private bTexName = '';
  private planKey = '';
  private plan: LeafEntry[] = [];

  constructor(private atlas: PlantAtlas, private plotId: number, private slotIdx: number) {
    super();
    this.baseTex = atlas.getCorn(CORN_FRAMES.stages[0]);
    this.baseA = new Sprite(this.baseTex);
    this.baseB = new Sprite(this.baseTex);
    this.baseA.anchor.set(0.5, 0.98);
    this.baseB.anchor.set(0.5, 0.98);
    this.addChild(this.baseA, this.baseB, this.leavesC); // A 下、B 中、叶片上
  }

  update(p: CornUpdate): void {
    this.rotation = p.rotation;
    const stemBlend = clamp01((p.wither - STEM_START) / (STEM_FULL - STEM_START));

    // —— 基底 A：当前阶段图（枯萎态随 stemBlend 淡出）——
    const aFrame = CORN_FRAMES.stages[Math.min(4, p.stage)];
    if (this.aTexName !== aFrame) { this.aTexName = aFrame; this.baseA.texture = this.atlas.getCorn(aFrame); }
    this.baseA.anchor.set(0.5, this.atlas.cornAnchor(aFrame).y);
    const aScale = p.heightPx / (this.baseA.texture.height || 1);
    this.baseA.scale.set(aScale);
    this.baseA.position.set(0, 0);
    this.baseA.tint = p.baseTint;
    this.baseA.alpha = 1 - stemBlend;
    this.baseA.visible = this.baseA.alpha > 0.003;

    // —— 基底 B：生长态=下一阶段图(交叉淡入)；枯萎态=主干(交叉淡入替换阶段图，避免突然消失) ——
    if (stemBlend <= 0) {
      const bFrame = CORN_FRAMES.stages[Math.min(4, p.upper)];
      if (this.bTexName !== bFrame) { this.bTexName = bFrame; this.baseB.texture = this.atlas.getCorn(bFrame); }
      this.baseB.anchor.set(0.5, this.atlas.cornAnchor(bFrame).y);
      this.baseB.scale.set(p.heightPx / (this.baseB.texture.height || 1));
      this.baseB.tint = p.baseTint;
      this.baseB.alpha = p.stage >= 4 ? 0 : Math.max(0, (p.frac - 0.7) / 0.3); // 仅每阶段最后 30% 淡入，其余只显当前阶段
    } else {
      const useWith = p.dead || p.wither >= 0.78; // 死亡/重度→枯萎主干；中度缺叶→缺叶主干
      const pool = useWith ? CORN_FRAMES.stems.withered : CORN_FRAMES.stems.stripped;
      const stemFrame = pool[Math.floor(plantHash(this.plotId, this.slotIdx, 70) * pool.length) % pool.length];
      if (this.bTexName !== stemFrame) { this.bTexName = stemFrame; this.baseB.texture = this.atlas.getCorn(stemFrame); }
      this.baseB.anchor.set(0.5, this.atlas.cornAnchor(stemFrame).y);
      this.baseB.scale.set(p.heightPx / (this.baseB.texture.height || 1));
      this.baseB.tint = p.partTint;
      this.baseB.alpha = stemBlend;
    }
    this.baseB.position.set(0, 0);
    this.baseB.visible = this.baseB.alpha > 0.003;

    // 主导基底（供阴影：取当前 alpha 更高者的几何）
    if (stemBlend >= 0.5) { this.baseTex = this.baseB.texture; this.baseScaleX = this.baseB.scale.x; this.baseScaleY = this.baseB.scale.y; this.baseAnchorY = this.baseB.anchor.y; }
    else { this.baseTex = this.baseA.texture; this.baseScaleX = this.baseA.scale.x; this.baseScaleY = this.baseA.scale.y; this.baseAnchorY = this.baseA.anchor.y; }

    // —— 衰老叶片叠加 ——（健康期不叠加；只在枯萎档/阶段/死亡跨阈值时重选可见叶，不每帧重选）
    if (p.wither < WITHER_AGING) {
      this.planKey = '';
      for (const lf of this.leaves) lf.visible = false;
    } else {
      const band = Math.floor(p.wither * 10);
      const key = `${band}:${p.stage}:${p.dead ? 1 : 0}:${stemBlend > 0.35 ? 1 : 0}`;
      if (key !== this.planKey) { this.planKey = key; this.plan = this.buildLeafPlan(p.stage, p.wither, stemBlend); }
      this.applyLeaves(p, aScale);
    }
  }

  // 选哪些挂点叠加什么叶——固定随机种子(plantHash)：低 t 挂点先黄、类型/翻转稳定 → 同株刷新/重建外观一致。
  private buildLeafPlan(stage: number, wither: number, stemBlend: number): LeafEntry[] {
    const cfg = CORN_STAGE_CONFIG[Math.min(stage, CORN_STAGE_CONFIG.length - 1)];
    const variant = getCornAgingVariant(wither);
    const stemVisible = stemBlend > 0.35; // 主干露出 → 需要叶子撑场面（阶段图绿叶已淡出）
    const out: LeafEntry[] = [];
    for (let i = 0; i < cfg.leaves.length && out.length < MAX_LEAVES; i++) {
      const ap = cfg.leaves[i];
      const t = plantHash(this.plotId, this.slotIdx, 30 + i);    // 退化先后：低值先黄
      const roll = plantHash(this.plotId, this.slotIdx, 50 + i); // 类型/翻转
      const affected = wither > 0.1 + t * 0.82;
      let type: 'healthy' | 'yellow' | 'dry' | 'curled' | null = null;
      if (affected) {
        if (stemVisible && roll < variant.missingLeafChance) type = null; // 缺叶（仅主干态可"少叶"，阶段图叶片无法擦除）
        else if (roll < variant.curledLeafChance) type = 'curled';
        else if (wither > 0.55 || roll < variant.dryLeafChance) type = 'dry';
        else type = 'yellow';
      } else if (stemVisible) {
        type = wither > 0.62 ? 'yellow' : 'healthy'; // 主干态补叶，避免光秃
      } else {
        type = null; // 阶段图自带绿叶，健康挂点无需叠加
      }
      if (!type) continue;
      const pick = pickLeafFrame(type, ap.side, roll);
      out.push({
        ai: i,
        frame: pick.frame,
        flipX: pick.flip,
        sJit: 0.88 + plantHash(this.plotId, this.slotIdx, 60 + i) * 0.24, // 0.88..1.12
        yJit: 0.95 + plantHash(this.plotId, this.slotIdx, 80 + i) * 0.12, // 轻微非等比
        rJit: (plantHash(this.plotId, this.slotIdx, 90 + i) - 0.5) * 0.28, // ±0.14rad ≈ ±8°
      });
    }
    return out;
  }

  // 每帧把计划中的叶片放到挂点（位置随株高/缩放连续更新；可见集/帧/翻转来自缓存计划，不每帧重选）。
  private applyLeaves(p: CornUpdate, aScale: number): void {
    const cfg = CORN_STAGE_CONFIG[Math.min(p.stage, CORN_STAGE_CONFIG.length - 1)];
    const texW = this.baseA.texture.width || 1;
    const texH = this.baseA.texture.height || 1;
    const droop = p.wither * 0.3; // 衰老越深叶尖越下垂
    for (let k = 0; k < this.plan.length; k++) {
      const e = this.plan[k];
      const ap = cfg.leaves[e.ai];
      let lf = this.leaves[k];
      if (!lf) { lf = new Sprite(); this.leaves[k] = lf; this.leavesC.addChild(lf); }
      if (!ap) { lf.visible = false; continue; }
      const tex = this.atlas.getCorn(e.frame);
      if (lf.texture !== tex) lf.texture = tex;
      const an = this.atlas.cornAnchor(e.frame);
      lf.anchor.set(an.x, an.y);
      // 归一化挂点 → 局部坐标（相对阶段图、根在原点）：localX=(x-0.5)·texW·scale, localY=(y-0.98)·texH·scale
      lf.position.set((ap.x - 0.5) * texW * aScale, (ap.y - 0.98) * texH * aScale);
      const sgn = e.flipX ? -1 : 1;
      // 按帧最长边归一：干枯/卷曲叶帧偏大→缩到与健康/黄叶相称的长度，消除「枯萎株大很多」
      const norm = LEAF_REF_LEN / Math.max(tex.width, tex.height || 1);
      const ls = aScale * LEAF_SCALE * e.sJit * norm * leafTypeScale(e.frame); // 再按叶型缩放：枯/黄/卷曲比健康叶小
      lf.scale.set(sgn * ls, ls * e.yJit);
      const droopSign = ap.side === 'left' ? -1 : ap.side === 'right' ? 1 : 0;
      lf.rotation = ap.rotation + e.rJit + droop * droopSign;
      lf.tint = p.partTint;
      lf.alpha = 1;
      lf.visible = true;
    }
    for (let k = this.plan.length; k < this.leaves.length; k++) this.leaves[k].visible = false;
  }

  destroy(): void {
    super.destroy({ children: true }); // 销毁 baseA/baseB/leavesC 及叶片；共享图集纹理不销毁(默认 texture:false)
  }
}
