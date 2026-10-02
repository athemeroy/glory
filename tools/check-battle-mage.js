import * as THREE from 'three';
import { CLASSES, SKILLS } from '../src/data/classes.js';
import { World } from '../src/game/world.js';
import { input } from '../src/engine/input.js';
import { CHASERS, battleMageHit, fireChaser, applyChaserBuff, battleMageSpeed, battleMageAttackSpeed, battleMageSnapshot, applyBattleMageSnapshot } from '../src/game/battle-mage.js';

export async function checkBattleMage(app) {
  const g = app.game, savedRandom = Math.random, saved = { fighters: g.fighters, player: g.player, mode: g.mode, world: g.world, onHit: g.onHit, inputFrozen: g.inputFrozen };
  const results = [], errors = [], contacts = [], check = (ok, name, extra = {}) => (ok ? results : errors).push({ name, ...extra });
  g.fighters = []; g.mode = null; g.world = new World(); g.inputFrozen = false;
  const f = g.spawn({ cls: CLASSES.battlemage, clsId: 'battlemage', team: 1, isPlayer: true, pos: [0, 0, 0] });
  const t = g.spawn({ cls: CLASSES.swordmaster, clsId: 'swordmaster', kind: 'dummy', team: 2, pos: [0, 0, 2.5] });
  g.player = f;
  g.onHit = function(att, target, result, hit, def, ...rest) {
    if (att === f && target === t) contacts.push({ name: def?.name, chaser: hit.chaser, result, t: hit.t, region: hit.contact?.region, point: hit.contact?.point?.toArray() });
    return saved.onHit.call(g, att, target, result, hit, def, ...rest);
  };
  const resetTarget = distance => { t.resetState(); t.pos.set(0, 0, distance); t.yaw = Math.PI; t.hp = t.maxHp; };
  const reset = (distance = 2.5) => { f.resetState(); f.pos.set(0, 0, 0); f.yaw = f.pitch = 0; f.aimDir.set(0, 0, 1); f.hp = f.maxHp; f.mp = f.maxMp; f.target = null; resetTarget(distance); g.world.colliders = []; g.combat.clear(); g.vfx.clear(); contacts.length = 0; };
  const tick = seconds => { for (let i = 0; i < Math.ceil(seconds * 120); i++) { g.time += 1 / 120; f.update(1 / 120); t.updateModel(1 / 120); g.combat.updateMelee(1 / 120); g.combat.updateProjectiles(1 / 120); g.vfx.update(1 / 120); } };
  const settle = () => { for (let i = 0; i < 24; i++) { f.updateModel(1 / 60); t.updateModel(1 / 60); } };
  const perform = (def, slot) => { f.action = null; f.state = 'idle'; f.vel.set(0, 0, 0); f.knockVel.set(0, 0, 0); f.startAction(def, slot); tick((def.wind + def.active + def.recover + 70) / 1000); };
  const actualDistances = {};
  try {
    for (const [slot, type] of [['s1', 'light'], ['s2', 'neutral'], ['s3', 'dark'], ['s4', 'fire'], ['s5', 'ice']]) {
      const def = f.cls.skills[slot]; let found = null;
      for (let d = .75; d <= 3.76; d += .25) {
        reset(d); settle(); perform(def, slot);
        const hits = contacts.filter(c => c.result !== 'miss');
        if (f.chasers.some(c => c.type === type) && (slot !== 's5' || hits.length >= 2)) { found = { d, hits }; break; }
      }
      check(!!found, '对应真实招式命中生成指定炫纹', { slot, skill: def.name, type, ...found });
      actualDistances[slot] = found?.d || 2.5;
      check(f.chasers.length <= 1, '一次多段技能只生成一枚炫纹', { slot, count: f.chasers.length });
      if (slot === 's5') check(found?.hits.length >= 2 && new Set(found?.hits.map(c => c.t)).size === 2, '连突确实有两个独立实际刺击窗口', { hits: found?.hits });
    }
    reset(12); settle(); perform(f.cls.skills.s2, 's2');
    check(!f.chasers.length, '挥空不能生成炫纹');
    reset(actualDistances.s2); settle(); perform(f.cls.skills.s2, 's2');
    const held = f.chasers.length; check(!fireChaser(f) && f.chasers.length === held, '本次刚生成的炫纹不能立即凭空发射');
    check(!g.combat.projectiles.length, '命中不会替玩家自动发射');
    // 后续普攻开放发射窗口，仍然必须真实接触。
    let opened = false;
    for (let d = 1.75; d <= 3.26 && !opened; d += .25) {
      f.pos.set(0, 0, 0); resetTarget(d); settle(); perform(f.chain[0], 'atk');
      opened = f.chaserHitSerial > 1 && f.chaserWindow > 0;
    }
    check(opened, '再次真实普攻命中开放发射窗口');
    const origin = f.chaserVisual?.orbs[0].getWorldPosition(new THREE.Vector3()), before = t.hp;
    const fired = fireChaser(f), pr = g.combat.projectiles.at(-1);
    check(fired && pr?.p.chaser === 'neutral' && f.chasers.length === 0, '手动发射消耗已有炫纹且创建实际弹体');
    check(pr && origin && pr.origin.distanceTo(origin) < .001, '炫纹从背后实际小球位置发射', { origin: pr?.origin.toArray(), visual: origin?.toArray() });
    tick(.5); check(t.hp < before && f.hasEffect('chaserNeutral'), '真实弹体命中才得到无属性移速增益', { damage: before - t.hp });
    const base = f.speed; check(battleMageSpeed(f) >= 1.10 && f.speed === base, '增益不累改职业基础移动速度');
    reset(actualDistances.s2); settle(); perform(f.cls.skills.s2, 's2');
    // 此处用已经验证的接触入口制造第二个攻击命中，专门检验实体墙阻挡。
    f.action = null; battleMageHit(f, t, 'hit', {}, f.chain[0], false); g.world.colliders = [{ min: [-3, 0, .9], max: [3, 4, 1] }];
    const hp = t.hp; check(fireChaser(f), '遮挡情况下可发射已有炫纹'); tick(.5);
    check(t.hp === hp && !f.hasEffect('chaserNeutral') && !g.combat.projectiles.length, '炫纹撞墙销毁且不给命中增益');
    for (const type of Object.keys(CHASERS)) {
      reset(); applyChaserBuff(f, type);
      check(f.hasEffect(CHASERS[type].buff), '五类炫纹增益独立', { type });
    }
    reset(); applyChaserBuff(f, 'light'); f.startAction(f.chain[0], 'atk'); f.updateAction(.1, 100);
    check(f.action.t > 107 && battleMageAttackSpeed(f) === 1.08, '光炫纹实际加速动作状态机');
    reset(); const normalDmg = f.damageMul(t, {}); applyChaserBuff(f, 'fire');
    check(f.damageMul(t, {}) > normalDmg && f.damageMul(t, { kind: 'magic' }) === normalDmg, '火炫纹提升物理攻击并区分魔法弹');
    reset(); const oldRandom = Math.random; Math.random = () => .5;
    const amount = () => { f.hp = f.maxHp; f.comboTaken = 0; f.state = 'idle'; f.receiveHit(t, { dmg: 100, noStun: true }, 0, -1); return f.maxHp - f.hp; };
    const damageNormal = amount(); applyChaserBuff(f, 'ice'); const damageIce = amount(); Math.random = oldRandom;
    check(damageIce < damageNormal, '冰炫纹实际减免物理伤害', { damageNormal, damageIce });
    reset(); f.action = { uid: 999, def: SKILLS.longya }; t.state = 'guard'; t.guarding = true; t.guardT = 1000;
    const blockHit = { dmg: 20, stun: 200 }; const res = t.receiveHit(f, blockHit, 0, 1); g.onHit(f, t, res, blockHit, SKILLS.longya, false);
    check(res === 'block' && f.chasers[0]?.type === 'neutral', '技能被实际招架也生成炫纹');
    reset();
    for (let i = 1; i <= 120; i++) {
      t.state = i === 1 ? 'idle' : 'hitstun'; t.applyDamage(f, 1, {});
      if ([9, 10, 20, 60, 119, 120].includes(i)) check(f.battleWill.tier === (i < 10 ? 0 : i < 120 ? Math.min(6, Math.floor(i / 10)) : 7), '斗者意志按真实受伤连击升阶', { combo: i, tier: f.battleWill.tier });
    }
    tick(1.5); check(f.battleWill.tier === 7 && !f.battleWill.active, '整轮120连击结束后保留本轮意志等级');
    t.state = 'idle'; t.applyDamage(f, 1, {}); check(f.battleWill.tier === 7 && f.battleWill.combo === 1, '新一轮以先前意志开始但重新计算连击');
    tick(1.5); check(f.battleWill.tier === 0, '短连击结束按新一轮结果掉阶');
    reset(); for (let i = 0; i < 20; i++) { t.state = i ? 'hitstun' : 'idle'; t.applyDamage(f, 1, {}); }
    f.enterStun(100); check(f.comboDealt === 0 && f.comboDealtT === 0 && !f.battleWill.active, '受击打断不能沿用旧连击计数');
    reset(); f.action = { uid: 998, def: SKILLS.liantu }; const point = t.center(new THREE.Vector3()); const random = Math.random; Math.random = () => .1;
    battleMageHit(f, t, 'hit', { t: 55, contact: { point, region: 'torso' } }, SKILLS.liantu, false);
    battleMageHit(f, t, 'hit', { t: 235, contact: { point: point.clone().add(new THREE.Vector3(.04, 0, 0)), region: 'torso' } }, SKILLS.liantu, false);
    check(t.hasEffect('bleed'), '连突二击近同部位通过概率后造成出血');
    reset(); f.action = { uid: 997, def: SKILLS.liantu };
    battleMageHit(f, t, 'hit', { t: 55, contact: { point, region: 'torso' } }, SKILLS.liantu, false);
    battleMageHit(f, t, 'hit', { t: 235, contact: { point: point.clone().add(new THREE.Vector3(0, .4, 0)), region: 'head' } }, SKILLS.liantu, false);
    check(!t.hasEffect('bleed'), '不同命中部位不伪造连突出血');
    const oldClass = t.cls; t.cls = { ...t.cls, statusImmunities: ['bleed'] }; check(!t.addEffect({ type: 'bleed', t: 4000, dps: 12 }), '无血生物状态免疫入口拒绝出血'); t.cls = oldClass; Math.random = random;
    reset(actualDistances.s2); settle(); perform(f.cls.skills.s2, 's2');
    const oldCount = f.chasers.length; f.addEffect({ type: 'silence', t: 1000 }); f.chaserHitSerial++; f.chaserWindow = 1;
    check(!fireChaser(f) && f.chasers.length === oldCount, '封印禁止发射且不吃炫纹');
    f.cleanse(); f.chaserWindow = 0; check(!fireChaser(f), '没有有效命中窗口不能发射');
    f.chasers.forEach(c => c.ttl = .01); tick(.02); check(!f.chasers.length, '炫纹有独立储存时限');
    reset(actualDistances.s2); settle(); perform(f.cls.skills.s2, 's2'); const snapshot = battleMageSnapshot(f), copy = JSON.stringify(snapshot);
    f.chasers = []; applyBattleMageSnapshot(f, snapshot); check(JSON.stringify(battleMageSnapshot(f)) === copy, '联机快照还原颜色/数量/资格/意志');
    const targetHeld = f.chaserHitSerial; input._press(input.binds.special); g.playerControl(f, 1 / 60);
    check(f.wantChaser && !f.wantGuard && f.chaserHitSerial === targetHeld, '实际键鼠职业特技输入请求炫纹发射'); input.clear();
    f.resetState(); check(!f.chasers.length && f.battleWill.tier === 0 && !f.wantChaser, '回合重置清空炫纹和意志');
  } finally {
    Math.random = savedRandom; input.clear(); for (const fighter of [...g.fighters]) g.removeFighter(fighter); g.combat.clear(); Object.assign(g, saved);
  }
  return { passed: results.length, results, errors, distances: actualDistances };
}
