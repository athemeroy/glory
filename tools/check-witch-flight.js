import * as THREE from 'three';
import { CLASSES } from '../src/data/classes.js';
import { World } from '../src/game/world.js';
import { Brain } from '../src/game/ai.js';
import { fighterSnap, NetHostDuel } from '../src/game/netmodes.js';
import { startFlight, applyFlightSnapshot } from '../src/game/witch-flight.js';

export async function checkWitchFlight(app) {
  const g = app.game, saved = { fighters: g.fighters, player: g.player, mode: g.mode, world: g.world, inputFrozen: g.inputFrozen };
  const results = [], errors = [], check = (ok, name, data = {}) => (ok ? results : errors).push({ name, ...data });
  g.fighters = []; g.mode = null; g.world = new World(); g.world.bounds = { minX: -50, maxX: 50, minZ: -50, maxZ: 50 }; g.inputFrozen = false;
  const f = g.spawn({ clsId: 'witch', cls: CLASSES.witch, pos: [0, 0, 0], team: 1 });
  const enemy = g.spawn({ clsId: 'swordmaster', cls: CLASSES.swordmaster, pos: [0, 0, 6], team: 2 }); g.player = f;
  const reset = () => { f.resetState(); f.pos.set(0, 0, 0); f.hp = f.maxHp; f.mp = f.maxMp; f.yaw = f.pitch = 0; f.aimDir.set(0, 0, 1); g.world.colliders = []; g.combat.clear(); };
  const tick = (seconds, fps = 60) => { for (let i = 0; i < Math.round(seconds * fps); i++) { g.time += 1 / fps; f.update(1 / fps); g.combat.updateMelee?.(1 / fps); } };
  const fly = () => { f.wantJump = true; f.jumpHeld = true; tick(1 / 60); f.wantJump = true; tick(1 / 60); };
  try {
    reset(); f.wantJump = true; f.jumpHeld = true; tick(.4);
    check(!f.flightActive && f.pos.y > .8 && f.pos.y < 1.3, '一次跳跃保留普通跳跃');
    f.wantJump = true; tick(1 / 60);
    check(f.flightActive && f.flight.used && f.stamina < 71, '第二次空中跳跃起飞并消耗体力', { stamina: f.stamina });
    f.moveInput.set(0, 1); tick(1.2);
    check(f.pos.z > 5 && f.pos.y > 3.5, '骑帚可移动并按住上升', { position: f.pos.toArray() });
    tick(.7); check(f.pos.y <= 4.2001 && f.flightActive, '高度上限按本次起跳地面计算', { height: f.pos.y });
    f.jumpHeld = false; tick(.8); check(f.vel.y < -.7 && f.flightActive, '松开跳跃缓降');
    f.wantDash = true; tick(1 / 60); const stoppedY = f.pos.y;
    check(!f.flightActive && f.flight.used && f.flight.reason === 'cancel', '闪避收帚');
    f.wantJump = true; tick(.2); check(!f.flightActive && f.pos.y < stoppedY, '收帚后触地前无法再次飞行');
    tick(2); check(f.onGround && !f.flight.used, '落地恢复飞行机会');
    fly(); check(f.flightActive, '落地后可以再次起飞');
    for (const type of ['silence', 'frozen', 'bind', 'sleep', 'stun', 'fear']) {
      reset(); fly(); f.addEffect({ type, t: 1000 }); const y = f.pos.y; tick(.1);
      check(!f.flightActive && f.flight.used && f.vel.y < 0 && f.pos.y < y, '异常状态打落骑帚', { type });
      check(!startFlight(f), '受控期间不能重新飞行', { type });
    }
    reset(); fly(); f.receiveHit(enemy, { dmg: 10, stun: 200, knock: 1 }, 0, 1);
    check(!f.flightActive && f.state === 'air', '实际受击打落并进入浮空保护流程');
    reset(); fly(); f.addEffect({ type: 'superArmor', t: 1000 }); f.receiveHit(enemy, { dmg: 10, stun: 200 }, 0, 1);
    check(f.flightActive, '霸体受击保留飞行');
    reset(); fly(); f.stamina = .05; tick(1 / 60); check(!f.flightActive && f.flight.reason === 'stamina' && f.stamina === 0, '体力耗尽自动收帚且不变成负值');
    const durations = [];
    for (const fps of [30, 60, 120]) {
      reset(); fly(); f.stamina = 999; let t = 0;
      while (f.flightActive && t < 7) { tick(1 / fps, fps); t += 1 / fps; }
      durations.push(t); check(f.flight.reason === 'duration' && t >= 5.4 && t <= 5.6, '飞行时间上限不依赖帧率', { fps, duration: t });
    }
    reset(); f.stamina = 19; fly(); check(!f.flightActive && f.stamina >= 0, '不足跳跃加起飞消耗时拒绝起飞');
    reset(); fly(); g.world.colliders = [{ min: [-4, 2.5, -4], max: [4, 3, 4] }]; tick(.8);
    check(f.pos.y + f.collisionHeight <= 2.5001, '骑帚不能穿越头顶实心屋顶', { feet: f.pos.y, height: f.collisionHeight });
    reset(); fly(); g.world.colliders = [{ min: [-5, 0, 2], max: [5, 8, 2.12] }]; f.moveInput.set(0, 1); tick(1.1);
    check(f.pos.z <= 2 - f.radius + .001, '高速飞行不能穿过薄墙', { z: f.pos.z });
    reset(); fly(); tick(.7); const before = f.stamina;
    const snap = fighterSnap(f, true); applyFlightSnapshot(enemy, snap.fl); // 非魔道不接受飞行能力。
    check(snap.fl[0] === 1 && snap.fl[1] === 1 && snap.fl[2] > .6 && snap.sp === Math.round(before) && !enemy.flightActive, '权威快照包含飞行状态与体力且不赋予其他职业');
    f.flight.active = false; applyFlightSnapshot(f, snap.fl); check(f.flightActive && Math.abs(f.flight.elapsed - snap.fl[2]) < .001, '客机恢复飞行姿势/时间');
    applyFlightSnapshot(f, undefined); check(!f.flightActive, '旧快照缺省不会残留飞行');
    for (const slot of Object.keys(f.cls.skills)) { reset(); fly(); check(f.tryUse(slot), '骑帚可释放职业技能', { slot, skill: f.cls.skills[slot].name }); }
    reset(); fly(); tick(.6); f.updateModel(1 / 60); f.rig.root.updateMatrixWorld(true);
    const axis = new THREE.Vector3(0, 1, 0).applyQuaternion(f.weapon.obj.getWorldQuaternion(new THREE.Quaternion()));
    const finite = Object.values(f.mocapBody?.bones || {}).every(b => b.matrixWorld.elements.every(Number.isFinite));
    check(finite && Math.abs(axis.y) < .03 && axis.z > .97, '真实骨架骑帚姿势有限且帚杆沿前向', { axis: axis.toArray() });
    reset(); f.pos.set(0, 0, 0); enemy.pos.set(0, 0, 8); f.ai = new Brain(f, 'normal');
    for (let i = 0; i < 3; i++) { f.ai.update(1 / 60); f.update(1 / 60); }
    check(f.flightActive, 'AI通过相同跳跃输入进入扫帚飞行'); f.ai = null;
    reset(); fly(); const h = { enemy: f, game: g, remoteIn: { mx: 0, my: 0, yaw: 0, pitch: 0, jump: 1 }, lastInT: performance.now(), presses: [] };
    NetHostDuel.prototype.preTick.call(h); check(f.jumpHeld, '联机远端长按跳跃传给权威角色');
    h.lastInT -= 400; NetHostDuel.prototype.preTick.call(h); check(!f.jumpHeld, '联机输入超时释放上升避免悬停');
    reset(); fly(); f.resetState(); check(!f.flightActive && !f.flight.used && !f.jumpHeld, '回合重置清空飞行和按住输入');
    enemy.pos.y = 2; enemy.onGround = false; enemy.wantJump = true; enemy.jumpHeld = true; enemy.update(1 / 60);
    check(!enemy.flightActive && enemy.vel.y < 0, '其他职业没有获得二段骑帚能力');
  } finally {
    for (const actor of [...g.fighters]) g.removeFighter(actor);
    g.combat.clear(); Object.assign(g, saved);
  }
  return { passed: results.length, results, errors };
}
