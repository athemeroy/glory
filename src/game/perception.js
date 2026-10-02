// 遮影步来自视野死角与走位；角色不隐身，也不获得穿墙锁定。
import * as THREE from 'three';
const eye = new THREE.Vector3(), point = new THREE.Vector3(), delta = new THREE.Vector3();
const DEG = Math.PI / 180;
export function visibleTo(observer, target, world = observer?.game?.world, options = {}) {
  if (!observer || !target || observer === target) return false;
  if (!options.ignoreBlind && observer.hasEffect?.('blind')) return false;
  observer.eyePos ? observer.eyePos(eye) : eye.copy(observer.pos).add({ x: 0, y: (observer.height || 1.8) * .9, z: 0 });
  const height = target.collisionHeight || (target.state === 'down' ? target.downHeight || .45 : target.height || 1.8);
  const fov = options.fov ?? (observer.isPlayer ? observer.game?.settings?.fov || 95 : 110);
  const aspect = options.aspect ?? (observer.isPlayer ? observer.game?.aspect || 16 / 9 : 16 / 9);
  const halfH = Math.min(89, fov / 2) * DEG;
  const halfV = Math.atan(Math.tan(halfH) / aspect);
  const yaw = options.yaw ?? observer.yaw, pitch = options.pitch ?? observer.pitch ?? 0;
  const maxDistance = options.range ?? 45;
  for (const k of [.23, .55, .86]) {
    point.set(target.pos.x, target.pos.y + height * k, target.pos.z);
    delta.copy(point).sub(eye);
    const dist = delta.length(); if (dist > maxDistance || dist < .02) continue;
    const horizontal = Math.hypot(delta.x, delta.z);
    const a = Math.atan2(delta.x, delta.z) - yaw;
    const h = Math.abs(Math.atan2(Math.sin(a), Math.cos(a)));
    const pad = Math.asin(Math.min(.9, (target.radius || .3) / dist));
    if (h > halfH + pad) continue;
    const vertical = Math.atan2(delta.y, Math.max(.001, horizontal));
    if (Math.abs(vertical - pitch) > halfV + pad) continue;
    if (!world?.blocked?.(eye, point)) return true;
  }
  return false;
}
export function shadowStep(attacker, victim, world = attacker?.game?.world) {
  if (!attacker?.alive || !victim?.alive || victim.state !== 'air' || victim.onGround || victim.hasEffect?.('blind')) return false;
  if (attacker.pos.distanceTo(victim.pos) > 4.5) return false;
  if (world?.blocked?.(victim.eyePos(new THREE.Vector3()), attacker.center(new THREE.Vector3()))) return false;
  return !visibleTo(victim, attacker, world);
}
export function incomingFromFront(attacker, victim, hit, degrees = 60) {
  victim.eyePos(eye);
  if (hit.incomingDir) delta.copy(hit.incomingDir).negate();
  else if (hit.origin) delta.copy(hit.origin).sub(eye);
  else delta.copy(attacker.eyePos(point)).sub(eye);
  if (delta.lengthSq() < 1e-8) return false;
  delta.normalize();
  const pitch = victim.pitch || 0, cp = Math.cos(pitch);
  point.set(Math.sin(victim.yaw) * cp, Math.sin(pitch), Math.cos(victim.yaw) * cp);
  return point.dot(delta) >= Math.cos(degrees * DEG);
}
export function sandBlinds(attacker, victim, hit, world = victim?.game?.world) {
  const contact = hit.contact;
  if (!contact || contact.region !== 'head' || victim.lookData?.glasses || victim.cls?.sandImmune) return false;
  // 沙子触到头部不等于触到眼睛；转头/俯仰让眼睛离开来沙方向就能规避。
  const toward = new THREE.Vector3();
  if (hit.incomingDir) toward.copy(hit.incomingDir).negate();
  else if (hit.origin) toward.copy(hit.origin).sub(victim.eyePos(new THREE.Vector3()));
  else {
    toward.copy(attacker.pos).sub(victim.pos);
    toward.y = attacker.pos.y + attacker.height * .85 - (victim.pos.y + victim.height * .88);
  }
  toward.normalize();
  const cp = Math.cos(victim.pitch || 0);
  const facing = new THREE.Vector3(Math.sin(victim.yaw) * cp, Math.sin(victim.pitch || 0), Math.cos(victim.yaw) * cp);
  if (facing.dot(toward) < Math.cos(48 * DEG)) return false;
  if (contact.point && world?.blocked?.(hit.origin || attacker.eyePos(new THREE.Vector3()), contact.point)) return false;
  return true;
}
