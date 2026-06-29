// 大屏展示模式（裸眼 3D 近似）——「立体沙盘」深度观感 v1.5
// ─────────────────────────────────────────────────────────────────────────────
// 两套深度线索叠加，在平屏 + 现有素材下尽量「立体」：
//  ① 整画面透视倾斜 + 缓慢自动转动 + 指针视差（CSS 3D，作物钉在地块、不破坏等距对齐）。
//  ② 真·层间视差（onParallax 回调）：作物/粒子等「近层」相对固定地面多位移一点 →
//     作物「立起来、浮出地面」，产生眼睛能识别的纵深（运动视差是单人观看最强的深度线索）。
//     ②是 v1.5 新增——纯 CSS 倾斜只是「一张照片在摆动」，没有层间视差就不像 3D。
//
// 自包含、纯视觉：CSS 变换只作用在 #fp-depth；层间位移由宿主在 onParallax 里施加并自带 env 衰减
//  → 关闭时（env→0）所有偏移归零、对游戏零影响。
//
// ⚠️ 平屏真 3D 仍有物理上限：真正的「破框/弹出」需分层背景素材（天空/远景/中景/前景拆 PNG）
//    或物理折角屏。本模式是「平屏 + 现有合成图」能做到的最强深度近似。

export interface PresentationHandle {
  toggle(): boolean;
  readonly active: boolean;
  update(dtMS: number): void;
}

export interface PresentationOpts {
  depthLayer: HTMLElement; // 包住画布、承载 3D 变换的层（#fp-depth）
  badgeHost: HTMLElement; // 分辨率角标挂这层（#fp-wrap：不随舞台缩放/倾斜，固定在屏角）
  onEnter?: () => void; // 进入展示：隐藏 HUD 等
  onExit?: () => void; // 退出展示：恢复
  /** 层间视差驱动：nx,ny ∈ ~[-1.6,1.6] 已含 env 衰减；宿主据此位移各 Pixi 近层。 */
  onParallax?: (nx: number, ny: number) => void;
}

// —— 观感参数（v1.5 加强：让深度明确可感；都是单数值，按喜好调）——
const PERSP = 1100; // 透视距离(px)：越小透视越夸张
const TILT_X = 9; // 基础俯视角(°)：与等距美术叠加，营造「看进田里」
const ORBIT_Y = 10; // 自动左右摆幅(°)
const ORBIT_X = 3; // 自动俯仰摆幅(°)
const POINTER_Y = 12; // 指针水平视差最大偏转(°)
const POINTER_X = 7; // 指针垂直视差最大偏转(°)
const SCALE_COVER = 1.16; // 放大补满倾斜后的边缘，避免露出舞台底色
const PER_Y = 13000; // 左右摆动周期(ms)
const PER_X = 19000; // 俯仰摆动周期(ms)
const POINTER_LERP = 0.07; // 指针跟手平滑
const AUTO_PAR = 0.55; // 自动转动注入层间视差的比例（无鼠标时也有纵深）
const ENV_RAMP = 1500; // 进/出场包络时长(ms)

export function installPresentation(opts: PresentationOpts): PresentationHandle {
  const { depthLayer, badgeHost, onEnter, onExit, onParallax } = opts;

  let active = false;
  let env = 0; // 0..1 进出场包络
  let t = 0; // 累计时间(ms)
  let pnx = 0, pny = 0; // 指针归一化位置 [-1,1]
  let curPX = 0, curPY = 0; // 当前指针视差角（平滑逼近）
  let spx = 0, spy = 0; // 平滑后的指针位置（驱动层间视差）

  depthLayer.style.transformOrigin = 'center center';
  depthLayer.style.willChange = 'transform';

  // —— 左上角分辨率角标 ——
  const badge = document.createElement('div');
  badge.style.cssText =
    'position:absolute; top:14px; left:14px; z-index:120; display:none; pointer-events:none;' +
    'background:rgba(14,20,32,.74); color:#dfe9f6; font:600 12px/1.5 "Noto Sans SC",ui-monospace,monospace;' +
    'padding:9px 13px; border-radius:11px; box-shadow:0 4px 14px rgba(0,0,0,.34);' +
    'border:1px solid rgba(140,170,210,.22); letter-spacing:.3px; backdrop-filter:blur(3px);';
  badgeHost.appendChild(badge);

  const refreshBadge = () => {
    const dpr = +(window.devicePixelRatio || 1).toFixed(2);
    const iw = window.innerWidth, ih = window.innerHeight;
    const ratio = (iw / Math.max(1, ih)).toFixed(3);
    badge.innerHTML =
      `🖥️ <b>大屏展示模式</b><br>` +
      `屏幕 ${screen.width}×${screen.height} · 窗口 ${iw}×${ih}<br>` +
      `比例 ${ratio} · DPR ${dpr}<br>` +
      `<span style="opacity:.7">P 退出 · 移动鼠标转动视角</span>`;
  };
  window.addEventListener('resize', () => { if (active) refreshBadge(); });

  window.addEventListener('pointermove', (e) => {
    if (!active || e.pointerType === 'touch') return;
    pnx = (e.clientX / Math.max(1, window.innerWidth)) * 2 - 1;
    pny = (e.clientY / Math.max(1, window.innerHeight)) * 2 - 1;
  });

  const toggle = (): boolean => {
    active = !active;
    if (active) { refreshBadge(); badge.style.display = 'block'; onEnter?.(); }
    else { onExit?.(); pnx = pny = 0; }
    return active;
  };

  const update = (dtMS: number) => {
    const target = active ? 1 : 0;
    const k = Math.min(1, dtMS / ENV_RAMP);
    env += (target - env) * Math.min(1, k * 3);
    if (env < 0.002 && !active) { // 完全退出：清空变换、归零层间视差
      env = 0;
      depthLayer.style.transform = '';
      depthLayer.style.willChange = 'auto';
      badge.style.display = 'none';
      onParallax?.(0, 0);
      return;
    }
    if (active) depthLayer.style.willChange = 'transform';

    t += dtMS;
    curPY += (pnx * POINTER_Y - curPY) * POINTER_LERP;
    curPX += (-pny * POINTER_X - curPX) * POINTER_LERP;
    spx += (pnx - spx) * POINTER_LERP;
    spy += (pny - spy) * POINTER_LERP;

    // 自动缓转（运动视差）+ 指针视差
    const autoY = Math.sin((t / PER_Y) * Math.PI * 2);
    const autoX = Math.sin((t / PER_X) * Math.PI * 2 + 1.1);
    const ry = (autoY * ORBIT_Y + curPY) * env;
    const rx = (TILT_X + autoX * ORBIT_X + curPX) * env;
    const s = 1 + (SCALE_COVER - 1) * env;
    depthLayer.style.transform =
      `perspective(${PERSP}px) rotateX(${rx.toFixed(2)}deg) rotateY(${ry.toFixed(2)}deg) scale(${s.toFixed(4)})`;

    // 真·层间视差驱动：指针 + 自动转动 → 近层相对地面位移（含 env 衰减）
    const driveX = (spx + autoY * AUTO_PAR) * env;
    const driveY = (spy * 0.5 + autoX * AUTO_PAR * 0.5) * env;
    onParallax?.(driveX, driveY);
  };

  return {
    toggle,
    get active() { return active; },
    update,
  };
}
