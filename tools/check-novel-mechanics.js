import * as THREE from 'three';
import { CLASSES, SKILLS, skillClass } from '../src/data/classes.js';
import { Brain } from '../src/game/ai.js';
import { visibleTo, shadowStep, sandBlinds } from '../src/game/perception.js';
import { staminaProfile, spendStamina, updateStamina } from '../src/game/stamina.js';
import { confusedMovement } from '../src/game/statuses.js';

export async function checkMechanics(app) {
  const g = app.game, original = { fighters: g.fighters, player: g.player, mode: g.mode }, results = [], errors = [];
  const check = (ok, name, metrics = {}) => (ok ? results : errors).push({ name, ...metrics });
  const make = (clsId, team = 1, scale = 1) => g.spawn({ name: clsId, clsId, cls: CLASSES[clsId], team, scale, pos: [0, 0, 0], isPlayer: false });
  const reset = f => { f.resetState(); f.hp = f.maxHp; f.mp = f.maxMp; f.moveInput.set(0, 0); f.pos.set(0, 0, 0); f.yaw = f.pitch = 0; f.aimDir.set(0, 0, 1); };
  g.fighters = []; g.mode = null;
  const p = make('swordmaster'), t = make('thug', 2), mage = make('cleric');
  try {
    check(p.height > 1.6 && p.height < 1.9 && p.radius > .16 && p.radius < .32, '角色使用实测身体尺寸', { height: p.height, radius: p.radius });
    const big = make('swordmaster', 2, 1.8);
    check(Math.abs(big.height / p.height - 1.8) < 1e-6 && Math.abs(big.radius / p.radius - 1.8) < 1e-6, '体型缩放只乘一次');
    big.state = 'down'; check(big.collisionHeight < big.height * .5, '倒地体积降低');
    g.removeFighter(big);
    p.stamina = 0; const mp = p.mp;
    check(!p.startDash() && p.state === 'idle' && p.mp === mp, '体力不足不能闪避且不消耗法力');
    p.wantJump = true; p.updateState(1 / 60, 1000 / 60); check(p.onGround && p.vel.y === 0, '体力不足不能跳跃');
    reset(p); const before = p.stamina; check(p.startDash() && p.stamina === before - 22 && p.mp === mp, '闪避消耗22体力');
    for (const fps of [30, 60, 120]) {
      const f = { ...p, effects: [], moveInput: new THREE.Vector2(0, 1), state: 'move', onGround: true, guarding: false, aiming: false, dead: false, hasEffect: () => false, movementLocked: () => false,
        staminaSpec: staminaProfile('swordmaster'), maxStamina: 105, stamina: 105, staminaDelay: 0, staminaExhausted: false, wantSprint: true };
      for (let i = 0; i < fps * 2; i++) updateStamina(f, 1 / fps);
      check(Math.abs(f.stamina - 63) < 1e-6 && f.sprinting, '疾跑耗体力与帧率无关', { fps, stamina: f.stamina });
      for (let i = 0; i < fps * 4; i++) updateStamina(f, 1 / fps);
      check(f.stamina >= 0 && f.stamina <= 12.7, '体力耗尽后不会负数或每帧抽动', { fps, stamina: f.stamina });
      f.wantSprint = false; for (let i = 0; i < fps * 6; i++) updateStamina(f, 1 / fps);
      check(f.stamina === 105, '停止疾跑自动恢复到上限', { fps });
    }
    for (const type of ['stun', 'sleep', 'frozen']) {
      reset(p); p.addEffect({ type, t: 1600 });
      check(!p.tryUse('atk') && !p.tryUse('s1') && !p.startDash(), '硬控制阻止出招和位移', { type });
      p.wantJump = p.wantGuard = true; p.updateState(1 / 60, 1000 / 60);
      check(!p.guarding && p.onGround && p.moveInput.lengthSq() === 0, '硬控制阻止跳跃与举盾', { type });
      p.applyDamage(t, 20, {});
      check(p.hasEffect(type) === (type === 'frozen'), '受击解除眩晕/睡眠且保留冻结', { type });
    }
    reset(p); p.addEffect({ type: 'sleep', t: 1000 }); p.addEffect({ type: 'shield', t: 2000, amount: 100 }); p.applyDamage(t, 50, {});
    check(p.hasEffect('sleep') && p.hp === p.maxHp, '护盾吸收的零伤害不唤醒睡眠');
    reset(p); p.addEffect({ type: 'sleep', t: 2000 }); p.receiveHit(t, { dmg: 20, stun: 500, knock: 0 }, 0, 1); p.update(1 / 60);
    check(!p.hasEffect('sleep') && p.state === 'hitstun' && p.stunT > 400, '受击唤醒睡眠后保留这一击的物理硬直');
    p.addEffect({ type: 'poison', t: 1000, dps: 20 }); const physicalStun = p.stunT; p.cleanse();
    check(p.state === 'hitstun' && p.stunT === physicalStun, '净化异常不解除唤醒一击的物理硬直');
    reset(p); p.addEffect({ type: 'silence', t: 3000 }); const oldMp = p.mp;
    check(!p.tryUse('s1') && p.mp === oldMp && !p.cd.s1, '技能封印不会吃法力和冷却');
    check(p.tryUse('atk'), '技能封印仍允许普攻');
    reset(p); p.addEffect({ type: 'bind', t: 1800 });
    check(p.tryUse('atk') && !p.startDash(), '束缚允许普攻但禁止闪避');
    p.wantJump = true; p.action = null; p.state = 'idle'; p.updateState(1 / 60, 1000 / 60); check(p.onGround, '束缚不能跳跃');
    const pos = p.pos.clone(); g.combat.doBlink(p, { range: 10 }); check(pos.distanceTo(p.pos) < 1e-8, '束缚不能瞬移');
    reset(p); p.addEffect({ type: 'slow', t: 3000 }); p.addEffect({ type: 'slow', t: 800 }); check(p.effects.length === 1 && p.effects[0].t === 3000, '同类状态覆盖不相加、不缩短');
    p.addEffect({ type: 'shield', t: 6000, amount: 100 }); p.addEffect({ type: 'burn', t: 1000, dps: 20 });
    check(p.cleanse() === 2 && p.effects.length === 1 && p.hasEffect('shield'), '净化移除异常并保留增益');
    reset(p); p.state = 'down'; p.downT = 600; p.addEffect({ type: 'poison', t: 1000, dps: 20 }); p.cleanse(); check(p.state === 'down', '净化不能解除倒地');
    reset(p); p.addEffect({ type: 'poison', t: 1000, dps: 20 }); p.addEffect({ type: 'bleed', t: 1000, dps: 30 }); p.addEffect({ type: 'burn', t: 1000, dps: 10 });
    for (let i = 0; i < 90; i++) p.update(1 / 60);
    check(Math.abs(p.maxHp - p.hp - 60) < .01 && !p.effects.length, '中毒、出血、灼烧独立结算且到期停止', { damage: p.maxHp - p.hp });
    reset(mage); mage.startAction(SKILLS.chengjie, 's2'); mage.addEffect({ type: 'burn', t: 100, dps: 100, interval: .01, interruptCast: true }); mage.update(.01);
    check(!mage.action, '暗影烈焰伤害跳能打断正在吟唱的法术');
    reset(mage); mage.hp -= 1000; const selfHeal = mage.heal(100, mage); reset(p); p.hp -= 1000; const allyHeal = p.heal(100, mage);
    check(selfHeal === 77 && allyHeal === 110, '牧师自疗效率70%且队友治疗保留虔诚加成');
    check(mage.heal(100, mage, true) === 100, '自疗平衡配置不改变独立吸血的结算');
    reset(t); t.startAction(SKILLS.shasha, 's1'); t.addEffect({ type: 'burn', t: 100, dps: 100, interval: .01, interruptCast: true }); t.update(.01);
    check(!!t.action, '投掷动作前摇不冒充法术吟唱');
    reset(p); p.armor = 2000; const result = p.receiveHit(t, { dmg: 100, stun: 500, knock: 6 }, 0, 1);
    check(result === 'armor' && p.hp < p.maxHp && p.state === 'idle', '霸体吃伤害但免物理僵直击退');
    reset(p); p.invuln = 1000; const health = p.hp; check(p.receiveHit(t, { dmg: 100 }, 0, 1) === 'miss' && p.hp === health && !p.addEffect({ type: 'blind', t: 4000 }), '无敌免伤与免异常');
    reset(p); g.time = 0; p.addEffect({ type: 'confuse', t: 2000 }); const first = confusedMovement(p, .4, 1); g.time = .5; const second = confusedMovement(p, .4, 1);
    check(first.some((v, i) => Math.abs(v - second[i]) > .01) && Math.abs(Math.hypot(...first) - Math.hypot(.4, 1)) < 1e-6, '混乱改变输入方向且保留输入幅度');
    check(confusedMovement(p, 0, 0).every(v => v === 0), '混乱不会凭空强制静止角色移动');
    reset(p); reset(t); t.pos.set(0, 0, 3); t.yaw = Math.PI;
    check(visibleTo(p, t) && visibleTo(t, p), '正面目标可见'); p.addEffect({ type: 'blind', t: 4000 }); check(!visibleTo(p, t), '致盲关闭目标视觉感知');
    p.effects = []; p.yaw = Math.PI; check(!visibleTo(p, t), '背后目标不可见');
    p.yaw = 0; t.state = 'air'; t.onGround = false; t.pos.y = 1; t.yaw = 0;
    check(shadowStep(p, t), '浮空目标视角背侧产生遮影步'); t.yaw = Math.PI; t.pitch = -.2; check(!shadowStep(p, t), '对手转头看到攻击者打破遮影步');
    t.yaw = 0; t.state = 'jump'; check(!shadowStep(p, t), '普通跳跃不会冒充浮空遮影步'); t.state = 'air'; check(!shadowStep(p, t, { blocked: () => true }), '墙体遮挡不会冒充遮影步');
    reset(p); reset(t); t.pos.set(0, 0, 3); t.yaw = Math.PI;
    const hit = { contact: { region: 'head', point: t.eyePos(new THREE.Vector3()) }, origin: p.eyePos(new THREE.Vector3()) };
    check(sandBlinds(p, t, hit), '迎面眼部触沙可致盲'); t.yaw = 0; check(!sandBlinds(p, t, hit), '转头避开来沙不会失明');
    t.yaw = Math.PI; p.pos.set(6, 0, 3); hit.incomingDir = new THREE.Vector3(0, 0, 1);
    check(sandBlinds(p, t, hit), '来沙方向取真实弹道，不受投沙者随后走位影响'); p.pos.set(0, 0, 0); delete hit.incomingDir;
    t.yaw = Math.PI; t.pitch = 1.3; check(!sandBlinds(p, t, hit), '抬头避开眼部不会失明'); t.pitch = 0; hit.contact.region = 'torso'; check(!sandBlinds(p, t, hit), '沙子打到躯干不会失明');
    reset(t); t.pos.set(0, 0, 3); t.yaw = Math.PI; mage.pos.set(0, 0, 6);
    const sleepHit = { dmg: 0, noStun: true, frontOnlyStatus: true, effect: { type: 'sleep', t: 2400 }, origin: p.eyePos(new THREE.Vector3()), incomingDir: new THREE.Vector3(0, 0, 1) };
    g.onHit(mage, t, 'hit', sleepHit, SKILLS.cuimian, true, t.eyePos(new THREE.Vector3()));
    check(t.hasEffect('sleep'), '催眠按实际来光判正面，不受施法者随后绕背影响');
    reset(t); t.pos.set(0, 0, 3); g.onHit(mage, t, 'hit', sleepHit, SKILLS.cuimian, true, t.eyePos(new THREE.Vector3()));
    check(!t.hasEffect('sleep'), '背身接到催眠光仍不进入睡眠'); reset(mage);
    t.ai = new Brain(t); t.target = p; t.yaw = Math.PI; t.ai.update(1 / 60); t.addEffect({ type: 'blind', t: 4000 }); p.pos.x = 7; t.ai.update(1 / 60);
    check(t.targetVisible === false && t.lastKnownTargetPos?.x === 0, 'AI致盲后使用记忆位置，不追踪真实坐标');
    reset(p); reset(t); t.pos.set(0, 0, 0); p.pos.copy(t.pos); g.separate(); check(p.pos.distanceTo(t.pos) > .3, '完全重叠的角色能够分开');
    reset(p); p.air.noTech = true; p.state = 'down'; p.requestTech(); check(p.state === 'down', '强制倒地不能受身');
    p.downT = 0; p.updateState(1 / 60, 1000 / 60); p.stateT = .5; p.updateState(1 / 60, 1000 / 60);
    check(p.state === 'idle' && !p.air.noTech, '起身后清除强制倒地的受身限制');
    reset(p); p.moveInput.set(0, 1); p.chainIdx = 2; p.chainT = 800; p.dashCd = 600; p.resetState(); const resetPosition = p.pos.clone(); p.update(1 / 60);
    check(p.pos.distanceTo(resetPosition) < .001, '复活和回合重置后不会沿旧输入自行移动');
    check(p.tryUse('atk') && p.action.chainIdx === 0, '新回合普攻从第一招开始');
    check(skillClass('cleric', CLASSES.cleric, { s5: 'jinghua' }).skills.s5 === SKILLS.jinghua && skillClass('cleric', CLASSES.cleric, { s5: 'fulong' }).skills.s5 === SKILLS.hudun, '招式配置可选且禁止跨职业注入');
    reset(p); p.isPlayer = true; g.player = p; app.hud.bindPlayer(p); app.hud.show(true); t.pos.set(0, 0, 3); t.yaw = Math.PI; g.lockTarget = t;
    p.addEffect({ type: 'blind', t: 4000 }); app.hud.update(1 / 60, g);
    check(app.hud.blindBox.style.opacity === '1' && app.hud.targetBox.style.display === 'none' && app.hud.cross.style.display === 'none' && app.hud.floatLayer.style.visibility === 'hidden', '致盲完全遮住场景并隐藏目标/准星/飘字');
  } catch (e) { errors.push({ name: 'Exception', error: e.stack }); }
  finally {
    for (const f of [...g.fighters]) g.removeFighter(f);
    g.combat.clear(); g.fighters = original.fighters; g.player = original.player; g.mode = original.mode; g.lockTarget = null;
    app.hud.bindPlayer(original.player, original.player.account);
  }
  return { results, errors };
}
