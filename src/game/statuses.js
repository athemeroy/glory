// 状态行为与显示共用的定义。时间/伤害为本作平衡值；原著依据见 docs/novel-mechanics.md。
export const STATUSES = Object.freeze({
  stun: { name: '眩晕', debuff: true, actionLock: true, movementLock: true, breakOnDamage: true, interrupt: true },
  frozen: { name: '冻结', debuff: true, actionLock: true, movementLock: true, interrupt: true },
  sleep: { name: '睡眠', debuff: true, actionLock: true, movementLock: true, breakOnDamage: true, interrupt: true },
  root: { name: '定身', debuff: true, movementLock: true },
  bind: { name: '束缚', debuff: true, movementLock: true },
  silence: { name: '技能封印', debuff: true, skillLock: true },
  fear: { name: '恐惧', debuff: true, attackLock: true, interrupt: true },
  confuse: { name: '混乱', debuff: true },
  blind: { name: '致盲', debuff: true },
  slow: { name: '减速', debuff: true, speedMul: .55 },
  weak: { name: '虚弱', debuff: true },
  armorBreak: { name: '破甲', debuff: true, takenMul: 1.25 },
  vulnerable: { name: '圣诫', debuff: true, takenMul: 1.3 },
  bleed: { name: '出血', debuff: true },
  poison: { name: '中毒', debuff: true },
  burn: { name: '灼烧', debuff: true },
  dot: { name: '持续伤害', debuff: true },
  superArmor: { name: '霸体' }, invulnerable: { name: '无敌' },
  swordIntent: { name: '剑意' }, berserk: { name: '狂暴' },
  shield: { name: '护盾' }, hot: { name: '回复' }, haste: { name: '加速', speedMul: 1.2 },
  chaserNeutral: { name: '无炫纹·移速' }, chaserLight: { name: '光炫纹·攻速' },
  chaserIce: { name: '冰炫纹·物防' }, chaserFire: { name: '火炫纹·力量' }, chaserDark: { name: '暗炫纹·暴击' },
});
const active = f => f.effects.filter(e => e.t > 0);
export function hasStatusFlag(f, flag) { return active(f).some(e => STATUSES[e.type]?.[flag]); }
export function statusMoveMultiplier(f) {
  if (hasStatusFlag(f, 'movementLock')) return 0;
  let slow = 1, haste = 1;
  for (const e of active(f)) {
    const mul = e.speedMul ?? STATUSES[e.type]?.speedMul ?? 1;
    if (mul < 1) slow = Math.min(slow, mul); else haste = Math.max(haste, mul);
  }
  return slow * haste;
}
export function statusDamageTaken(f) {
  return active(f).reduce((mul, e) => mul * (e.takenMul ?? STATUSES[e.type]?.takenMul ?? 1), 1);
}
export function isCleanseable(e) {
  return !!(e.debuff ?? STATUSES[e.type]?.debuff) && e.cleanseable !== false;
}
export function normalizeStatus(e) {
  const def = STATUSES[e.type] || {};
  return { ...e, t: Math.max(0, Number(e.t) || 0), debuff: e.debuff ?? !!def.debuff };
}
// 同类控制覆盖，不把重复命中的秒数相加；较短的新状态不缩短旧状态。
export function mergeStatus(previous, next) {
  const remaining = Math.max(previous.t, next.t), acc = previous.acc || 0, acc2 = previous.acc2 || 0;
  Object.assign(previous, next, { t: remaining, acc, acc2 });
  return previous;
}
export function breakDamageStatuses(f) {
  f.effects = f.effects.filter(e => !STATUSES[e.type]?.breakOnDamage);
  if (!hasStatusFlag(f, 'actionLock')) {
    f.statusStun = false;
    if (f.state === 'stun') { f.stunT = 0; f.state = f.onGround ? 'idle' : 'jump'; f.stateT = 0; }
  }
}
// 混乱仅改写已有移动输入，不凭空让静止角色奔跑；映射随时间变化，不能简单反向抵消。
export function confusedMovement(f, x, y) {
  if (!f.hasEffect('confuse')) return [x, y];
  const tick = Math.floor((f.game.time || 0) / .45), seed = (f.id || 0) * 31 + tick * 17;
  const angle = ((seed % 7 + 7) % 7 + 1) * Math.PI / 4;
  return [x * Math.cos(angle) - y * Math.sin(angle), x * Math.sin(angle) + y * Math.cos(angle)];
}
export function statusLabel(e) { return STATUSES[e.type]?.name || e.type; }
