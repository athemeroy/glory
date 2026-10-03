// Cross-check charged payload dispatch against the combo-protection state path.
// CPU-only: synthetic contact markers isolate combat/state contracts from art.
// Run: node --loader ./tools/three-local-loader.mjs tools/charge-protection-regression.mjs
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Fighter } from '../src/game/fighter.js';
import { Combat } from '../src/game/combat.js';
import { World } from '../src/game/world.js';
import { CLASSES } from '../src/data/classes.js';

const tests = [];
for (const [name, hold, combo, velocity, expectedVelocity, damage, protectEvents] of [
  ['partial charge reaches threshold during descent', 700, 11, -2.5, -2.5, 81, 1],
  ['full charge reaches threshold during ascent', 1100, 11, 6, 0, 104, 1],
  ['full charge cannot restart an already protected fall', 1100, 12, -4, -4, 104, 0],
]) {
  const random = Math.random, fighters = [];
  Math.random = () => .5; // No crit or damage variation.
  let originalWeapon;
  try {
    const events = [], hits = [];
    const game = { scene: new THREE.Scene(), fighters, world: new World(),
      onFighterEvent: (f, type) => events.push({ f, type }),
      onHit: (...args) => hits.push(args), onWhiff() {} };
    game.combat = new Combat(game);
    const attacker = new Fighter(game, { clsId: 'swordmaster', cls: CLASSES.swordmaster, team: 1, dmgMul: 1 });
    const target = new Fighter(game, { clsId: 'swordmaster', cls: CLASSES.swordmaster, team: 2, pos: [0, 0, 1], yaw: Math.PI });
    fighters.push(attacker, target);
    originalWeapon = attacker.weapon;
    const base = new THREE.Object3D(), tip = new THREE.Object3D();
    base.position.set(0, 1, .4); tip.position.set(0, 1, 1.3);
    attacker.weapon = { type: 'sword', base, tip };
    // Explicit contact geometry; damage and protection use production methods.
    target.customHurtCapsules = () => [{ region: 'torso',
      a: new THREE.Vector3(0, .8, 1), b: new THREE.Vector3(0, 1.4, 1), radius: .2 }];
    target.state = 'air'; target.onGround = false; target.vel.y = velocity;
    target.comboTaken = combo; target.protectPending = combo >= 12; target.airDown = combo >= 12;
    assert.equal(attacker.startCharge(), true);
    for (let ms = 10; ms <= hold; ms += 10) {
      if (ms === hold) attacker.charging = false;
      attacker.updateAction(.01, 10); game.combat.updateMelee(.01);
    }
    assert.equal(hits.length, 1, 'the charge must make a real Combat contact');
    assert.equal(hits[0][4], attacker.action.def, 'contact must receive the released definition');
    assert.equal(hits[0][3].dmg, hold === 700 ? 179 : 230);
    assert.equal(hits[0][3].down, true);
    assert.equal(hits[0][3].guardBreak, hold === 1100);
    assert.equal(target.maxHp - target.hp, damage, 'existing combo decay still applies');
    assert.equal(target.comboTaken, combo + 1);
    assert.equal(target.state, 'air'); assert.equal(target.protectPending, true);
    assert.equal(target.airDown, true); assert.equal(target.vel.y, expectedVelocity);
    assert.equal(events.filter(e => e.f === target && e.type === 'protect').length, protectEvents);
    for (let i = 0; i < 13; i++) { attacker.updateAction(.01, 10); game.combat.updateMelee(.01); }
    assert.equal(hits.length, 1, 'one released window cannot repeatedly damage the same victim');
    assert.equal(target.maxHp - target.hp, damage);
    assert.equal(target.vel.y, expectedVelocity);
    tests.push({ name, passed: true });
  } catch (error) { tests.push({ name, passed: false, error: error.message }); }
  finally {
    Math.random = random;
    if (fighters[0] && originalWeapon) fighters[0].weapon = originalWeapon;
    for (const f of fighters) f.dispose();
  }
}
const result = { passed: tests.filter(t => t.passed).length, total: tests.length, tests };
console.log(JSON.stringify(result, null, 2));
if (result.passed !== result.total) process.exitCode = 1;
