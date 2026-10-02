import * as THREE from '../vendor/three.module.js';
import { World } from '../src/game/world.js';
import { Combat } from '../src/game/combat.js';
import { buildWeapon } from '../src/game/weapons.js';
import { characterProfile, hurtCapsules, segmentCapsule, segmentHitCharacter,
  attackSegments, sweptMeleeContact, cylinderContact, sphereContact, rangedMeleeContact } from '../src/game/combat-volumes.js';

const v = (x, y, z) => new THREE.Vector3(x, y, z);
const assert = (ok, message) => { if (!ok) throw new Error(message); };
const close = (actual, expected, epsilon = 1e-6) => Math.abs(actual - expected) <= epsilon;

function fighter(x = 0, y = 0, z = 0, opts = {}) {
  const f = { pos: v(x, y, z), vel: v(0, 0, 0), yaw: 0, pitch: 0, scale: 1,
    radius: 0.28, height: 1.8, downHeight: 0.45, alive: true, state: 'idle', team: 2,
    onGround: true, cls: {}, isPlayer: false, hits: [], aimDir: v(0, 0, 1), ...opts };
  f.center = (out = new THREE.Vector3()) => out.copy(f.pos).add(v(0, f.height * 0.5, 0));
  f.eyePos = (out = new THREE.Vector3()) => out.copy(f.pos).add(v(0, f.height * 0.9, 0));
  f.forward = (out = new THREE.Vector3()) => out.set(Math.sin(f.yaw), 0, Math.cos(f.yaw));
  f.hasEffect = type => (f.effects || []).some(e => e.type === type);
  f.receiveHit = (source, hit) => { f.hits.push(hit); return 'hit'; };
  const root = new THREE.Group(), base = new THREE.Object3D(), tip = new THREE.Object3D();
  root.add(base, tip); base.position.set(0, 1.0, 0.4); tip.position.set(0, 1.0, 1.2);
  f.weapon = { type: 'sword', obj: root, base, tip, muzzle: tip };
  return f;
}

function game(fighters, colliders = []) {
  const world = new World(); world.setLevel({ colliders, bounds: { minX: -30, maxX: 30, minZ: -30, maxZ: 30 } });
  const events = [], g = { fighters, world, scene: new THREE.Scene(), onHit: (...args) => events.push(args),
    onWhiff: () => {}, onFire: () => {}, sfx: () => {}, shake: () => {},
    vfx: { projectileMesh: () => new THREE.Group(), projectileStep: () => {}, burst: () => {},
      ring: () => {}, explosion: () => {}, particle: () => {}, beam: () => {} } };
  g.combat = new Combat(g); g.events = events;
  return g;
}

function projectile(g, owner, from, velocity, p = {}) {
  const mesh = new THREE.Group(); g.scene.add(mesh);
  const pr = { owner, p: { kind: 'bullet', radius: 0.18, speed: velocity.length(), range: 50, dmg: 50, ...p },
    def: {}, pos: from.clone(), vis: from.clone(), visOff: v(0, 0, 0), vel: velocity.clone(),
    traveled: 0, mesh, hit: new Set(), age: 0, color: '#ffffff' };
  g.combat.projectiles.push(pr); return pr;
}

export function runCombatVolumeRegression() {
  const tests = [];
  const test = (name, fn) => { try { fn(); tests.push({ name, passed: true }); } catch (e) { tests.push({ name, passed: false, error: e.message }); } };

  test('exact sphere entry, not projected centre', () => {
    const hit = segmentCapsule(v(-2, 0, 0), v(2, 0, 0), { a: v(0, 0, 0), b: v(0, 0, 0), radius: 0.2, region: 'head' });
    assert(hit && close(hit.fraction, 0.45), `entry ${hit?.fraction}`);
  });
  test('parallel capsule ray enters rounded cap', () => {
    const hit = segmentCapsule(v(0, -1, 0), v(0, 4, 0), { a: v(0, 0, 0), b: v(0, 2, 0), radius: 0.2, region: 'torso' });
    assert(hit && close(hit.fraction, 0.16), `entry ${hit?.fraction}`);
  });
  test('grazing capsule tangent is finite', () => {
    const hit = segmentCapsule(v(-1, 1, 0.2), v(1, 1, 0.2), { a: v(0, 0, 0), b: v(0, 2, 0), radius: 0.2, region: 'torso' });
    assert(hit && close(hit.fraction, 0.5) && hit.point.toArray().every(Number.isFinite), 'tangent missing or nonfinite');
  });
  test('thin limb cannot be skipped by high speed', () => {
    const cap = { a: v(0, 0.5, 5), b: v(0, 1.3, 5), radius: 0.06, region: 'forearm' };
    assert(segmentCapsule(v(0, 0.9, 0), v(0, 0.9, 20), cap), 'continuous ray missed limb');
  });
  test('standing body has empty gap between legs', () => {
    assert(!segmentHitCharacter(v(0, 0.3, -3), v(0, 0.3, 3), fighter()), 'empty leg gap was a cylinder');
  });
  test('shot just outside head and shoulder misses', () => {
    assert(!segmentHitCharacter(v(0.37, 1.62, -3), v(0.37, 1.62, 3), fighter()), 'side aim manufactured hit');
  });
  test('actual arm graze hits arm region', () => {
    const hit = segmentHitCharacter(v(0.215, 1.15, -3), v(0.215, 1.15, 3), fighter());
    assert(hit?.region === 'arm', `region ${hit?.region}`);
  });
  test('head shot reports face contact point', () => {
    const hit = segmentHitCharacter(v(0, 1.66, -3), v(0, 1.66, 3), fighter());
    assert(hit?.region === 'head' && hit.point.z < 0 && hit.normal.z < 0, 'head contact wrong');
  });
  test('prone body is not hit at standing head height', () => {
    assert(!segmentHitCharacter(v(0, 1.6, -3), v(0, 1.6, 3), fighter(0, 0, 0, { state: 'down' })), 'head stayed standing');
  });
  test('prone body remains hittable near ground', () => {
    assert(segmentHitCharacter(v(0, 0.22, -3), v(0, 0.22, 3), fighter(0, 0, 0, { state: 'down' })), 'ground target lost body');
  });
  test('body scaling enlarges physical target once', () => {
    const small = fighter(), big = fighter(0, 0, 0, { scale: 2, radius: 0.56, height: 3.6 });
    assert(!segmentHitCharacter(v(0.32, 1.1, -3), v(0.32, 1.1, 3), small), 'small body hit outside');
    assert(segmentHitCharacter(v(0.32, 2.0, -3), v(0.32, 2.0, 3), big), 'large body still tiny');
  });
  test('distinct class build controls corresponding volume', () => {
    const slim = fighter(0, 0, 0, { collisionProfile: { torsoRadius: 0.13, shoulderWidth: 0.3, limbRadius: 0.06 } });
    const broad = fighter(0, 0, 0, { collisionProfile: { torsoRadius: 0.3, shoulderWidth: 0.56, limbRadius: 0.09 } });
    assert(!segmentHitCharacter(v(0.24, 1.1, -3), v(0.24, 1.1, 3), slim), 'slim phantom shoulder');
    assert(segmentHitCharacter(v(0.24, 1.1, -3), v(0.24, 1.1, 3), broad), 'broad body missed');
  });
  test('profile is unscaled metadata', () => {
    const f = fighter(0, 0, 0, { scale: 3, mocapBody: { shape: { height: 1.72, radius: 0.22 } } });
    assert(characterProfile(f).height === 1.72 && characterProfile(f).radius === 0.22, 'scale counted twice');
  });
  test('bent imported chest follows measured spine order', () => {
    const root=new THREE.Group(),bones={};
    for(const [name,p]of Object.entries({Hips:[0,.9,0],Spine02:[0,1.05,0],Spine01:[0,1.25,.25],Spine:[0,1.45,.6],Neck:[0,1.6,.6],Head:[0,1.72,.6]})){
      bones[name]=new THREE.Object3D();bones[name].position.set(...p);root.add(bones[name]);
    }
    const f=fighter(0,0,0,{rig:{root,bones},mocapBody:{bones,shape:{chestBone:'Spine',spineBones:['Spine02','Spine01','Spine']}}});
    const hit=segmentHitCharacter(v(-2,1.4,.75),v(2,1.4,.75),f);
    assert(hit?.region==='torso','visible bent upper chest had an abdominal-only damage volume');
  });
  const stab = [{ a: v(0, 1, 0.4), b: v(0, 1, 1.2), radius: 0.055 }];
  test('melee does not reach a distant target from same direction', () => {
    assert(!sweptMeleeContact(stab, stab, fighter(0, 0, 2.1)), 'range fan hit beyond blade');
  });
  test('melee blade contact hits nearby torso', () => {
    assert(sweptMeleeContact(stab, stab, fighter(0, 0, 1.3)), 'real blade missed torso');
  });
  test('narrow thrust misses a side stepping target', () => {
    assert(!sweptMeleeContact(stab, stab, fighter(0.55, 0, 1.1)), 'thrust fan hit side');
  });
  test('ground blade cannot strike overhead airborne target', () => {
    assert(!sweptMeleeContact(stab, stab, fighter(0, 3.0, 1.0)), 'phantom high melee');
  });
  test('same weapon reaches when attacker also jumps', () => {
    const lifted = stab.map(s => ({ ...s, a: s.a.clone().add(v(0, 3, 0)), b: s.b.clone().add(v(0, 3, 0)) }));
    assert(sweptMeleeContact(lifted, lifted, fighter(0, 3.0, 1.3)), 'air to air missed');
  });
  test('continuous sweep hits between separated endpoints', () => {
    const old = [{ a: v(-1, 1, 0.5), b: v(-1, 1, 1.5), radius: 0.055 }];
    const now = [{ a: v(1, 1, 0.5), b: v(1, 1, 1.5), radius: 0.055 }];
    assert(!sweptMeleeContact(old, old, fighter(0, 0, 1)), 'old endpoint unexpectedly hit');
    assert(!sweptMeleeContact(now, now, fighter(0, 0, 1)), 'new endpoint unexpectedly hit');
    assert(sweptMeleeContact(old, now, fighter(0, 0, 1)), 'sweep tunneled');
  });
  test('alternating fists cannot sweep through the air between hands', () => {
    const left=[{a:v(-1,1,.7),b:v(-1,1,1.2),radius:.105,part:'LeftForearm'}];
    const right=[{a:v(1,1,.7),b:v(1,1,1.2),radius:.105,part:'RightForearm'}];
    assert(!sweptMeleeContact(left,right,fighter(0,0,1)),'changing attack hand generated an invisible cross-body hit');
  });
  test('left rendered dagger contacts while right dagger misses', () => {
    const att=fighter(0,0,0,{team:1}), target=fighter(0,0,1.2);
    att.weapon=buildWeapon('dagger');att.weapon.obj.position.set(3,.9,1.2);
    att.leftWeapon=att.weapon.makeLeft();att.leftWeapon.position.set(0,.9,1.2);
    const segments=attackSegments(att,{}, {anim:'thrust'});
    assert(sweptMeleeContact(segments,segments,target), 'left blade existed visually but had no contact');
  });
  test('real club handle is physical below the trail anchor', () => {
    const att=fighter(0,0,0,{team:1}), target=fighter(0,0,1.2);
    att.weapon=buildWeapon('club');att.weapon.obj.position.set(0,1.4,1.2);
    const segments=attackSegments(att,{}, {anim:'slash1'});
    assert(sweptMeleeContact(segments,segments,target), 'lower wooden club was deleted by a trail marker');
  });
  test('planted supporting foot cannot manufacture a kick hit', () => {
    const att=fighter(0,0,0,{team:1}), target=fighter(0,0,1.2,{state:'down'});
    const root=new THREE.Group(),bones={};
    for(const [name,p]of Object.entries({ftL:[0,.2,1.2],knL:[0,.5,1.1],ftR:[2,1,1.2],knR:[2,.8,1]})){
      bones[name]=new THREE.Object3D();bones[name].position.set(...p);root.add(bones[name]);
    }
    att.rig={root,bones};const segments=attackSegments(att,{}, {anim:'kick'});
    assert(!sweptMeleeContact(segments,segments,target),'stationary left supporting foot caused right kick damage');
  });
  test('spinning kick uses certified left attacking foot', () => {
    const att=fighter(0,0,0,{team:1}), target=fighter(0,0,1);
    const root=new THREE.Group(),bones={};
    for(const [name,p]of Object.entries({ftL:[0,1,.9],knL:[0,.9,.6],ftR:[2,.1,.2],knR:[2,.5,.2]})){
      bones[name]=new THREE.Object3D();bones[name].position.set(...p);root.add(bones[name]);
    }
    att.rig={root,bones};const segments=attackSegments(att,{}, {anim:'spinkick'});
    assert(sweptMeleeContact(segments,segments,target),'spinning left foot was rendered but not damaging');
  });
  test('finite low shock wave misses jumped feet', () => {
    assert(!cylinderContact(v(0, 0, 0), 3, 0.9, fighter(0, 1.3, 1)), 'low shock extended into air');
    assert(cylinderContact(v(0, 0, 0), 3, 0.9, fighter(0, 0, 1)), 'ground shock missed ground target');
  });
  test('cylinder against vertical torso stays finite', () => {
    const hit = cylinderContact(v(0, 0, 0), 3, 2, fighter(0, 0, 1));
    assert(hit && hit.point.toArray().every(Number.isFinite), 'vertical cylinder division by zero');
  });
  test('spherical explosion has real upper boundary', () => {
    assert(!sphereContact(v(0, 0, 0), 1, fighter(0, 2, 0)), 'explosion hit above radius');
    assert(sphereContact(v(0, 0.3, 0), 1, fighter(0, 0, 0.7)), 'spherical ground contact lost');
  });
  test('cone respects vertical aim', () => {
    const att = fighter(0, 0, 0, { team: 1 }), t = fighter(0, 4, 3);
    const h = { range: 6, arc: 45 }, def = { anim: 'cast' };
    assert(!rangedMeleeContact(att, t, h, def), 'horizontal cast reached overhead');
    att.pitch = 0.9;
    assert(rangedMeleeContact(att, t, h, def), 'aimed upward cast missed');
  });
  test('explicit low cast ring does not hit high airborne body', () => {
    const att=fighter(0,0,0,{team:1}), target=fighter(0,1.7,2,{onGround:false});
    assert(!rangedMeleeContact(att,target,{range:5.5,arc:360,h:[-.5,1.2]},{anim:'castUp'}), 'low frost ring became a tall sphere');
  });
  test('thin wall wins before target on one fast segment', () => {
    const att = fighter(0, 0, -1, { team: 1 }), t = fighter(0, 0, 2.5);
    const g = game([att, t], [{ min: [-2, 0, 2], max: [2, 3, 2.04], tag: 'wall' }]);
    projectile(g, att, v(0, 1.1, 0), v(0, 0, 160)); g.combat.updateProjectiles(0.03);
    assert(t.hits.length === 0 && g.combat.projectiles.length === 0, 'bullet damaged through wall');
  });
  test('a ground spell below a bridge stays on its actual floor', () => {
    const att=fighter(0,0,0,{team:1}),target=fighter(0,0,3);
    att.target=target;att.targetVisible=true;
    const g=game([att,target],[{min:[-2,2,2],max:[2,2.2,4],tag:'platform'}]);
    g.combat.placeAoe(att,{at:'aim',radius:2,delay:0},{anim:'cast'});
    assert(g.combat.aoes[0].pos.y===0,'floor spell teleported to the unrelated bridge roof');
    target.pos.y=2.2;
    g.combat.placeAoe(att,{at:'aim',radius:2,delay:0},{anim:'cast'});
    assert(close(g.combat.aoes[1].pos.y,2.2),'spell aimed at a bridge target fell below its feet');
  });
  test('nearest target wins independent of fighter order', () => {
    const near = fighter(0, 0, 1), far = fighter(0, 0, 3), g = game([far, near]);
    const hit = g.world.raycast(v(0, 1.1, 0), v(0, 0, 1), 10, [far, near], 1);
    assert(hit.fighter === near && hit.dist < 1, 'far target chosen by order');
  });
  test('fast projectile hits small body continuously', () => {
    const att = fighter(0, 0, 0, { team: 1 }), t = fighter(0, 0, 2);
    const g = game([att, t]); projectile(g, att, v(0, 1.1, 0), v(0, 0, 160)); g.combat.updateProjectiles(0.04);
    assert(t.hits.length === 1 && t.hits[0].contact.region === 'torso', 'continuous body hit failed');
  });
  test('bullet radius does not manufacture side hit', () => {
    const att = fighter(0, 0, 0, { team: 1 }), t = fighter(0.38, 0, 2);
    const g = game([att, t]); projectile(g, att, v(0, 1.1, 0), v(0, 0, 160)); g.combat.updateProjectiles(0.04);
    assert(t.hits.length === 0, 'old visual radius caused wide bullet hit');
  });
  test('piercing projectile hits each victim once in distance order', () => {
    const att = fighter(0, 0, 0, { team: 1 }), a = fighter(0, 0, 2), b = fighter(0, 0, 4);
    const g = game([att, b, a]); projectile(g, att, v(0, 1.1, 0), v(0, 0, 160), { pierce: true });
    g.combat.updateProjectiles(0.04); g.combat.updateProjectiles(0.04);
    assert(a.hits.length === 1 && b.hits.length === 1 && g.events[0][1] === a, 'pierce duplicate or out of order');
  });
  test('head-only sand never converts torso graze to blindness', () => {
    const att = fighter(0, 0, 0, { team: 1 }), t = fighter(0, 0, 2);
    const g = game([att, t]); projectile(g, att, v(0, 0.9, 0), v(0, 0, 22), { kind: 'sand', radius: 0.23, eyeOnlyBlind: true, effect: { type: 'blind', t: 4000 }, pierce: true });
    g.combat.updateProjectiles(0.15);
    assert(t.hits.length === 0, 'body sand became face effect');
  });
  test('sand aimed at exposed head returns head region', () => {
    const att = fighter(0, 0, 0, { team: 1 }), t = fighter(0, 0, 2);
    const g = game([att, t]); projectile(g, att, v(0, 1.66, 0), v(0, 0, 22), { kind: 'sand', radius: 0.23, eyeOnlyBlind: true, effect: { type: 'blind', t: 4000 }, pierce: true });
    g.combat.updateProjectiles(0.15);
    assert(t.hits.length === 1 && t.hits[0].contact.region === 'head', 'sand head contact missing');
  });
  test('AI head-specific brick aims for the head instead of waist', () => {
    const att = fighter(0, 0, 0, { team: 1 }), t = fighter(0, 0, 3), g = game([att, t]);
    att.target = t; att.targetVisible = true;
    const headAim = g.combat.aimFor(att, { headOnlyStatus: true, speed: 24, gravity: 10 });
    assert(headAim.dir.y > .1, 'brick was aimed at waist rather than actual head');
  });
  test('barrel poking through wall cannot fire on its far side', () => {
    const att = fighter(0, 0, 0, { team: 1 }), t = fighter(0, 0, 3);
    const g = game([att, t], [{ min: [-2, 0, .7], max: [2, 3, .76], tag: 'wall' }]);
    att.target = t; g.combat.fireProjectile(att, {kind:'bullet',speed:90,range:20,dmg:50}, {}, 0);
    g.combat.updateProjectiles(.1);
    assert(!t.hits.length && !g.combat.projectiles.length, 'gun fired from an origin beyond solid wall');
  });
  test('beam endpoint stops at terrain before target body', () => {
    const att = fighter(0, 0, 0, { team: 1 }), t = fighter(0, 0, 2);
    const g = game([att, t], [{ min: [-2, 0, 1.5], max: [2, 3, 1.55], tag: 'wall' }]);
    att.target = t; g.combat.beamTick(att, {beam:{range:10,width:.3,dmg:50}}, 0);
    assert(!t.hits.length, 'beam hit a body beyond its clipped visual endpoint');
  });
  test('raised platform blocks shots through its underside', () => {
    const g = game([], [{ min: [-1, 1, 1], max: [1, 1.3, 2], tag: 'platform' }]);
    assert(g.world.blocked(v(0, 1.1, 0), v(0, 1.1, 3)), 'platform was transparent to damage');
  });
  test('AI plain coordinate probes use the same solid terrain', () => {
    const g = game([], [{ min: [-1, 0, 1], max: [1, 3, 1.04], tag: 'wall' }]);
    assert(g.world.blocked({x:0,y:1,z:0}, {x:0,y:1,z:2}), 'plain AI coordinates bypassed solid wall');
    assert(!g.world.blocked({x:2,y:1,z:0}, {x:2,y:1,z:2}), 'clear path probe was blocked');
  });
  test('dash cannot tunnel across a thin wall', () => {
    const f = fighter(), g = game([f], [{ min: [-2, 0, 1], max: [2, 3, 1.04], tag: 'wall' }]);
    const resolved = g.world.resolve(f, 0, 0, 4);
    assert(resolved.wallHit && resolved.z <= 0.721, `dash tunneled to ${resolved.z}`);
  });
  test('wall sliding preserves tangential travel', () => {
    const f = fighter(), g = game([f], [{ min: [-4, 0, 1], max: [4, 3, 1.04], tag: 'wall' }]);
    const resolved = g.world.resolve(f, 2, 0, 2);
    assert(resolved.wallHit && resolved.z <= 0.721 && resolved.x > 1.99, `slide ${resolved.x},${resolved.z}`);
  });
  test('dash beginning exactly tangent cannot tunnel on next frame', () => {
    const f = fighter(0, 0, 0.72), g = game([f], [{ min: [-2, 0, 1], max: [2, 3, 1.04], tag: 'wall' }]);
    const resolved = g.world.resolve(f, 0, 0, 4);
    assert(resolved.wallHit && resolved.z <= 0.721, `tangent dash tunneled to ${resolved.z}`);
  });
  test('jump cannot pass through a low ceiling', () => {
    const f = fighter(), g = game([f], [{ min: [-2, 2.2, -2], max: [2, 2.4, 2], tag: 'platform' }]);
    const resolved = g.world.resolve(f, 0, 1.0, 0);
    assert(resolved.ceiling && close(resolved.y, 0.4), `ceiling ${resolved.y}`);
  });
  test('downed collision height can pass below overhang', () => {
    const f = fighter(0, 0, 0, { state: 'down', collisionHeight: 0.45 });
    const g = game([f], [{ min: [-2, 1, 1], max: [2, 2.2, 2], tag: 'platform' }]);
    const resolved = g.world.resolve(f, 0, 0, 3);
    assert(!resolved.wallHit && close(resolved.z, 3), 'standing collider blocked prone body');
  });
  test('active window cannot repeatedly damage same victim', () => {
    const att = fighter(0, 0, 0, { team: 1 }), t = fighter(0, 0, 1.25);
    const h = { t: 0, range: 2, arc: 80, h: [0, 2.2], dmg: 50 };
    const def = { anim: 'thrust', wind: 100, active: 100, recover: 100, hits: [h] };
    att.action = { uid: 1, def, stage: 'active', t: 20, animIdx: 0 };
    const g = game([att, t]); g.combat.meleeHit(att, h, def, 0);
    g.combat.updateMelee(0.02); att.action.t = 40; g.combat.updateMelee(0.02);
    assert(t.hits.length === 1, `same sweep hit ${t.hits.length} times`);
  });
  test('turning the rendered blade also turns its melee arc', () => {
    const att=fighter(0,0,0,{team:1,yaw:Math.PI/2}), target=fighter(1.1,0,0),g=game([att,target]);
    att.rig={root:new THREE.Group(),bones:{}};att.rig.root.add(att.weapon.obj);
    const h={t:0,range:2,arc:50,h:[0,2.2],dmg:50},def={anim:'thrust',wind:100,active:100,hits:[h]};
    att.action={uid:1,stage:'active',t:20,def,aimYaw:0};
    g.combat.meleeHit(att,h,def,0);g.combat.updateMelee(.02);
    assert(target.hits.length===1,'visible turned blade hit was rejected by old starting yaw');
  });
  test('directional spell follows the current visible facing', () => {
    const att=fighter(0,0,0,{team:1,yaw:Math.PI/2}), target=fighter(2,0,0);
    att.action={aimYaw:0};
    assert(rangedMeleeContact(att,target,{range:4,arc:40,h:[0,2.2]},{anim:'cast'}), 'visible spell facing used its stale starting yaw');
  });
  test('real extended forearm remains hittable beyond root broadphase', () => {
    const att=fighter(0,0,0,{team:1}),target=fighter(0,0,3),g=game([att,target]);
    const root=new THREE.Group(),bones={};
    for(const [name,p]of Object.entries({hips:[0,.9,0],chest:[0,1.2,0],head:[0,1.65,0],
      shR:[0,1.2,-.3],elR:[0,1.2,-.7],haR:[0,1.2,-1.1]})){
      bones[name]=new THREE.Object3D();bones[name].position.set(...p);root.add(bones[name]);
    }
    target.rig={root,bones};
    const h={t:0,range:2,arc:50,h:[0,2.2],dmg:50},def={anim:'cast',wind:100,active:100,hits:[h]};
    att.action={uid:1,stage:'active',t:20,def};g.combat.meleeHit(att,h,def,0);g.combat.updateMelee(.02);
    assert(target.hits.length===1,'real reaching arm was excluded by the body-root radius');
  });
  test('separate skill strikes retain separate hit permissions', () => {
    const att = fighter(0, 0, 0, { team: 1 }), t = fighter(0, 0, 1.25);
    const h1 = { t: 0, range: 2, arc: 80, dmg: 50 }, h2 = { ...h1, t: 120 };
    const def = { anim: 'thrust', wind: 100, active: 220, recover: 100, hits: [h1, h2] };
    att.action = { uid: 1, def, stage: 'active', t: 20, animIdx: 0 };
    const g = game([att, t]); g.combat.meleeHit(att, h1, def, 0); g.combat.updateMelee(0.02);
    att.action.t = 130; g.combat.meleeHit(att, h2, def, 1); g.combat.updateMelee(0.11);
    assert(t.hits.length === 2, `multi skill hits ${t.hits.length}`);
  });
  test('cancelled action removes its pending melee damage', () => {
    const att = fighter(0, 0, 0, { team: 1 }), t = fighter(0, 0, 1.25);
    const h = { t: 0, range: 2, arc: 80, dmg: 50 }, def = { anim: 'thrust', wind: 100, active: 100, hits: [h] };
    att.action = { uid: 1, def, stage: 'active', t: 20 };
    const g = game([att, t]); g.combat.meleeHit(att, h, def, 0); att.action = null; g.combat.updateMelee(0.02);
    assert(t.hits.length === 0 && g.combat.meleeWindows.length === 0, 'cancelled attack still hit');
  });
  test('grab, forced knockdown and multiple statuses reach the victim', () => {
    const att=fighter(0,0,0,{team:1}), target=fighter(0,0,.2),g=game([att,target]);
    const h={t:0,range:1.6,arc:70,dmg:100,noTech:true,effects:[{type:'bleed',t:1000},{type:'armorBreak',t:1000}]};
    const def={anim:'grab',grab:true,wind:100,active:90,hits:[h]};
    att.action={uid:1,stage:'active',t:10,def};
    g.combat.meleeHit(att,h,def,0);g.combat.updateMelee(.01);
    assert(target.hits[0]?.grab===true&&target.hits[0].noTech===true&&target.hits[0].effects.length===2, 'grab or status flags were dropped by contact dispatch');
  });
  test('AoE cannot damage through wall', () => {
    const att = fighter(0, 0, -1, { team: 1 }), t = fighter(0, 0, 2);
    const g = game([att, t], [{ min: [-2, 0, 1], max: [2, 3, 1.05], tag: 'wall' }]);
    g.combat.aoes.push({ owner: att, a: { delay: 0, radius: 3, height: 2, dmg: 50 }, def: {}, pos: v(0, 0, 0), t: 0, effectVictims: new Set() });
    g.combat.updateAoes(0.02); assert(t.hits.length === 0, 'AoE passed through wall');
  });
  test('persistent AoE applies extra status once per target', () => {
    const att = fighter(0, 0, -1, { team: 1 }), t = fighter(0, 0, 1), g = game([att, t]);
    g.combat.aoes.push({ owner: att, a: { delay: 0, interval: 500, ticks: 3, radius: 3, height: 2,
      dmg: 50, statusOnce: true, effects: [{ type: 'silence', t: 3000 }] }, def: {}, pos: v(0, 0, 0), t: 0, effectVictims: new Set() });
    g.combat.updateAoes(0.02); g.combat.updateAoes(0.5); g.combat.updateAoes(0.5);
    assert(t.hits.length === 3 && t.hits.filter(hit => hit.effects).length === 1, 'silence refreshed on every damage tick');
  });
  test('movement lock blocks a blink displacement', () => {
    const att = fighter(0, 0, 0, { team: 1, movementLocked: () => true }), g = game([att]);
    assert(g.combat.doBlink(att, { range: 10 }) === false && att.pos.lengthSq() === 0, 'bound fighter teleported');
  });
  test('blink turn updates the strike direction at its destination', () => {
    const att = fighter(0, 0, 0, { team: 1 }), t = fighter(0, 0, 3), g = game([att, t]);
    t.yaw=Math.PI;att.target=t;att.action={aimYaw:0};
    assert(g.combat.doBlink(att, {range:10}), 'clear blink failed');
    assert(Math.abs(att.yaw-Math.PI)<1e-6 && att.action.aimYaw===att.yaw, 'pre-blink yaw rejected destination dagger');
  });
  test('cleanse prioritizes visible ally status burden and removes all', () => {
    const att=fighter(0,0,0,{team:1,hp:20,maxHp:100,effects:[{type:'poison',t:1000}]}),
      ally=fighter(0,0,2,{team:1,hp:95,maxHp:100,effects:[{type:'blind',t:1000},{type:'weak',t:1000}]}),g=game([att,ally]);
    for(const f of [att,ally]){f.heal=()=>0;f.cleanse=count=>{f.cleansed=count;};}
    g.combat.doHeal(att,{target:'lowest',cleanse:true,range:10},{});
    assert(ally.cleansed===Infinity&&att.cleansed===undefined, 'cleanse chose lowest health rather than removable status burden');
  });
  test('clear removes pending hits and physics pose caches', () => {
    const att = fighter(0, 0, 0, { team: 1 }), g = game([att]);
    g.combat.meleeHit(att, { t: 0 }, { active: 100 }, 0); projectile(g, att, v(0, 1, 0), v(0, 0, 20));
    g.combat.clear(); assert(!g.combat.meleeWindows.length && !g.combat.projectiles.length && !g.combat.aoes.length, 'stale combat state after restart');
  });
  return { passed: tests.filter(t => t.passed).length, total: tests.length, tests };
}

if (typeof process !== 'undefined' && process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
  const result = runCombatVolumeRegression();
  console.log(JSON.stringify(result, null, 2));
  if (result.passed !== result.total) process.exitCode = 1;
}
