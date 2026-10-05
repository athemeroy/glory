// CPU decision regressions using the real Brain, class definitions and Fighter
// action/resource methods. No renderer, simulated match or visual claim.
// Run: node --loader ./tools/three-local-loader.mjs tools/ai-height-regression.mjs
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Brain } from '../src/game/ai.js';
import { Fighter } from '../src/game/fighter.js';
import { CLASSES, SKILLS, skillClass } from '../src/data/classes.js';
import { characterProfile, hurtCapsules } from '../src/game/combat-volumes.js';
import { SummonSystem, BEASTS } from '../src/game/summons.js';
import { World } from '../src/game/world.js';
import { visibleTo } from '../src/game/perception.js';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const tests = [];
const observations = {};
const originalDefinitions = JSON.stringify({ CLASSES, SKILLS });
function test(name, fn) {
  const random = Math.random;
  // Always willing to attack; choose the first available candidate. Charge is
  // enabled explicitly in its own cases so it cannot hide skill selection.
  Math.random = () => 0;
  try { fn(); tests.push({ name, passed: true }); }
  catch (e) { tests.push({ name, passed: false, error: e.message }); }
  finally { Math.random = random; }
}

function fighter(clsId, team, y = 0, z = 0) {
  // Skip only the visual/model constructor. Action admission, mana/cooldowns,
  // basic chains, charge and collision-height getters are production methods.
  const f = Object.assign(Object.create(Fighter.prototype), {
    id: team, clsId, cls: CLASSES[clsId], kind: 'hero', team,
    pos: V(0, y, z), vel: V(), knockVel: V(), yaw: 0, pitch: 0, scale: 1,
    state: y ? 'jump' : 'idle', stateT: 0, onGround: !y, dead: false,
    hp: CLASSES[clsId].hp, maxHp: CLASSES[clsId].hp, mp: 100,
    effects: [], cd: {}, chainIdx: 0, chainT: 0, formLock: 0,
    stunT: 0, parryT: 0, action: null, stageInfo: null,
    weapon: { type: CLASSES[clsId].weapon }, moveInput: new THREE.Vector2(),
    stats: { skills: 0 }, emit() {},
  });
  f.bodyProfile = characterProfile(f); f.height = f.bodyProfile.height;
  f.radius = f.bodyProfile.radius;
  return f;
}

function setup({ clsId = 'striker', skill = null, y = 0, targetY = 3,
  distance = .8, targetState = 'jump', charge = false } = {}) {
  const f = fighter(clsId, 1, y), target = fighter('witch', 2, targetY, distance);
  if (skill === SKILLS.guangchong) f.cls = skillClass('cleric', f.cls, { s6: 'guangchong' });
  target.state = targetState;
  const game = { fighters: [f, target], world: { blocked: () => false } };
  f.game = target.game = game; f.target = target;
  for (const slot of Object.keys(f.cls.skills)) f.cd[slot] = f.cls.skills[slot] === skill ? 0 : 99999;
  if (!charge) f.startCharge = () => false;
  const brain = new Brain(f); f.ai = brain;
  const decide = () => brain.decide(target, Math.hypot(target.pos.x - f.pos.x, target.pos.z - f.pos.z));
  return { f, target, brain, decide };
}

test('ground tiger does not spend 35 MP / 40 s cooldown on an overhead witch', () => {
  const { f, decide } = setup({ skill: SKILLS.menghu });
  decide();
  observations.overheadTiger = { slot: f.action?.slot || null, mp: f.mp, ultCooldown: f.cd.ult };
  assert.equal(f.action, null); assert.equal(f.mp, 100); assert.equal(f.cd.ult, 0);
});
test('ground charge is not started against a vertically unreachable target', () => {
  const { f, decide } = setup({ charge: true }); decide();
  observations.overheadCharge = { slot: f.action?.slot || null, charging: !!f.charging };
  assert.equal(f.action, null); assert.notEqual(f.charging, true);
});
test('full Brain update preserves the visible overhead target without spending tiger', () => {
  const { f, target, brain } = setup({ skill: SKILLS.menghu });
  // Looking up makes this a real perceived target, rather than a hidden actor
  // passed directly into the decision routine. Target selection is unchanged.
  f.pitch = Math.atan2(target.center().y - f.eyePos().y, .8);
  assert.equal(visibleTo(f, target), true);
  brain.update(1 / 60);
  assert.equal(f.target, target); assert.equal(f.targetVisible, true);
  assert.equal(f.action, null); assert.equal(f.mp, 100); assert.equal(f.cd.ult, 0);
});
test('horizontal dash cannot substitute for vertical reach', () => {
  const { f, decide } = setup({ skill: SKILLS.tiebu, distance: 2.2 }); decide();
  assert.equal(f.action, null); assert.equal(f.mp, 100); assert.equal(f.cd.s2, 0);
});
test('tiger becomes available again after the target descends', () => {
  const { f, target, decide } = setup({ skill: SKILLS.menghu }); decide();
  assert.equal(f.action, null);
  target.pos.y = 0; target.state = 'idle'; decide();
  assert.equal(f.action?.def, SKILLS.menghu); assert.equal(f.mp, 65); assert.equal(f.cd.ult, 40000);
});
test('target below an elevated fighter does not consume a short melee skill', () => {
  const { f, decide } = setup({ skill: SKILLS.menghu, y: 4, targetY: 0, targetState: 'idle' });
  f.onGround = true; f.state = 'idle'; decide();
  assert.equal(f.action, null); assert.equal(f.mp, 100);
});
for (const y of [0, 4]) {
  test(`same-height ${y ? 'air' : 'ground'} basic attacks remain available`, () => {
    const { f, decide } = setup({ y, targetY: y, targetState: y ? 'jump' : 'idle' }); decide();
    assert.equal(f.action?.slot, 'atk');
  });
  test(`same-height ${y ? 'raised-platform' : 'ground'} tiger keeps its existing cost`, () => {
    const { f, decide } = setup({ skill: SKILLS.menghu, y, targetY: y, targetState: 'idle' });
    f.onGround = true; f.state = 'idle'; decide();
    assert.equal(f.action?.def, SKILLS.menghu); assert.equal(f.mp, 65); assert.equal(f.cd.ult, 40000);
  });
}
test('reachable ground charge is still selected', () => {
  const { f, decide } = setup({ charge: true, targetY: 0, targetState: 'guard' }); decide();
  assert.equal(f.action?.slot, 'charge'); assert.equal(f.charging, true);
});
test('rising uppercut is not removed by the static height gate', () => {
  const { f, decide } = setup({ skill: SKILLS.shenglong }); decide();
  assert.equal(f.action?.def, SKILLS.shenglong); assert.equal(f.vel.y, 4); assert.equal(f.onGround, false);
});
for (const [clsId, skill, distance] of [
  ['sharpshooter', SKILLS.fukong, 5], ['launcher', SKILLS.jiguang, 5],
  ['witch', SKILLS.yunshi, 5], ['cleric', SKILLS.guangchong, 1],
  ['sharpshooter', SKILLS.tashe, 1], ['swordmaster', SKILLS.yinguang, 4],
  ['witch', SKILLS.saozhou, 4], ['assassin', SKILLS.yingxi, 4],
  ['swordmaster', SKILLS.sanduan, 2],
]) {
  test(`${skill.name} retains its ranged, area, mobility or staged admission`, () => {
    const { f, decide } = setup({ clsId, skill, distance }); decide();
    assert.equal(f.action?.def.name, skill.name);
  });
}
test('ranged basic attacks remain available across height differences', () => {
  const { f, decide } = setup({ clsId: 'sharpshooter', distance: 5 }); decide();
  assert.equal(f.action?.slot, 'atk');
});
test('downed targets retain melee skill admission and reduced existing weighting', () => {
  const { f, decide } = setup({ skill: SKILLS.menghu, targetY: 0, targetState: 'down' }); decide();
  assert.equal(f.action?.def, SKILLS.menghu);
});
test('a moving, falling target is reconsidered with fresh height and distance', () => {
  const { f, target, decide } = setup({ skill: SKILLS.menghu, targetY: 3.4, distance: 1.1 });
  target.vel.set(0, -2, -1);
  for (let step = 0; step < 5; step++) {
    decide(); assert.equal(f.action, null); assert.equal(f.mp, 100);
    target.pos.addScaledVector(target.vel, .1);
  }
  target.pos.set(0, .8, .8); decide();
  assert.equal(f.action?.def, SKILLS.menghu); assert.equal(f.mp, 65);
});
for (const kind of ['cat', 'wolf', 'eagle', 'dragon']) {
  test(`real ${kind} summon height is respected without treating every pet as a tall hero`, () => {
    const { f, target: owner, brain } = setup({ skill: SKILLS.menghu });
    const game = f.game, world = new World();
    world.setLevel({ colliders: [], bounds: { minX: -30, maxX: 30, minZ: -30, maxZ: 30 } });
    Object.assign(game, { time: 0, world, scene: new THREE.Scene(), vfx: {} });
    const system = new SummonSystem(game); game.summons = system;
    try {
      assert.equal(system.cast(owner, { kind }), true);
      const pet = system.units[0]; pet.pos.set(0, BEASTS[kind].altitude || 0, .8);
      f.target = pet; brain.decide(pet, .8);
      if (kind === 'eagle') { assert.equal(f.action, null); assert.equal(f.mp, 100); }
      else { assert.equal(f.action?.def, SKILLS.menghu); assert.equal(f.mp, 65); }
    } finally { system.clear(); }
  });
}
test('multiple skill hits and charge share one body query, refreshed next decision', () => {
  const { f, target, decide } = setup({ charge: true });
  // Several ordinary skills plus an eight-hit ultimate and charge must share
  // the same query. Disable only the exempt rising uppercut.
  for (const slot in f.cd) f.cd[slot] = slot === 's1' ? 99999 : 0;
  let queries = 0;
  target.customHurtCapsules = () => {
    queries++;
    return hurtCapsules({ ...target, customHurtCapsules: null });
  };
  decide(); assert.equal(queries, 1); assert.equal(f.action, null);
  target.pos.y = 0; decide();
  assert.equal(queries, 2); assert(f.action, 'later reachable decision used a stale body');
});
test('ranged-only selection does not compute target bone volumes', () => {
  const { f, target, decide } = setup({ clsId: 'launcher', skill: SKILLS.jiguang, distance: 5 });
  target.customHurtCapsules = () => { throw Error('unnecessary body query'); };
  decide(); assert.equal(f.action?.def, SKILLS.jiguang);
});
test('height query does not advance physics, animation or local bone poses', () => {
  const { f, target, decide } = setup({ skill: SKILLS.menghu });
  const root = new THREE.Group(), bones = {};
  for (const [name, p] of Object.entries({
    hips: [0, .9, 0], chest: [0, 1.3, 0], neck: [0, 1.5, 0], head: [0, 1.65, 0],
    shL: [.2, 1.35, 0], elL: [.3, 1.1, .1], haL: [.3, .9, .2],
    shR: [-.2, 1.35, 0], elR: [-.3, 1.1, .1], haR: [-.3, .9, .2],
    thL: [.1, .8, 0], knL: [.1, .45, 0], ftL: [.1, .1, 0],
    thR: [-.1, .8, 0], knR: [-.1, .45, 0], ftR: [-.1, .1, 0],
  })) {
    bones[name] = new THREE.Object3D(); bones[name].position.set(...p); root.add(bones[name]);
  }
  root.position.copy(target.pos); root.rotation.y = target.yaw; root.updateMatrixWorld(true);
  target.rig = { root, bones }; target.vel.set(1, -2, .3);
  target.animator = { update() { throw Error('AI advanced animation'); } };
  const state = () => JSON.stringify({
    pos: target.pos, vel: target.vel, state: target.state, stateT: target.stateT,
    action: target.action, mp: target.mp, cd: target.cd, stats: target.stats,
    nodes: [root, ...Object.values(bones)].map(n => [n.position.toArray(), n.quaternion.toArray(), n.scale.toArray()]),
  });
  const before = state(); decide();
  assert.equal(state(), before); assert.equal(f.action, null);
});
for (const [name, patch] of [
  ['self-leap without a projectile', { selfLeap: { vy: 4, back: 0 } }],
  ...['ground', 'sphere', 'cone', 'cylinder'].map(shape => [shape + ' hit volume', { hits: [{ ...SKILLS.menghu.hits[0], shape }] }]),
  ['unspecified height contract', { hits: [{ ...SKILLS.menghu.hits[0], h: undefined }] }],
  ['later hit with a reachable height band', { hits: [{ ...SKILLS.menghu.hits[0] }, { ...SKILLS.menghu.hits[1], h: [0, 5] }] }],
]) {
  test(`${name} is not incorrectly removed by the contact-height filter`, () => {
    // Capability fixtures protect future definitions without altering the real
    // class data or making claims about these invented actions' actual hits.
    const { f, decide } = setup();
    f.cls = { ...f.cls, skills: { s1: { ...SKILLS.menghu, ...patch } } }; f.cd = {};
    decide(); assert.equal(f.action?.slot, 's1');
  });
}
test('a body part in reach remains eligible even when its root is above the band', () => {
  const { f, target, decide } = setup({ skill: SKILLS.menghu });
  target.customHurtCapsules = () => [{ region: 'arm', a: V(0, 2, .8), b: V(0, 3, .8), radius: .07 }];
  decide(); assert.equal(f.action?.def, SKILLS.menghu);
});
test('global class data, balance values and skill definitions are unchanged', () => {
  assert.equal(JSON.stringify({ CLASSES, SKILLS }), originalDefinitions);
});

const result = { passed: tests.filter(t => t.passed).length, total: tests.length, observations, tests };
console.log(JSON.stringify(result, null, 2));
if (result.passed !== result.total) process.exitCode = 1;
