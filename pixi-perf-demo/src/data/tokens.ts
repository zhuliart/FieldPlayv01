// 设计令牌（Design Tokens）—— 从原型 README.md §3 与 FieldPlay.dc.html 内联样式抽取。
// 仅 DEMO 的 HUD / letterbox 用得到的部分；颜色口径与原型一致。
export const TOKENS = {
  // 天空渐变（舞台底）
  skyGradient: 'linear-gradient(#5fb6ea 0%, #84c9ef 22%, #b6e0f4 40%, #d8eef6 50%)',
  // 夜底 letterbox
  night: '#0b1820',
  // 主绿（面板/木牌底）
  greenPanel: 'rgba(74,116,44,.92)',
  greenDark: '#32561e',
  // 木质描边 / 金棕
  wood: '#b0863f',
  wood2: '#b78a4e',
  // 米黄卡面
  cream: '#f4e7c8',
  // 主蓝（机器人/路径/按钮）
  blue: '#5aa0e8',
  blueDark: '#3f7fd0',
  blueShadow: '#2f63aa',
  // 健康/正向
  good: '#bff05f',
  confirm: '#7ec943',
  confirmDark: '#54992c',
  // 警告/负向
  warn: '#c2452f',
  warn2: '#ff8a7a',
  // 文本
  textLight: '#eaf6e0',
  textBlue: '#bcd6f5',
  // 面板投影
  panelShadow: '0 6px 16px rgba(0,0,0,.28)',
} as const;

// 机器人 / 关键地图坐标（% of 1672×941），移植自原型
export const MAP = {
  station: { left: 92.5, top: 73 }, // 充电站
  shop: { left: 81, top: 45 },
  warehouse: { left: 20, top: 43 },
  robotHome: { left: 89, top: 73 }, // 机器人初始/待命位
} as const;
