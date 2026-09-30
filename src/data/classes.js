// 职业、技能与外观数据。时间单位 ms，距离 m，伤害按 PvP 基础生命 3000 设计。
// 技能名称部分取自原著可考的招式名（如天击、龙牙、圆舞棍、落花掌、拔刀斩、三段斩、反坦克炮、浮空弹、乱射、卫星射线、伏龙翔天），
// 其余为本作原创；数值均为本作平衡值，非原著数据。

// ---- 通用片段构造 ----
const H = (o) => ({ t: 0, range: 2.4, arc: 110, h: [0, 2.2], dmg: 60, stun: 300, knock: 2.5, ...o });
const P = (o) => ({ t: 0, kind: 'bullet', speed: 60, radius: 0.18, range: 35, dmg: 50, stun: 250, knock: 1.5, gravity: 0, ...o });

// ---------- 普攻链 ----------
const swordChain = [
  { anim: 'slash1', wind: 110, active: 90, recover: 220, hits: [H({ range: 2.5, arc: 130, dmg: 55, stun: 300, knock: 1.8 })], lunge: 2.2, vfx: 'slashR', sfx: 'swing_light' },
  { anim: 'slash2', wind: 100, active: 90, recover: 220, hits: [H({ range: 2.5, arc: 130, dmg: 60, stun: 320, knock: 1.8 })], lunge: 2.2, vfx: 'slashL', sfx: 'swing_light' },
  { anim: 'thrust', wind: 150, active: 100, recover: 330, hits: [H({ range: 3.0, arc: 50, dmg: 85, stun: 420, knock: 5.5 })], lunge: 3.5, vfx: 'thrust', sfx: 'thrust' },
];
const spearChain = [
  { anim: 'spearThrust', wind: 130, active: 100, recover: 230, hits: [H({ range: 3.5, arc: 45, dmg: 58, stun: 300, knock: 2 })], lunge: 2, vfx: 'thrust', sfx: 'thrust' },
  { anim: 'spearThrust', wind: 120, active: 100, recover: 230, hits: [H({ range: 3.5, arc: 45, dmg: 62, stun: 320, knock: 2 })], lunge: 2, vfx: 'thrust', sfx: 'thrust' },
  { anim: 'slash1', wind: 160, active: 130, recover: 330, hits: [H({ range: 3.4, arc: 160, dmg: 85, stun: 420, knock: 5.5 })], lunge: 2.5, vfx: 'slashWide', sfx: 'swing_heavy' },
];
const fistChain = [
  { anim: 'punchL', wind: 70, active: 70, recover: 160, hits: [H({ range: 1.8, arc: 80, dmg: 42, stun: 280, knock: 1 })], lunge: 2.2, vfx: 'punch', sfx: 'punch' },
  { anim: 'punchR', wind: 70, active: 70, recover: 160, hits: [H({ range: 1.8, arc: 80, dmg: 46, stun: 280, knock: 1 })], lunge: 2.2, vfx: 'punch', sfx: 'punch' },
  { anim: 'kick', wind: 140, active: 100, recover: 300, hits: [H({ range: 2.2, arc: 110, dmg: 80, stun: 420, knock: 6 })], lunge: 2.4, vfx: 'kick', sfx: 'swing_heavy' },
];
const pistolChain = [
  { anim: 'shoot', wind: 40, active: 60, recover: 140, proj: [P({ dmg: 28, speed: 90, stun: 100, knock: 0.4 })], sfx: 'gun_shot', aimed: true },
  { anim: 'shoot2', wind: 40, active: 60, recover: 140, proj: [P({ dmg: 28, speed: 90, stun: 100, knock: 0.4, left: true })], sfx: 'gun_shot', aimed: true },
  { anim: 'shoot2', wind: 60, active: 80, recover: 240, proj: [P({ dmg: 30, speed: 90, stun: 180, knock: 1 }), P({ t: 60, dmg: 30, speed: 90, stun: 240, knock: 2.5, left: true })], sfx: 'gun_shot', aimed: true },
];
const cannonChain = [
  { anim: 'cannon', wind: 160, active: 60, recover: 380, proj: [P({ kind: 'shell', dmg: 60, speed: 30, radius: 0.25, range: 40, stun: 260, knock: 3, explode: { radius: 1.6, dmg: 15, knock: 3 } })], sfx: 'cannon', aimed: true, recoil: 1.2 },
];
const umbrellaGunChain = [
  { anim: 'shoot', wind: 50, active: 60, recover: 170, proj: [P({ dmg: 36, speed: 85, stun: 220, knock: 0.8 })], sfx: 'rifle_shot', aimed: true },
  { anim: 'shoot', wind: 50, active: 60, recover: 170, proj: [P({ dmg: 36, speed: 85, stun: 220, knock: 0.8 })], sfx: 'rifle_shot', aimed: true },
  { anim: 'shoot', wind: 80, active: 60, recover: 260, proj: [P({ dmg: 52, speed: 85, stun: 320, knock: 2.5 })], sfx: 'rifle_shot', aimed: true },
];
const umbrellaShieldChain = [
  { anim: 'thrust', wind: 120, active: 100, recover: 260, hits: [H({ range: 1.9, arc: 120, dmg: 50, stun: 380, knock: 3 })], lunge: 1.8, vfx: 'bash', sfx: 'shield_up' },
  { anim: 'slash2', wind: 140, active: 110, recover: 300, hits: [H({ range: 2.0, arc: 140, dmg: 60, stun: 420, knock: 5 })], lunge: 1.8, vfx: 'bash', sfx: 'hit_metal' },
];


const magicChain = (color, sfx = 'magic_bolt') => [
  { anim: 'cast', wind: 120, active: 60, recover: 200, proj: [P({ kind: 'magic', color, dmg: 41, speed: 29, radius: 0.25, stun: 150, knock: 0.5 })], sfx, aimed: true },
  { anim: 'cast', wind: 120, active: 60, recover: 200, proj: [P({ kind: 'magic', color, dmg: 41, speed: 29, radius: 0.25, stun: 150, knock: 0.5 })], sfx, aimed: true },
  { anim: 'castUp', wind: 200, active: 60, recover: 320, proj: [P({ kind: 'magic', color, dmg: 56, speed: 28, radius: 0.32, stun: 300, knock: 3 })], sfx, aimed: true },
];
const greatChain = [
  { anim: 'slash1', wind: 210, active: 130, recover: 330, hits: [H({ range: 2.9, arc: 140, dmg: 80, stun: 420, knock: 2 })], lunge: 1.8, vfx: 'slashWide', sfx: 'swing_heavy' },
  { anim: 'slash2', wind: 200, active: 130, recover: 330, hits: [H({ range: 2.9, arc: 140, dmg: 88, stun: 440, knock: 2 })], lunge: 1.8, vfx: 'slashWide', sfx: 'swing_heavy' },
  { anim: 'slash3', wind: 260, active: 130, recover: 420, hits: [H({ range: 3.0, arc: 70, dmg: 130, stun: 520, knock: 6 })], lunge: 2, vfx: 'slashUp', sfx: 'swing_heavy' },
];
const daggerChain = [
  { anim: 'thrust', wind: 50, active: 60, recover: 120, hits: [H({ range: 2.0, arc: 80, dmg: 30, stun: 240, knock: 0.6 })], lunge: 2, vfx: 'thrust', sfx: 'swing_light' },
  { anim: 'slash2', wind: 50, active: 70, recover: 130, hits: [H({ range: 2.0, arc: 110, dmg: 32, stun: 250, knock: 0.6 })], lunge: 2, vfx: 'slashL', sfx: 'swing_light' },
  { anim: 'slash1', wind: 60, active: 70, recover: 140, hits: [H({ range: 2.0, arc: 110, dmg: 34, stun: 260, knock: 0.8 })], lunge: 2, vfx: 'slashR', sfx: 'swing_light' },
  { anim: 'thrust', wind: 90, active: 80, recover: 260, hits: [H({ range: 2.2, arc: 60, dmg: 60, stun: 380, knock: 4 })], lunge: 2.4, vfx: 'thrust', sfx: 'thrust' },
];
const clubChain = [
  { anim: 'slash1', wind: 120, active: 100, recover: 220, hits: [H({ range: 2.3, arc: 120, dmg: 50, stun: 320, knock: 1.5 })], lunge: 2, vfx: 'slashR', sfx: 'swing_heavy' },
  { anim: 'slash2', wind: 120, active: 100, recover: 220, hits: [H({ range: 2.3, arc: 120, dmg: 55, stun: 330, knock: 1.5 })], lunge: 2, vfx: 'slashL', sfx: 'swing_heavy' },
  { anim: 'kick', wind: 150, active: 100, recover: 300, hits: [H({ range: 2.2, arc: 100, dmg: 75, stun: 420, knock: 6 })], lunge: 2.2, vfx: 'kick', sfx: 'swing_heavy' },
];

// ---------- 技能库（可被多个职业复用；散人用低级版本） ----------
export const SKILLS = {
  // 剑
  batou: { name: '拔刀斩', icon: 'sword', cd: 5000, mp: 12, anim: 'dashslash', wind: 160, active: 160, recover: 320, dash: { speed: 17, from: 'active', dur: 160 }, hits: [H({ t: 40, range: 2.6, arc: 120, dmg: 150, stun: 450, knock: 7 })], vfx: 'slashWide', sfx: 'swing_heavy', ai: { range: [2, 7], role: 'gap' }, desc: '向前突进一闪，击退。' },
  sanduan: { name: '三段斩', icon: 'sword', cd: 7000, mp: 14, anim: 'slash1', stages: 3, stageWindow: 650,
    stageDefs: [
      { anim: 'slash1', wind: 90, active: 110, recover: 200, dash: { speed: 12, from: 'active', dur: 110 }, hits: [H({ range: 2.5, dmg: 70, stun: 380, knock: 1.5 })], vfx: 'slashR' },
      { anim: 'slash2', wind: 90, active: 110, recover: 200, dash: { speed: 12, from: 'active', dur: 110 }, hits: [H({ range: 2.5, dmg: 75, stun: 380, knock: 1.5 })], vfx: 'slashL' },
      { anim: 'upslash', wind: 110, active: 120, recover: 300, dash: { speed: 10, from: 'active', dur: 100 }, hits: [H({ range: 2.6, dmg: 90, stun: 450, knock: 2, launch: 8 })], vfx: 'slashUp' },
    ], sfx: 'swing_light', desc: '三次突进斩，连按可衔接，末段挑空。', ai: { range: [1, 4.5], role: 'combo' } },
  shangtiao: { name: '上挑', icon: 'knockup', cd: 5500, mp: 10, anim: 'upslash', wind: 120, active: 110, recover: 280, hits: [H({ range: 2.4, arc: 100, dmg: 80, launch: 9.5, knock: 0.8, stun: 500 })], vfx: 'slashUp', sfx: 'launch', lunge: 1.5, ai: { range: [0, 2.6], role: 'launch' }, desc: '上挑挑空目标。' },
  yinguang: { name: '银光落刃', icon: 'sword', cd: 9000, mp: 18, anim: 'jumpslam', wind: 360, active: 120, recover: 420, leap: { vy: 6.5, fwd: 7 }, slamOnLand: true, hits: [H({ range: 2.8, arc: 360, h: [-0.5, 2.5], dmg: 170, down: true, knock: 4 })], vfx: 'ring', sfx: 'boss_slam', ai: { range: [3, 9], role: 'gap' }, desc: '跃起后急坠斩击，落点范围击倒。' },
  liantuci: { name: '连突刺', icon: 'target', cd: 8000, mp: 16, anim: 'thrust', wind: 150, active: 600, recover: 300, hits: [0, 120, 240, 360, 480].map((t, i) => H({ t, range: 2.8, arc: 50, dmg: 36, stun: 260, knock: i === 4 ? 5 : 0.6 })), vfx: 'thrustMulti', sfx: 'thrust', multiSfx: true, dash: { speed: 2.5, from: 'active', dur: 600 }, ai: { range: [0, 2.8], role: 'combo' }, desc: '高速连刺五次。' },
  huixuan: { name: '回旋斩', icon: 'sword', cd: 7000, mp: 14, anim: 'spin', wind: 140, active: 260, recover: 260, hits: [H({ t: 60, range: 2.6, arc: 360, dmg: 110, stun: 420, knock: 6 })], vfx: 'ring', sfx: 'swing_heavy', ai: { range: [0, 2.5], role: 'escape' }, desc: '回身一周斩，击退周围敌人。' },
  swordUlt: { glyph: '刃', name: '银光·千刃', icon: 'sword', cd: 40000, mp: 35, anim: 'dashslash', wind: 260, active: 900, recover: 400, armor: true, ult: true, dash: { speed: 9, from: 'active', dur: 900 },
    hits: [0, 110, 220, 330, 440, 550, 660, 780].map((t, i) => H({ t, range: 3, arc: 150, dmg: i === 7 ? 180 : 55, stun: 380, knock: i === 7 ? 9 : 0.5, launch: i === 7 ? 7 : 0 })), vfx: 'ult_blades', sfx: 'swing_heavy', multiSfx: true, ai: { range: [0, 4], role: 'ult' }, desc: '霸体突进，千刃乱斩后挑飞。' },
  // 矛（战斗法师）
  longya: { name: '龙牙', icon: 'spear', cd: 4500, mp: 10, anim: 'spearThrust', wind: 130, active: 120, recover: 260, dash: { speed: 9, from: 'active', dur: 110 }, hits: [H({ range: 3.8, arc: 40, dmg: 110, stun: 650, knock: 2 })], vfx: 'thrust', sfx: 'thrust', ai: { range: [1.5, 4.2], role: 'poke' }, desc: '突刺，命中使目标较长硬直。' },
  tianji: { name: '天击', icon: 'knockup', cd: 5000, mp: 10, anim: 'spearUp', wind: 130, active: 120, recover: 280, hits: [H({ range: 3.0, arc: 70, dmg: 95, launch: 10, knock: 1, stun: 500 })], vfx: 'slashUp', sfx: 'launch', lunge: 1.5, ai: { range: [0, 3.1], role: 'launch' }, desc: '上挑战矛，把目标击上天。' },
  yuanwu: { name: '圆舞棍', icon: 'spear', cd: 7000, mp: 14, anim: 'spearSpin', wind: 130, active: 300, recover: 280, hits: [H({ t: 40, range: 3.2, arc: 360, dmg: 70, stun: 380, knock: 2 }), H({ t: 200, range: 3.2, arc: 360, dmg: 80, stun: 420, knock: 7 })], vfx: 'ringWide', sfx: 'swing_heavy', multiSfx: true, ai: { range: [0, 3], role: 'escape' }, desc: '抡矛旋转两周，扫开周围。' },
  luohua: { name: '落花掌', icon: 'fist', cd: 6000, mp: 12, anim: 'palm', wind: 150, active: 100, recover: 300, hits: [H({ range: 2.0, arc: 70, dmg: 90, knock: 14, down: true, stun: 500 })], vfx: 'palm', sfx: 'hit_heavy', lunge: 1.2, ai: { range: [0, 2.2], role: 'finisher' }, desc: '掌击，将目标远远击飞倒地。' },
  longtaitou: { name: '龙抬头', icon: 'knockup', cd: 8000, mp: 14, anim: 'spearUp', wind: 150, active: 100, recover: 300, otg: true, hits: [H({ range: 3.2, arc: 60, h: [-0.5, 1.5], dmg: 90, launch: 9, stun: 500, otgOk: true })], vfx: 'slashUp', sfx: 'launch', ai: { range: [0, 3.2], role: 'otg' }, desc: '挑起倒地的目标，重新浮空。' },
  luoxing: { name: '落星', icon: 'spear', cd: 10000, mp: 18, anim: 'spearSlam', wind: 300, active: 100, recover: 450, leap: { vy: 7.5, fwd: 4 }, slamOnLand: true, hits: [H({ range: 3.2, arc: 360, h: [-0.5, 2.2], dmg: 160, down: true, knock: 3 })], vfx: 'ring', sfx: 'boss_slam', ai: { range: [1, 6], role: 'gap' }, desc: '高跃后以矛砸地，落点范围击倒。' },
  fulong: { glyph: '翔', name: '伏龙翔天', icon: 'spear', cd: 45000, mp: 40, anim: 'spearThrust', wind: 450, active: 500, recover: 500, armor: true, ult: true, dash: { speed: 18, from: 'active', dur: 420 },
    hits: [H({ t: 0, range: 3.4, arc: 70, dmg: 90, stun: 500, knock: 1 }), H({ t: 150, range: 3.4, arc: 70, dmg: 90, stun: 500, knock: 1 }), H({ t: 300, range: 3.6, arc: 80, dmg: 280, launch: 12, stun: 700, knock: 3 })], vfx: 'ult_dragon', sfx: 'thunder', ai: { range: [2, 8], role: 'ult' }, desc: '化作飞龙霸体突进，最后一击冲天。' },
  // 拳法家
  bengquan: { name: '崩拳', icon: 'fist', cd: 6000, mp: 14, anim: 'punchR', wind: 330, active: 80, recover: 380, armor: true, hits: [H({ range: 2.2, arc: 70, dmg: 190, knock: 11, stun: 600, guardBreak: true })], vfx: 'punchBig', sfx: 'hit_heavy', lunge: 1.5, ai: { range: [0, 2.3], role: 'finisher' }, desc: '蓄力重拳，霸体、破防、强击退。' },
  tiebu: { name: '铁步', icon: 'dodge', cd: 4000, mp: 8, anim: 'punchL', wind: 80, active: 160, recover: 200, dash: { speed: 14, from: 'wind', dur: 220 }, hits: [H({ t: 60, range: 1.9, arc: 90, dmg: 55, stun: 380, knock: 1 })], vfx: 'punch', sfx: 'dash', ai: { range: [2, 6], role: 'gap' }, desc: '滑步贴身并出拳。' },
  shenglong: { name: '升龙击', icon: 'knockup', cd: 5500, mp: 10, anim: 'uppercut', wind: 110, active: 120, recover: 300, hits: [H({ range: 1.9, arc: 80, dmg: 90, launch: 10.5, stun: 500, knock: 0.5 })], selfVy: 4, vfx: 'slashUp', sfx: 'launch', ai: { range: [0, 2], role: 'launch' }, desc: '上勾拳，把目标打上天。' },
  xuanfeng: { name: '旋风腿', icon: 'dodge', cd: 7000, mp: 14, anim: 'spinkick', wind: 120, active: 360, recover: 260, hits: [0, 120, 240].map((t, i) => H({ t, range: 2.3, arc: 360, dmg: 50, stun: 350, knock: i === 2 ? 6 : 1 })), vfx: 'ring', sfx: 'swing_heavy', multiSfx: true, dash: { speed: 4, from: 'active', dur: 360 }, ai: { range: [0, 2.3], role: 'combo' }, desc: '旋身连踢三脚。' },
  chanshou: { name: '缠手', icon: 'fist', cd: 9000, mp: 14, anim: 'grab', wind: 160, active: 90, recover: 380, grab: true, hits: [H({ range: 1.6, arc: 60, dmg: 110, down: true, stun: 700, knock: -1, unblockable: true })], vfx: 'palm', sfx: 'knockdown', ai: { range: [0, 1.6], role: 'grab' }, desc: '抓取摔倒，无视格挡。' },
  tieshan: { name: '铁山靠', icon: 'guard', cd: 8000, mp: 14, anim: 'palm', wind: 140, active: 220, recover: 300, armor: true, dash: { speed: 13, from: 'active', dur: 200 }, hits: [H({ t: 60, range: 1.8, arc: 90, dmg: 120, knock: 9, stun: 550 })], vfx: 'bash', sfx: 'hit_heavy', ai: { range: [1.5, 5], role: 'gap' }, desc: '霸体肩撞冲锋。' },
  menghu: { glyph: '虎', name: '猛虎硬爬山', icon: 'fist', cd: 40000, mp: 35, anim: 'punchR', wind: 250, active: 1000, recover: 450, armor: true, ult: true, dash: { speed: 6, from: 'active', dur: 900 },
    hits: [0, 120, 240, 360, 480, 600, 720, 900].map((t, i) => H({ t, range: 2.2, arc: 110, dmg: i === 7 ? 260 : 50, stun: 400, knock: i === 7 ? 12 : 0.6, down: i === 7 })), vfx: 'ult_fists', sfx: 'punch', multiSfx: true, altAnims: ['punchL', 'punchR'], ai: { range: [0, 3], role: 'ult' }, desc: '霸体连环重拳，最后一击击倒。' },
  // 枪（神枪手）
  luanshe: { name: '乱射', icon: 'target', cd: 7000, mp: 14, anim: 'shoot2', wind: 80, active: 900, recover: 220, proj: [0, 90, 180, 270, 360, 450, 540, 630, 720, 810].map((t, i) => P({ t, dmg: 20, speed: 85, stun: 140, knock: 0.3, spread: 3, left: i % 2 === 1 })), sfx: 'gun_shot', multiSfx: true, aimed: true, moveOk: 0.5, ai: { range: [3, 18], role: 'poke' }, desc: '双枪连射十发，可缓慢移动。' },
  fukong: { name: '浮空弹', icon: 'knockup', cd: 5000, mp: 10, anim: 'shootUp', wind: 90, active: 60, recover: 220, proj: [P({ dmg: 70, speed: 80, launch: 8.5, stun: 400, knock: 0.3 })], sfx: 'rifle_shot', aimed: true, ai: { range: [1, 16], role: 'launch' }, desc: '射出浮空弹，将目标打上天（对空中目标同样有效）。' },
  juji: { name: '狙击射击', icon: 'target', cd: 8000, mp: 16, anim: 'shoot', wind: 500, active: 60, recover: 300, proj: [P({ dmg: 180, speed: 160, radius: 0.12, range: 60, stun: 500, knock: 4 })], sfx: 'rifle_shot', aimed: true, ai: { range: [8, 40], role: 'poke' }, desc: '瞄准后射出高伤害子弹。' },
  tashe: { name: '踏射', icon: 'dodge', cd: 6000, mp: 10, anim: 'kick', wind: 70, active: 120, recover: 220, hits: [H({ range: 2, arc: 90, dmg: 60, knock: 7, stun: 400 })], proj: [P({ t: 100, dmg: 40, speed: 90 })], selfLeap: { vy: 5, back: 9 }, sfx: 'dash', aimed: true, ai: { range: [0, 2.5], role: 'escape' }, desc: '踢开近身敌人并后翻射击。' },
  grenade: { name: '手雷', icon: 'warning', cd: 9000, mp: 14, anim: 'throw', wind: 160, active: 80, recover: 260, proj: [P({ kind: 'grenade', dmg: 0, speed: 16, radius: 0.15, range: 30, gravity: 18, arc: 0.35, fuse: 1100, explode: { radius: 3.2, dmg: 150, down: true, knock: 5, stun: 600 } })], sfx: 'reload', aimed: true, ai: { range: [5, 16], role: 'zone' }, desc: '投掷手雷，爆炸击倒范围内敌人。' },
  zhuanshen: { name: '转身射击', icon: 'target', cd: 5000, mp: 10, anim: 'shoot2', wind: 60, active: 200, recover: 200, proj: [P({ dmg: 45, speed: 90, stun: 350, knock: 2 }), P({ t: 100, dmg: 45, speed: 90, stun: 350, knock: 2, left: true })], selfLeap: { vy: 0, back: 7 }, sfx: 'gun_shot', aimed: true, ai: { range: [0, 6], role: 'escape' }, desc: '侧滑后退同时双枪射击。' },
  gunUlt: { glyph: '雨', name: '枪林弹雨', icon: 'target', cd: 40000, mp: 35, anim: 'shoot2', wind: 200, active: 1200, recover: 300, armor: true, ult: true,
    proj: Array.from({ length: 24 }, (_, i) => P({ t: i * 50, dmg: 34, speed: 95, stun: 260, knock: i === 23 ? 6 : 0.4, spread: 8, left: i % 2 === 1 })), sfx: 'gun_shot', multiSfx: true, aimed: true, ai: { range: [2, 16], role: 'ult' }, desc: '霸体扇面弹幕扫射。' },
  // 炮（枪炮师）
  fantanke: { name: '反坦克炮', icon: 'warning', cd: 7500, mp: 16, anim: 'cannon', wind: 220, active: 60, recover: 380, proj: [P({ kind: 'shell', dmg: 100, speed: 34, radius: 0.28, range: 40, stun: 500, knock: 5, down: true, explode: { radius: 2.4, dmg: 50, down: true, knock: 5 } })], sfx: 'cannon', aimed: true, recoil: 2.5, ai: { range: [3, 22], role: 'poke' }, desc: '重型炮弹，爆炸击倒。' },
  jiguang: { name: '激光炮', icon: 'target', cd: 8000, mp: 18, anim: 'cannon', wind: 380, active: 500, recover: 300, beam: { range: 26, width: 0.45, ticks: 5, dmg: 36, stun: 280, knock: 1.5 }, sfx: 'thunder', aimed: true, ai: { range: [3, 24], role: 'poke' }, desc: '持续激光贯穿直线上的敌人。' },
  liudan: { name: '榴弹炮', icon: 'warning', cd: 8500, mp: 14, anim: 'cannon', wind: 180, active: 60, recover: 320, proj: [P({ kind: 'grenade', dmg: 0, speed: 20, radius: 0.2, range: 40, gravity: 16, arc: 0.45, fuse: 0, explode: { radius: 3.0, dmg: 120, launch: 7, stun: 500, knock: 2 } })], sfx: 'cannon', aimed: true, ai: { range: [6, 22], role: 'zone' }, desc: '抛射榴弹，爆炸把目标炸上天。' },
  gatling: { name: '格林机枪', icon: 'target', cd: 10000, mp: 20, anim: 'cannon', wind: 250, active: 1400, recover: 300, proj: Array.from({ length: 20 }, (_, i) => P({ t: i * 70, dmg: 13, speed: 80, stun: 120, knock: 0.25, spread: 4 })), sfx: 'gun_shot', multiSfx: true, aimed: true, moveOk: 0.35, ai: { range: [3, 18], role: 'poke' }, desc: '持续扫射，射击时可缓慢移动。' },
  houtiao: { name: '后跳炮', icon: 'dodge', cd: 6500, mp: 12, anim: 'cannon', wind: 80, active: 60, recover: 260, proj: [P({ kind: 'shell', dmg: 60, speed: 34, radius: 0.22, range: 30, stun: 350, knock: 3, explode: { radius: 1.8, dmg: 40, knock: 4 } })], selfLeap: { vy: 5.5, back: 10 }, sfx: 'cannon', aimed: true, ai: { range: [0, 5], role: 'escape' }, desc: '借后坐力后跳并开炮。' },
  kongzhong: { name: '空中爆雷', icon: 'knockup', cd: 7000, mp: 14, anim: 'castUp', wind: 200, active: 60, recover: 300, aoe: [{ t: 0, at: 'aim', radius: 2.4, delay: 700, dmg: 110, launch: 8, stun: 500, knock: 1, telegraph: true, vfx: 'explosion', sfx: 'explosion' }], sfx: 'reload', aimed: true, ai: { range: [3, 20], role: 'zone' }, desc: '在准星处投下延时爆雷，炸飞目标。' },
  weixing: { glyph: '卫', name: '卫星射线', icon: 'warning', cd: 45000, mp: 40, anim: 'castUp', wind: 400, active: 100, recover: 500, ult: true, aoe: [{ t: 0, at: 'aim', radius: 4.2, delay: 1300, dmg: 420, down: true, stun: 800, knock: 3, telegraph: true, vfx: 'satellite', sfx: 'thunder' }], sfx: 'magic_cast', aimed: true, ai: { range: [3, 25], role: 'ult' }, desc: '呼叫天空射线轰击准星处，延时巨额伤害。' },

  // ---- 术士 ----
  xuruo: { name: '虚弱诅咒', icon: 'warning', cd: 9000, mp: 12, anim: 'cast', wind: 180, active: 60, recover: 260, proj: [P({ kind: 'magic', color: '#b05cff', dmg: 65, speed: 30, radius: 0.32, stun: 300, knock: 0.5, effect: { type: 'weak', t: 6000 } })], sfx: 'dark', aimed: true, ai: { range: [3, 20], role: 'poke' }, desc: '诅咒目标，6 秒内伤害降低 25%。' },
  yingfu: { name: '影缚术', icon: 'target', cd: 8000, mp: 14, anim: 'cast', wind: 220, active: 60, recover: 280, proj: [P({ kind: 'magic', color: '#7a3cff', dmg: 60, speed: 26, radius: 0.3, stun: 300, knock: 0.2, effect: { type: 'root', t: 1600 } })], sfx: 'dark', aimed: true, ai: { range: [3, 18], role: 'poke' }, desc: '暗影锁链定身目标 1.6 秒。' },
  anyingqiu: { name: '暗影球', icon: 'warning', cd: 7000, mp: 16, anim: 'cast', wind: 300, active: 60, recover: 320, proj: [P({ kind: 'magic', color: '#9a4cff', dmg: 60, speed: 12, radius: 0.45, range: 30, stun: 400, knock: 2, explode: { radius: 2.8, dmg: 135, down: true, knock: 5, color: '#9a4cff' } })], sfx: 'dark', aimed: true, ai: { range: [3, 16], role: 'zone' }, desc: '缓慢飞行的暗影球，爆炸击倒。' },
  kongju: { name: '恐惧术', icon: 'warning', cd: 12000, mp: 16, anim: 'cast', wind: 200, active: 80, recover: 300, hits: [H({ range: 6, arc: 60, dmg: 30, stun: 200, knock: 0.5, effect: { type: 'fear', t: 1500 } })], vfx: 'palm', sfx: 'dark', ai: { range: [0, 5.5], role: 'escape' }, desc: '前方锥形范围内的敌人陷入恐惧，四散奔逃 1.5 秒。' },
  xiqu: { name: '生命吸取', icon: 'health', cd: 10000, mp: 18, anim: 'cast', wind: 200, active: 1200, recover: 250, beam: { range: 15, width: 0.4, ticks: 6, dmg: 40, stun: 260, knock: 0.2, drain: 0.6 }, color: '#b05cff', sfx: 'dark', aimed: true, ai: { range: [2, 13], role: 'poke' }, desc: '持续吸取目标生命，按伤害 60% 回复自己。' },
  anyinglieyan: { name: '暗影烈焰', icon: 'warning', cd: 11000, mp: 18, anim: 'castUp', wind: 240, active: 60, recover: 260, aoe: [{ t: 0, at: 'aim', radius: 3, delay: 500, ticks: 5, interval: 450, dmg: 35, stun: 200, knock: 0.3, effect: { type: 'slow', t: 1500 }, telegraph: true, vfx: 'zone', color: '#9a4cff', sfx: 'fire' }], aimed: true, sfx: 'dark', ai: { range: [3, 20], role: 'zone' }, desc: '在准星处燃起暗影火焰，持续伤害并减速。' },
  diyuzhimen: { glyph: '狱', name: '地狱之门', icon: 'warning', cd: 45000, mp: 40, anim: 'castUp', wind: 400, active: 100, recover: 500, ult: true, aoe: [{ t: 0, at: 'aim', radius: 5, delay: 1200, dmg: 320, launch: 7, pull: true, stun: 600, knock: 4, telegraph: true, vfx: 'vortex', sfx: 'dark' }], aimed: true, sfx: 'magic_cast', ai: { range: [3, 22], role: 'ult' }, desc: '打开地狱之门，吸入范围内敌人并炸上天。' },
  // ---- 牧师 ----
  zhiliao: { name: '治疗术', icon: 'health', cd: 5000, mp: 18, anim: 'heal', wind: 350, active: 80, recover: 250, heal: { target: 'lowest', amount: 480, range: 22 }, sfx: 'heal', ai: { range: [0, 99], role: 'heal' }, desc: '治疗生命比例最低的队友（或自己）480 点。' },
  chengjie: { name: '惩戒', icon: 'target', cd: 8000, mp: 14, anim: 'cast', wind: 220, active: 60, recover: 260, proj: [P({ kind: 'magic', color: '#ffe7a0', dmg: 95, speed: 40, radius: 0.28, stun: 1100, knock: 0.5 })], sfx: 'holy', aimed: true, ai: { range: [2, 20], role: 'poke' }, desc: '神圣之锤，命中后长时间硬直。' },
  shenshenghuo: { name: '神圣之火', icon: 'warning', cd: 9000, mp: 16, anim: 'castUp', wind: 260, active: 60, recover: 260, aoe: [{ t: 0, at: 'aim', radius: 3, delay: 400, ticks: 4, interval: 500, dmg: 45, stun: 250, knock: 0.5, telegraph: true, vfx: 'zone', color: '#ffd27a', sfx: 'fire' }], aimed: true, sfx: 'holy', ai: { range: [3, 20], role: 'zone' }, desc: '圣火灼烧准星处，持续伤害。' },
  qunliao: { name: '群体治疗', icon: 'health', cd: 14000, mp: 26, anim: 'castUp', wind: 500, active: 80, recover: 300, heal: { target: 'allies', radius: 14, amount: 260, hot: { t: 4000, hps: 45 } }, sfx: 'heal', ai: { range: [0, 99], role: 'heal' }, desc: '治疗附近所有队友，并附加持续回复。' },
  hudun: { name: '神圣护盾', icon: 'guard', cd: 12000, mp: 18, anim: 'heal', wind: 200, active: 60, recover: 240, heal: { target: 'lowest', amount: 0, range: 22, shield: { t: 6000, amount: 450 } }, sfx: 'holy', ai: { range: [0, 99], role: 'heal' }, desc: '为最需要的队友加上可吸收 450 伤害的护盾。' },
  guangchong: { name: '光之冲击', icon: 'warning', cd: 9000, mp: 14, anim: 'castUp', wind: 180, active: 100, recover: 280, hits: [H({ range: 3.6, arc: 360, dmg: 90, knock: 9, down: true })], vfx: 'ringWide', sfx: 'holy', ai: { range: [0, 3.2], role: 'escape' }, desc: '以自身为中心爆发圣光，击倒周围敌人。' },
  tianshi: { glyph: '翼', name: '天使之翼', icon: 'health', cd: 50000, mp: 40, anim: 'castUp', wind: 500, active: 100, recover: 400, ult: true, heal: { target: 'allies', radius: 22, pct: 0.35, armor: 3000 }, sfx: 'holy', ai: { range: [0, 99], role: 'heal' }, desc: '全队回复 35% 生命并获得 3 秒霸体。' },
  // ---- 魔道学者 ----
  saozhou: { name: '扫帚冲刺', icon: 'dodge', cd: 5000, mp: 10, anim: 'thrust', wind: 80, active: 450, recover: 200, flyDash: { speed: 15, dur: 450 }, hits: [60, 200, 340].map((t) => H({ t, range: 2.1, arc: 120, dmg: 45, stun: 350, knock: 3 })), sfx: 'dash', ai: { range: [2, 7], role: 'gap' }, desc: '骑扫帚沿视线方向（可向上）高速冲刺，撞击沿途敌人。' },
  bingdong: { name: '冰冻药水', icon: 'warning', cd: 8000, mp: 12, anim: 'throw', wind: 160, active: 80, recover: 240, proj: [P({ kind: 'grenade', color: '#9fe6ff', dmg: 0, speed: 18, radius: 0.15, range: 30, gravity: 16, arc: 0.35, fuse: 0, explode: { radius: 3, dmg: 80, stun: 400, knock: 1, effect: { type: 'slow', t: 3000 }, color: '#9fe6ff' } })], sfx: 'ice', aimed: true, ai: { range: [4, 16], role: 'zone' }, desc: '投掷冰冻药水，范围伤害并减速 3 秒。' },
  yunshi: { name: '陨石术', icon: 'warning', cd: 10000, mp: 20, anim: 'castUp', wind: 280, active: 60, recover: 300, aoe: [{ t: 0, at: 'aim', radius: 3.2, delay: 1000, dmg: 225, down: true, stun: 600, knock: 4, telegraph: true, vfx: 'meteor', sfx: 'explosion' }], aimed: true, sfx: 'fire', ai: { range: [4, 24], role: 'zone' }, desc: '召唤陨石砸向准星处，延时击倒。' },
  feidan: { name: '魔法飞弹', icon: 'target', cd: 6000, mp: 12, anim: 'cast', wind: 150, active: 200, recover: 220, proj: [0, 90, 180].map((t) => P({ t, kind: 'magic', color: '#c9a0ff', dmg: 45, speed: 24, radius: 0.22, homing: 4, spread: 10, stun: 260, knock: 0.6 })), sfx: 'magic_bolt', aimed: true, ai: { range: [3, 20], role: 'poke' }, desc: '三发追踪飞弹。' },
  fushen: { name: '缚身药水', icon: 'target', cd: 11000, mp: 14, anim: 'throw', wind: 160, active: 80, recover: 240, proj: [P({ kind: 'grenade', color: '#7aff9a', dmg: 0, speed: 18, radius: 0.15, range: 30, gravity: 16, arc: 0.35, fuse: 0, explode: { radius: 2.5, dmg: 50, stun: 300, knock: 0.5, effect: { type: 'root', t: 1800 }, color: '#7aff9a' } })], sfx: 'magic_cast', aimed: true, ai: { range: [4, 16], role: 'zone' }, desc: '药水炸开后定身范围内敌人 1.8 秒。' },
  xuanfengsao: { name: '旋风扫', icon: 'dodge', cd: 7000, mp: 12, anim: 'spin', wind: 120, active: 260, recover: 240, hits: [H({ t: 60, range: 2.6, arc: 360, dmg: 80, knock: 7, stun: 400 })], vfx: 'ring', sfx: 'swing_heavy', ai: { range: [0, 2.5], role: 'escape' }, desc: '抡扫帚横扫一周，击退贴身敌人。' },
  xingyun: { name: '星陨', icon: 'warning', cd: 45000, mp: 40, anim: 'castUp', wind: 400, active: 900, recover: 400, ult: true, aoe: [0, 200, 400, 600, 800].map((t) => ({ t, at: 'aim', scatter: 3.2, radius: 2.6, delay: 900, dmg: 150, down: true, stun: 600, knock: 3, telegraph: true, vfx: 'meteor', sfx: 'explosion' })), aimed: true, sfx: 'magic_cast', ai: { range: [4, 24], role: 'ult' }, desc: '准星附近连续落下五颗陨石。' },
  // ---- 狂剑士 ----
  bengshan: { name: '崩山击', icon: 'sword', cd: 8000, mp: 16, anim: 'jumpslam', wind: 260, active: 100, recover: 420, armor: true, leap: { vy: 7, fwd: 6 }, slamOnLand: true, hits: [H({ range: 3.0, arc: 360, h: [-0.5, 2.4], dmg: 170, down: true, knock: 4 })], vfx: 'ring', sfx: 'boss_slam', ai: { range: [2, 8], role: 'gap' }, desc: '霸体跃起重砸，落点击倒。' },
  xueying: { name: '血影狂刃', icon: 'sword', cd: 9000, mp: 16, anim: 'spin', wind: 140, active: 420, recover: 300, hits: [0, 140, 280].map((t, i) => H({ t, range: 2.8, arc: 360, dmg: 60, stun: 380, knock: i === 2 ? 6 : 1, drain: 0.35 })), vfx: 'ring', sfx: 'swing_heavy', multiSfx: true, ai: { range: [0, 2.7], role: 'combo' }, desc: '旋身三连斩，按伤害 35% 吸血。' },
  dilie: { name: '地裂波动剑', icon: 'sword', cd: 7000, mp: 14, anim: 'slash3', wind: 250, active: 80, recover: 320, proj: [P({ kind: 'wave', color: '#ff6a5a', dmg: 110, speed: 18, radius: 0.7, range: 14, ground: true, pierce: true, launch: 7, stun: 450, knock: 1 })], sfx: 'boss_slam', ai: { range: [2, 13], role: 'poke' }, desc: '剑气沿地面推进，贯穿并挑起途经的敌人。' },
  kuangbao: { name: '狂暴', icon: 'health', cd: 25000, mp: 10, anim: 'castUp', wind: 200, active: 80, recover: 200, buff: { type: 'berserk', t: 8000, dmgMul: 1.3, lifesteal: 0.12 }, buffColor: '#ff3a2a', hpCost: 0.08, sfx: 'boss_roar', ai: { range: [0, 6], role: 'buff' }, desc: '消耗 8% 生命，8 秒内伤害 +30%、吸血 12%。' },
  shizi: { name: '十字斩', icon: 'sword', cd: 6500, mp: 14, anim: 'slash1', wind: 160, active: 300, recover: 360, altAnims: ['slash1', 'slash3'], hits: [H({ t: 0, range: 2.8, arc: 120, dmg: 90, stun: 450, knock: 1 }), H({ t: 180, range: 2.8, arc: 60, dmg: 130, stun: 500, knock: 6 })], vfx: 'slashWide', sfx: 'swing_heavy', multiSfx: true, ai: { range: [0, 2.8], role: 'finisher' }, desc: '横竖两斩，第二斩重击退。' },
  nuhou: { name: '怒吼', icon: 'warning', cd: 14000, mp: 12, anim: 'castUp', wind: 200, active: 80, recover: 260, hits: [H({ range: 4, arc: 360, dmg: 20, stun: 200, knock: 1, effect: { type: 'fear', t: 1200 } })], vfx: 'ringWide', sfx: 'boss_roar', ai: { range: [0, 3.8], role: 'escape' }, desc: '震耳怒吼，周围敌人恐惧 1.2 秒。' },
  xuezhikuangnu: { glyph: '怒', name: '血之狂怒', icon: 'sword', cd: 42000, mp: 35, anim: 'slash1', wind: 250, active: 1000, recover: 450, armor: true, ult: true, dash: { speed: 6, from: 'active', dur: 900 }, altAnims: ['slash1', 'slash2', 'slash3'],
    hits: [0, 130, 260, 390, 520, 650, 780, 920].map((t, i) => H({ t, range: 3, arc: 150, dmg: i === 7 ? 240 : 70, stun: 400, knock: i === 7 ? 10 : 0.6, down: i === 7, drain: 0.25 })), vfx: 'ult_blades', sfx: 'swing_heavy', multiSfx: true, ai: { range: [0, 3.2], role: 'ult' }, desc: '霸体狂斩八刀，吸血，最后一刀击倒。' },
  // ---- 刺客 ----
  yingxi: { name: '影袭', icon: 'dodge', cd: 10000, mp: 14, anim: 'thrust', wind: 120, active: 100, recover: 280, blink: { range: 12 }, hits: [H({ t: 40, range: 2.2, arc: 120, dmg: 90, stun: 650, knock: 1 })], vfx: 'thrust', sfx: 'shadow_step', ai: { range: [3, 12], role: 'gap' }, desc: '瞬移到目标身后并刺击。' },
  beici: { name: '背刺', icon: 'target', cd: 6000, mp: 12, anim: 'thrust', wind: 180, active: 90, recover: 300, hits: [H({ range: 2.2, arc: 70, dmg: 100, backMul: 1.8, stun: 500, knock: 2 })], vfx: 'thrust', sfx: 'thrust', lunge: 1.5, ai: { range: [0, 2.2], role: 'finisher' }, desc: '从背后命中时伤害 ×2.2。' },
  duren: { name: '毒刃', icon: 'sword', cd: 7000, mp: 12, anim: 'slash2', wind: 110, active: 90, recover: 240, hits: [H({ range: 2.2, arc: 110, dmg: 60, stun: 350, knock: 1, effect: { type: 'dot', t: 5000, dps: 30 } })], vfx: 'slashL', sfx: 'swing_light', lunge: 1.5, ai: { range: [0, 2.3], role: 'poke' }, desc: '淬毒一刀，5 秒内持续掉血。' },
  yanwu: { name: '烟雾弹', icon: 'warning', cd: 14000, mp: 14, anim: 'throw', wind: 120, active: 60, recover: 220, aoe: [{ t: 0, at: 'self', radius: 4, delay: 0, ticks: 5, interval: 400, dmg: 1, noStun: true, effect: { type: 'blind', t: 1600 }, vfx: 'zone', color: '#8a8a90', sfx: 'dash' }], sfx: 'dash', ai: { range: [0, 4], role: 'escape' }, desc: '脚下炸开烟雾，致盲范围内敌人。' },
  shunying: { name: '瞬影杀', icon: 'dodge', cd: 6000, mp: 12, anim: 'dashslash', wind: 100, active: 200, recover: 260, dash: { speed: 24, from: 'active', dur: 180 }, hits: [H({ t: 60, range: 2.4, arc: 140, dmg: 100, stun: 450, knock: 3 })], vfx: 'slashWide', sfx: 'dash', ai: { range: [2, 6], role: 'gap' }, desc: '高速突进斩击。' },
  feidao: { name: '飞刀', icon: 'target', cd: 5000, mp: 10, anim: 'throw', wind: 100, active: 60, recover: 200, proj: [0, 0, 0].map(() => P({ kind: 'bullet', color: '#cfd8e0', dmg: 40, speed: 50, spread: 7, stun: 300, knock: 0.5 })), sfx: 'swing_light', aimed: true, ai: { range: [3, 18], role: 'poke' }, desc: '扇形掷出三把飞刀。' },
  qianying: { glyph: '杀', name: '千影绝杀', icon: 'dodge', cd: 42000, mp: 35, anim: 'thrust', wind: 150, active: 900, recover: 400, armor: true, ult: true, blink: { range: 14 }, altAnims: ['thrust', 'slash1', 'slash2'],
    hits: [60, 180, 300, 420, 540, 700].map((t, i) => H({ t, range: 2.4, arc: 140, dmg: i === 5 ? 220 : 60, stun: 420, knock: i === 5 ? 9 : 0.5, down: i === 5, backMul: 1.5 })), vfx: 'ult_blades', sfx: 'swing_light', multiSfx: true, ai: { range: [2, 14], role: 'ult' }, desc: '瞬移至目标身后，霸体连刺，最后一击击倒。' },
  // ---- 流氓 ----
  shasha: { name: '撒沙', icon: 'warning', cd: 10000, mp: 10, anim: 'throw', wind: 100, active: 80, recover: 220, hits: [H({ range: 4, arc: 70, dmg: 20, stun: 300, knock: 0.3, effect: { type: 'blind', t: 1800 } })], vfx: 'palm', sfx: 'dash', ai: { range: [0, 3.8], role: 'poke' }, desc: '往对手脸上撒沙，致盲 2.5 秒。' },
  banzhuan: { name: '板砖', icon: 'target', cd: 6000, mp: 10, anim: 'throw', wind: 140, active: 60, recover: 220, proj: [P({ kind: 'grenade', color: '#b0553a', dmg: 70, speed: 24, radius: 0.18, gravity: 10, arc: 0.12, stun: 900, knock: 1 })], sfx: 'swing_heavy', aimed: true, ai: { range: [3, 16], role: 'poke' }, desc: '扔出板砖，命中造成长时间硬直。' },
  beishuai: { name: '背摔', icon: 'fist', cd: 9000, mp: 14, anim: 'grab', wind: 150, active: 90, recover: 380, grab: true, hits: [H({ range: 1.7, arc: 70, dmg: 130, down: true, stun: 700, knock: -1, unblockable: true })], vfx: 'palm', sfx: 'knockdown', ai: { range: [0, 1.7], role: 'grab' }, desc: '抓住对手背摔，无视格挡。' },
  caita: { name: '踩踏', icon: 'fist', cd: 5000, mp: 10, anim: 'stomp', wind: 120, active: 80, recover: 260, hits: [H({ range: 1.9, arc: 100, h: [-0.5, 0.9], dmg: 60, downMul: 2.3, otgOk: true, stun: 300, knock: 0.5 })], vfx: 'punch', sfx: 'hit_heavy', ai: { range: [0, 1.9], role: 'otg' }, desc: '狠踩倒地的敌人（对倒地目标伤害 ×2.3）。' },
  duyao: { name: '毒药瓶', icon: 'warning', cd: 9000, mp: 12, anim: 'throw', wind: 140, active: 60, recover: 220, proj: [P({ kind: 'grenade', color: '#7adf5a', dmg: 0, speed: 18, radius: 0.15, gravity: 16, arc: 0.3, fuse: 0, explode: { radius: 2.5, dmg: 30, stun: 250, knock: 0.3, effect: { type: 'dot', t: 5000, dps: 28 }, color: '#7adf5a' } })], sfx: 'magic_cast', aimed: true, ai: { range: [3, 15], role: 'zone' }, desc: '毒药瓶炸开，范围内持续中毒。' },
  saotang: { name: '扫堂腿', icon: 'dodge', cd: 7000, mp: 12, anim: 'spinkick', wind: 130, active: 220, recover: 280, hits: [H({ t: 60, range: 2.4, arc: 360, h: [-0.5, 0.9], dmg: 70, down: true, knock: 3 })], vfx: 'ring', sfx: 'swing_heavy', ai: { range: [0, 2.3], role: 'finisher' }, desc: '低位扫腿，击倒周围敌人。' },
  liumang: { glyph: '连', name: '流氓连环', icon: 'fist', cd: 40000, mp: 35, anim: 'slash1', wind: 200, active: 900, recover: 420, armor: true, ult: true, dash: { speed: 5, from: 'active', dur: 700 }, altAnims: ['slash1', 'slash2', 'kick', 'slash3'],
    hits: [0, 150, 300, 450, 600].map((t, i) => H({ t, range: 2.4, arc: 130, dmg: i === 4 ? 200 : 60, stun: 450, knock: i === 4 ? 10 : 0.5, down: i === 4 })), proj: [P({ t: 760, kind: 'grenade', color: '#b0553a', dmg: 80, speed: 26, radius: 0.18, gravity: 8, stun: 1000 })], vfx: 'ult_fists', sfx: 'hit_heavy', multiSfx: true, ai: { range: [0, 3], role: 'ult' }, desc: '棍棒拳脚一顿招呼，最后补一板砖。' },
  // 散人专属/通用
  qianjiUlt: { name: '千机·百式', icon: 'umbrella', cd: 40000, mp: 35, anim: 'slash1', wind: 200, active: 1400, recover: 400, armor: true, ult: true, umbrellaSeq: ['sword', 'spear', 'gun', 'spear', 'shield', 'spear'],
    hits: [H({ t: 0, range: 2.6, dmg: 70, stun: 400, knock: 0.5 }), H({ t: 230, range: 3.4, arc: 50, dmg: 80, stun: 400, knock: 0.5 }), H({ t: 700, range: 3.2, arc: 360, dmg: 90, launch: 8, stun: 500 }), H({ t: 1150, range: 2.4, arc: 120, dmg: 160, knock: 12, down: true, stun: 600 })],
    proj: [P({ t: 460, dmg: 60, speed: 90, launch: 5 }), P({ t: 540, dmg: 60, speed: 90, launch: 5 })],
    altAnims: ['slash1', 'spearThrust', 'shoot', 'spearSpin', 'palm'], vfx: 'ult_blades', sfx: 'form_switch', multiSfx: true, ai: { range: [0, 3.5], role: 'ult' }, desc: '千机伞连续变形：剑、矛、枪、盾，一气呵成。' },
};

// ---------- 职业 ----------
export const CLASSES = {
  unspecialized: {
    name: '散人', group: '散人', weapon: 'umbrella', stance: 'umbrella_sword', portrait: 'unspecialized', dmgMul: 1.12,
    hp: 3150, mp: 100, speed: 5.6, role: '全能 / 跨形态连段',
    desc: '未转职的散人，靠千机伞在剑、矛、枪、盾四种形态间切换，使用各系低级技能。技能会自动切换所需形态；连续使用不同形态的技能叠加“百家”增伤。',
    forms: { sword: { chain: swordChain, stance: 'umbrella_sword', guard: 'sword' }, spear: { chain: spearChain, stance: 'umbrella_spear', guard: 'spear' }, gun: { chain: umbrellaGunChain, stance: 'umbrella_gun', guard: 'sword' }, shield: { chain: umbrellaShieldChain, stance: 'umbrella_shield', guard: 'shield' } },
    special: { type: 'guard', kind: 'shield', form: 'shield', arc: 150, name: '伞盾' },
    skills: {
      s1: { ...SKILLS.tianji, form: 'spear' },
      s2: { ...SKILLS.longya, form: 'spear' },
      s3: { ...SKILLS.batou, form: 'sword' },
      s4: { ...SKILLS.fantanke, form: 'gun', proj: [P({ kind: 'shell', dmg: 95, speed: 36, radius: 0.26, range: 36, stun: 500, knock: 5, down: true, explode: { radius: 2.4, dmg: 60, down: true, knock: 5 } })], anim: 'shoot', recoil: 1.5 },
      s5: { ...SKILLS.fukong, form: 'gun', anim: 'shootUp' },
      s6: { ...SKILLS.luohua, form: 'shield' },
      ult: SKILLS.qianjiUlt,
    },
    passive: '百家：连续用不同形态的技能命中，每层 +8% 伤害，最多 3 层。',
    look: { sex: 'm', hair: { style: 'spiky', color: '#1b1d24' }, top: { style: 'jacket', color: '#e6e0d3', trim: '#8a6a44', inner: '#2e3138' }, pants: '#2c3038', boots: '#3a2a20', gloves: '#2a2420', sash: '#4d9d9a', shoulder: 'light', accent: '#4d9d9a' },
  },
  swordmaster: {
    name: '剑客', group: '剑士', weapon: 'sword', stance: 'sword', portrait: 'swordmaster', dmgMul: 1.06,
    hp: 3300, mp: 100, speed: 5.8, role: '近战爆发 / 格挡反击',
    desc: '剑士系的正统。灵活的突进、连斩与挑空，右键格挡：在出招瞬间格挡成功（完美格挡）后可立刻左键“回锋”反击。',
    chain: swordChain,
    special: { type: 'guard', kind: 'sword', arc: 110, parry: true, name: '格挡' },
    counter: { name: '回锋', anim: 'slash2', wind: 60, active: 90, recover: 260, hits: [H({ range: 2.8, arc: 140, dmg: 170, stun: 700, knock: 3, launch: 6 })], vfx: 'slashWide', sfx: 'parry' },
    skills: { s1: SKILLS.batou, s2: SKILLS.sanduan, s3: SKILLS.shangtiao, s4: SKILLS.yinguang, s5: SKILLS.liantuci, s6: SKILLS.huixuan, ult: SKILLS.swordUlt },
    passive: '剑意：完美格挡后 2 秒内伤害 +20%。',
    look: { sex: 'm', hair: { style: 'short', color: '#c9b27a' }, top: { style: 'coat', color: '#2f4b6e', trim: '#c9d2dc', inner: '#e7e2d7' }, pants: '#1f2632', boots: '#2b2b33', gloves: '#e7e2d7', sash: null, shoulder: 'light', accent: '#7fd3ff', scarf: null },
  },
  battlemage: {
    name: '战斗法师', group: '法师', weapon: 'spear', stance: 'spear', portrait: 'battlemage', dmgMul: 1.15,
    hp: 3300, mp: 100, speed: 5.6, role: '中近距离 / 浮空连段',
    desc: '持战矛的法师，矛端距离与挑空连段是核心：天击起手，龙牙、圆舞棍衔接，落花掌收尾；龙抬头能把倒地的人重新挑起。',
    chain: spearChain,
    special: { type: 'guard', kind: 'spear', arc: 110, name: '矛挡' },
    skills: { s1: SKILLS.tianji, s2: SKILLS.longya, s3: SKILLS.yuanwu, s4: SKILLS.luohua, s5: SKILLS.longtaitou, s6: SKILLS.luoxing, ult: SKILLS.fulong },
    passive: '战斗意志：对浮空目标伤害 +10%。',
    look: { sex: 'm', hair: { style: 'spiky', color: '#2a2320' }, top: { style: 'coat', color: '#26262c', trim: '#c7a45a', inner: '#7a2630' }, pants: '#1d1d22', boots: '#3b2a1f', gloves: '#1d1d22', sash: '#b13a3a', shoulder: 'heavy', accent: '#e0b050' },
  },
  striker: {
    name: '拳法家', group: '格斗', weapon: 'gauntlet', stance: 'fist', portrait: 'striker', dmgMul: 1.06,
    hp: 3630, mp: 100, speed: 5.9, role: '贴身 / 霸体压制',
    desc: '格斗系的拳脚宗师。贴身后连段极快，崩拳、铁山靠带霸体，缠手无视格挡直接摔倒对手。怕被长兵器控在距离外。',
    chain: fistChain,
    special: { type: 'guard', kind: 'fist', arc: 100, name: '架拳' },
    skills: { s1: SKILLS.shenglong, s2: SKILLS.tiebu, s3: SKILLS.bengquan, s4: SKILLS.xuanfeng, s5: SKILLS.chanshou, s6: SKILLS.tieshan, ult: SKILLS.menghu },
    passive: '钢筋铁骨：受到的击退距离 -30%。',
    look: { sex: 'm', build: 1.12, hair: { style: 'short', color: '#15161a' }, top: { style: 'vest', color: '#1c1c20', trim: '#9b2d2d', inner: '#1c1c20' }, pants: '#2a2a30', boots: '#1a1a1d', gloves: '#6d2525', sash: '#9b2d2d', shoulder: 'none', accent: '#d04a3a' },
  },
  sharpshooter: {
    name: '神枪手', group: '枪手', weapon: 'pistol', stance: 'pistol', portrait: 'sharpshooter', dmgMul: 0.87,
    hp: 2660, mp: 100, speed: 6.0, role: '远程 / 机动射击',
    desc: '双枪手。左键双枪速射，右键瞄准（精度与伤害提高）。浮空弹能把目标打上天后用乱射接连段，踏射、转身射击拉开距离。',
    chain: pistolChain,
    special: { type: 'aim', fov: 0.62, dmgMul: 1.25, name: '瞄准' },
    skills: { s1: SKILLS.fukong, s2: SKILLS.luanshe, s3: SKILLS.juji, s4: SKILLS.tashe, s5: SKILLS.grenade, s6: SKILLS.zhuanshen, ult: SKILLS.gunUlt },
    passive: '枪斗术：命中浮空目标时额外把目标托高。',
    look: { sex: 'm', hair: { style: 'short', color: '#1a1a20' }, top: { style: 'coat', color: '#dcdde0', trim: '#5e7f9a', inner: '#20242c' }, pants: '#262a31', boots: '#22222a', gloves: '#1f2228', sash: null, shoulder: 'light', accent: '#e05a3a' },
    weaponOpts: { color: '#8b3a2a', colorL: '#5e7f9a' },
  },
  launcher: {
    name: '枪炮师', group: '枪手', weapon: 'cannon', stance: 'cannon', portrait: 'launcher', dmgMul: 0.86,
    hp: 2700, mp: 100, speed: 5.3, role: '远程火力 / 范围压制',
    desc: '扛炮的火力手。反坦克炮击倒、榴弹与空中爆雷封锁区域、激光炮贯穿直线；卫星射线延时从天而降。近身时靠后跳炮脱离。',
    chain: cannonChain,
    special: { type: 'aim', fov: 0.72, dmgMul: 1.15, name: '瞄准' },
    skills: { s1: SKILLS.fantanke, s2: SKILLS.liudan, s3: SKILLS.jiguang, s4: SKILLS.gatling, s5: SKILLS.kongzhong, s6: SKILLS.houtiao, ult: SKILLS.weixing },
    passive: '重火力：爆炸范围 +15%。',
    look: { sex: 'f', hair: { style: 'long', color: '#6b3a24' }, top: { style: 'jacket', color: '#d9772e', trim: '#f2d8a6', inner: '#2c2622' }, pants: '#2a2522', boots: '#4a3326', gloves: '#2a2522', sash: '#f2d8a6', shoulder: 'light', accent: '#ffb35a' },
  },

  warlock: {
    name: '术士', group: '暗夜', weapon: 'tome', stance: 'tome', portrait: 'warlock', magicColor: '#b05cff', dmgMul: 1.06,
    hp: 3300, mp: 110, speed: 5.4, role: '远程控制 / 诅咒', aiRange: 11,
    desc: '暗夜系的控制大师。虚弱、定身、恐惧层层削弱对手，生命吸取续航，地狱之门吸人炸飞。近身脆弱。',
    chain: magicChain('#b05cff', 'dark'),
    special: { type: 'guard', kind: 'magic', arc: 120, name: '暗影屏障' },
    skills: { s1: SKILLS.xuruo, s2: SKILLS.yingfu, s3: SKILLS.anyingqiu, s4: SKILLS.kongju, s5: SKILLS.xiqu, s6: SKILLS.anyinglieyan, ult: SKILLS.diyuzhimen },
    passive: '腐蚀：对处于负面状态的目标伤害 +10%。',
    look: { sex: 'm', hair: { style: 'short', color: '#2a2230' }, top: { style: 'robe', color: '#3a2a4a', trim: '#b89adf', inner: '#1c1624' }, pants: '#1c1624', boots: '#2a2030', gloves: '#3a2a4a', sash: '#6a3a8a', shoulder: 'light', accent: '#b05cff' },
  },
  cleric: {
    name: '牧师', group: '圣职', weapon: 'holy', stance: 'holy', portrait: 'cleric', magicColor: '#ffe7a0', dmgMul: 1.06,
    hp: 2850, mp: 120, speed: 5.4, role: '治疗 / 支援', aiRange: 9,
    desc: '圣职系的治疗者。治疗术、群体治疗、神圣护盾保住队友，惩戒长硬直打断，光之冲击击倒贴身敌人。团队赛与副本的核心。',
    chain: magicChain('#ffe7a0', 'holy'),
    special: { type: 'guard', kind: 'magic', arc: 120, name: '圣光屏障' },
    skills: { s1: SKILLS.zhiliao, s2: SKILLS.chengjie, s3: SKILLS.shenshenghuo, s4: SKILLS.qunliao, s5: SKILLS.hudun, s6: SKILLS.guangchong, ult: SKILLS.tianshi },
    passive: '虔诚：治疗量 +10%。',
    look: { sex: 'm', hair: { style: 'short', color: '#e0d6c0' }, top: { style: 'robe', color: '#ecebe6', trim: '#c9a55a', inner: '#8fb3d9' }, pants: '#d8d4ca', boots: '#8a7a5a', gloves: '#ecebe6', sash: '#8fb3d9', shoulder: 'light', accent: '#ffe7a0' },
  },
  witch: {
    name: '魔道学者', group: '法师', weapon: 'broom', stance: 'broom', portrait: 'witch', magicColor: '#c9a0ff',
    hp: 2950, mp: 110, speed: 5.7, role: '机动法术 / 空中压制', aiRange: 10,
    desc: '骑扫帚的法师，机动性极强：扫帚冲刺可以向上飞，药水控场，陨石术与魔法飞弹远程压制。',
    chain: [
      { anim: 'cast', wind: 100, active: 60, recover: 190, proj: [P({ kind: 'magic', color: '#c9a0ff', dmg: 42, speed: 30, radius: 0.22, homing: 2.5, stun: 200, knock: 0.5 })], sfx: 'magic_bolt', aimed: true },
      { anim: 'cast', wind: 100, active: 60, recover: 190, proj: [P({ kind: 'magic', color: '#c9a0ff', dmg: 42, speed: 30, radius: 0.22, homing: 2.5, stun: 200, knock: 0.5 })], sfx: 'magic_bolt', aimed: true },
      { anim: 'castUp', wind: 180, active: 60, recover: 300, proj: [P({ kind: 'magic', color: '#e0c0ff', dmg: 58, speed: 30, radius: 0.3, homing: 2.5, stun: 350, knock: 3 })], sfx: 'magic_bolt', aimed: true },
    ],
    special: { type: 'guard', kind: 'magic', arc: 120, name: '魔法屏障' },
    skills: { s1: SKILLS.saozhou, s2: SKILLS.bingdong, s3: SKILLS.yunshi, s4: SKILLS.feidan, s5: SKILLS.fushen, s6: SKILLS.xuanfengsao, ult: SKILLS.xingyun },
    passive: '炼金：药水效果持续时间 +20%。',
    look: { sex: 'm', hair: { style: 'short', color: '#2a3a2a' }, top: { style: 'coat', color: '#2f5a3a', trim: '#c9b27a', inner: '#1c2a20' }, pants: '#1c2a20', boots: '#3a2a1c', gloves: '#2f5a3a', sash: '#9ad08a', shoulder: 'light', accent: '#c9a0ff' },
  },
  berserker: {
    name: '狂剑士', group: '剑士', weapon: 'greatsword', stance: 'greatsword', portrait: 'berserker',
    hp: 3630, mp: 100, speed: 5.4, role: '重剑爆发 / 吸血续航',
    desc: '双手大剑的狂战士。攻击慢而重，崩山击霸体压制，血影狂刃与狂暴吸血，地裂波动剑远程挑空。',
    chain: greatChain,
    special: { type: 'guard', kind: 'sword', arc: 110, name: '横剑格挡' },
    skills: { s1: SKILLS.bengshan, s2: SKILLS.xueying, s3: SKILLS.dilie, s4: SKILLS.kuangbao, s5: SKILLS.shizi, s6: SKILLS.nuhou, ult: SKILLS.xuezhikuangnu },
    passive: '血怒：生命低于 40% 时伤害 +15%。',
    look: { sex: 'm', build: 1.1, hair: { style: 'spiky', color: '#6a1f1f' }, top: { style: 'armor', color: '#3a2a2a', trim: '#8a2a2a', inner: '#1c1414' }, pants: '#2a1c1c', boots: '#1c1414', gloves: '#3a2a2a', sash: '#8a2a2a', shoulder: 'heavy', accent: '#ff4a3a', scarf: '#7a2630' },
  },
  assassin: {
    name: '刺客', group: '暗夜', weapon: 'dagger', stance: 'dagger', portrait: 'assassin',
    hp: 2750, mp: 100, speed: 6.3, role: '突袭 / 背刺爆发',
    desc: '双匕首刺客，速度最快。影袭瞬移到背后，背刺从背后命中伤害翻倍，毒刃持续掉血，烟雾弹致盲脱身。',
    chain: daggerChain,
    special: { type: 'guard', kind: 'fist', arc: 100, name: '交叉格挡' },
    skills: { s1: SKILLS.yingxi, s2: SKILLS.beici, s3: SKILLS.duren, s4: SKILLS.yanwu, s5: SKILLS.shunying, s6: SKILLS.feidao, ult: SKILLS.qianying },
    passive: '暗杀：背后攻击额外暴击率 +15%。',
    look: { sex: 'f', hair: { style: 'pony', color: '#15151c' }, top: { style: 'jacket', color: '#1c1f28', trim: '#6a4a9a', inner: '#101218' }, pants: '#15171e', boots: '#101218', gloves: '#1c1f28', sash: '#6a4a9a', shoulder: 'none', accent: '#9a6aff', scarf: '#2a2238' },
  },
  thug: {
    name: '流氓', group: '格斗', weapon: 'club', stance: 'sword', portrait: 'brawler', dmgMul: 1.05,
    hp: 3410, mp: 100, speed: 5.8, role: '控制 / 倒地追击',
    desc: '格斗系里最不讲究的一位：撒沙致盲、板砖硬直、背摔无视格挡、踩踏专打倒地。靠控制链把人按在地上打。',
    chain: clubChain,
    special: { type: 'guard', kind: 'sword', arc: 100, name: '招架' },
    skills: { s1: SKILLS.shasha, s2: SKILLS.banzhuan, s3: SKILLS.beishuai, s4: SKILLS.caita, s5: SKILLS.duyao, s6: SKILLS.saotang, ult: SKILLS.liumang },
    passive: '下三路：对倒地目标伤害 +15%。',
    look: { sex: 'm', hair: { style: 'spiky', color: '#3a2a1c' }, top: { style: 'jacket', color: '#4a5a3a', trim: '#c9a55a', inner: '#d8d0bc' }, pants: '#3a3a44', boots: '#2a2018', gloves: '#2a2018', sash: null, shoulder: 'none', accent: '#e0b050' },
  },
};

export const CLASS_ORDER = ['unspecialized', 'swordmaster', 'battlemage', 'striker', 'sharpshooter', 'launcher', 'warlock', 'cleric', 'witch', 'berserker', 'assassin', 'thug'];

// 账号卡（原著战队与角色账号，作为同人彩蛋；操作者与战队仅作介绍）
export const ACCOUNTS = [
  { id: 'jmx', name: '君莫笑', cls: 'unspecialized', player: '叶修', team: '兴欣', weaponName: '千机伞', title: '荣耀教科书', color: '#4d9d9a' },
  { id: 'yyzq', name: '一叶之秋', cls: 'battlemage', player: '（原斗神）', team: '嘉世', weaponName: '却邪', title: '斗神', color: '#e0b050' },
  { id: 'yysf', name: '夜雨声烦', cls: 'swordmaster', player: '黄少天', team: '蓝雨', weaponName: '冰雨', title: '剑圣', color: '#7fd3ff' },
  { id: 'dmgy', name: '大漠孤烟', cls: 'striker', player: '韩文清', team: '霸图', weaponName: '拳套', title: '拳皇', color: '#d04a3a' },
  { id: 'yqcy', name: '一枪穿云', cls: 'sharpshooter', player: '周泽楷', team: '轮回', weaponName: '荒火 · 碎霜', title: '枪王', color: '#e05a3a' },
  { id: 'myc', name: '沐雨橙风', cls: 'launcher', player: '苏沐橙', team: '兴欣', weaponName: '重炮', title: '枪炮师', color: '#ffb35a' },
  { id: 'skse', name: '索克萨尔', cls: 'warlock', player: '喻文州', team: '蓝雨', weaponName: '魔典', title: '术士', color: '#b05cff' },
  { id: 'xsbl', name: '小手冰凉', cls: 'cleric', player: '安文逸', team: '兴欣', weaponName: '十字杖', title: '牧师', color: '#ffe7a0' },
  { id: 'wblx', name: '王不留行', cls: 'witch', player: '王杰希', team: '微草', weaponName: '灭神的诅咒', title: '魔术师', color: '#9ad08a' },
  { id: 'bzrq', name: '包子入侵', cls: 'thug', player: '包荣兴', team: '兴欣', weaponName: '板砖', title: '流氓', color: '#e0b050' },
  { id: 'lt', name: '裂天', cls: 'berserker', player: '原创账号', team: '自由人', weaponName: '赤血大剑', title: '狂剑士', color: '#ff4a3a' },
  { id: 'yr', name: '影刃', cls: 'assassin', player: '原创账号', team: '自由人', weaponName: '双匕', title: '刺客', color: '#9a6aff' },
];

// 技能槽位显示顺序
export const SLOT_ORDER = ['s1', 's2', 's3', 's4', 's5', 's6', 'ult'];
