// 战斗单位：物理、状态机、技能执行。玩家、Bot、训练木桩、副本怪物与 Boss 共用。
import * as THREE from 'three';
import { buildCharacter, setFirstPersonHidden, disposeRig } from './model.js';
import { buildWeapon } from './weapons.js';
import { Animator } from './anim.js';
import { applySkinnedModel } from './skin.js';
import { createMocapBody, splitForFirstPerson, MocapAnimator, hasClips, analyzeImpacts, weaponTilt, mountMocapWeapon, handSocket } from './mocap.js';
import { installGripHands, fitWorldGripHands } from './grip.js';
import { clamp, wrapAngle, turnToward, uid, DEG } from '../engine/util.js';

export const GRAVITY = 24;
export const JUGGLE_GRAVITY = 15;
const RADIUS = 0.4;

// 越肩/第三人称：贴近镜头的角色抖动淡出，避免挡住整个画面（game.camFade.value 为淡出距离，0 关闭）
function addCamFade(m, game) {
  if (!game.camFade) game.camFade = { value: 0 };
  const u = game.camFade;
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uCamFade = u;
    sh.fragmentShader = 'uniform float uCamFade;\n' + sh.fragmentShader.replace('void main() {', `void main() {
      if (uCamFade > 0.0) { float h = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
        if (vViewPosition.z < uCamFade * (0.45 + 0.55 * h)) discard; }`);
  };
  m.customProgramCacheKey = () => 'camFade';
}

export class Fighter {
  constructor(game, opts) {
    this.game = game;
    this.id = uid();
    this.name = opts.name || '无名';
    this.team = opts.team ?? 1;
    this.cls = opts.cls;           // CLASSES 条目（或怪物数据）
    this.clsId = opts.clsId;
    this.kind = opts.kind || 'hero'; // hero | dummy | mob | boss
    this.isPlayer = !!opts.isPlayer;
    this.scale = opts.scale || 1;
    this.radius = (opts.radius || RADIUS) * this.scale;
    this.height = 1.8 * this.scale;
    this.maxHp = opts.hp ?? this.cls.hp ?? 3000;
    this.hp = this.maxHp;
    this.maxMp = this.cls.mp ?? 100;
    this.mp = this.maxMp;
    this.mpRegen = opts.mpRegen ?? 7;
    this.speed = opts.speed ?? this.cls.speed ?? 5.6;
    this.dmgMul = opts.dmgMul ?? this.cls.dmgMul ?? 1;
    this.defMul = opts.defMul ?? 1;
    this.knockMul = opts.knockMul ?? (this.clsId === 'striker' ? 0.7 : 1);
    this.pos = new THREE.Vector3(...(opts.pos || [0, 0, 0]));
    this.vel = new THREE.Vector3();
    this.knockVel = new THREE.Vector3();
    this.yaw = opts.yaw || 0;
    this.pitch = 0;
    this.onGround = true;
    this.state = 'idle';
    this.stateT = 0;
    this.action = null;       // 当前技能实例
    this.cd = {};             // slot -> 剩余 ms
    this.chainIdx = 0; this.chainT = 0;
    this.stageInfo = null;    // 多段技能（三段斩）
    this.guarding = false; this.guardT = 0;
    this.parryT = 0;          // 完美格挡后的反击窗口
    this.armor = 0;           // 霸体剩余 ms（非技能来源）
    this.invuln = 0;
    this.stunT = 0;           // 硬直/眩晕剩余 ms
    this.downT = 0;
    this.air = { time: 0, launches: 0, protected: false };
    this.comboTaken = 0; this.comboResetT = 0;
    this.comboDealt = 0; this.comboDealtT = 0; this.maxCombo = 0;
    this.lastHitBy = null;
    this.effects = [];        // {type, t, ...}
    this.techBuffer = 0;
    this.dead = false;
    this.form = null;
    this.formLock = 0;
    this.stacks = 0; this.lastForm = null; // 散人“百家”
    this.stats = { dmgDealt: 0, dmgTaken: 0, hits: 0, skills: 0, kills: 0, maxCombo: 0 };
    this.moveInput = new THREE.Vector2(); // x: 右, y: 前（本地坐标）
    this.wantJump = false; this.wantDash = false; this.wantGuard = false;
    this.aimPoint = null; this.aimDir = new THREE.Vector3(0, 0, 1);
    this.dashCd = 0; this.dashT = 0;
    this.target = null;
    this.ai = null;
    this.react = null;
    this.onEvent = null;
    this.footT = 0;
    this.hitFlash = 0;

    // ---- 模型 ----
    const look = opts.look || this.cls.look || {};
    this.rig = buildCharacter(look);
    this.rig.root.scale.setScalar(this.scale);
    this.weapon = buildWeapon(opts.weapon || this.cls.weapon, this.cls.weaponOpts || {});
    this.rig.bones.gripR.add(this.weapon.obj);
    if (this.weapon.makeLeft) { this.leftWeapon = this.weapon.makeLeft(); this.rig.bones.gripL.add(this.leftWeapon); }
    if (opts.extraModel) opts.extraModel(this);
    this.modelKey = opts.modelKey ?? this.clsId;
    this.lookData = look;
    this.applyModel(look);
    this.attachMocap(look);
    this.anim = new Animator(this.rig);
    this.prepMaterials();
    this.baseStance = this.cls.stance || 'none';
    if (this.cls.forms) this.setForm('sword', true);
    this.rig.root.position.copy(this.pos);
    this.rig.root.rotation.y = this.yaw;
    game.scene.add(this.rig.root);
  }

  get alive() { return !this.dead; }
  get stance() { return this.form && this.cls.forms ? this.cls.forms[this.form].stance : this.baseStance; }
  get chain() { return this.form && this.cls.forms ? this.cls.forms[this.form].chain : this.cls.chain; }
  forward(out = new THREE.Vector3()) { return out.set(Math.sin(this.yaw), 0, Math.cos(this.yaw)); }
  eyePos(out = new THREE.Vector3()) {
    let h = 1.62 * this.scale;
    if (this.state === 'down' || this.state === 'dead') h = 0.45;
    else if (this.state === 'getup') h = 0.45 + (1.62 - 0.45) * clamp(this.stateT / 0.45, 0, 1);
    return out.set(this.pos.x, this.pos.y + h, this.pos.z);
  }
  center(out = new THREE.Vector3()) { return out.set(this.pos.x, this.pos.y + (this.state === 'down' ? 0.25 : 0.95 * this.scale), this.pos.z); }

  setForm(f, instant = false) {
    if (!this.cls.forms || this.form === f) return false;
    this.form = f;
    if (this.weapon.setForm) this.weapon.setForm(f, instant);
    if (this.fp) this.fp.setForm(f);
    if (!instant) { this.formLock = 120; this.emit('form', { form: f }); }
    return true;
  }

  emit(type, data = {}) { this.game.onFighterEvent(this, type, data); }

  // ---- 能否行动 ----
  get busy() { return !!this.action; }
  canAct() {
    return !this.dead && (this.state === 'idle' || this.state === 'move') && this.stunT <= 0 && !this.hasEffect('fear');
  }
  hasEffect(type) { return this.effects.some((e) => e.type === type); }
  addEffect(e) {
    const ex = this.effects.find((x) => x.type === e.type);
    if (ex) Object.assign(ex, e); else this.effects.push({ ...e });
  }

  // ---- 技能请求 ----
  // slot: 'atk' | 's1'..'s6' | 'ult' | 'counter'
  tryUse(slot) {
    if (this.dead) return false;
    if (this.hasEffect('fear') || this.hasEffect('silence') && slot !== 'atk') return false;
    if (this.formLock > 0 && slot !== 'atk') { this.queued = { slot, t: 150 }; return false; }
    // 普攻：连段衔接
    if (slot === 'atk') {
      if (this.parryT > 0 && this.cls.counter && (this.state === 'guard' || this.canActOrAir())) { this.stunT = 0; return this.startAction(this.cls.counter, 'counter'); }
      const chain = this.chain; if (!chain) return false;
      if (this.action) {
        // 收招末段可接下一段
        const a = this.action;
        if (a.slot === 'atk' && a.stage === 'recover' && a.t >= a.def.recover * 0.25) {
          this.chainIdx = (a.chainIdx + 1) % chain.length;
          return this.startAction(chain[this.chainIdx], 'atk', { chainIdx: this.chainIdx });
        }
        this.queued = { slot, t: 220 };
        return false;
      }
      if (!this.canActOrAir()) return false;
      if (this.chainT <= 0) this.chainIdx = 0;
      return this.startAction(chain[this.chainIdx], 'atk', { chainIdx: this.chainIdx });
    }
    const def = this.cls.skills?.[slot];
    if (!def) return false;
    // 多段技能的后续段
    if (this.stageInfo && this.stageInfo.slot === slot && this.stageInfo.window > 0) {
      const a = this.action;
      if ((!a && this.canActOrAir()) || (a && a.slot === slot && a.stage === 'recover')) {
        const n = this.stageInfo.next;
        const sd = { ...def, ...def.stageDefs[n] };
        this.stageInfo.next++;
        this.stageInfo.window = def.stageWindow;
        if (this.stageInfo.next >= def.stages) { this.stageInfo = null; this.cd[slot] = def.cd; }
        return this.startAction(sd, slot, { stageN: n });
      }
      this.queued = { slot, t: 250 };
      return false;
    }
    if ((this.cd[slot] || 0) > 0) { if (this.isPlayer) this.emit('cooldown', { slot }); return false; }
    if (this.mp < (def.mp || 0)) { if (this.isPlayer) this.emit('nomana', { slot }); return false; }
    if (def.otg === undefined && def.leap === undefined && !this.onGround && !def.airOk && this.kind === 'hero' && def.air !== 'ok') {
      // 空中只允许部分技能
      if (!(def.anim && (def.proj || def.slamOnLand))) return false;
    }
    if (this.action) {
      // 取消：普攻收招可被技能取消；技能收招末段可被其他技能取消（荣耀式连段）
      const a = this.action;
      const cancellable = (a.slot === 'atk' && (a.stage === 'recover' || (a.stage === 'active' && a.t > a.def.active * 0.6)))
        || (a.slot !== 'atk' && a.slot !== slot && a.stage === 'recover' && a.t >= a.def.recover * 0.35 && !a.def.ult);
      if (!cancellable) { this.queued = { slot, t: 260 }; return false; }
    } else if (!this.canActOrAir()) return false;
    if (def.form && this.cls.forms) { if (this.setForm(def.form)) { this.queued = { slot, t: 400 }; return false; } }
    this.mp -= def.mp || 0;
    if (def.stages) {
      this.stageInfo = { slot, next: 1, window: def.stageWindow };
      const sd = { ...def, ...def.stageDefs[0] };
      this.stats.skills++;
      return this.startAction(sd, slot, { stageN: 0 });
    }
    this.cd[slot] = def.cd;
    this.stats.skills++;
    return this.startAction(def, slot);
  }
  canActOrAir() {
    return !this.dead && this.stunT <= 0 && (this.state === 'idle' || this.state === 'move' || this.state === 'jump');
  }

  // 蓄力重击（近战）：蓄力阶段霸体、武器蓝光；蓄满破防、金光
  chargeDef() {
    const chain = this.chain; if (!chain || chain[0].proj) return null;
    const last = chain[chain.length - 1];
    const h0 = last.hits?.[0] || { range: 2.6, arc: 120 };
    return { name: '蓄力重击', anim: last.anim === 'thrust' || last.anim === 'spearThrust' ? last.anim : (this.cls.weapon === 'gauntlet' ? 'punchR' : 'slash3'), charge: true,
      wind: 1100, minWind: 280, active: 130, recover: 420, armor: true, lunge: 2.4,
      hits: [{ t: 0, range: h0.range + 0.3, arc: Math.max(90, h0.arc || 110), h: [0, 2.4], dmg: 90, stun: 520, knock: 7 }], vfx: 'slashWide', sfx: 'swing_heavy' };
  }
  startCharge() {
    const d = this.chargeDef(); if (!d) return false;
    if (this.action || !this.canActOrAir() || !this.onGround) return false;
    this.charging = true;
    return this.startAction(d, 'charge');
  }

  startAction(def, slot, extra = {}) {
    this.action = { uid: (Fighter.seq = (Fighter.seq || 0) + 1), def, slot, stage: 'wind', t: 0, total: 0, hitsDone: new Set(), projDone: new Set(), aoeDone: new Set(), victims: new Map(), chainIdx: extra.chainIdx ?? 0, stageN: extra.stageN, animIdx: 0, landed: false, beamTick: 0 };
    this.guarding = false;
    this.state = 'attack';
    this.stateT = 0;
    this.queued = null;
    if (slot === 'atk') this.chainT = 900;
    // 起手朝向：玩家用视线，AI 转向目标（近战磁吸）
    if (!this.isPlayer && this.target && this.target.alive) {
      const tgt = this.target.pos;
      this.yaw = Math.atan2(tgt.x - this.pos.x, tgt.z - this.pos.z) + (this.ai ? this.ai.aimError() : 0);
    } else if (this.isPlayer && !def.aimed) {
      this.meleeAssist(def);
    }
    if (def.leap && def.leap.toTarget && this.target) {
      // 起跳前锁定落点（不追踪到最后一帧）
      this.leapTarget = this.target.pos.clone();
    }
    if (def.selfVy && this.onGround) { this.vel.y = def.selfVy; this.onGround = false; }
    this.emit('action', { def, slot });
    return true;
  }

  doLeap(d) {
    this.vel.y = d.leap.vy; this.onGround = false;
    this.knockVel.set(0, 0, 0);
    if (d.leap.toTarget && this.leapTarget) {
      const T = 2 * d.leap.vy / GRAVITY;
      const dx = this.leapTarget.x - this.pos.x, dz = this.leapTarget.z - this.pos.z;
      this.yaw = Math.atan2(dx, dz);
      this.leapVel = new THREE.Vector3(dx / T, 0, dz / T);
    } else {
      const f = this.forward();
      let fwd = d.leap.fwd;
      // 玩家/AI：若前方有目标，落点对准目标
      const tgt = this.assistTarget || (!this.isPlayer ? this.target : null);
      if (tgt && tgt.alive) {
        const T = 2 * d.leap.vy / GRAVITY * 0.8;
        const dist = Math.hypot(tgt.pos.x - this.pos.x, tgt.pos.z - this.pos.z) - 0.8;
        fwd = Math.max(1, Math.min(fwd * 1.3, dist / T));
      }
      this.leapVel = f.multiplyScalar(fwd);
    }
  }

  // 近战起手时向视线附近的敌人微调朝向（仅在小角度内）
  meleeAssist(def) {
    const range = (def.hits?.[0]?.range || 2.5) + (def.lunge || 0) + 1.2;
    let best = null, bestA = 28 * DEG;
    for (const o of this.game.fighters) {
      if (o === this || o.team === this.team || !o.alive || o.kind === 'prop') continue;
      const dx = o.pos.x - this.pos.x, dz = o.pos.z - this.pos.z;
      const d = Math.hypot(dx, dz); if (d > range) continue;
      const a = Math.abs(wrapAngle(Math.atan2(dx, dz) - this.yaw));
      if (a < bestA) { bestA = a; best = o; }
    }
    if (best) this.assistTarget = best; else this.assistTarget = null;
  }

  // ---- 受击 ----
  // 返回：'hit' | 'block' | 'parry' | 'miss' | 'armor'
  receiveHit(src, hit, dirX, dirZ, opts = {}) {
    if (this.dead) return 'miss';
    if (this.invuln > 0) return 'miss';
    const game = this.game;
    // 格挡判定：前方扇形
    const toSrcYaw = Math.atan2(-dirX, -dirZ);
    const facing = Math.abs(wrapAngle(toSrcYaw - this.yaw));
    const guardArc = (this.cls.special?.arc || 110) * DEG / 2;
    if (this.guarding && !hit.unblockable && facing <= guardArc && this.state === 'guard') {
      // 振刀：任何能格挡的职业，在蓄力重击命中前 220ms 内举起格挡即可震开对手
      const vsCharge = src && src.action && src.action.def.charge;
      if (vsCharge && this.guardT < 220) {
        this.parryT = 450;
        if (src) { src.interrupt(1100, 'parried'); src.knockVel.set(-dirX, 0, -dirZ).multiplyScalar(4); }
        this.emit('parry', { src, zhen: true });
        return 'parry';
      }
      const perfect = this.guardT < 160 && this.cls.special?.parry;
      if (perfect) {
        this.parryT = 450;
        this.addEffect({ type: 'swordIntent', t: 2000 });
        if (src && src.action && !src.action.def.ult) src.interrupt(500, 'parried');
        this.emit('parry', { src });
        return 'parry';
      }
      const chip = Math.round(hit.dmg * 0.15);
      const cost = hit.guardBreak ? 40 : hit.kind === 'bullet' || hit.kind === 'magic' ? 2 + hit.dmg * 0.02 : 8 + hit.dmg * 0.04;
      this.mp -= cost;
      if (this.mp <= 0 || hit.guardBreak) {
        this.mp = Math.max(0, this.mp);
        this.guarding = false; this.state = 'idle';
        this.applyDamage(src, Math.round(hit.dmg * 0.6), hit);
        this.enterStun(500, 'stun');
        this.emit('guardbreak', { src });
        return 'hit';
      }
      this.applyDamage(src, chip, hit, true);
      this.knockVel.set(dirX, 0, dirZ).multiplyScalar(Math.min(4, (hit.knock || 1) * 0.6 + 1));
      this.guardStun = 160;
      this.emit('block', { src });
      return 'block';
    }
    // 伤害
    let dmg = hit.dmg * (src ? src.damageMul(this) : 1) * this.defMul;
    const hdist = src ? Math.hypot(src.pos.x - this.pos.x, src.pos.z - this.pos.z) : 0;
    if (hit.kind === 'bullet' && hdist > 10) dmg *= 1 - Math.min(0.35, (hdist - 10) / 30); // 子弹远距离衰减
    if (this.hasEffect('weak')) dmg *= 1.0;
    const decay = Math.max(0.45, 1 - 0.08 * this.comboTaken);
    dmg *= decay;
    const lying = this.state === 'down';
    if (lying && !hit.otgOk) dmg *= 0.55;
    // 背后攻击
    if (facing > 120 * DEG) dmg *= hit.backMul || 1.15;
    if (hit.downMul && lying) dmg *= hit.downMul;
    const crit = Math.random() < 0.08 + (src && src.clsId === 'assassin' && facing > 120 * DEG ? 0.15 : 0);
    if (crit) dmg *= 1.5;
    dmg = Math.max(1, Math.round(dmg * (0.95 + Math.random() * 0.1)));
    this.comboTaken++; this.comboResetT = 900;
    this.applyDamage(src, dmg, hit, false, crit);
    if (this.dead) { this.launchCorpse(dirX, dirZ, hit); return 'hit'; }
    if (hit.noStun) return 'hit';

    // 霸体：只吃伤害
    const armored = this.armor > 0 || (this.action && this.action.def.armor && this.action.stage !== 'recover') || this.kind === 'boss' && !this.bossStaggerable;
    if (armored && !hit.grab) { this.emit('armor', { src }); this.hitFlash = 1; return 'armor'; }
    this.cancelAction();
    this.hitFlash = 1;
    // 受击方向（本地坐标）：用于左右/前后不同的受击姿势
    { const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw); this.hitSide = -(dirX * -fz + dirZ * fx) ; this.hitBack = -(dirX * fx + dirZ * fz); }
    const km = this.knockMul;
    // 浮空
    const inAir = this.state === 'air' || !this.onGround;
    if (hit.launch && hit.launch > 0) {
      if (!this.air.protected && this.air.launches < 3) {
        this.air.launches++;
        this.enterAir(hit.launch, dirX, dirZ, (hit.knock || 0.5) * km);
        if (this.air.launches >= 3) this.air.protected = true;
        return 'hit';
      }
      // 保护：只是小幅上顶
      this.enterAir(Math.max(this.vel.y, 2), dirX, dirZ, 1);
      return 'hit';
    }
    if (inAir) {
      // 空中追击：托一下，保持浮空
      const pop = this.air.protected ? 0 : (hit.down ? -6 : 3.2);
      this.enterAir(Math.max(this.vel.y * 0.3, 0) + pop, dirX, dirZ, (hit.knock || 1) * 0.5 * km, hit.down);
      return 'hit';
    }
    if (lying) {
      this.downHits = (this.downHits || 0) + 1;
      if (hit.otgOk && hit.launch && !this.protectPending) { this.enterAir(hit.launch, dirX, dirZ, 0.5); return 'hit'; }
      if (this.downHits <= 3) this.downT = Math.min(this.downT + 120, 1300);
      return 'hit';
    }
    // 连段保护：同一连段第 12 击强制击倒，起身后短暂无敌 + 霸体
    if (this.comboTaken >= 12 && !this.protectPending) {
      this.protectPending = true;
      this.enterAir(4, dirX, dirZ, (hit.knock || 3) * km, true);
      this.emit('protect');
      return 'hit';
    }
    if (hit.down) {
      // 击倒：先短暂飞出再倒地
      this.enterAir(3.5, dirX, dirZ, (hit.knock || 4) * km, true);
      return 'hit';
    }
    // 硬直随连段衰减，避免无限压制；远距离命中硬直打七折
    const far = hdist > 6 ? (hit.kind === 'bullet' ? 0.45 : 0.7) : 1;
    this.enterStun((hit.stun || 300) * Math.max(0.4, 1 - 0.05 * this.comboTaken) * far, 'hit');
    const kb = (hit.knock || 1) * km;
    this.knockVel.set(dirX, 0, dirZ).multiplyScalar(kb * 2.2);
    if (hit.knock < 0) this.knockVel.multiplyScalar(-0.5);
    return 'hit';
  }

  damageMul(target) {
    let m = this.dmgMul;
    if (this.hasEffect('swordIntent')) m *= 1.2;
    if (this.hasEffect('weak')) m *= 0.75;
    for (const e of this.effects) if (e.dmgMul) m *= e.dmgMul;
    if (target) {
      if (this.clsId === 'warlock' && target.effects.some((e) => e.debuff)) m *= 1.1;
      if (this.clsId === 'thug' && target.state === 'down') m *= 1.15;
    }
    if (this.clsId === 'berserker' && this.hp < this.maxHp * 0.4) m *= 1.15;
    if (this.clsId === 'battlemage' && target && (target.state === 'air')) m *= 1.1;
    if (this.cls.forms && this.stacks > 0) m *= 1 + 0.08 * this.stacks;
    if (this.aiming && this.cls.special?.dmgMul) m *= this.cls.special.dmgMul;
    return m;
  }

  applyDamage(src, dmg, hit, blocked = false, crit = false) {
    const sh = this.effects.find((e) => e.type === 'shield');
    if (sh && sh.amount > 0) { const ab = Math.min(sh.amount, dmg); sh.amount -= ab; dmg -= ab; if (sh.amount <= 0) sh.t = 0; this.emit('absorb', { amount: ab }); if (dmg <= 0) return; }
    if (src && src !== this && !blocked) {
      let ls = 0; for (const e of src.effects) if (e.lifesteal) ls += e.lifesteal;
      if (hit && hit.drain) ls += hit.drain;
      if (ls > 0) src.heal(dmg * ls, src, true);
    }
    if (this.kind === 'dummy') { this.hp = Math.max(1, this.hp - dmg); }
    else this.hp -= dmg;
    this.stats.dmgTaken += dmg;
    this.lastHitBy = src;
    if (src) {
      src.stats.dmgDealt += dmg; src.stats.hits++;
      if (!blocked && !(hit && hit.dot)) {
        // 只有目标在被命中前已处于硬直/浮空/倒地，才算连上
        const locked = this.state === 'hitstun' || this.state === 'stun' || this.state === 'air' || this.state === 'down';
        src.comboDealt = locked && src.comboDealtT > 0 ? src.comboDealt + 1 : 1;
        src.comboDealtT = 1400; src.stats.maxCombo = Math.max(src.stats.maxCombo, src.comboDealt);
      }
    }
    this.emit('damage', { src, dmg, blocked, crit, hit });
    if (this.hp <= 0 && this.kind !== 'dummy') {
      this.hp = 0; this.die(src);
    }
  }

  heal(amount, src, quiet = false) {
    if (this.dead) return 0;
    if (src && src.clsId === 'cleric' && !quiet) amount *= 1.1;
    const before = this.hp;
    this.hp = Math.min(this.maxHp, this.hp + amount);
    const got = Math.round(this.hp - before);
    if (got > 0 && !quiet) this.emit('heal', { amount: got, src });
    return got;
  }

  die(src) {
    this.dead = true;
    this.cancelAction();
    this.state = 'dead';
    this.stateT = 0;
    if (src) src.stats.kills++;
    this.emit('death', { src });
  }
  launchCorpse(dx, dz) {
    this.vel.y = 4; this.onGround = false;
    this.knockVel.set(dx, 0, dz).multiplyScalar(4);
  }

  enterAir(vy, dx, dz, knock, forceDown = false) {
    this.state = 'air'; this.stateT = 0;
    this.onGround = false;
    this.vel.y = vy;
    this.knockVel.set(dx, 0, dz).multiplyScalar(knock * 1.6);
    this.airDown = forceDown || this.airDown;
    this.stunT = 0;
  }
  enterStun(ms, type = 'hit') {
    this.state = type === 'stun' ? 'stun' : 'hitstun';
    this.stateT = 0;
    this.stunT = Math.max(this.stunT, ms);
    this.stunDur = ms;
  }
  interrupt(ms, why) {
    this.cancelAction();
    this.enterStun(ms, 'stun');
    this.emit('interrupted', { why });
  }
  cancelAction() {
    if (this.action) { this.action = null; this.leapVel = null; }
    this.guarding = false;
    this.aiming = false;
    this.beam = null;
  }

  // ---- 每帧 ----
  update(dt) {
    const ms = dt * 1000;
    this.stateT += dt;
    for (const k in this.cd) if (this.cd[k] > 0) this.cd[k] -= ms;
    if (this.chainT > 0) this.chainT -= ms;
    if (this.formLock > 0) this.formLock -= ms;
    if (this.parryT > 0) this.parryT -= ms;
    if (this.stackT > 0) { this.stackT -= ms; if (this.stackT <= 0) { this.stacks = 0; this.lastForm = null; } }
    if (this.invuln > 0) this.invuln -= ms;
    if (this.armor > 0) this.armor -= ms;
    if (this.dashCd > 0) this.dashCd -= ms;
    if (this.guardStun > 0) this.guardStun -= ms;
    if (this.hitFlash > 0) this.hitFlash = Math.max(0, this.hitFlash - dt * 7);
    if (this.stageInfo) { this.stageInfo.window -= ms; if (this.stageInfo.window <= 0 && !(this.action && this.action.slot === this.stageInfo.slot)) { this.cd[this.stageInfo.slot] = this.cls.skills[this.stageInfo.slot].cd; this.stageInfo = null; } }
    if (this.comboResetT > 0) { this.comboResetT -= ms; }
    if (this.comboResetT <= 0 && (this.state === 'idle' || this.state === 'move')) { this.comboTaken = 0; this.air.launches = 0; this.air.time = 0; this.air.protected = false; }
    if (this.comboDealtT > 0) { this.comboDealtT -= ms; if (this.comboDealtT <= 0) { if (this.comboDealt >= 3) this.emit('comboEnd', { n: this.comboDealt }); this.comboDealt = 0; } }
    for (let i = this.effects.length - 1; i >= 0; i--) {
      const e = this.effects[i]; e.t -= ms;
      if (e.dps && !this.dead) { e.acc = (e.acc || 0) + dt; if (e.acc >= 0.5) { e.acc -= 0.5; this.applyDamage(e.src || null, Math.round(e.dps * 0.5), { dot: true }); } }
      if (e.hps && !this.dead) { e.acc2 = (e.acc2 || 0) + dt; if (e.acc2 >= 0.5) { e.acc2 -= 0.5; this.heal(e.hps * 0.5, e.src); } }
      if (e.t <= 0) this.effects.splice(i, 1);
    }
    if (!this.dead && this.kind !== 'dummy') this.mp = Math.min(this.maxMp, this.mp + this.mpRegen * dt * (this.guarding ? 0 : 1));
    if (this.kind === 'dummy') { this.mp = this.maxMp; if (this.stats.lastHit === undefined) this.stats.lastHit = 0; }
    if (this.queued) { this.queued.t -= ms; if (this.queued.t <= 0) this.queued = null; }
    if (this.weapon.update) this.weapon.update(dt);
    if (this.fp) this.fp.update(dt);

    this.updateState(dt, ms);
    if (!(this.state === 'idle' || this.state === 'move' || this.state === 'jump')) { this.wantDash = false; this.wantJump = false; }
    this.updatePhysics(dt);
    this.updateModel(dt);
  }

  updateState(dt, ms) {
    const g = this.game;
    switch (this.state) {
      case 'hitstun': case 'stun':
        this.stunT -= ms;
        if (this.stunT <= 0) { this.state = 'idle'; this.stateT = 0; }
        break;
      case 'air':
        this.air.time += dt;
        if (this.air.time > 2.0) this.air.protected = true;
        break;
      case 'down':
        this.downT -= ms;
        if (this.downT <= 0) {
          this.state = 'getup'; this.stateT = 0; this.invuln = 450; this.downHits = 0;
          if (this.protectPending) { this.protectPending = false; this.invuln = 900; this.armor = 1300; this.comboTaken = 0; }
          this.emit('getup');
        }
        break;
      case 'getup':
        this.stunT = 0;
        if (this.stateT > 0.45) { this.state = 'idle'; this.stateT = 0; this.air.launches = 0; this.air.protected = false; this.air.time = 0; this.comboTaken = 0; }
        break;
      case 'tech':
        this.stunT = 0;
        if (this.stateT > 0.35) { this.state = 'idle'; this.stateT = 0; }
        break;
      case 'dash':
        this.dashT -= ms;
        if (this.dashT <= 0) { this.state = 'idle'; this.stateT = 0; }
        break;
      case 'guard':
        this.guardT += ms;
        if (!this.wantGuard) { this.guarding = false; this.state = 'idle'; }
        break;
      case 'attack':
        this.updateAction(dt, ms);
        break;
      case 'dead':
        break;
      default: {
        const fear = this.effects.find((e) => e.type === 'fear');
        if (fear && fear.src) {
          const dx = this.pos.x - fear.src.pos.x, dz = this.pos.z - fear.src.pos.z;
          const away = Math.atan2(dx, dz); const rel = away - this.yaw;
          this.moveInput.set(-Math.sin(rel), Math.cos(rel));
          if (!this.isPlayer) this.yaw = away;
        }
        // idle / move / jump：处理移动与输入
        if (this.queued && !this.action) { const q = this.queued; this.queued = null; this.tryUse(q.slot); if (this.action) break; }
        if (this.wantDash && this.dashCd <= 0 && this.onGround) {
          this.wantDash = false;
          this.startDash();
          break;
        }
        this.wantDash = false;
        if (this.wantGuard && this.cls.special && this.onGround) {
          if (this.cls.special.type === 'guard') {
            if (this.cls.special.form && this.cls.forms) { if (this.form !== this.cls.special.form) { this.prevForm = this.form; this.setForm(this.cls.special.form); } }
            this.state = 'guard'; this.guarding = true; this.guardT = 0;
            break;
          }
        }
        if (this.cls.special?.type === 'aim') this.aiming = this.wantGuard;
        if (this.prevForm && !this.wantGuard) { this.setForm(this.prevForm); this.prevForm = null; }
        if (this.wantJump && this.onGround) {
          this.vel.y = 7.2; this.onGround = false; this.emit('jump');
        }
        this.wantJump = false;
        this.state = this.onGround ? (this.moveInput.lengthSq() > 0.01 ? 'move' : 'idle') : 'jump';
      }
    }
  }

  startDash() {
    const mi = this.moveInput;
    let lx = mi.x, ly = mi.y;
    if (lx * lx + ly * ly < 0.01) { lx = 0; ly = -1; }
    const len = Math.hypot(lx, ly); lx /= len; ly /= len;
    const f = this.forward();
    const rx = -f.z, rz = f.x; // 右方向
    const dx = f.x * ly + rx * lx, dz = f.z * ly + rz * lx;
    const dl = Math.hypot(dx, dz) || 1;
    this.knockVel.set(dx / dl, 0, dz / dl).multiplyScalar(15);
    this.state = 'dash'; this.dashT = 230; this.dashCd = 900; this.stateT = 0;
    this.invuln = Math.max(this.invuln, 140);
    this.mp -= 4;
    this.emit('dash');
  }

  updateAction(dt, ms) {
    const a = this.action;
    if (!a) { this.state = 'idle'; return; }
    const d = a.def;
    a.t += ms; a.total += ms;
    // 阶段推进
    if (d.charge && a.stage === 'wind') {
      a.chargeFrac = Math.min(1, a.t / d.wind);
      if (a.t >= d.minWind && (!this.charging || a.t >= d.wind)) {
        // 按蓄力程度生成本次重击
        const k = a.chargeFrac, full = k >= 0.98;
        const h = { ...d.hits[0], dmg: Math.round(90 + 140 * k), knock: 6 + 6 * k, stun: 500 + 300 * k, guardBreak: full, down: full || k > 0.6 };
        a.def = { ...d, wind: a.t, hits: [h] };
        this.charging = false;
        a.stage = 'active'; a.t = 0; this.emit('active', { def: a.def });
        if (full) this.emit('fullcharge');
      }
    } else if (a.stage === 'wind' && a.t >= d.wind) {
      a.stage = 'active'; a.t -= d.wind; this.emit('active', { def: d });
      if (d.leap) this.doLeap(d);
      if (d.heal) this.game.combat.doHeal(this, d.heal, d);
      if (d.buff) { this.addEffect({ ...d.buff }); this.emit('buff', { def: d }); }
      if (d.hpCost) this.hp = Math.max(1, this.hp - this.maxHp * d.hpCost);
      if (d.blink) this.game.combat.doBlink(this, d.blink);
      if (d.cleanse) { this.effects = this.effects.filter((e) => !e.debuff); this.emit('cleanse'); }
      if (d.flyDash) { this.flyT = d.flyDash.dur; const dir = this.isPlayer ? this.aimDir.clone() : this.forward().setY(0.15).normalize(); this.flyVel = dir.multiplyScalar(d.flyDash.speed); this.onGround = false; }
    }
    if (a.stage === 'active') {
      // 命中判定窗口
      if (d.hits) for (let i = 0; i < d.hits.length; i++) {
        const h = d.hits[i];
        if (a.hitsDone.has(i)) continue;
        if (d.slamOnLand && !a.landed) continue;
        if (a.t >= h.t) { a.hitsDone.add(i); this.game.combat.meleeHit(this, h, d, i); if (d.multiSfx && i > 0) this.emit('swing', { def: d, i }); }
      }
      if (d.proj) for (let i = 0; i < d.proj.length; i++) {
        if (a.projDone.has(i)) continue;
        const p = d.proj[i];
        if (a.t >= p.t) { a.projDone.add(i); this.game.combat.fireProjectile(this, p, d, i); }
      }
      if (d.aoe) for (let i = 0; i < d.aoe.length; i++) {
        if (a.aoeDone.has(i)) continue;
        const p = d.aoe[i];
        if (a.t >= p.t) { a.aoeDone.add(i); this.game.combat.placeAoe(this, p, d); }
      }
      if (d.beam) {
        const every = d.active / d.beam.ticks;
        while (a.beamTick < d.beam.ticks && a.t >= a.beamTick * every) { this.game.combat.beamTick(this, d, a.beamTick); a.beamTick++; }
      }
      if (d.altAnims) a.animIdx = Math.floor(a.t / 130) % d.altAnims.length;
      if (d.umbrellaSeq && this.cls.forms) {
        const idx = Math.min(d.umbrellaSeq.length - 1, Math.floor(a.t / (d.active / d.umbrellaSeq.length)));
        const f = d.umbrellaSeq[idx];
        if (this.form !== f) { this.form = f; this.weapon.setForm?.(f); this.fp?.setForm(f); this.emit('form', { form: f, silent: true }); }
      }
      // 跳劈：必须落地才进入收招
      const slamWait = d.slamOnLand && !a.landed;
      if (!slamWait && a.t >= d.active) { a.stage = 'recover'; a.t -= d.active; }
    }
    if (a.stage === 'recover' && a.t >= d.recover) {
      this.action = null; this.leapVel = null; this.beam = null;
      this.state = this.onGround ? 'idle' : 'jump'; this.stateT = 0;
      if (this.queued) { const q = this.queued; this.queued = null; this.tryUse(q.slot); }
    }
    // 跳劈落地
    if (d.slamOnLand && a.stage !== 'wind' && this.onGround && !a.landed && a.total > d.wind + 80) {
      a.landed = true; this.leapVel = null; a.stage = 'active'; a.t = 0; a.hitsDone.clear();
      this.emit('slam', { def: d });
    }
    if (d.slamOnLand && a.stage === 'active' && !a.landed && this.vel.y < 0 && !(d.leap && d.leap.toTarget)) {
      // 过顶点后加速下坠
      this.vel.y -= 30 * dt;
    }
  }

  updatePhysics(dt) {
    const g = this.game;
    const moving = this.state === 'idle' || this.state === 'move' || this.state === 'jump' || (this.state === 'attack' && this.action && this.action.def.moveOk);
    let tvx = 0, tvz = 0;
    if (moving && !this.dead) {
      const f = this.forward();
      const rx = -f.z, rz = f.x; // 右方向
      const mx = this.moveInput.x, my = this.moveInput.y;
      let sp = this.speed * (this.state === 'attack' ? this.action.def.moveOk : 1);
      if (this.aiming) sp *= 0.55;
      if (this.hasEffect('slow')) sp *= 0.55;
      if (this.hasEffect('root')) sp = 0;
      if (my < 0) sp *= 0.8; // 后退略慢
      tvx = (f.x * my + rx * mx) * sp;
      tvz = (f.z * my + rz * mx) * sp;
      const l = Math.hypot(this.moveInput.x, this.moveInput.y);
      if (l > 1) { tvx /= l; tvz /= l; }
    }
    // 技能位移
    const a = this.action;
    if (a) {
      const d = a.def;
      if (d.dash) {
        const inWin = (d.dash.from === 'wind' && a.stage === 'wind') || (d.dash.from === 'wind' && a.stage === 'active' && a.t < d.dash.dur - d.wind) || (d.dash.from === 'active' && a.stage === 'active' && a.t < d.dash.dur);
        if (inWin) {
          const f = this.forward();
          // 冲刺不穿过目标：贴身时停下
          const blocked = this.closestEnemyAhead(0.95);
          const sp = blocked ? 0 : d.dash.speed;
          tvx = f.x * sp; tvz = f.z * sp;
        }
      }
      if (d.lunge && a.stage === 'wind') {
        const tgt = this.assistTarget || (this.isPlayer ? null : this.target);
        if (tgt && tgt.alive) {
          const dx = tgt.pos.x - this.pos.x, dz = tgt.pos.z - this.pos.z;
          const dist = Math.hypot(dx, dz);
          const want = (d.hits?.[0]?.range || 2.2) * 0.65;
          if (dist > want) {
            const sp = Math.min(d.lunge / (d.wind / 1000), (dist - want) / Math.max(dt, 0.001));
            tvx = dx / dist * sp; tvz = dz / dist * sp;
            if (this.isPlayer) { /* 玩家不改视线，只移动身体 */ } else this.yaw = Math.atan2(dx, dz);
          }
        } else if (a.t < d.wind) {
          const f = this.forward(); const sp = d.lunge * 0.5 / (d.wind / 1000);
          tvx = f.x * sp; tvz = f.z * sp;
        }
      }
      if (this.leapVel) { tvx = this.leapVel.x; tvz = this.leapVel.z; }
      if (this.flyT > 0 && this.flyVel) { tvx = this.flyVel.x; tvz = this.flyVel.z; this.vel.y = this.flyVel.y; }
      if (d.selfLeap && a.stage === 'active' && a.t < 60 && !a.leapt) {
        a.leapt = true;
        const f = this.forward();
        this.knockVel.set(-f.x, 0, -f.z).multiplyScalar(d.selfLeap.back);
        if (d.selfLeap.vy) { this.vel.y = d.selfLeap.vy; this.onGround = false; }
      }
      if (d.recoil && a.stage === 'active' && !a.recoiled) { a.recoiled = true; const f = this.forward(); this.knockVel.addScaledVector(f, -d.recoil * 2); }
    }
    // 击退速度衰减
    const fr = this.onGround ? 9 : 1.2;
    this.knockVel.multiplyScalar(Math.exp(-fr * dt));
    const accel = this.onGround ? 18 : 5;
    if (a || this.state === 'attack') {
      this.vel.x = tvx; this.vel.z = tvz;
    } else if (this.state === 'air' || this.state === 'hitstun' || this.state === 'stun' || this.state === 'down' || this.state === 'dead' || this.state === 'getup' || this.state === 'dash' || this.state === 'tech' || this.state === 'guard') {
      this.vel.x = 0; this.vel.z = 0;
      if (this.state === 'guard' && this.moveInput.lengthSq() > 0.01 && this.guardStun <= 0) {
        const f = this.forward(); const rx = -f.z, rz = f.x;
        this.vel.x = (f.x * this.moveInput.y + rx * this.moveInput.x) * 2.6;
        this.vel.z = (f.z * this.moveInput.y + rz * this.moveInput.x) * 2.6;
      }
    } else {
      const k = 1 - Math.exp(-accel * dt);
      this.vel.x += (tvx - this.vel.x) * k;
      this.vel.z += (tvz - this.vel.z) * k;
    }
    if (this.flyT > 0) { this.flyT -= dt * 1000; if (this.flyT <= 0) { this.flyVel = null; this.vel.y = Math.min(this.vel.y, 1.5); } }
    // 重力
    if (!this.onGround && !(this.flyT > 0)) {
      const grav = this.state === 'air' ? JUGGLE_GRAVITY : GRAVITY;
      this.vel.y -= grav * dt;
    }
    const nx = this.pos.x + (this.vel.x + this.knockVel.x) * dt;
    const nz = this.pos.z + (this.vel.z + this.knockVel.z) * dt;
    let ny = this.pos.y + this.vel.y * dt;
    // 关卡碰撞
    const res = g.world.resolve(this, nx, ny, nz);
    this.pos.set(res.x, res.y, res.z);
    if (res.wallHit && this.state === 'air' && this.knockVel.lengthSq() > 16) { this.knockVel.multiplyScalar(-0.3); this.emit('wallbounce'); }
    const wasGround = this.onGround;
    if (res.grounded && this.vel.y <= 0) {
      this.onGround = true;
      if (!wasGround) this.onLand(-this.vel.y);
      this.vel.y = 0;
    } else if (!res.grounded) {
      this.onGround = false;
    }
    if (res.ceiling && this.vel.y > 0) this.vel.y = 0;
  }

  onLand(impact) {
    if (this.state === 'air') {
      // 受身：落地前后窗口按下跳跃
      const techOk = this.techBuffer > 0 && !this.dead;
      if (techOk) {
        this.protectPending = false;
        this.state = 'tech'; this.stateT = 0; this.invuln = 400; this.techBuffer = 0;
        this.air.launches = 0; this.air.time = 0; this.air.protected = false; this.comboTaken = 0; this.airDown = false;
        const f = this.forward(); this.knockVel.set(-f.x, 0, -f.z).multiplyScalar(6);
        this.emit('tech');
        return;
      }
      this.state = 'down'; this.stateT = 0; this.downT = this.airDown ? 900 : 650; this.airDown = false;
      this.techWindow = 220; // 落地后短时间仍可受身
      this.emit('knockdown', { impact });
      return;
    }
    if (this.state === 'dead') { this.emit('land', { impact, dead: true }); return; }
    if (impact > 6) this.emit('land', { impact });
  }

  requestTech() {
    if (this.state === 'air') this.techBuffer = 260;
    else if (this.state === 'down' && this.stateT < 0.22) {
      this.state = 'tech'; this.stateT = 0; this.invuln = 400; this.protectPending = false; this.airDown = false; this.downHits = 0;
      this.air.launches = 0; this.air.time = 0; this.air.protected = false; this.comboTaken = 0;
      this.emit('tech');
    }
  }

  closestEnemyAhead(minDist) {
    const f = this.forward();
    for (const o of this.game.fighters) {
      if (o === this || o.team === this.team || !o.alive) continue;
      const dx = o.pos.x - this.pos.x, dz = o.pos.z - this.pos.z;
      const d = Math.hypot(dx, dz);
      if (d < minDist + o.radius && (dx * f.x + dz * f.z) > 0 && Math.abs(o.pos.y - this.pos.y) < 1.5) return o;
    }
    return null;
  }

  updateModel(dt) {
    if (this.techBuffer > 0) this.techBuffer -= dt * 1000;
    const r = this.rig.root;
    r.position.copy(this.pos);
    r.rotation.y = this.yaw;
    const a = this.action;
    const hspeed = Math.hypot(this.vel.x, this.vel.z);
    const f = this.forward();
    const fwd = hspeed > 0.1 ? (this.vel.x * f.x + this.vel.z * f.z) / hspeed : 1;
    const side = hspeed > 0.1 ? (this.vel.x * -f.z + this.vel.z * f.x) / hspeed : 0; // 右为正
    let clip = null, stage = null, t = 0;
    if (a) {
      clip = a.def.altAnims ? a.def.altAnims[a.animIdx] : a.def.anim;
      stage = a.stage === 'wind' ? 'wind' : a.stage === 'active' ? 'active' : 'recover';
      t = a.stage === 'wind' ? a.t / Math.max(1, a.def.wind) : a.stage === 'active' ? a.t / Math.max(1, a.def.active) : a.t / Math.max(1, a.def.recover);
      if (a.def.altAnims && a.stage === 'active') { t = (a.t % 130) / 130; }
    }
    let react = null;
    switch (this.state) {
      case 'hitstun': react = { type: 'hit', t: this.stateT, dur: (this.stunDur || 300) / 1000, side: this.hitSide || 0, back: this.hitBack ?? 1 }; break;
      case 'stun': react = { type: 'stun', t: this.stateT }; break;
      case 'air': react = { type: 'air', t: this.stateT }; break;
      case 'down': react = { type: 'down', t: this.stateT }; break;
      case 'getup': react = { type: 'getup', t: this.stateT, dur: 0.45 }; break;
      case 'tech': react = { type: 'tech', t: this.stateT, dur: 0.35 }; break;
      case 'dead': react = { type: 'dead', t: this.stateT, back: this.hitBack ?? 1 }; break;
    }
    if (this.cheer) react = { type: 'cheer', t: this.stateT };
    let guardKind = this.cls.special?.kind || 'sword';
    if (this.cls.special?.type === 'guard' && this.cls.forms && this.form) guardKind = this.cls.forms[this.form].guard || guardKind;
    const st = {
      speed: this.state === 'dash' ? 8 : hspeed, fwd, side, onGround: this.onGround, vy: this.vel.y,
      stance: this.stance, action: clip ? { clip, stage, t, key: a.uid + ':' + (a.animIdx || 0) } : null, react,
      pitch: this.aiming || (a && a.def.aimed) ? this.pitch : this.pitch * 0.7,
      guard: this.state === 'guard', guardKind,
      dash: this.state === 'dash', dashT: this.state === 'dash' ? 1 - Math.max(0, this.dashT) / 230 : 0,
      calm: this.kind === 'hero' && this.game.mode && this.game.mode.constructor.name === 'TrainingMode' && !this.action,
    };
    this.anim.update(dt, st);
    if (this.mocap) this.mocap.update(dt, st);
    if (this.gripHands?.length) fitWorldGripHands(this.mocapBody, this.gripHands, this.weapon, this.leftWeapon);
    this.applyFlash();
    this.applyTell(dt);
  }

  // 动捕身体（Meshy 绑定模型 + 共享动作库）：替换世界身体，武器挂到骨架手上
  attachMocap(look) {
    const rs = this.game.rigged && this.game.rigged.get(this.modelKey);
    this.mocap = null;
    this.mocapBody = null;
    this.gripHands = [];
    if (!rs || !hasClips() || (look && look.proc)) return;
    try {
      analyzeImpacts(rs);
      const body = createMocapBody(rs);
      const split = splitForFirstPerson(body);
      this.rig.root.add(body.model);
      for (const p of this.rig.parts) p.visible = false;
      this.rig.parts = [...split.head, ...split.arms, ...split.body];
      this.rig.headParts.length = 0; this.rig.headParts.push(...split.head);
      this.rig.armParts = [...split.arms];
      this.rig.mocapBodyMeshes = split.body;
      this.rig.root.updateMatrixWorld(true);
      const tilt = weaponTilt(this.weapon.type);
      mountMocapWeapon(body, 'Right', this.weapon.obj, tilt, this.scale);
      mountMocapWeapon(body, 'Left', this.leftWeapon, -tilt, this.scale);
      this.gripHands = installGripHands(body, { Right: handSocket(body,'Right'), Left: handSocket(body,'Left') }, this.weapon.type, this.scale);
      fitWorldGripHands(body,this.gripHands);
      for(const hand of this.gripHands) hand.root.traverse(object=>{if(object.isMesh){object.castShadow=true; this.rig.armParts.push(object);}});
      this.mocapBody = body;
      this.mocap = new MocapAnimator(body, this.rig);
      this.fpGlb = rs;
      this.usesModel = false;
    } catch (e) { console.warn('动捕身体创建失败', e); this.mocap = null; }
  }

  // 有原画精模（图生 3D + 自动蒙皮）时替换程序化身体；自定义外观时保留程序化造型
  applyModel(look) {
    const glb = this.game.models && this.game.models.get(this.modelKey);
    this.usesModel = false;
    this.fpGlb = null;
    if (!glb || (look && look.proc)) return;
    try { this.usesModel = applySkinnedModel(this.rig, glb, { key: `${this.modelKey}|${look.sex}|${look.build || 1}` }); if (this.usesModel) this.fpGlb = glb; } catch (e) { console.warn('蒙皮失败', e); }
  }

  // 每个角色独立材质，便于受击闪白
  prepMaterials() {
    this.weaponMats = null;
    this.flashMats = [];
    this.privateMaterials ||= new WeakSet();
    const seen = new Map();
    this.rig.root.traverse((o) => {
      if (!o.isMesh || !o.material) return;
      const materials=[].concat(o.material).map(source=>{
        if(!source.isMeshStandardMaterial) return source;
        let m=seen.get(source);
        if(!m) {
          m=this.privateMaterials.has(source)?source:source.clone();
          if(!this.privateMaterials.has(m)) {m.userData.baseE=source.emissive.clone();this.privateMaterials.add(m);addCamFade(m,this.game);}
          m.emissive.copy(m.userData.baseE);seen.set(source,m);this.flashMats.push(m);
        }
        return m;
      });
      o.material=Array.isArray(o.material)?materials:materials[0];
    });
    this._flashOn = false;
  }
  // 读招光效：霸体招式蓝光，破防/不可格挡金光
  applyTell(dt) {
    const a = this.action;
    let col = null, k = 0;
    if (a && a.stage !== 'recover') {
      const d = a.def;
      const unblock = d.hits && d.hits.some((h) => h.unblockable || h.guardBreak);
      if (d.charge) { col = (a.chargeFrac || 0) >= 0.98 ? 'gold' : 'blue'; k = 0.5 + 0.5 * (a.chargeFrac || 0); }
      else if (unblock) { col = 'gold'; k = 1; }
      else if (d.armor) { col = 'blue'; k = 1; }
    }
    this.tellK = (this.tellK || 0) + ((col ? k : 0) - (this.tellK || 0)) * Math.min(1, dt * 14);
    if (col) this.tellCol = col;
    if (!this.weaponMats) { this.weaponMats = []; const seen = new Set(); const add = (o) => o && o.traverse((m) => { if (m.isMesh && m.material && m.material.emissive && !seen.has(m.material)) { seen.add(m.material); this.weaponMats.push(m.material); m.material.userData.baseE = m.material.userData.baseE || m.material.emissive.clone(); m.material.userData.baseEI = m.material.emissiveIntensity; } }); add(this.weapon.obj); add(this.leftWeapon); }
    const on = this.tellK > 0.02;
    if (!on && !this._tellOn) return;
    this._tellOn = on;
    const c = this.tellCol === 'gold' ? [1.0, 0.72, 0.2] : [0.25, 0.6, 1.0];
    const pulse = 0.75 + 0.25 * Math.sin(performance.now() / 60);
    for (const m of this.weaponMats) {
      const b = m.userData.baseE;
      if (on) { m.emissive.setRGB(b.r + c[0] * this.tellK * pulse, b.g + c[1] * this.tellK * pulse, b.b + c[2] * this.tellK * pulse); m.emissiveIntensity = Math.max(m.userData.baseEI, 2.2); }
      else { m.emissive.copy(b); m.emissiveIntensity = m.userData.baseEI; }
    }
    if (on && Math.random() < dt * 30 * this.tellK && this.weapon.tip) {
      const p = this.weapon.tip.getWorldPosition(new THREE.Vector3());
      this.game.vfx.particle(p.x, p.y, p.z, (Math.random() - 0.5), 1 + Math.random(), (Math.random() - 0.5), this.tellCol === 'gold' ? '#ffc040' : '#50a8ff', 0.09, 0.35, -1);
    }
  }

  applyFlash() {
    const k = this.hitFlash;
    if (k <= 0.01 && !this._flashOn) return;
    this._flashOn = k > 0.01;
    const f = this._flashOn ? k * k * 0.09 : 0;
    for (const m of this.flashMats) { const b = m.userData.baseE; m.emissive.setRGB(b.r + f, b.g + f * 0.95, b.b + f * 0.85); }
  }

  // 复活/回合开始时清空所有战斗状态
  resetState() {
    this.dead = false; this.state = 'idle'; this.stateT = 0; this.action = null; this.cd = {}; this.effects = [];
    this.stunT = 0; this.invuln = 0; this.armor = 0; this.parryT = 0; this.guardStun = 0; this.downT = 0; this.downHits = 0;
    this.vel.set(0, 0, 0); this.knockVel.set(0, 0, 0); this.comboTaken = 0; this.air = { time: 0, launches: 0, protected: false };
    this.stageInfo = null; this.queued = null; this.guarding = false; this.aiming = false; this.cheer = false;
    this.leapVel = null; this.flyT = 0; this.flyVel = null; this.protectPending = false; this.airDown = false; this.techBuffer = 0;
    this.prevForm = null; this.wantDash = false; this.wantJump = false; this.wantGuard = false; this.beam = null; this.stacks = 0; this.stackT = 0;
    this.onGround = true; this.hitFlash = 0;
  }

  rebuildLook(look) {
    const parent = this.rig.root.parent;
    // 武器继续使用，先移出旧骨架再释放旧身体的独占资源。
    this.weapon.obj.removeFromParent();
    this.leftWeapon?.removeFromParent();
    this.mocap?.mixer.stopAllAction();
    disposeRig(this.rig, { sharedRoots: [this.game.models?.get(this.modelKey), this.game.rigged?.get(this.modelKey), ...(this.gripHands || []).map(hand=>hand.root)] });
    for(const hand of this.gripHands || []) hand.dispose();
    this.rig = buildCharacter(look);
    this.rig.root.scale.setScalar(this.scale);
    this.rig.bones.gripR.add(this.weapon.obj);
    if (this.leftWeapon) this.rig.bones.gripL.add(this.leftWeapon);
    this.lookData = look;
    if (parent) parent.add(this.rig.root);
    this.rig.root.position.copy(this.pos);
    this.applyModel(look);
    this.attachMocap(look);
    this.anim = new Animator(this.rig);
    this.prepMaterials();
    this.updateModel(0.016);
  }

  setFirstPerson(on) {
    setFirstPersonHidden(this.rig, on);
  }

  dispose() {
    this.mocap?.mixer.stopAllAction();
    disposeRig(this.rig, { sharedRoots: [this.game.models?.get(this.modelKey), this.game.rigged?.get(this.modelKey), ...(this.gripHands || []).map(hand=>hand.root)] });
    for(const hand of this.gripHands || []) hand.dispose();
    this.gripHands=[];
    if (this.fp) this.fp.dispose();
  }
}
