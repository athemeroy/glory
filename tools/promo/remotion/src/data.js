// 宣传片分镜：时长、转场、字幕、旁白。游戏镜头素材由 tools/promo/promo.py 录到 public/rec/。
// dur：该段在时间线上的帧数（含与下一段重叠的转场帧），不得超过录制帧数（(sec + 0.6) * 30）。
// out：到下一段的转场 [类型, 帧数]；类型见 Promo.jsx 的 makeTransition。
// sfx：该段游戏音效分轨的音量（默认 0.85）。cap：左下角（HUD 镜头为左上角）字幕 [标题, 副标题]；vo：[[旁白id, 相对本段开头的帧]]。
export const FPS = 30;
export const W = 1920;
export const H = 1080;

// 旁白已取消（2026-10-01：用户觉得 TTS 旁白难听，只保留游戏原声）；保留结构，便于以后加回
export const VO = {};

export const SHOTS = [
  { type: 'title', dur: 135, out: ['fade', 16] },
  { type: 'clip', name: 'duel', dur: 160, out: ['flash', 10], hud: true, zoom: [1.0, 1.0],
    cap: ['第一人称', '君莫笑 对 夜雨声烦 · 断桥庭院'] },
  { type: 'clip', name: 'mirror', dur: 145, out: ['fade', 12], hud: true, zoom: [1.0, 1.0],
    cap: ['镜廊训练室', '对镜换装 · 千机伞四种形态'] },
  { type: 'clip', name: 'charge', dur: 175, out: ['flash', 8], hud: true, zoom: [1.0, 1.0], punch: 72,
    cap: ['蓄力 · 振刀', '裂天的蓄力重击，被夜雨声烦振开'] },
  { type: 'clip', name: 'juggle', dur: 160, out: ['wipe', 12], hud: true, zoom: [1.0, 1.0],
    cap: ['浮空 · 追击', '一叶之秋 · 天击'] },
  { type: 'clip', name: 'ult1', dur: 145, out: ['flash', 8], hud: true, zoom: [1.0, 1.0], punch: 14,
    cap: ['银光·千刃', '夜雨声烦 · 大招'] },
  { type: 'clip', name: 'ult2', dur: 145, out: ['flash', 10], hud: true, zoom: [1.0, 1.0], punch: 14,
    cap: ['伏龙翔天', '一叶之秋 · 大招'] },
  { type: 'clip', name: 'gunner', dur: 145, out: ['slide', 10], hud: true, zoom: [1.0, 1.0],
    cap: ['枪林弹雨', '一枪穿云 · 双枪'] },
  { type: 'clip', name: 'mobs', dur: 160, out: ['dip', 14], hud: true, zoom: [1.0, 1.0], sfx: 0.7,
    cap: ['副本 · 寒铁遗庭', '大漠孤烟 · 骸骨卫兵'] },
  { type: 'clip', name: 'boss', dur: 175, out: ['flash', 10], hud: true, zoom: [1.0, 1.0], sfx: 0.6,
    cap: ['寒铁守卫', '两阶段 Boss'] },
  { type: 'clip', name: 'team', dur: 160, out: ['fade', 20], hud: true, zoom: [1.0, 1.0], sfx: 0.7,
    cap: ['3v3 团队赛', '联赛赛场'] },
  { type: 'end', dur: 180 },
];

// 每段在总时间线上的起始帧（转场重叠会把后一段提前）
export const starts = (() => {
  const out = []; let t = 0;
  SHOTS.forEach((s, i) => { out.push(t); t += s.dur - (s.out ? s.out[1] : 0); });
  return out;
})();
export const TOTAL = starts[starts.length - 1] + SHOTS[SHOTS.length - 1].dur;

// 旁白的绝对时间（帧）
export const voTrack = SHOTS.flatMap((s, i) => (s.vo || []).filter(([id]) => VO[id]).map(([id, off]) => ({
  id, from: starts[i] + off, len: Math.ceil(VO[id].sec * FPS), text: VO[id].text,
})));
