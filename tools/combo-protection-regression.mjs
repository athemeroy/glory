// Headless production Fighter + Combat + World tests, using procedural bodies.
// Run: node --loader ./tools/three-local-loader.mjs tools/combo-protection-regression.mjs
// These fixtures verify state-machine contracts, not a practical infinite combo
// or rendered / animated GLB contact correctness.
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Fighter } from '../src/game/fighter.js';
import { Combat } from '../src/game/combat.js';
import { World } from '../src/game/world.js';
import { CLASSES } from '../src/data/classes.js';
import { STAMINA_COST } from '../src/game/stamina.js';

const tests = [], live = [];
function test(name, run) {
  const random = Math.random;
  Math.random = () => .5; // No crit or damage variation; restore even on failure.
  try { run(); tests.push({ name, passed: true }); }
  catch (error) { tests.push({ name, passed: false, error: error.message }); }
  finally { Math.random = random; for (const f of live.splice(0)) f.dispose(); }
}
function fixture(opts = {}) {
  const events = [], contacts = [];
  const game = { scene: new THREE.Scene(), world: new World(), fighters: [], time: 0,
    onFighterEvent: (fighter, type, data) => events.push({ fighter, type, data }),
    onHit: (...args) => contacts.push(args), onWhiff() {}, vfx: { particle() {} } };
  game.combat = new Combat(game);
  const make = options => {
    const f = new Fighter(game, { clsId: 'swordmaster', cls: CLASSES.swordmaster, hp: 100000, dmgMul: 1, ...options });
    game.fighters.push(f); live.push(f); return f;
  };
  const src = make({ team: 1, pos: [0, 0, -1] }), target = make({ team: 2, ...opts });
  return { game, src, target, events, contacts };
}
const normal = { dmg: 100, stun: 400, knock: .1 };
const launcher = { ...normal, launch: 8 };
const count = (fx, type) => fx.events.filter(e => e.fighter === fx.target && e.type === type).length;
function hit(fx, payload = normal) { return fx.target.receiveHit(fx.src, payload, 0, 1); }
function airborne(f, vy = 5, y = 2) { f.state = 'air'; f.onGround = false; f.pos.y = y; f.vel.y = vy; }
function chain(fx, hits) {
  for (let i = 0; i < hits.length; i++) {
    hit(fx, hits[i]);
    assert.equal(fx.target.comboTaken, i + 1);
    assert.equal(count(fx, 'protect'), i >= 11 ? 1 : 0, `threshold on hit ${i + 1}`);
    if (i < 11) assert.ok(!fx.target.protectPending);
  }
}
function protectedAir(fx, payload = normal) {
  airborne(fx.target); chain(fx, Array(11).fill(normal)); hit(fx, payload);
  assert.equal(fx.target.protectPending, true); assert.equal(fx.target.airDown, true);
  assert.equal(count(fx, 'protect'), 1);
}
function until(fx, done, cadence = [1 / 60], limit = 4, beforeStep = () => {}) {
  let elapsed = 0, step = 0;
  while (!done() && elapsed < limit) {
    const dt = cadence[step++ % cadence.length];
    beforeStep(dt); fx.game.time += dt; fx.target.update(dt); elapsed += dt;
  }
  assert.ok(done(), `state did not arrive within ${limit}s: ${fx.target.state}`);
  return elapsed;
}

for (const [name, setup, hits] of [
  ['ground ordinary', () => {}, Array(12).fill(normal)],
  ['ground launcher at threshold', () => {}, [...Array(11).fill(normal), launcher]],
  ['air ordinary', f => airborne(f), Array(12).fill(normal)],
  ['air repeated launcher', f => airborne(f), Array(12).fill(launcher)],
  ['mixed ground, launch, juggle', () => {}, [...Array(4).fill(normal), launcher, normal, launcher, ...Array(5).fill(normal)]],
  ['air down hit at threshold', f => airborne(f), [...Array(11).fill(normal), { ...normal, down: true }]],
]) test(`${name}: protection begins exactly once at hit 12`, () => {
  const fx = fixture(); setup(fx.target); chain(fx, hits);
  assert.equal(fx.target.state, 'air'); assert.equal(fx.target.protectPending, true);
  assert.equal(fx.target.airDown, true); assert.equal(fx.target.onGround, false);
  assert.equal(fx.target.vel.y, name.startsWith('ground') ? 4 : 0);
  const hp = fx.target.hp, vy = fx.target.vel.y;
  for (const payload of [normal, launcher, { ...launcher, grab: true, otgOk: true, down: true }]) hit(fx, payload);
  assert.ok(fx.target.hp < hp, 'protection must not add damage immunity');
  assert.equal(fx.target.vel.y, vy); assert.equal(count(fx, 'protect'), 1);
});

test('air threshold preserves existing downward velocity', () => {
  const fx = fixture(); airborne(fx.target, -7); fx.target.comboTaken = 11; hit(fx, launcher);
  assert.equal(fx.target.vel.y, -7); assert.equal(fx.target.airDown, true);
});

test('repeated launch limit below the 12-hit threshold stays unchanged', () => {
  const fx = fixture();
  for (let i = 1; i <= 3; i++) { hit(fx, launcher); assert.equal(fx.target.air.launches, i); assert.equal(fx.target.vel.y, 8); }
  assert.equal(fx.target.air.protected, true); fx.target.vel.y = -3; hit(fx, launcher);
  assert.equal(fx.target.air.launches, 3); assert.equal(fx.target.vel.y, 2);
  assert.equal(count(fx, 'protect'), 0); assert.ok(!fx.target.protectPending);
});

test('elapsed-air protection below the threshold stays separate', () => {
  const fx = fixture(); airborne(fx.target); fx.target.air.time = 1.99;
  fx.target.updateState(.02, 20); assert.equal(fx.target.air.protected, true);
  fx.target.vel.y = -4; hit(fx);
  assert.equal(fx.target.vel.y, 0); assert.ok(!fx.target.protectPending); assert.equal(count(fx, 'protect'), 0);
});

for (const [name, cadence] of [['30Hz', [1 / 30]], ['60Hz', [1 / 60]], ['120Hz', [1 / 120]], ['variable', [.008, .033, .017, .025]]]) {
  test(`${name}: attacks cannot suspend protected fall, and getup keeps existing bonuses`, () => {
    const fx = fixture(); protectedAir(fx);
    const startY = fx.target.pos.y;
    until(fx, () => fx.target.state === 'down', cadence, 2, () => {
      const oldVy = fx.target.vel.y; hit(fx, launcher); assert.equal(fx.target.vel.y, oldVy);
    });
    assert.equal(fx.target.pos.y, 0); assert.ok(startY > fx.target.pos.y);
    assert.equal(fx.target.downT, 900); assert.equal(fx.target.protectPending, true);
    assert.equal(fx.target.airDown, false); assert.equal(count(fx, 'protect'), 1);
    const downT = fx.target.downT;
    for (let i = 1; i <= 5; i++) {
      hit(fx, { ...launcher, otgOk: true });
      assert.equal(fx.target.state, 'down'); assert.equal(fx.target.onGround, true);
      assert.equal(fx.target.downT, Math.min(downT + Math.min(i, 3) * 120, 1300));
    }
    until(fx, () => fx.target.state === 'getup', cadence);
    assert.equal(fx.target.invuln, 900); assert.equal(fx.target.armor, 1300);
    assert.equal(fx.target.protectPending, false); assert.equal(fx.target.comboTaken, 0);
    const hp = fx.target.hp; assert.equal(hit(fx, launcher), 'miss'); assert.equal(fx.target.hp, hp);
    until(fx, () => fx.target.state === 'idle', cadence);
    assert.ok(fx.target.invuln > 0 && fx.target.armor > 0);
    assert.equal(fx.target.air.launches, 0); assert.equal(fx.target.air.time, 0);
    assert.equal(fx.target.air.protected, false); assert.equal(fx.target.air.noTech, false);
    until(fx, () => fx.target.armor <= 0 && fx.target.invuln <= 0, cadence);
    assert.equal(hit(fx), 'hit'); assert.equal(fx.target.state, 'hitstun');
    assert.equal(fx.target.comboTaken, 1); assert.equal(count(fx, 'protect'), 1);
  });
}

test('Combat real body contacts trigger protection only on the twelfth delivered segment', () => {
  const fx = fixture(); airborne(fx.target, 3, 1);
  for (let i = 0; i < 15; i++) {
    const payload = { ...(i % 2 ? launcher : normal), t: 0, shape: 'sphere', range: 4, arc: 360 };
    const def = { wind: 0, active: 100, recover: 0, anim: 'cast', hits: [payload] };
    fx.src.action = { uid: `contact-${i}`, def, stage: 'active', t: 0 };
    fx.game.combat.meleeHit(fx.src, payload, def, 0);
    fx.game.combat.updateMelee(1 / 60);
    assert.equal(fx.contacts.length, i + 1, 'fixture must actually contact the production body');
    assert.equal(fx.target.comboTaken, i + 1);
    assert.equal(count(fx, 'protect'), i >= 11 ? 1 : 0);
    if (i >= 11) assert.equal(fx.target.vel.y, 0);
    fx.game.combat.updateMelee(1 / 120);
    assert.equal(fx.contacts.length, i + 1, 'one hit window must not damage twice');
  }
});

test('protection does not change per-hit damage decay', () => {
  const fx = fixture(); chain(fx, Array(15).fill(normal));
  const damage = fx.events.filter(e => e.fighter === fx.target && e.type === 'damage').map(e => e.data.dmg);
  // Target faces away, so the existing 15% back-hit modifier also applies.
  const expected = Array.from({ length: 15 }, (_, i) => Math.round(100 * Math.max(.45, 1 - .08 * i) * 1.15));
  assert.deepEqual(damage, expected);
});

test('already-down ordinary hits keep capped extensions without a second knockdown', () => {
  const fx = fixture(); fx.target.state = 'down'; fx.target.downT = 650; fx.target.comboTaken = 11;
  for (let i = 0; i < 5; i++) hit(fx);
  assert.equal(fx.target.state, 'down'); assert.equal(fx.target.downT, 1010);
  assert.equal(fx.target.downHits, 5); assert.ok(!fx.target.protectPending); assert.equal(count(fx, 'protect'), 0);
});

test('unprotected downed launcher keeps its existing response', () => {
  const fx = fixture(); fx.target.state = 'down'; fx.target.downT = 650;
  hit(fx, { ...launcher, otgOk: true });
  assert.equal(fx.target.state, 'air'); assert.equal(fx.target.vel.y, 8); assert.ok(!fx.target.protectPending);
});

test('ordinary knockdown below the threshold keeps its launch and recovery timing', () => {
  const fx = fixture(); hit(fx, { ...normal, down: true });
  assert.equal(fx.target.vel.y, 3.5); assert.equal(fx.target.airDown, true);
  assert.ok(!fx.target.protectPending); assert.equal(count(fx, 'protect'), 0);
  until(fx, () => fx.target.state === 'down'); assert.equal(fx.target.downT, 900);
  until(fx, () => fx.target.state === 'getup');
  assert.equal(fx.target.invuln, 450); assert.equal(fx.target.armor, 0);
});

for (const setup of ['timer armor', 'status armor', 'active action armor', 'boss']) test(`${setup} remains immune to threshold hit reactions`, () => {
  const fx = fixture(setup === 'boss' ? { kind: 'boss' } : {});
  if (setup === 'timer armor') fx.target.armor = 1000;
  if (setup === 'status armor') fx.target.effects.push({ type: 'superArmor', t: 1000 });
  if (setup === 'active action armor') fx.target.action = { def: { armor: true }, stage: 'active' };
  fx.target.comboTaken = 11;
  assert.equal(hit(fx, launcher), 'armor'); assert.equal(fx.target.state, 'idle');
  assert.ok(fx.target.hp < fx.target.maxHp); assert.ok(!fx.target.protectPending); assert.equal(count(fx, 'protect'), 0);
});

test('grab still bypasses armor and can trigger threshold protection', () => {
  const fx = fixture({ kind: 'boss' }); fx.target.armor = 1000; fx.target.comboTaken = 11;
  assert.equal(hit(fx, { ...launcher, grab: true }), 'hit');
  assert.equal(fx.target.protectPending, true); assert.equal(fx.target.airDown, true); assert.equal(fx.target.vel.y, 4);
});

test('staggerable boss and recovering action remain susceptible', () => {
  const fx = fixture({ kind: 'boss' }); fx.target.bossStaggerable = true;
  fx.target.action = { def: { armor: true }, stage: 'recover' }; fx.target.comboTaken = 11;
  assert.equal(hit(fx, launcher), 'hit'); assert.equal(fx.target.protectPending, true); assert.equal(fx.target.action, null);
});

for (const state of ['idle', 'air']) test(`${state}: noStun damage does not gain a threshold reaction`, () => {
  const fx = fixture(); if (state === 'air') airborne(fx.target);
  fx.target.comboTaken = 11; const vy = fx.target.vel.y;
  assert.equal(hit(fx, { ...launcher, noStun: true }), 'hit');
  assert.equal(fx.target.comboTaken, 12); assert.equal(fx.target.state, state); assert.equal(fx.target.vel.y, vy);
  assert.ok(!fx.target.protectPending); assert.equal(count(fx, 'protect'), 0);
  hit(fx); assert.equal(count(fx, 'protect'), 1); assert.equal(fx.target.protectPending, true);
});

for (const kind of ['timer', 'effect']) test(`${kind} invulnerability ignores threshold damage and reactions`, () => {
  const fx = fixture(); fx.target.comboTaken = 11;
  if (kind === 'timer') fx.target.invuln = 500; else fx.target.effects.push({ type: 'invulnerable', t: 500 });
  assert.equal(hit(fx, launcher), 'miss'); assert.equal(fx.target.hp, fx.target.maxHp);
  assert.equal(fx.target.comboTaken, 11); assert.equal(count(fx, 'protect'), 0);
});

test('ordinary guard still blocks without incrementing the threshold', () => {
  const fx = fixture(); fx.target.comboTaken = 11; fx.target.yaw = Math.PI;
  fx.target.state = 'guard'; fx.target.guarding = true; fx.target.guardT = 500;
  assert.equal(hit(fx), 'block'); assert.equal(fx.target.state, 'guard');
  assert.equal(fx.target.comboTaken, 11); assert.equal(count(fx, 'protect'), 0);
});

for (const pending of [false, true]) test(`${pending ? 'pending fall' : 'threshold'} lethal hit cannot replace death with protection`, () => {
  const fx = fixture();
  if (pending) protectedAir(fx); else { airborne(fx.target); fx.target.comboTaken = 11; }
  fx.target.hp = 1; hit(fx, launcher);
  assert.equal(fx.target.dead, true); assert.equal(fx.target.state, 'dead'); assert.equal(fx.target.hp, 0);
  assert.equal(count(fx, 'protect'), pending ? 1 : 0); assert.equal(count(fx, 'death'), 1);
  fx.target.update(.1); assert.equal(fx.target.state, 'dead'); assert.equal(hit(fx), 'miss');
});

for (const timing of ['before landing', 'after landing']) test(`existing tech ${timing} can end protection and uses its original stamina/invulnerability`, () => {
  const fx = fixture(); protectedAir(fx); const stamina = fx.target.stamina;
  fx.target.vel.y = -2; fx.target.pos.y = 0; fx.target.onGround = true;
  if (timing === 'before landing') fx.target.requestTech();
  fx.target.onLand(2);
  if (timing === 'after landing') fx.target.requestTech();
  assert.equal(fx.target.state, 'tech'); assert.equal(fx.target.stamina, stamina - STAMINA_COST.tech);
  assert.equal(fx.target.invuln, 400); assert.equal(fx.target.armor, 0);
  assert.equal(fx.target.protectPending, false); assert.equal(fx.target.airDown, false); assert.equal(fx.target.comboTaken, 0);
});

test('noTech threshold hit still prevents tech and clears restriction after normal getup', () => {
  const fx = fixture(); protectedAir(fx, { ...launcher, noTech: true });
  assert.equal(fx.target.requestTech(), false); assert.equal(fx.target.techBuffer, 0);
  until(fx, () => fx.target.state === 'down'); assert.equal(fx.target.requestTech(), false);
  until(fx, () => fx.target.state === 'idle');
  assert.equal(fx.target.air.noTech, false); assert.equal(fx.target.protectPending, false);
});

test('insufficient stamina cannot tech out of protected knockdown', () => {
  const fx = fixture(); protectedAir(fx); fx.target.stamina = 0; fx.target.techBuffer = 260;
  fx.target.onLand(2); assert.equal(fx.target.state, 'down'); assert.equal(fx.target.protectPending, true);
});

test('resetState clears every protection and knockdown flag for the next round', () => {
  const fx = fixture(); protectedAir(fx, { ...launcher, noTech: true });
  fx.target.downHits = 3; fx.target.techBuffer = 200; fx.target.resetState();
  assert.equal(fx.target.state, 'idle'); assert.equal(fx.target.onGround, true);
  assert.equal(fx.target.protectPending, false); assert.equal(fx.target.airDown, false);
  assert.equal(fx.target.comboTaken, 0); assert.equal(fx.target.comboResetT, 0);
  assert.equal(fx.target.downHits, 0); assert.equal(fx.target.downT, 0); assert.equal(fx.target.techBuffer, 0);
  assert.deepEqual(fx.target.air, { time: 0, launches: 0, protected: false });
  hit(fx, launcher); assert.equal(fx.target.vel.y, 8); assert.equal(fx.target.comboTaken, 1); assert.ok(!fx.target.protectPending);
});

test('ordinary recovery still resets the combo and allows a fresh chain', () => {
  const fx = fixture(); hit(fx); until(fx, () => fx.target.state === 'idle' && fx.target.comboTaken === 0);
  chain(fx, Array(12).fill(normal)); assert.equal(fx.target.protectPending, true);
});

const result = { passed: tests.filter(t => t.passed).length, total: tests.length, tests };
console.log(JSON.stringify(result, null, 2));
if (result.passed !== result.total) process.exitCode = 1;
