// A flying/air-targeting bot must recover its vertical scan after landing.
// Run with the repository's three-local-loader; no renderer is required.
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Brain } from '../src/game/ai.js';
import { visibleTo } from '../src/game/perception.js';

function setup(pitch, blocked = false) {
  const target = { id: 2, alive: true, team: 2, pos: new THREE.Vector3(0, 0, 10),
    radius: .25, height: 1.8, collisionHeight: 1.8, hasEffect: () => false };
  target.center = () => target.pos.clone().add(new THREE.Vector3(0, 1, 0));
  const f = { id: 1, clsId: 'witch', cls: { aiRange: 10, weapon: 'broom' },
    weapon: { type: 'broom' }, team: 1, pos: new THREE.Vector3(), radius: .25,
    height: 1.8, collisionHeight: 1.8, pitch, yaw: 0, state: 'idle',
    moveInput: new THREE.Vector2(), canActOrAir: () => true, hasEffect: () => false };
  f.eyePos = (out = new THREE.Vector3()) => out.copy(f.pos).add(new THREE.Vector3(0, 1.6, 0));
  f.game = { time: 0, world: { blocked: typeof blocked === 'function' ? blocked : () => blocked }, combat: { enemiesOf: () => [target] } };
  const brain = new Brain(f); f.ai = brain; return { f, target, brain };
}

const checks = [];
for (const pitch of [-1.2, 1.2]) {
  const { f, target, brain } = setup(pitch);
  assert.equal(visibleTo(f, target), false, 'initial ground opponent is outside vertical view');
  let found = false;
  for (let i = 0; i < 180; i++) {
    if (visibleTo(f, target)) { found = true; break; }
    f.game.time += 1 / 60; brain.update(1 / 60);
  }
  assert(found, `bot retained ${pitch} rad aim and never scanned the ground opponent`);
  checks.push(`reacquires from ${pitch} rad within 3 seconds`);
}
{
  const { f, target, brain } = setup(1.2, (a, b) => Math.hypot(b.x-a.x, b.z-a.z) > 2);
  f.lastKnownTargetPos = target.pos.clone();
  f.lastKnownTargetAim = target.center(); brain.memoryT = 2.2;
  // Move the hidden opponent after the observation; investigation must use the
  // cached point, never reveal the new position through an occluding wall.
  target.pos.set(12, 6, -8);
  for (let i = 0; i < 180; i++) { f.game.time += 1 / 60; brain.update(1 / 60); }
  assert.equal(f.targetVisible, false); assert.equal(brain.pickTarget(), null);
  assert(f.lastKnownTargetPos.equals(new THREE.Vector3(0, 0, 10)));
  assert(Math.abs(f.pitch) < .01, 'expired observation restores a level scan');
  assert(f.moveInput.length() > .1, 'bot investigates another viewpoint after memory expires');
  checks.push('hidden opponent remains hidden; cached observation expires');
}
console.log(JSON.stringify({ checks, errors: [] }, null, 2));
