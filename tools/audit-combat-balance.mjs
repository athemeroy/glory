// Numeric upper bounds, not a substitute for actual animated contact tests.
// Run: node tools/audit-combat-balance.mjs
import { CLASSES, CLASS_ORDER } from '../src/data/classes.js';
import { staminaProfile, STAMINA_COST } from '../src/game/stamina.js';

const seconds = ms => (ms || 0) / 1000;
const duration = d => seconds((d.wind || 0) + (d.active || 0) + (d.recover || 0));
const round = n => Math.round(n * 100) / 100;
const effects = h => [...(h.effect ? [h.effect] : []), ...(h.effects || [])];
function payload(d) {
  if (d.stageDefs) return d.stageDefs.flatMap(payload);
  return [...(d.hits || []), ...(d.proj || []).flatMap(p => [p, ...(p.explode ? [p.explode] : [])]),
    ...(d.aoe || []).map(a => ({ ...a, multiplicity: a.ticks || 1 })),
    ...(d.beam ? [{ ...d.beam, multiplicity: d.beam.ticks || 1 }] : [])];
}
function damage(d) {
  return payload(d).reduce((n,h) => n + (h.dmg || 0) * (h.multiplicity || 1) +
    effects(h).reduce((sum,e) => sum + (e.dps || 0) * seconds(e.t), 0), 0);
}
function control(d) {
  return payload(d).map(h => ({ hitStun: h.noStun ? 0 : h.stun || 0,
    effects: effects(h).map(e => ({ type: e.type, seconds: seconds(e.t) })),
    down: !!h.down, launch: h.launch || 0 }));
}

const report = { caveat: 'All-hit upper bounds; excludes defense, accuracy, combo decay, crits, distance falloff and interrupted casts.', classes: [] };
for (const id of CLASS_ORDER) {
  const cls = CLASSES[id], mul = cls.dmgMul || 1, stamina = staminaProfile(id, cls);
  const chain = cls.chain || cls.forms.sword.chain;
  const chainSeconds = chain.reduce((n,d) => n + duration(d), 0);
  const chainDamage = chain.reduce((n,d) => n + damage(d), 0) * mul;
  const skills = Object.entries(cls.skills).map(([slot,d]) => {
    const dmg = damage(d) * mul, cd = seconds(d.cd), heal = d.heal;
    const healAmount = heal ? ((heal.amount || 0) + cls.hp * (heal.pct || 0) + (heal.hot?.hps || 0) * seconds(heal.hot?.t)) * (id === 'cleric' ? 1.1 : 1) : 0;
    return { slot, name: d.name, cooldownSeconds: cd, animationSeconds: round(duration(d)), mana: d.mp || 0,
      damageAllHits: round(dmg), damagePerCooldown: round(dmg / cd), manaPerSecond: round((d.mp || 0) / cd),
      healAllTicks: round(healAmount), shield: heal?.shield?.amount || 0,
      healPerCooldown: round(healAmount / cd), control: control(d) };
  });
  report.classes.push({ id, name: cls.name, hp: cls.hp, mana: cls.mp, speed: cls.speed,
    chainSeconds: round(chainSeconds), chainDamageAllHits: round(chainDamage), chainDpsAllHits: round(chainDamage / chainSeconds),
    forms: cls.forms ? Object.fromEntries(Object.entries(cls.forms).map(([form, data]) => [form,
      { chainDpsAllHits: round(data.chain.reduce((n,d) => n+damage(d),0)*mul/data.chain.reduce((n,d) => n+duration(d),0)) }])) : undefined,
    manaRegenPerSecond: 7, manaSpendAllSkillsOnCooldown: round(skills.reduce((n,s) => n+s.manaPerSecond,0)),
    skillDamageAllCooldowns: round(skills.reduce((n,s) => n+s.damagePerCooldown,0)),
    stamina: { max: stamina.max, sprintSecondsFromFull: round(stamina.max/stamina.sprintDrain),
      sprintSpeed: round(cls.speed*stamina.sprintSpeed), fullRegenSeconds: round(stamina.max/stamina.regen),
      dashesFromFull: Math.floor(stamina.max/STAMINA_COST.dash), jumpsFromFull: Math.floor(stamina.max/STAMINA_COST.jump) }, skills });
}
console.log(JSON.stringify(report, null, 2));
