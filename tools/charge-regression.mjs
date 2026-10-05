// CPU regression of the real Fighter state machine and Combat registration,
// contact, damage and counters. Fixtures use deterministic body/weapon poses;
// this is not a WebGL or imported-animation test.
// Run: node --loader ./tools/three-local-loader.mjs tools/charge-regression.mjs
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Fighter } from '../src/game/fighter.js';
import { Combat } from '../src/game/combat.js';
import { World } from '../src/game/world.js';
import { CLASSES } from '../src/data/classes.js';
import { initBattleMage } from '../src/game/battle-mage.js';
import { characterProfile } from '../src/game/combat-volumes.js';
import { staminaProfile } from '../src/game/stamina.js';

const tests = [];
function test(name, fn) {
  try { fn(); tests.push({ name, passed: true }); }
  catch (error) { tests.push({ name, passed: false, error: error.stack }); }
}
const near = (actual, expected) => assert(Math.abs(actual - expected) < 1e-7, `${actual} != ${expected}`);
function deterministic(fn) {
  const random = Math.random;
  Math.random = () => .5; // No crit, exactly 1x damage variance.
  try { return fn(); } finally { Math.random = random; }
}

function fighter(game, clsId = 'swordmaster', team = 1, form = null) {
  const f = Object.create(Fighter.prototype), cls = CLASSES[clsId];
  Object.assign(f, {
    game, clsId, cls, kind: 'hero', isPlayer: true, team, scale: 1,
    effects: [], pos: new THREE.Vector3(), vel: new THREE.Vector3(), knockVel: new THREE.Vector3(), moveInput: new THREE.Vector2(),
    onGround: true, dead: false, state: 'idle', stateT: 0, action: null, stunT: 0, invuln: 0, armor: 0,
    hp: 10000, maxHp: 10000, mp: 100, maxMp: 100, stamina: 100, maxStamina: 100, staminaSpec: staminaProfile(clsId, cls),
    dmgMul: 1, defMul: 1, knockMul: 1, yaw: 0, pitch: 0, chainT: 0, chainIdx: 0, guardT: 0, cd: {},
    form: form ?? (cls.forms ? 'sword' : null), formLock: 0, baseStance: cls.stance,
    air: { time: 0, launches: 0, protected: false },
    stats: { dmgDealt: 0, dmgTaken: 0, hits: 0, skills: 0, kills: 0, maxCombo: 0 },
    comboTaken: 0, comboResetT: 0, comboDealt: 0, comboDealtT: 0, flight: { active: false },
  });
  f.bodyProfile = characterProfile(f); f.height = f.bodyProfile.height; f.radius = f.bodyProfile.radius;
  initBattleMage(f);
  // A stable contact pose, with actual Three.js world transforms for Combat.
  const root = new THREE.Group(), obj = new THREE.Group(), base = new THREE.Object3D(), tip = new THREE.Object3D();
  root.add(obj); obj.position.set(0, 1, .3); obj.rotation.x = Math.PI / 2;
  obj.add(base, tip); base.position.y = .1; tip.position.y = 1;
  const bones = {};
  for (const [name, z] of [['elR', .4], ['haR', 1.2], ['elL', .4], ['haL', 1.2]]) {
    bones[name] = new THREE.Object3D(); bones[name].position.set(0, 1, z); root.add(bones[name]);
  }
  f.rig = { root, bones }; f.weapon = { type: cls.weapon, obj, base, tip };
  game.fighters.push(f);
  return f;
}

function setup(clsId = 'swordmaster', form = null) {
  const world = new World();
  world.setLevel({ colliders: [], bounds: { minX: -30, maxX: 30, minZ: -30, maxZ: 30 } });
  const game = { world, fighters: [], events: [], hits: [], whiffs: [],
    onFighterEvent(f, type, data) { this.events.push({ f, type, data }); },
    onHit(...args) { this.hits.push(args); }, onWhiff(...args) { this.whiffs.push(args); } };
  game.combat = new Combat(game);
  const attacker = fighter(game, clsId, 1, form), target = fighter(game, 'swordmaster', 2);
  target.pos.z = .9; target.yaw = Math.PI;
  return { game, attacker, target };
}

function tick(attacker, ms, contact = false) {
  // updateState avoids calling updateAction directly after cancellation/death.
  attacker.updateState(ms / 1000, ms);
  if (contact) deterministic(() => attacker.game.combat.updateMelee(ms / 1000));
}
function release(attacker, heldMs, { step = 10, contact = false } = {}) {
  assert(attacker.startCharge());
  let elapsed = 0;
  while (attacker.action?.stage === 'wind') {
    elapsed += step;
    if (elapsed + 1e-7 >= heldMs) attacker.charging = false;
    tick(attacker, step, contact);
    assert(elapsed < 2000, 'charge never released');
  }
  return attacker.action;
}
function windowFor(game, attacker) {
  assert.equal(game.combat.meleeWindows.length, 1, 'one charge must register one melee window');
  const window = game.combat.meleeWindows[0];
  assert.equal(window.att, attacker); assert.equal(window.uid, attacker.action.uid);
  assert.equal(window.def, attacker.action.def, 'Combat must receive the released definition');
  assert.equal(window.h, attacker.action.def.hits[0], 'Combat must receive the released hit');
  return window;
}
function checkPayload(game, attacker, expected = {}) {
  const w = windowFor(game, attacker), k = Math.min(1, w.def.wind / 1100);
  assert.equal(w.h.dmg, Math.round(90 + 140 * k));
  near(w.h.knock, 6 + 6 * k); near(w.h.stun, 500 + 300 * k);
  assert.equal(w.h.guardBreak, k >= .98); assert.equal(w.h.down, k >= .98 || k > .6);
  for (const [key, value] of Object.entries(expected)) assert.equal(w.h[key], value, key);
  assert.equal(w.def.active, 130); assert.equal(w.def.recover, 420); assert.equal(w.def.lunge, 2.4);
  assert.equal(w.def.armor, true); assert.equal(w.start, 0); assert.equal(w.duration, 130);
  return w;
}

for (const [name, heldMs, dmg, down, guardBreak] of [
  ['early release waits for minimum', 10, 126, false, false],
  ['minimum', 280, 126, false, false], ['partial', 700, 179, true, false],
  ['full', 1100, 230, true, true], ['overhold auto-releases at full', Infinity, 230, true, true],
]) test(`${name}: real Combat receives the charge payoff`, () => {
  const { game, attacker } = setup(); const a = release(attacker, heldMs);
  checkPayload(game, attacker, { dmg, down, guardBreak });
  assert.equal(a.def.wind, Math.min(1100, Math.max(280, heldMs)));
  assert.equal(a.stage, 'active'); assert.equal(a.t, 0); assert.equal(attacker.charging, false);
  assert.equal(game.events.filter(e => e.type === 'active').length, 1);
  assert.equal(game.events.filter(e => e.type === 'fullcharge').length, guardBreak ? 1 : 0);
  assert.equal(game.events.find(e => e.type === 'active').data.def, a.def);
});

for (const hz of [30, 60, 120]) for (const heldMs of [10, 700, Infinity]) {
  test(`${hz} Hz / ${heldMs} ms: sampled release uses current payload and one event`, () => {
    const { game, attacker } = setup(); const a = release(attacker, heldMs, { step: 1000 / hz });
    const w = checkPayload(game, attacker);
    assert(a.def.wind >= Math.min(1100, Math.max(280, heldMs)) - 1e-6);
    assert(a.def.wind < Math.min(1100, Math.max(280, heldMs)) + 1000 / hz + 1e-6);
    for (let i = 0; i < hz; i++) tick(attacker, 1000 / hz);
    assert.equal(attacker.action, null); assert.equal(game.combat.meleeWindows.length, 1);
    assert.equal(game.combat.meleeWindows[0], w); assert.equal(game.events.filter(e => e.type === 'active').length, 1);
  });
}

for (const [ms, down, guardBreak] of [[660, false, false], [661, true, false], [1077, true, false], [1078, true, true]]) {
  test(`${ms} ms keeps the existing knockdown/guard-break threshold`, () => {
    const { game, attacker } = setup(); release(attacker, ms, { step: 1 });
    checkPayload(game, attacker, { down, guardBreak });
  });
}

test('one release, one victim hit, unchanged active/recovery durations', () => {
  const { game, attacker, target } = setup(); const a = release(attacker, 700);
  deterministic(() => game.combat.updateMelee(.01));
  assert.equal(game.hits.length, 1); assert.equal(target.hp, 10000 - 179);
  assert.equal(target.state, 'air'); assert.equal(target.airDown, true); near(target.vel.y, 3.5);
  near(target.knockVel.z, (6 + 6 * 700 / 1100) * 1.6);
  for (let i = 0; i < 12; i++) tick(attacker, 10, true);
  assert.equal(a.stage, 'active'); assert.equal(a.t, 120); assert.equal(game.hits.length, 1);
  assert.equal(game.combat.meleeWindows.length, 1);
  tick(attacker, 10, true); assert.equal(a.stage, 'recover'); assert.equal(a.t, 0);
  assert.equal(game.combat.meleeWindows.length, 0);
  for (let i = 0; i < 41; i++) tick(attacker, 10, true);
  assert.equal(attacker.action, a); tick(attacker, 10, true);
  assert.equal(attacker.action, null); assert.equal(attacker.state, 'idle'); assert.equal(game.hits.length, 1);
});

for (const heldMs of [280, 700, 1100]) test(`${heldMs} ms charge applies actual Fighter damage and control`, () => {
  const { game, attacker, target } = setup(); release(attacker, heldMs);
  const w = checkPayload(game, attacker); deterministic(() => game.combat.updateMelee(.01));
  assert.equal(game.hits.length, 1); assert.equal(game.hits[0][2], 'hit'); assert.equal(game.hits[0][4], w.def);
  assert.equal(target.hp, 10000 - w.h.dmg); assert.equal(attacker.stats.dmgDealt, w.h.dmg);
  assert.equal(target.state, heldMs === 280 ? 'hitstun' : 'air');
  if (heldMs === 280) { near(target.stunT, w.h.stun * .95); near(target.knockVel.z, w.h.knock * 2.2); }
  else { assert.equal(target.airDown, true); near(target.knockVel.z, w.h.knock * 1.6); }
});

for (const heldMs of [280, 700, 1077, 1078, 1100]) test(`${heldMs} ms charge versus held guard`, () => {
  const { game, attacker, target } = setup(); target.guarding = true; target.state = 'guard'; target.guardT = 500;
  release(attacker, heldMs, { step: 1 }); const w = checkPayload(game, attacker);
  deterministic(() => game.combat.updateMelee(.001));
  assert.equal(game.hits.length, 1);
  const broken = heldMs >= 1078;
  assert.equal(game.hits[0][2], broken ? 'hit' : 'block');
  assert.equal(target.hp, 10000 - Math.round(w.h.dmg * (broken ? .6 : .15)));
  near(target.mp, 100 - (broken ? 40 : 8 + w.h.dmg * .04));
  assert.equal(target.guarding, !broken); assert.equal(target.state, broken ? 'stun' : 'guard');
  assert.equal(game.events.filter(e => e.type === 'guardbreak').length, broken ? 1 : 0);
  if (broken) assert.equal(target.stunT, 500);
});

for (const guardT of [0, 219, 220]) test(`full charge versus ${guardT} ms guard preserves parry precedence`, () => {
  const { game, attacker, target } = setup(); target.guarding = true; target.state = 'guard'; target.guardT = guardT;
  release(attacker, 1100); deterministic(() => game.combat.updateMelee(.01));
  assert.equal(game.hits[0][2], guardT < 220 ? 'parry' : 'hit');
  if (guardT < 220) {
    assert.equal(target.hp, 10000); assert.equal(target.mp, 100); assert.equal(target.parryT, 450);
    assert.equal(attacker.action, null); assert.equal(attacker.state, 'stun'); assert.equal(attacker.stunT, 1100);
    near(attacker.knockVel.z, -4); game.combat.updateMelee(.01); assert.equal(game.combat.meleeWindows.length, 0);
  } else assert.equal(target.hp, 10000 - 138);
});

test('invulnerable dodge takes no damage from a fully charged hit', () => {
  const { game, attacker, target } = setup(); target.state = 'dash'; target.invuln = 100;
  release(attacker, 1100); deterministic(() => game.combat.updateMelee(.01));
  assert.equal(game.hits[0][2], 'miss'); assert.equal(target.hp, 10000); assert.equal(target.mp, 100);
  assert.equal(target.state, 'dash'); assert.equal(target.airDown, undefined);
});

for (const [heldMs, mp] of [[280, 1], [1100, 100]]) {
  test(`lethal ${heldMs} ms guard break preserves death through later updates and reset`, () => {
    const { game, attacker, target } = setup();
    target.hp = 1; target.mp = mp; target.guarding = true; target.state = 'guard'; target.guardT = 500;
    release(attacker, heldMs); deterministic(() => game.combat.updateMelee(.01));
    assert.equal(game.hits[0][2], 'hit'); assert.equal(target.hp, 0); assert.equal(target.dead, true);
    assert.equal(target.state, 'dead'); assert.equal(target.action, null); assert.equal(target.guarding, false);
    assert.equal(target.tryUse('atk'), false); assert.equal(target.startCharge(), false);
    for (let i = 0; i < 100; i++) tick(target, 10, true);
    assert.equal(target.state, 'dead'); assert.equal(target.stunT, 0); assert.equal(attacker.stats.kills, 1);
    assert.equal(target.receiveHit(attacker, { dmg: 100, guardBreak: true }, 0, 1), 'miss');
    assert.equal(game.events.filter(e => e.f === target && e.type === 'death').length, 1);
    assert.equal(game.events.filter(e => e.f === target && e.type === 'guardbreak').length, 1);
    target.resetState(); target.hp = target.maxHp; target.mp = target.maxMp;
    assert.equal(target.state, 'idle'); assert.equal(target.dead, false); assert.equal(target.stunT, 0);
    assert(target.startCharge());
  });
}

test('mana-depleted ordinary guard break also preserves lethal death state', () => {
  const { game, attacker, target } = setup();
  target.hp = 1; target.mp = 1; target.guarding = true; target.state = 'guard'; target.guardT = 500;
  assert(attacker.startAction(attacker.chain[0], 'atk'));
  tick(attacker, attacker.action.def.wind + attacker.action.def.hits[0].t, true);
  assert.equal(game.hits.length, 1); assert.equal(target.hp, 0); assert.equal(target.state, 'dead');
  tick(target, 600); assert.equal(target.state, 'dead'); assert.equal(attacker.stats.kills, 1);
});

for (const heldMs of [280, 700, 1100]) {
  test(`${heldMs} ms full Fighter update/physics/procedural-animation loop hits once`, () => {
    const { game } = setup(); game.fighters = []; game.scene = new THREE.Scene(); game.vfx = { particle() {} };
    const attacker = new Fighter(game, { clsId: 'swordmaster', cls: CLASSES.swordmaster, isPlayer: true, dmgMul: 1 });
    const target = new Fighter(game, { clsId: 'swordmaster', cls: CLASSES.swordmaster, team: 2, pos: [-.4, 0, 1.25], yaw: Math.PI });
    game.fighters.push(attacker, target);
    const initialHp = target.hp, expected = Math.round(90 + 140 * heldMs / 1100);
    assert(attacker.startCharge());
    deterministic(() => {
      for (let elapsed = 10; elapsed <= 1800; elapsed += 10) {
        if (elapsed === heldMs) attacker.charging = false;
        attacker.update(.01); target.update(.01); game.combat.updateMelee(.01);
      }
    });
    assert.equal(game.hits.length, 1); assert.equal(game.hits[0][2], 'hit');
    assert.equal(game.hits[0][3].dmg, expected); assert.equal(game.hits[0][3].down, heldMs > 660);
    assert.equal(game.hits[0][3].guardBreak, heldMs >= 1078); assert.equal(game.hits[0][3].contact.region, 'torso');
    assert.equal(target.hp, initialHp - expected); assert.equal(attacker.stats.dmgDealt, expected);
    assert.equal(attacker.action, null); assert.equal(game.combat.meleeWindows.length, 0);
  });
}

for (const phase of ['wind', 'active']) for (const reason of ['cancel', 'interrupt', 'frozen', 'death', 'reset', 'replace']) {
  test(`${reason} during ${phase} discards stale charge/windows before contact`, () => {
    const { game, attacker, target } = setup();
    if (phase === 'active') release(attacker, 700);
    else { assert(attacker.startCharge()); tick(attacker, 200, true); }
    const old = attacker.action;
    if (reason === 'cancel') { attacker.cancelAction(); attacker.state = 'idle'; }
    else if (reason === 'interrupt') attacker.interrupt(1100, 'test');
    else if (reason === 'frozen') attacker.addEffect({ type: 'frozen', t: 1100 });
    else if (reason === 'death') attacker.die(null);
    else if (reason === 'reset') attacker.resetState();
    else attacker.startAction({ name: 'replacement', wind: 2000, active: 100, recover: 100 }, 's1');
    attacker.charging = false;
    for (let i = 0; i < 12; i++) tick(attacker, 10, true);
    assert.equal(game.hits.length, 0); assert.equal(target.hp, 10000); assert.equal(game.combat.meleeWindows.length, 0);
    assert.notEqual(attacker.action, old);
    if (reason === 'death') { assert.equal(attacker.dead, true); assert.equal(attacker.state, 'dead'); }
    if (reason === 'replace') { assert.equal(attacker.action.slot, 's1'); assert.equal(attacker.action.t, 120); }
  });
}

test('ordinary hits still meet charge armor without cancelling its payoff', () => {
  const { game, attacker, target } = setup(); assert(attacker.startCharge()); tick(attacker, 200);
  const a = attacker.action;
  const result = deterministic(() => attacker.receiveHit(target, { dmg: 50, stun: 300, knock: 1 }, 0, -1));
  assert.equal(result, 'armor'); assert.equal(attacker.action, a); assert.equal(attacker.hp, 9950);
  attacker.charging = false; tick(attacker, 80);
  checkPayload(game, attacker, { dmg: 126, down: false, guardBreak: false });
});

test('a new charge after reset has a fresh hit set and original base definition', () => {
  const { game, attacker, target } = setup(); release(attacker, 1100);
  deterministic(() => game.combat.updateMelee(.01));
  const old = attacker.action; attacker.resetState(); target.resetState(); target.hp = 10000;
  assert(attacker.startCharge()); assert.notEqual(attacker.action.uid, old.uid);
  assert.equal(attacker.action.def.hits[0].dmg, 90); assert.equal(attacker.action.hitsDone.size, 0);
  attacker.charging = false; tick(attacker, 280, true);
  assert.equal(game.hits.length, 2); assert.equal(game.hits[1][3].dmg, 126); assert.equal(target.hp, 10000 - 126);
});

test('charge leaves existing mana/stamina costs and depleted-stamina eligibility unchanged', () => {
  for (const stamina of [0, 1, 100]) {
    const { game, attacker } = setup(); attacker.stamina = stamina; attacker.mp = 0;
    release(attacker, 700); checkPayload(game, attacker, { dmg: 179 });
    assert.equal(attacker.stamina, stamina); assert.equal(attacker.mp, 0);
  }
});

test('airborne, dead, busy and controlled actors cannot start charging', () => {
  for (const configure of [f => { f.onGround = false; f.state = 'jump'; }, f => { f.dead = true; },
    f => { f.action = {}; }, f => { f.stunT = 100; }, f => { f.addEffect({ type: 'frozen', t: 1000 }); }]) {
    const { game, attacker } = setup(); configure(attacker);
    assert.equal(attacker.startCharge(), false); assert.equal(game.combat.meleeWindows.length, 0);
  }
});

test('normal attacks and class definitions are not changed by charged release', () => {
  const before = JSON.stringify(CLASSES), { game, attacker } = setup();
  release(attacker, 700); attacker.resetState(); game.combat.updateMelee(.01);
  const def = attacker.chain[0]; assert(attacker.startAction(def, 'atk'));
  tick(attacker, def.wind + (def.hits[0].t || 0));
  const w = windowFor(game, attacker); assert.equal(w.def, def); assert.equal(w.h, def.hits[0]);
  assert.equal(JSON.stringify(CLASSES), before);
});

const variants = [];
for (const [clsId, cls] of Object.entries(CLASSES)) {
  for (const form of cls.forms ? Object.keys(cls.forms) : [null]) {
    const label = clsId + (form ? '/' + form : '');
    const chain = form ? cls.forms[form].chain : cls.chain;
    const chargeable = !!chain && !chain[0].proj;
    variants.push({ class: clsId, form, weapon: cls.weapon, chargeable });
    test(`${label}: ${chargeable ? 'melee charge registers full payoff' : 'ranged chain rejects charging'}`, () => {
      if (chargeable) {
        for (const heldMs of [280, 700, 1100]) {
          const { game, attacker } = setup(clsId, form); release(attacker, heldMs);
          checkPayload(game, attacker, { dmg: Math.round(90 + 140 * heldMs / 1100), down: heldMs > 660, guardBreak: heldMs >= 1078 });
        }
      } else {
        const { attacker } = setup(clsId, form);
        assert.equal(attacker.chargeDef(), null); assert.equal(attacker.startCharge(), false); assert.equal(attacker.action, null);
      }
    });
  }
}

const result = { passed: tests.filter(t => t.passed).length, total: tests.length, variants, tests };
console.log(JSON.stringify(result, null, 2));
if (result.passed !== result.total) process.exitCode = 1;
