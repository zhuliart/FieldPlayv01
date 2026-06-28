import { Assets, RenderTexture, Rectangle, Sprite, Container, Texture, Spritesheet, type SpritesheetData, type Renderer } from 'pixi.js';
import { CROP_KEYS } from '../data/crops';
import { CORN_FRAMES } from '../data/corn_config';
import { av } from './assetVer';

// ============================================================================
// 作物图集（spritesheet 合批）—— 把 20 张 plant_*.png（番茄/生菜/辣椒/小麦 ×5 阶段；
// 玉米已改用预制 corn_atlas，见下方 buildCorn）在运行时打进一张 atlas，
// 所有作物精灵共享同一 base texture → 1 个 draw call 画完全田作物（任务书五章「图集合批」）。
// 若运行时打包失败，回退到逐张纹理（Pixi v8 多纹理批处理仍可合批，画面不受影响）。
// 玉米另走预制 corn_atlas.png/json（Spritesheet 解析，20 帧：5 阶段 + 健康/黄化/干枯/卷曲叶 + 缺叶/枯萎主干）。
// ============================================================================
export class PlantAtlas {
  private frames = new Map<string, Texture>();
  private fallback = new Map<string, Texture>();
  built = false;
  // 玉米预制图集帧 / 各帧锚点（来自 corn_atlas.json）。所有帧共享 corn_atlas.png 单一 TextureSource。
  private cornFrames = new Map<string, Texture>();
  private cornAnchors = new Map<string, { x: number; y: number }>();
  private cornWarned = new Set<string>();
  cornReady = false;

  private names(): string[] {
    const out: string[] = [];
    for (const k of CROP_KEYS) {
      if (k === 'corn') continue; // 玉米改用预制 corn_atlas，不再打入运行时图集
      for (let s = 1; s <= 5; s++) out.push(`plant_${k}_s${s}`);
    }
    return out;
  }

  async build(renderer: Renderer): Promise<void> {
    await this.buildCorn(); // 先加载玉米预制图集（PNG+JSON 都经 av() 缓存失效）
    const names = this.names();
    const urls = names.map((n) => av(`assets/${n}.png`));
    let textures: Texture[];
    try {
      textures = await Promise.all(urls.map((u) => Assets.load<Texture>(u)));
    } catch (e) {
      console.warn('[atlas] 作物纹理加载失败，回退逐张', e);
      return;
    }
    names.forEach((n, i) => this.fallback.set(n, textures[i]));

    try {
      // —— 货架(shelf)装箱到 2048×2048 ——
      const PAD = 2;
      const ATLAS = 4096; // 容纳 2x 高清作物（20 张）仍单 base texture 合批；显存 ~67MB，桌面无压力
      const placements: { name: string; tex: Texture; x: number; y: number; w: number; h: number }[] = [];
      let x = PAD, y = PAD, rowH = 0;
      for (let i = 0; i < names.length; i++) {
        const tex = textures[i];
        const w = tex.width;
        const h = tex.height;
        if (x + w + PAD > ATLAS) {
          x = PAD;
          y += rowH + PAD;
          rowH = 0;
        }
        if (y + h + PAD > ATLAS) throw new Error('atlas 容量不足');
        placements.push({ name: names[i], tex, x, y, w, h });
        x += w + PAD;
        rowH = Math.max(rowH, h);
      }

      const rt = RenderTexture.create({ width: ATLAS, height: ATLAS });
      const stage = new Container();
      for (const p of placements) {
        const sp = new Sprite(p.tex);
        sp.position.set(p.x, p.y);
        stage.addChild(sp);
      }
      renderer.render({ container: stage, target: rt, clear: true });
      stage.destroy({ children: true });

      for (const p of placements) {
        this.frames.set(p.name, new Texture({ source: rt.source, frame: new Rectangle(p.x, p.y, p.w, p.h) }));
      }
      this.built = true;
      console.log(`[atlas] 作物图集已打包：${placements.length} 帧 → 1 base texture`);
    } catch (e) {
      console.warn('[atlas] 打包失败，回退逐张纹理', e);
    }
  }

  // —— 玉米预制图集：fetch JSON（带 av 缓存失效）+ Assets.load PNG（同样 av）→ Pixi Spritesheet 解析 ——
  // 所有帧共享 corn_atlas.png 的单一 TextureSource；缺帧明确报错、绝不静默用 Texture.WHITE。
  private async buildCorn(): Promise<void> {
    try {
      const data = (await fetch(av('assets/corn/corn_atlas.json')).then((r) => {
        if (!r.ok) throw new Error(`corn_atlas.json ${r.status}`);
        return r.json();
      })) as SpritesheetData & { frames: Record<string, { anchor?: { x: number; y: number } }> };
      const tex = await Assets.load<Texture>(av('assets/corn/corn_atlas.png'));
      const sheet = new Spritesheet(tex, data as SpritesheetData);
      await sheet.parse();
      for (const [name, t] of Object.entries(sheet.textures)) this.cornFrames.set(name, t);
      for (const [name, f] of Object.entries(data.frames)) if (f.anchor) this.cornAnchors.set(name, { x: f.anchor.x, y: f.anchor.y });
      // 校验 20 个必需帧齐全（缺任一 → 明确 error，但不崩、不白块：getCorn 会用阶段图兜底）
      const required = [
        ...CORN_FRAMES.stages,
        ...CORN_FRAMES.leaves.healthy, ...CORN_FRAMES.leaves.yellow, ...CORN_FRAMES.leaves.dry, ...CORN_FRAMES.leaves.curled,
        ...CORN_FRAMES.stems.stripped, ...CORN_FRAMES.stems.withered,
      ];
      const missing = required.filter((n) => !this.cornFrames.has(n));
      if (missing.length) console.error(`[corn] 图集缺少 ${missing.length} 帧：`, missing.join(', '));
      this.cornReady = this.cornFrames.size > 0 && missing.length === 0;
      console.log(`[corn] 预制图集加载：${this.cornFrames.size} 帧，ready=${this.cornReady}`);
    } catch (e) {
      console.error('[corn] 预制图集加载失败（玉米将回退阶段图兜底）', e);
    }
  }

  /** 取玉米图集帧。缺帧时明确报错并回退阶段图（绝不返回 Texture.WHITE / 不崩 / 不白块）。 */
  getCorn(name: string): Texture {
    const t = this.cornFrames.get(name);
    if (t) return t;
    if (!this.cornWarned.has(name)) { this.cornWarned.add(name); console.error('[corn] 缺帧兜底:', name); }
    return this.cornFrames.get('corn_stage_05') || this.cornFrames.get('corn_stage_01') || Texture.EMPTY;
  }
  hasCornFrame(name: string): boolean { return this.cornFrames.has(name); }
  /** 玉米帧锚点（来自 atlas JSON，归一化）；缺省回退底部中心。 */
  cornAnchor(name: string): { x: number; y: number } { return this.cornAnchors.get(name) || { x: 0.5, y: 0.98 }; }

  get(name: string): Texture {
    // 兼容旧接口：plant_corn_s1..5 映射到预制图集 corn_stage_01..05（降低其它代码改动面）
    if (name.startsWith('plant_corn_s')) {
      const n = parseInt(name.slice(12), 10);
      if (n >= 1 && n <= 5) return this.getCorn(CORN_FRAMES.stages[n - 1]);
    }
    return this.frames.get(name) || this.fallback.get(name) || Texture.WHITE;
  }
}

// ============================================================================
// 按需背景纹理缓存 —— 只解码「当前 + 过渡」用到的 1–4 张；不再需要的延迟卸载，
// 严禁一次性解码 36 张高清图（任务书五章 / README §8：iOS 会内存溢出）。
// ============================================================================
export class OnDemandTextureCache {
  private cache = new Map<string, { tex: Texture | null; lastNeeded: number; loading: boolean }>();
  private frame = 0;
  // 不再需要多少帧后卸载（留足交叉淡入时间，避免来回 thrash）
  constructor(private graceFrames = 240) {}

  /** 标记本帧需要这些 url，并按需触发异步加载。返回已就绪的纹理（未就绪为 null）。 */
  request(url: string): Texture | null {
    let e = this.cache.get(url);
    if (!e) {
      e = { tex: null, lastNeeded: this.frame, loading: true };
      this.cache.set(url, e);
      Assets.load<Texture>(url)
        .then((t) => {
          const cur = this.cache.get(url);
          if (cur) {
            cur.tex = t;
            cur.loading = false;
          }
        })
        .catch((err) => {
          console.warn('[bg] 加载失败', url, err);
          const cur = this.cache.get(url);
          if (cur) cur.loading = false;
        });
    } else {
      e.lastNeeded = this.frame;
    }
    return e.tex;
  }

  /** 每帧推进；卸载长期未用的纹理，释放解码态内存。返回当前已解码张数。 */
  sweep(): { decoded: number; loading: number } {
    this.frame++;
    let decoded = 0;
    let loading = 0;
    for (const [url, e] of this.cache) {
      if (e.tex) decoded++;
      if (e.loading) loading++;
      if (this.frame - e.lastNeeded > this.graceFrames) {
        if (e.tex) {
          Assets.unload(url).catch(() => {});
        }
        this.cache.delete(url);
      }
    }
    return { decoded, loading };
  }

  get decodedCount(): number {
    let n = 0;
    for (const e of this.cache.values()) if (e.tex) n++;
    return n;
  }
}

// 按设备分辨率挑背景尺寸档（生产应备 @0.5x/@1x/@2x；当前仓库仅 1 档，函数保留扩展位）。
export function pickBgTier(): string {
  const dpr = window.devicePixelRatio || 1;
  const w = window.screen?.width || 1280;
  // 仅有一档实拍图时统一返回 ''（无后缀）；保留判断逻辑，便于将来接多分辨率。
  if (dpr >= 2 && w >= 900) return '';
  return '';
}
