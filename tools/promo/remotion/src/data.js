// 宣传片分镜：时长、转场、字幕、旁白。游戏镜头素材由 tools/promo/promo.py 录到 public/rec/。
// dur：该段在时间线上的帧数（含与下一段重叠的转场帧），不得超过录制帧数（(sec + 0.6) * 30）。
// out：到下一段的转场 [类型, 帧数]；类型见 Promo.jsx 的 makeTransition。
// sfx：该段游戏音效分轨的音量（默认 0.85）。cap：左下角（HUD 镜头为左上角）字幕 [标题, 副标题]；vo：[[旁白id, 相对本段开头的帧]]。
export const FPS = 30;
export const W = 1920;
export const H = 1080;

export const VO = {
  vo01: { text: '第十区，开服了。', sec: 3.36 },
  vo02: { text: '《全职高手》里的那款网游，现在，就在你的浏览器里。', sec: 6.68 },
  vo03: { text: '十二张账号卡，每一张，都有自己的打法。', sec: 6.0 },
  vo04: { text: '第一人称——原著的视角。', sec: 3.52 },
  vo05: { text: '也可以，切到越肩和第三人称。', sec: 3.88 },
  vo06: { text: '挑空，追击，受身。', sec: 3.76 },
  vo07: { text: '蓄力，霸体。看准时机——振刀！', sec: 5.72 },
  vo08: { text: '在镜廊里，看清自己。', sec: 4.36 },
  vo09: { text: '寒铁遗庭，守卫已经苏醒。', sec: 5.28 },
  vo10: { text: '三对三团队赛，局域网联机。', sec: 4.24 },
  vo11: { text: '荣耀。现在，开打。', sec: 4.0 },
};

export const SHOTS = [
  { type: 'title', dur: 150, out: ['fade', 18], vo: [['vo01', 24]] },
  { type: 'clip', name: 'establish', dur: 205, out: ['wipe', 12], bars: true, zoom: [1.06, 1.0],
    cap: ['断桥庭院', '个人赛 · 三局两胜'], vo: [['vo02', 10]] },
  { type: 'clip', name: 'lineupA', dur: 118, out: ['slide', 10], bars: true, zoom: [1.0, 1.03],
    cap: ['十二张账号卡', '君莫笑　一叶之秋　夜雨声烦　大漠孤烟　一枪穿云　沐雨橙风'], vo: [['vo03', 22]] },
  { type: 'clip', name: 'lineupB', dur: 118, out: ['flash', 10], bars: true, zoom: [1.0, 1.03],
    cap: ['精模 · 动作捕捉', '索克萨尔　小手冰凉　王不留行　包子入侵　裂天　影刃'] },
  { type: 'clip', name: 'fp', dur: 148, out: ['fade', 10], hud: true, zoom: [1.0, 1.0],
    cap: ['第一人称', '原著视角'], vo: [['vo04', 12]] },
  { type: 'clip', name: 'ots', dur: 148, out: ['flash', 10], hud: true, zoom: [1.0, 1.0],
    cap: ['越肩 · 第三人称', 'F5 一键切换'], vo: [['vo05', 10]] },
  { type: 'clip', name: 'juggle', dur: 148, out: ['wipe', 12], bars: true, zoom: [1.02, 1.08],
    cap: ['浮空 · 追击 · 受身', '一叶之秋 · 天击'], vo: [['vo06', 10]] },
  { type: 'clip', name: 'charge', dur: 180, out: ['flash', 8], bars: true, zoom: [1.0, 1.1],
    cap: ['蓄力 · 振刀', '裂天　对　夜雨声烦'], vo: [['vo07', 2]] },
  { type: 'clip', name: 'ult1', dur: 130, out: ['flash', 8], bars: true, zoom: [1.08, 1.0], punch: 18,
    cap: ['银光·千刃', '夜雨声烦 · 大招'] },
  { type: 'clip', name: 'ult2', dur: 132, out: ['fade', 16], bars: true, zoom: [1.0, 1.08], punch: 18,
    cap: ['伏龙翔天', '一叶之秋 · 大招'] },
  { type: 'clip', name: 'mirror', dur: 150, out: ['dip', 16], bars: true, zoom: [1.0, 1.05],
    cap: ['镜廊训练室', '照镜 · 换装'], vo: [['vo08', 14]] },
  { type: 'clip', name: 'boss', dur: 180, sfx: 0.45, out: ['flash', 10], bars: true, zoom: [1.05, 1.0], punch: 40,
    cap: ['副本 · 寒铁遗庭', '两阶段 Boss「寒铁守卫」'], vo: [['vo09', 16]] },
  { type: 'clip', name: 'team', dur: 165, sfx: 0.6, out: ['fade', 20], bars: true, zoom: [1.0, 1.06],
    cap: ['3v3 团队赛', '擂台车轮战 · 局域网联机'], vo: [['vo10', 10]] },
  { type: 'end', dur: 190, vo: [['vo11', 26]] },
];

// 每段在总时间线上的起始帧（转场重叠会把后一段提前）
export const starts = (() => {
  const out = []; let t = 0;
  SHOTS.forEach((s, i) => { out.push(t); t += s.dur - (s.out ? s.out[1] : 0); });
  return out;
})();
export const TOTAL = starts[starts.length - 1] + SHOTS[SHOTS.length - 1].dur;

// 旁白的绝对时间（帧）
export const voTrack = SHOTS.flatMap((s, i) => (s.vo || []).map(([id, off]) => ({
  id, from: starts[i] + off, len: Math.ceil(VO[id].sec * FPS), text: VO[id].text,
})));
