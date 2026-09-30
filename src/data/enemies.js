// 副本敌人与 Boss（项目原创：寒铁遗庭）
const H = (o) => ({ t: 0, range: 2.4, arc: 110, h: [0, 2.4], dmg: 60, stun: 300, knock: 2.5, ...o });
const P = (o) => ({ t: 0, kind: 'magic', speed: 18, radius: 0.25, range: 30, dmg: 60, stun: 300, knock: 2, gravity: 0, ...o });

export const MOBS = {
  skeleton: {
    name: '骸骨卫兵', weapon: 'sword', stance: 'sword', hp: 650, mp: 100, speed: 3.6, aiRange: 1.9, metal: false,
    chain: [
      { anim: 'slash1', wind: 380, active: 110, recover: 420, hits: [H({ range: 2.3, dmg: 55, stun: 350, knock: 2 })], lunge: 1.2, vfx: 'slashR', sfx: 'swing_light' },
      { anim: 'slash3', wind: 450, active: 110, recover: 520, hits: [H({ range: 2.4, arc: 70, dmg: 70, stun: 420, knock: 3 })], lunge: 1.2, vfx: 'slashUp', sfx: 'swing_heavy' },
    ],
    skills: {},
    special: { type: 'guard', kind: 'sword', arc: 100 },
    look: { sex: 'm', skin: '#d8d0bc', hair: { style: 'bald', color: '#000' }, eyes: '#ff4a2a', top: { style: 'armor', color: '#5d646e', trim: '#8a7a5a', inner: '#2a2a2e' }, pants: '#3a3a40', boots: '#2a2a2e', gloves: '#d8d0bc', sash: '#5a1f1f', shoulder: 'heavy', accent: '#ff4a2a', build: 0.9 },
    weaponOpts: { steel: '#8f949a', glow: '#ff5a3a' },
  },
  frostcaster: {
    name: '冰晶术士', weapon: 'staff', stance: 'staff', hp: 420, mp: 100, speed: 3.2, aiRange: 11, ranged: true,
    chain: [
      { anim: 'cast', wind: 520, active: 80, recover: 700, proj: [P({ dmg: 70, speed: 16, color: '#9fe6ff', stun: 350, knock: 2 })], sfx: 'ice', aimed: true },
    ],
    skills: {},
    look: { sex: 'f', skin: '#c9d6e2', hair: { style: 'long', color: '#dfe9f2' }, eyes: '#5fd0ff', top: { style: 'robe', color: '#3d5a78', trim: '#bfe6ff', inner: '#1d2a38' }, pants: '#1d2a38', boots: '#1d2a38', gloves: '#3d5a78', sash: '#bfe6ff', shoulder: 'light', accent: '#9fe6ff' },
    weaponOpts: { glow: '#9fe6ff' },
    magicColor: '#9fe6ff',
  },
};

export const BOSS = {
  name: '寒铁守卫', weapon: 'axe', stance: 'greatsword', hp: 9000, mp: 100, speed: 2.8, aiRange: 2.8, metal: true,
  chain: [
    { anim: 'slash1', wind: 520, active: 140, recover: 620, hits: [H({ range: 3.4, arc: 120, dmg: 90, stun: 420, knock: 4 })], vfx: 'slashWide', sfx: 'swing_heavy', lunge: 1 },
  ],
  skills: {
    s1: { name: '寒铁横扫', icon: 'sword', cd: 5000, mp: 0, anim: 'spin', wind: 750, active: 240, recover: 850, tele: { type: 'cone', radius: 4.4, arc: 170 }, hits: [H({ t: 40, range: 4.4, arc: 170, dmg: 180, stun: 500, knock: 7 })], vfx: 'slashWide', sfx: 'swing_heavy', ai: { range: [0, 4.2], role: 'poke' } },
    s2: { name: '盾撞', icon: 'guard', cd: 7000, mp: 0, anim: 'palm', wind: 600, active: 220, recover: 1000, dash: { speed: 11, from: 'active', dur: 200 }, tele: { type: 'cone', radius: 4.5, arc: 50 }, hits: [H({ t: 60, range: 2.4, arc: 90, dmg: 130, down: true, knock: 8 })], vfx: 'bash', sfx: 'hit_heavy', ai: { range: [2, 7], role: 'gap' } },
    s3: { name: '寒铁跃击', icon: 'warning', cd: 11000, mp: 0, phase: 2, anim: 'jumpslam', wind: 1100, active: 200, recover: 1200, leap: { vy: 9, toTarget: true }, slamOnLand: true, tele: { type: 'circle', at: 'target', radius: 3.4, extra: 700 }, hits: [H({ range: 3.4, arc: 360, h: [-0.5, 2.6], dmg: 220, down: true, knock: 6 })], vfx: 'ring', sfx: 'boss_slam', ai: { range: [3, 16], role: 'gap' } },
    s4: { name: '霜环', icon: 'warning', cd: 14000, mp: 0, phase: 2, anim: 'castUp', wind: 1000, active: 100, recover: 900, tele: { type: 'circle', at: 'self', radius: 5.5 }, hits: [H({ range: 5.5, arc: 360, h: [-0.5, 1.2], dmg: 160, launch: 8, stun: 500 })], vfx: 'ringWide', sfx: 'ice', ai: { range: [0, 5], role: 'escape' } },
  },
  look: { sex: 'm', skin: '#8fa3b5', hair: { style: 'bald', color: '#000' }, eyes: '#8fe0ff', top: { style: 'armor', color: '#6f7c8a', trim: '#a9c4d8', inner: '#2c3440' }, pants: '#3a444f', boots: '#2c3440', gloves: '#6f7c8a', sash: '#2e6a8a', shoulder: 'heavy', accent: '#8fe0ff', build: 1.25 },
  weaponOpts: { steel: '#b9d4e6' },
};
