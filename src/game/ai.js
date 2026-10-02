// Bot 行为：读招（格挡/闪避）、距离管理、连段衔接、受身、大招时机。
import { rand, wrapAngle, turnToward, clamp, DEG } from '../engine/util.js';
import { visibleTo } from './perception.js';
import { isCleanseable } from './statuses.js';
import { attackKind } from './combat-volumes.js';

export const DIFFICULTY = {
  easy: { name: '新手', react: 480, aimErr: 0.1, spread: 0.07, aggr: 0.45, guardP: 0.12, dodgeP: 0.08, techP: 0.15, combo: 0.3, turn: 4, think: 260 },
  normal: { name: '职业选手', react: 300, aimErr: 0.05, spread: 0.04, aggr: 0.65, guardP: 0.3, dodgeP: 0.2, techP: 0.45, combo: 0.6, turn: 6, think: 180 },
  hard: { name: '全明星', react: 200, aimErr: 0.03, spread: 0.025, aggr: 0.8, guardP: 0.45, dodgeP: 0.3, techP: 0.7, combo: 0.85, turn: 8, think: 130 },
  god: { name: '荣耀大神', react: 140, aimErr: 0.015, spread: 0.012, aggr: 0.9, guardP: 0.55, dodgeP: 0.38, techP: 0.9, combo: 0.97, turn: 11, think: 90 },
};

const RANGED = new Set(['sharpshooter', 'launcher', 'warlock', 'cleric', 'witch', 'summoner', 'elementalist', 'frostcaster']);

// Root-to-root distances measured against the animated blade/hand contacts.
// A dagger must close in; a spear should retain room for its pointed end.
const MELEE_SPACING = Object.freeze({ sword: 1.7, greatsword: 1.95, spear: 2.55,
  gauntlet: 1.08, dagger: .98, club: 1.3, knight: 1.3, axe: 2.1, broom: 1.75 });
export function meleeSpacing(f, target = null) {
  const form = f.cls.forms ? f.form : null;
  const base = form === 'shield' ? 1.05 : form === 'sword' ? 1.8 :
    MELEE_SPACING[form || f.weapon?.type || f.cls.weapon] || 1.7;
  return base * (f.scale || 1) + clamp((target?.radius || .24) - .24,-.06,.2);
}

// Skill reach follows its attacking body part, including a spear user's free
// palm and a club user's low kick. These values only guide AI movement/choices;
// the hit itself still requires contact with the current animated body.
export function meleeActionSpacing(f, def, target = null) {
  const kind = attackKind(def.hits?.[0] || {}, def, f), scale = f.scale || 1;
  const size = clamp((target?.radius || .24) - .24, -.06, .2), anim = def.anim || '';
  if (kind === 'body' || kind === 'shield') return f.radius + (target?.radius || .24) + .06;
  if (kind === 'fist') return (/uppercut/.test(anim) ? .84 : /grab|palm/.test(anim) ? 1.02 : 1.04) * scale + size;
  if (kind === 'stomp') return .88 * scale + size;
  if (kind === 'kick') return (anim === 'lowSweep' ? .88 : 1.22) * scale + size;
  if (anim === 'upslash') return 1.4 * scale + size;
  if (anim === 'spin') return meleeSpacing(f, target) * .8;
  return meleeSpacing(f, target);
}

export class Brain {
  constructor(f, diff = 'normal') {
    this.f = f;
    this.d = DIFFICULTY[diff] || DIFFICULTY.normal;
    this.thinkT = rand(0, 200);
    this.plan = 'approach';
    this.strafeDir = Math.random() < 0.5 ? -1 : 1;
    this.strafeT = 0;
    this.guardT = 0;
    this.reactQueue = []; // 延迟反应
    this.lastSeenAction = null;
    this.techDecided = false;
    this.ranged = RANGED.has(f.clsId) || f.form === 'gun';
    this.rangedRange = f.cls.aiRange || rand(8, 13);
    this.prefRange = f.cls.aiRange || (this.ranged ? this.rangedRange : meleeSpacing(f));
    this.jumpT = rand(2, 6);
    this.idleT = 0;
    this.passive = false; // 训练假人
  }

  aimError() { const b = this.f.hasEffect('blind') ? 6 : 1; return rand(-this.d.aimErr * b, this.d.aimErr * b); }
  aimSpread() { return this.d.spread * (this.f.hasEffect('blind') ? 6 : 1); }

  pickTarget() {
    const f = this.f;
    let best = null, bd = 1e9;
    for (const o of f.game.combat.enemiesOf(f)) {
      if (o.team === f.team || !o.alive || o.untargetable) continue;
      if (!visibleTo(f, o)) continue;
      const d = Math.hypot(o.pos.x - f.pos.x, o.pos.z - f.pos.z) - (o === f.target ? 2 : 0) + (o.kind === 'dummy' ? 50 : 0);
      if (d < bd) { bd = d; best = o; }
    }
    f.target = best;
    return best;
  }

  update(dt) {
    const f = this.f;
    const ms = dt * 1000;
    f.wantGuard = false;
    f.wantSprint = false;
    f.jumpHeld = false;
    if (f.dead || this.passive) { f.moveInput.set(0, 0); return; }
    let t = f.target && f.target.alive ? f.target : this.pickTarget();
    if (t && !visibleTo(f, t) && !f.hasEffect('blind')) t = this.pickTarget();
    f.targetVisible = !!t && visibleTo(f, t);
    if (f.targetVisible) {
      f.lastKnownTargetPos = t.pos.clone(); this.memoryT = 2.2;
      f.lastKnownTargetAim = t.pos.clone().setY(t.pos.y + (t.collisionHeight || t.height || 1.8) * .55);
      this.searchT = 0;
      if (f.clsId === 'battlemage' && f.chaserWindow > 0 && f.chaserCd <= 0 && f.chasers.some(c => c.bornHit < f.chaserHitSerial)) f.wantChaser = true;
    }
    else {
      this.memoryT = Math.max(0, (this.memoryT || 0) - dt);
      this.reactQueue.length = 0; this.guardT = 0; this.lastSeenAction = null;
      // Air aiming must not leave a landed bot staring permanently above/below
      // every opponent. Use only the last observed point, then scan level.
      if (f.canActOrAir() || f.state === 'guard') {
        const aim = this.memoryT > 0 ? f.lastKnownTargetAim : null;
        const pitch = aim ? Math.atan2(aim.y - (f.pos.y + f.height * .88), Math.max(.05, Math.hypot(aim.x - f.pos.x, aim.z - f.pos.z))) : 0;
        f.pitch += clamp(pitch - f.pitch, -this.d.turn * dt * .65, this.d.turn * dt * .65);
      }
      if (t || f.hasEffect('blind') || this.memoryT > 0) {
        const known = this.memoryT > 0 ? f.lastKnownTargetPos : null;
        if (known && f.canActOrAir()) {
          const dx = known.x - f.pos.x, dz = known.z - f.pos.z, distance = Math.hypot(dx, dz);
          f.yaw = turnToward(f.yaw, Math.atan2(dx, dz), this.d.turn * dt * .65);
          const dir = this.freeDir(f.yaw);
          f.moveInput.set(dir === null ? 0 : -Math.sin(dir - f.yaw) * .6, dir === null ? 0 : Math.cos(dir - f.yaw) * (distance > .9 ? .6 : 0));
        } else { f.moveInput.set(0, 0); if (!f.hasEffect('blind')) f.yaw += dt * .65; }
        f.aimPoint = null;
        return;
      }
    }
    if (!t) {
      // 没有敌人：走向目标点（副本推进）或跟随队友
      const goal = this.goal || (this.follow && this.follow.alive ? this.follow.pos : null);
      if (goal && f.canActOrAir()) {
        const gx = goal.x ?? goal[0], gz = goal.z ?? goal[1];
        const dx = gx - f.pos.x, dz = gz - f.pos.z, d = Math.hypot(dx, dz);
        if (d > (this.goal ? 1.5 : 3)) { f.yaw = turnToward(f.yaw, Math.atan2(dx, dz), this.d.turn * dt); f.moveInput.set(0, 1); return; }
      }
      // A stationary yaw sweep cannot see through a pillar. Investigate nearby
      // viewpoints around the last sighting, never the hidden opponent's live
      // position. Mission/follow goals above keep priority.
      if (!goal && f.lastKnownTargetPos && f.canActOrAir()) {
        this.searchT = (this.searchT || 0) + dt;
        const phase = Math.floor(this.searchT / 2.5), radius = 2 + phase % 4;
        const angle = phase * Math.PI * .65 + (f.id % 4) * Math.PI / 2;
        const dx = f.lastKnownTargetPos.x + Math.sin(angle) * radius - f.pos.x;
        const dz = f.lastKnownTargetPos.z + Math.cos(angle) * radius - f.pos.z;
        const desired = Math.atan2(dx, dz), free = this.freeDir(desired);
        f.yaw = turnToward(f.yaw, free ?? desired, this.d.turn * dt * .65);
        f.moveInput.set(free === null ? 0 : -Math.sin(free - f.yaw) * .5, free === null ? 0 : Math.cos(free - f.yaw) * .5);
        f.aimPoint = null; return;
      }
      f.moveInput.set(0, 0); f.yaw += dt * .6; return;
    }
    const dx = t.pos.x - f.pos.x, dz = t.pos.z - f.pos.z;
    const dist = Math.hypot(dx, dz);
    const toYaw = Math.atan2(dx, dz);
    if (f.clsId === 'witch') {
      this.flightRest = Math.max(0, (this.flightRest || 0) - dt);
      if (f.flightActive) {
        // 维持可射击的低空高度；没有目标时松开抬升自然落地。
        f.jumpHeld = f.pos.y < f.flight.floor + (dist < 4 ? 2.5 : 1.6);
        if (f.stamina < 12 || f.flight.elapsed > 4.2) f.wantDash = true;
      } else if (!f.flight.used && f.stamina > 35 && !this.flightRest && f.canActOrAir()) {
        f.wantJump = true; f.jumpHeld = true;
        if (!f.onGround) this.flightRest = 5.5;
        f.yaw = turnToward(f.yaw, toYaw, this.d.turn * dt);
        f.moveInput.set(this.strafeDir * .45, dist < 5 ? -.6 : .25);
        return; // 留出跳跃/骑帚的输入帧，避免本帧施法把跳跃吞掉。
      }
    }
    this.ranged = RANGED.has(f.clsId) || f.form === 'gun';
    this.prefRange = f.cls.aiRange || (this.ranged ? this.rangedRange : meleeSpacing(f, t));

    // 受身决策
    if (f.state === 'air') {
      if (!this.techDecided && f.vel.y < 0 && f.pos.y < 1.2) {
        this.techDecided = true;
        if (Math.random() < this.d.techP) f.requestTech();
      }
    } else this.techDecided = false;

    // 转向
    const canSteerAction = !!f.action?.def.moveOk;
    if (f.state !== 'attack' || (f.action && f.action.stage === 'wind') || canSteerAction) {
      if (f.canActOrAir() || f.state === 'guard' || (f.action && f.action.stage === 'wind') || canSteerAction) {
        f.yaw = turnToward(f.yaw, toYaw, this.d.turn * dt * (f.state === 'guard' ? 0.6 : 1));
      }
    }
    if (f.action && f.action.def.aimed) f.pitch = Math.atan2((t.pos.y + 1) - (f.pos.y + 1.5), dist);

    // 延迟反应队列（模拟反应时间）
    for (let i = this.reactQueue.length - 1; i >= 0; i--) {
      const r = this.reactQueue[i]; r.t -= ms;
      if (r.t <= 0) { this.reactQueue.splice(i, 1); r.fn(); }
    }
    // 感知对手出招
    const ta = t.action;
    if (ta && ta !== this.lastSeenAction && ta.stage === 'wind') {
      this.lastSeenAction = ta;
      const reach = (ta.def.hits?.[0]?.range || 0) + (ta.def.dash ? ta.def.dash.speed * ta.def.dash.dur / 1000 : 0) + (ta.def.lunge || 0) + 1;
      const facingMe = Math.abs(wrapAngle(Math.atan2(-dx, -dz) - t.yaw)) < 50 * DEG;
      const threatened = (ta.def.proj || ta.def.aoe || ta.def.beam) ? facingMe && dist < 30 : (dist < reach && facingMe);
      if (threatened) {
        const r = Math.random();
        const isRanged = !!(ta.def.proj || ta.def.aoe || ta.def.beam);
        const bigRanged = isRanged && (ta.def.ult || (ta.def.proj && ta.def.proj.reduce((s, p) => s + (p.dmg || 0) + (p.explode ? p.explode.dmg : 0), 0) >= 90));
        // 远程小招不举盾（会被磨光法力破防），改为侧移；大招且法力充足才格挡
        const canGuard = f.cls.special?.type === 'guard' && !ta.def.hits?.[0]?.unblockable && !ta.def.hits?.[0]?.guardBreak && (!isRanged || (bigRanged && f.mp > 45));
        if (canGuard && r < this.d.guardP) {
          this.reactQueue.push({ t: this.d.react * rand(0.7, 1.2), fn: () => { this.guardT = (ta.def.wind + ta.def.active) + 150; } });
        } else if (r < this.d.guardP + this.d.dodgeP) {
          this.reactQueue.push({ t: this.d.react * rand(0.7, 1.2), fn: () => { if (f.canAct()) { const side = Math.random() < 0.5 ? -1 : 1; f.moveInput.set(side, ta.def.aoe ? 0 : -0.3); f.wantDash = true; } } });
        }
      }
    }
    // 对手在蓄力：择机振刀
    if (ta && ta.slot === 'charge' && f.cls.special?.type === 'guard' && dist < 4 && !this.zhenPlanned && Math.random() < this.d.guardP * 1.4) {
      this.zhenPlanned = ta;
      this.reactQueue.push({ t: this.d.react * rand(0.8, 1.3) + 250, fn: () => { this.guardT = 380; } });
    }
    if (!ta || ta.slot !== 'charge') this.zhenPlanned = null;
    if (this.guardT > 0) {
      this.guardT -= ms;
      f.wantGuard = true;
      f.moveInput.set(0, 0);
      if (f.state === 'guard' || f.canAct()) return;
    }
    if (!f.canActOrAir() && f.state !== 'attack') { f.moveInput.set(0, 0); return; }

    // 蓄力重击：到时松手
    if (f.action && f.action.slot === 'charge') { this.chargeT -= ms; f.charging = this.chargeT > 0; }
    // ---- 思考 ----（致盲时反应更慢）
    this.thinkT -= ms * (f.hasEffect('blind') ? 0.4 : 1);
    if (this.thinkT <= 0) {
      this.thinkT = this.d.think * rand(0.7, 1.3);
      this.decide(t, dist);
    }
    // ---- 移动 ----
    this.strafeT -= dt;
    if (this.strafeT <= 0) { this.strafeT = rand(0.8, 2.2); this.strafeDir = Math.random() < 0.5 ? -1 : 1; }
    if (f.state === 'attack' && !canSteerAction) { f.moveInput.set(0, 0); return; }
    let fwd = 0, side = 0;
    const pr = this.prefRange;
    if (this.plan === 'approach') { fwd = dist > pr ? 1 : 0; side = dist < pr * 2 ? this.strafeDir * 0.35 : 0; }
    else if (this.plan === 'space') { fwd = dist < pr - .15 ? -.75 : dist > pr + .2 ? .6 : 0; side = this.strafeDir * .3; }
    else if (this.plan === 'kite') { fwd = dist < pr * 0.7 ? -1 : dist > pr * 1.3 ? 1 : 0; side = this.strafeDir * 0.8; }
    else if (this.plan === 'circle') { fwd = dist > pr + 0.6 ? 0.6 : dist < pr - 0.6 ? -0.5 : 0; side = this.strafeDir; }
    else if (this.plan === 'wait') { fwd = dist > 4 ? 0.5 : dist < 2.5 ? -0.4 : 0; side = this.strafeDir * 0.5; }
    else if (this.plan === 'retreat') { fwd = -1; side = this.strafeDir * 0.5; }
    // 避障：想要的移动方向被墙体/掩体挡住时，找最近的可走方向
    if (fwd !== 0 || side !== 0) {
      const dirYaw = f.yaw + Math.atan2(-side, fwd); // 世界空间移动方向
      const free = this.freeDir(dirYaw);
      if (free !== null && free !== dirYaw) {
        const rel = free - f.yaw;
        const mag = Math.min(1, Math.hypot(side, fwd));
        side = -Math.sin(rel) * mag; fwd = Math.cos(rel) * mag;
      }
    }
    f.moveInput.set(side, fwd);
    f.wantSprint = this.plan === 'approach' && dist > 7 && f.stamina > 28;
    // 近战追远程：举盾推进（子弹几乎不耗法力）
    const tRanged = t.chain && t.chain[0] && t.chain[0].proj;
    if (!this.ranged && tRanged && dist > 4 && f.cls.special?.type === 'guard' && f.mp > 35 && this.plan === 'approach' && (Math.floor(f.game.time / 1.5) + f.id) % 2 === 0) {
      f.wantGuard = true; f.moveInput.set(this.strafeDir * 0.3, 1);
      return;
    }
    // 近战追远程：蛇形接近 + 冲刺贴身
    if (!this.ranged && this.plan === 'approach' && dist > 4.5 && f.dashCd <= 0 && f.mp > 20 && Math.random() < dt * (0.8 + this.d.aggr)) {
      f.moveInput.set(this.strafeDir * 0.5, 1); f.wantDash = true;
    }
    if (!this.ranged && this.plan === 'approach' && dist > 6 && t.chain && t.chain[0] && t.chain[0].proj) f.moveInput.x = Math.sin(f.game.time / .35 + this.strafeDir) * 0.7;
    // 偶尔跳跃（远程更常见）
    this.jumpT -= dt;
    if (this.jumpT <= 0) { this.jumpT = rand(3, 8); if (Math.random() < (this.ranged ? 0.5 : 0.25)) f.wantJump = true; }
  }

  // 从 yaw 方向开始左右交替试探，返回第一个 1.6m 内不被挡的方向
  freeDir(yaw) {
    const f = this.f, w = f.game.world;
    const a = this._a || (this._a = { x: 0, y: 0, z: 0 }), b = this._b || (this._b = { x: 0, y: 0, z: 0 });
    a.x = f.pos.x; a.y = f.pos.y + 0.6; a.z = f.pos.z;
    const test = (yy) => { b.x = a.x + Math.sin(yy) * 1.6; b.y = a.y; b.z = a.z + Math.cos(yy) * 1.6; return !w.blocked(a, b); };
    if (test(yaw)) { this.detour = 0; return yaw; }
    const pref = this.detour || (Math.random() < 0.5 ? 1 : -1);
    for (const deg of [35, 70, 105, 140]) {
      for (const sgn of [pref, -pref]) {
        const yy = yaw + sgn * deg * DEG;
        if (test(yy)) { this.detour = sgn; return yy; }
      }
    }
    return null;
  }

  decide(t, dist) {
    const f = this.f;
    const d = this.d;
    const hpR = f.hp / f.maxHp;
    let allyLow = hpR;
    for (const o of f.game.fighters) if (o.team === f.team && o.alive && o.kind === 'hero' && o.pos.distanceTo(f.pos) < 22) allyLow = Math.min(allyLow, o.hp / o.maxHp);
    const tState = t.state;
    const vulnerable = tState === 'air' || tState === 'hitstun' || tState === 'stun';
    const down = tState === 'down';
    // 移动计划
    const longWeapon=(f.form||f.weapon?.type||f.cls.weapon)==='spear';
    if (this.ranged) this.plan = dist < 3 ? 'retreat' : 'kite';
    else if (down) this.plan = 'wait';
    else if (longWeapon && dist < this.prefRange - .35) this.plan = 'space';
    else if (dist > this.prefRange + 0.5) this.plan = 'approach';
    else this.plan = Math.random() < d.aggr ? 'approach' : 'circle';

    if (f.state !== 'idle' && f.state !== 'move' && f.state !== 'jump' && !(f.action && f.action.stage === 'recover')) return;
    // 散人：按距离选伞形态（远枪、中矛、近剑）
    if (f.cls.forms && !f.action && f.formLock <= 0) {
      const want = dist > 7 ? 'gun' : dist > 3.2 ? 'spear' : 'sword';
      if (f.form !== want && Math.random() < 0.35) { f.setForm(want); return; }
    }
    // 攻击意愿
    const want = vulnerable ? d.combo : down ? 0.35 : d.aggr * (this.ranged ? 0.9 : 0.75);
    if (Math.random() > want) return;
    const cands = [];
    const skills = f.cls.skills || {};
    for (const slot in skills) {
      const s = skills[slot];
      if ((f.cd[slot] || 0) > 0 && !(f.stageInfo && f.stageInfo.slot === slot)) continue;
      if (f.mp < (s.mp || 0)) continue;
      if (s.summon && !f.game.summons?.canUse(f, s.summon)) continue;
      if (s.phase && (f.phase || 1) < s.phase) continue;
      const ai = s.ai || { range: [0, 3], role: 'poke' };
      if (dist < ai.range[0] - 0.3 || dist > ai.range[1] + 0.3) continue;
      if(s.hits&&!s.proj&&!s.aoe&&!s.beam&&!s.dash&&!s.flyDash&&!s.leap&&!s.blink&&
        !s.slamOnLand&&!s.stageDefs&&!['ground','sphere','cone','cylinder'].includes(attackKind(s.hits[0],s,f))&&
        dist>meleeActionSpacing(f,s,t)+.12+(s.lunge||0)*.8)continue;
      if (s.dash && s.hits && !s.proj && !s.aoe && !s.beam) {
        const physicalBody = s.vfx === 'bash';
        const physicalHand = /punch|uppercut|palm|grab|kick|stomp|lowSweep/i.test(s.anim || '');
        const reach = physicalBody ? f.radius + t.radius + .12 :
          physicalHand ? meleeActionSpacing(f,s,t) : meleeSpacing(f,t) * .9;
        // Old AI ranges included the discarded air fan. A dash must actually
        // cover the gap before its physical fist/blade can reach the body.
        if (dist > s.dash.speed * s.dash.dur / 1000 + reach) continue;
      }
      let w = 1;
      switch (ai.role) {
        case 'summon': { const pet = f.game.summons.owned(f).find(p => p.beastKind === s.summon.kind); w = !pet ? 7 : pet.remaining < 6 || pet.hp < pet.maxHp * .25 ? 3 : 0; break; }
        case 'command': w = f.game.summons.order(f).target !== t ? 1.4 : 0; break;
        case 'recall': w = hpR < .22 && dist < 3 && f.game.summons.order(f).mode !== 'follow' ? 1.3 : 0; break;
        case 'formation': w = 4; break;
        case 'launch': w = tState === 'air' ? 0.6 : vulnerable ? 3 : 1.4; break;
        case 'combo': w = vulnerable ? 2.5 : 1; break;
        case 'finisher': w = tState === 'air' ? 2.5 : vulnerable ? 1.6 : 0.7; break;
        case 'otg': w = down ? 5 : 0; break;
        case 'gap': w = dist > 3 ? 2.2 : 0.3; break;
        case 'escape': w = dist < 2.2 && (this.ranged || hpR < 0.4) ? 3 : 0.4; break;
        case 'poke': w = 1.3; break;
        case 'zone': w = t.vel.lengthSq() < 4 ? 1.6 : 0.9; break;
        case 'grab': w = t.state === 'guard' ? 4 : 0.8; break;
        case 'ult': w = vulnerable || hpR < 0.35 ? 2.5 : 0.25; break;
        case 'heal':
          if (s.heal?.cleanse) {
            let removable = 0;
            for (const ally of f.game.fighters) {
              if (!ally.alive || ally.team !== f.team || ally.pos.distanceTo(f.pos) > (s.heal.range || 22)) continue;
              if (ally !== f && (f.hasEffect('blind') || f.game.world.blocked(f.eyePos(), ally.center()))) continue;
              removable = Math.max(removable, (ally.effects || []).filter(e => e.t > 0 && isCleanseable(e)).length);
            }
            w = removable ? 2 + Math.min(removable, 4) : 0;
          } else w = allyLow < 0.35 ? 6 : allyLow < 0.65 ? 3 : 0;
          break;
        case 'buff': w = 1; break;
      }
      if (down && ai.role !== 'otg' && !s.proj && !s.aoe) w *= 0.15;
      if (w > 0) cands.push({ slot, w });
    }
    // 蓄力重击（霸体克普攻）：对手在出普攻、或自己想破防时
    if (!this.ranged && chain0Melee(f) && dist < meleeActionSpacing(f,f.chargeDef(),t)+.18 && !down && Math.random() < (t.action && t.action.slot === 'atk' ? 0.45 : t.state === 'guard' ? 0.5 : 0.1)) {
      if (f.startCharge()) { this.chargeT = t.state === 'guard' ? 1150 : rand(300, 900); return; }
    }
    // 普攻
    const chain = f.chain, basic = chain?.[f.chainIdx || 0] || chain?.[0];
    const spacing = meleeSpacing(f, t);
    const atkRange = basic ? (basic.proj ? Math.min(25, basic.proj[0]?.range || 25) :
      spacing + .35 + (basic.lunge || 0) * .8) : 0;
    const verticalReach = basic?.proj || t.pos.y < f.pos.y + f.height + .4 &&
      t.pos.y + (t.collisionHeight || t.height) > f.pos.y - .5;
    const tipHasRoom = !longWeapon || !basic?.hits || attackKind(basic.hits[0],basic,f)!=='thrust' || dist > spacing*.7;
    if (dist <= atkRange && verticalReach && tipHasRoom && !down) cands.push({ slot: 'atk', w: vulnerable ? 2.2 : 1.6 });
    if (!cands.length) return;
    let sum = 0; for (const c of cands) sum += c.w;
    let r = Math.random() * sum;
    for (const c of cands) { r -= c.w; if (r <= 0) { f.tryUse(c.slot); if (c.slot === 'atk') this.atkBurst = Math.floor(rand(1, 3)); break; } }
    // 继续普攻连段
    if (this.atkBurst > 0 && f.action && f.action.slot === 'atk') { this.atkBurst--; f.queued = { slot: 'atk', t: 400 }; }
  }
}

function chain0Melee(f) { return f.chain && f.chain[0] && !f.chain[0].proj; }

// 副本小怪：简单追击 + 普攻
export class MobBrain extends Brain {
  constructor(f, diff) { super(f, diff); this.prefRange = f.cls.aiRange || 1.8; this.ranged = !!f.cls.ranged; }
}
