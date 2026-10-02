// 炫纹与斗者意志。原著机制和本作参数分开记录于 docs/battle-mage.md。
import * as THREE from 'three';
import { hasStatusFlag } from './statuses.js';

export const CHASERS = Object.freeze({
  neutral: { name: '无属性炫纹', color: '#ecf3ff', damage: 30, buff: 'chaserNeutral' },
  light: { name: '光炫纹', color: '#ffe17b', damage: 36, buff: 'chaserLight' },
  ice: { name: '冰炫纹', color: '#81d7ff', damage: 36, buff: 'chaserIce' },
  fire: { name: '火炫纹', color: '#ff8658', damage: 42, buff: 'chaserFire' },
  dark: { name: '暗炫纹', color: '#b89aff', damage: 38, buff: 'chaserDark' },
});
export const CHASER_RULES = Object.freeze({ max: 7, lifetime: 20, window: 1.2, cooldown: .24, buffMs: 8000, range: 18 });
export const WILL_THRESHOLDS = Object.freeze([10, 20, 30, 40, 50, 60, 120]);
const tierFor = n => WILL_THRESHOLDS.filter(x => n >= x).length;
let seq = 0;

export function initBattleMage(f) {
  f.chasers = []; f.chaserWindow = 0; f.chaserCd = 0; f.chaserTarget = null; f.chaserHitSerial = 0;
  f.battleWill = { tier: 0, combo: 0, timer: 0, carry: 0, active: false };
  f.wantChaser = false; f.chaserCast = null;
  if (f.chaserVisual) { f.chaserVisual.root.visible = false; for (const o of f.chaserVisual.orbs) o.visible = false; }
}

export function battleMageHit(f, target, result, hit, def, ranged) {
  if (f.clsId !== 'battlemage' || !['hit', 'armor', 'block', 'parry'].includes(result)) return;
  if (hit.chaser) {
    if (result !== 'parry') applyChaserBuff(f, hit.chaser);
    return;
  }
  if (ranged || !def?.hits?.length) return;
  if (def.sameSpotBleed && ['hit', 'armor'].includes(result) && hit.contact?.point) {
    const action = f.action;
    if (action) {
      action.thrustContacts ||= new Map();
      target.rig.root.updateWorldMatrix(true, true);
      const local = target.rig.root.worldToLocal(hit.contact.point.clone());
      const first = action.thrustContacts.get(target.id);
      if (!first) action.thrustContacts.set(target.id, { point: local, region: hit.contact.region, time: hit.t });
      else if (first.time !== hit.t && first.region === hit.contact.region && first.point.distanceTo(local) <= .18 && Math.random() < .5) {
        target.addEffect({ type: 'bleed', t: 4000, dps: 12, src: f, debuff: true });
      }
    }
  }
  // 必须再次命中才开放旧炫纹的发射窗口。本击刚生成的球不占此窗口。
  f.chaserHitSerial++;
  f.chaserWindow = CHASER_RULES.window; f.chaserTarget = target;
  const type = def.chaser;
  if (!CHASERS[type]) return;
  const action = f.action;
  if (action?.generatedChaser) return; // 一次多段技能最多生成一枚。
  if (action) action.generatedChaser = true;
  if (f.chasers.length >= CHASER_RULES.max) f.chasers.shift();
  f.chasers.push({ type, id: ++seq, ttl: CHASER_RULES.lifetime, bornHit: f.chaserHitSerial });
  f.emit('chaser', { type, generated: true });
}

export function applyChaserBuff(f, type) {
  const def = CHASERS[type]; if (!def || !f.alive) return;
  f.addEffect({ type: def.buff, t: CHASER_RULES.buffMs, debuff: false });
  f.emit('chaser', { type, generated: false });
}

export function finishWillCombo(f) {
  if (f.clsId !== 'battlemage' || !f.battleWill.active) return;
  const b = f.battleWill;
  b.tier = b.carry = tierFor(b.combo); b.timer = 0; b.active = false; b.combo = 0;
}
export function recordWillHit(f, combo) {
  if (f.clsId !== 'battlemage') return;
  const b = f.battleWill;
  if (combo <= 1 && b.active) finishWillCombo(f);
  b.active = true; b.combo = combo; b.timer = 1.4; b.tier = Math.max(b.carry, tierFor(combo));
}
export function battleMageSpeed(f) {
  if (f.clsId !== 'battlemage') return 1;
  const tier = f.battleWill.tier, will = tier === 7 ? .24 : tier * .02;
  return 1 + will + (f.hasEffect('chaserNeutral') ? .10 : 0);
}
export function battleMageAttackSpeed(f) {
  if (f.clsId !== 'battlemage') return 1;
  return 1 + f.battleWill.tier * .02 + (f.hasEffect('chaserLight') ? .08 : 0);
}
export function battleMageDamage(f, hit = {}) {
  if (f.clsId !== 'battlemage') return 1;
  const physical = hit.kind !== 'magic' && !hit.dot;
  return 1 + (physical ? f.battleWill.tier * .025 + (f.hasEffect('chaserFire') ? .10 : 0) : 0);
}
export function chaserPosition(f, index = 0, out = new THREE.Vector3()) {
  // 背后一圈，绑定身体位置而非相机，不会从准星凭空出生。
  const angle = (index / CHASER_RULES.max - .5) * Math.PI * 1.15;
  return f.rig.root.localToWorld(out.set(Math.sin(angle) * .63, 1.10 + Math.cos(angle) * .55, -.38 - Math.cos(angle) * .19));
}
export function fireChaser(f) {
  if (f.clsId !== 'battlemage' || !f.alive || f.chaserCd > 0 ||
      hasStatusFlag(f, 'skillLock') || hasStatusFlag(f, 'actionLock') || hasStatusFlag(f, 'attackLock') ||
      f.stunT > 0 || ['air', 'down', 'getup', 'hitstun', 'stun', 'dead'].includes(f.state)) return false;
  const reject = text => {
    if (f.isPlayer && f.game.time >= (f.chaserNoticeAt || 0)) { f.chaserNoticeAt = f.game.time + .8; f.game.hud?.toast(text); }
    return false;
  };
  if (!f.chasers.length) return reject('先用天击、龙牙等招式命中，生成炫纹');
  if (f.chaserWindow <= 0) return reject('再次命中敌人后，可发射已有炫纹');
  const index = f.chasers.findIndex(c => c.bornHit < f.chaserHitSerial);
  if (index < 0) return reject('炫纹已生成，再次命中后发射');
  const target = f.chaserTarget;
  if (!target?.alive || target.team === f.team || target.pos.distanceTo(f.pos) > CHASER_RULES.range) return reject('目标已离开，命中新目标后再发射');
  const chaser = f.chasers[index], type = CHASERS[chaser.type];
  f.rig.root.updateWorldMatrix(true, true);
  const origin = chaserPosition(f, index);
  // 有发射轨迹，有实体碰撞；遮挡只使弹体撞墙，绝不直接扣目标生命。
  const p = { kind: 'magic', chaser: chaser.type, color: type.color, radius: .10, hitRadius: .12,
    speed: 24, range: CHASER_RULES.range, homing: 5, gravity: 0, dmg: type.damage, stun: 100, knock: .25,
    ...(chaser.type === 'ice' ? { effect: { type: 'slow', t: 1400, speedMul: .8 } } : {}) };
  f.chaserCast = { origin, target };
  let pr;
  try { pr = f.game.combat.fireProjectile(f, p, { name: type.name, chaser: true, sfx: 'magic_bolt' }, 0); }
  finally { f.chaserCast = null; }
  if (!pr) return false;
  pr.homeT = target; f.chasers.splice(index, 1); f.chaserCd = CHASER_RULES.cooldown;
  // 一次真正的攻击命中开放一次发射；按住右键不能自动连发全部存球。
  f.chaserWindow = 0;
  return true;
}

export function updateBattleMage(f, dt) {
  if (f.clsId !== 'battlemage') return;
  f.chaserWindow = Math.max(0, f.chaserWindow - dt); f.chaserCd = Math.max(0, f.chaserCd - dt);
  for (const c of f.chasers) c.ttl -= dt;
  f.chasers = f.chasers.filter(c => c.ttl > 0);
  if (f.battleWill.active) {
    f.battleWill.timer = Math.max(0, f.battleWill.timer - dt);
    if (!f.battleWill.timer || f.comboDealtT <= 0) finishWillCombo(f);
  }
  if (f.wantChaser) { fireChaser(f); f.wantChaser = false; }
}

export function updateChaserVisual(f) {
  if (f.clsId !== 'battlemage') return;
  if (!f.chaserVisual && (f.chasers.length || f.battleWill.tier)) {
    const root = new THREE.Group(); root.name = 'battle-mage-chasers'; f.rig.root.add(root);
    const geometry = new THREE.IcosahedronGeometry(.075, 1), orbs = [];
    for (let i = 0; i < CHASER_RULES.max; i++) {
      const material = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: .92 });
      const orb = new THREE.Mesh(geometry, material); orb.name = 'chaser-' + i; root.add(orb); orbs.push(orb);
    }
    const aura = new THREE.Mesh(new THREE.TorusGeometry(.46, .012, 4, 32), new THREE.MeshBasicMaterial({ color: '#ffd56c', transparent: true, opacity: .2, depthWrite: false, blending: THREE.AdditiveBlending }));
    aura.name = 'fighters-will'; aura.position.y = .86; aura.rotation.x = Math.PI / 2; root.add(aura);
    f.chaserVisual = { root, geometry, orbs, aura };
  }
  const v = f.chaserVisual; if (!v) return;
  v.root.visible = f.alive && (f.chasers.length > 0 || f.battleWill.tier > 0);
  v.aura.visible = f.battleWill.tier > 0; v.aura.material.opacity = .10 + f.battleWill.tier * .045;
  v.aura.scale.setScalar(1 + f.battleWill.tier * .035 + Math.sin(f.game.time * 3) * .03);
  for (let i = 0; i < v.orbs.length; i++) {
    const orb = v.orbs[i], c = f.chasers[i]; orb.visible = !!c;
    if (!c) continue;
    const angle = (i / CHASER_RULES.max - .5) * Math.PI * 1.15;
    orb.position.set(Math.sin(angle) * .63, 1.10 + Math.cos(angle) * .55, -.38 - Math.cos(angle) * .19);
    orb.rotation.y = f.game.time * 1.6 + i; orb.rotation.z = f.game.time * .6 + i;
    orb.material.color.set(CHASERS[c.type].color);
    orb.material.opacity = c.ttl < 2 ? .35 + .5 * Math.abs(Math.sin(c.ttl * 8)) : .92;
  }
}
export function disposeChaserVisual(f) {
  const v = f.chaserVisual; if (!v) return;
  v.root.removeFromParent(); v.geometry.dispose(); for (const o of v.orbs) o.material.dispose();
  v.aura.geometry.dispose(); v.aura.material.dispose(); f.chaserVisual = null;
}
export function battleMageSnapshot(f) {
  if (f.clsId !== 'battlemage') return undefined;
  const b = f.battleWill;
  return { c: f.chasers.map(c => [c.type, c.id, +c.ttl.toFixed(1), c.bornHit]), h: f.chaserHitSerial, w: +f.chaserWindow.toFixed(2), cd: +f.chaserCd.toFixed(2),
    b: [b.tier, b.combo, +b.timer.toFixed(2), b.carry, b.active ? 1 : 0] };
}
export function applyBattleMageSnapshot(f, snapshot) {
  if (f.clsId !== 'battlemage') return;
  if (!snapshot) { initBattleMage(f); return; }
  f.chasers = snapshot.c.map(([type, id, ttl, bornHit]) => ({ type, id, ttl, bornHit: bornHit ?? 0 }));
  f.chaserHitSerial = snapshot.h || 0;
  f.chaserWindow = snapshot.w; f.chaserCd = snapshot.cd;
  const [tier, combo, timer, carry, active] = snapshot.b;
  Object.assign(f.battleWill, { tier, combo, timer, carry, active: !!active });
}
