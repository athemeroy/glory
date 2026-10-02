// 扫把掌握：原著的职业被动；时长、速度与体力是本作平衡值。
import { hasStatusFlag } from './statuses.js';
import { spendStamina } from './stamina.js';

export const BROOM_FLIGHT = Object.freeze({ maxDuration: 5.5, maxHeight: 4.2,
  startCost: 8, drain: 14, rise: 3.1, descend: .85, speed: 1.2 });

export function createFlight() {
  return { active: false, used: false, elapsed: 0, floor: 0, reason: '',
    maxDuration: BROOM_FLIGHT.maxDuration, maxHeight: BROOM_FLIGHT.maxHeight };
}
export function flightBlocked(f) {
  return f.dead || f.stunT > 0 || hasStatusFlag(f, 'actionLock') ||
    hasStatusFlag(f, 'movementLock') || hasStatusFlag(f, 'skillLock') || f.hasEffect('fear') ||
    ['air', 'down', 'getup', 'hitstun', 'stun', 'dead', 'tech'].includes(f.state);
}
export function startFlight(f) {
  if (f.clsId !== 'witch' || f.onGround || f.flight.active || f.flight.used || flightBlocked(f)) return false;
  if (!spendStamina(f, BROOM_FLIGHT.startCost, 'flight')) return false;
  Object.assign(f.flight, { active: true, used: true, elapsed: 0, reason: '',
    floor: f.flightTakeoffY ?? f.game.world.floorHeight(f.pos.x, f.pos.z, f.pos.y) });
  f.vel.y = Math.max(0, Math.min(f.vel.y, BROOM_FLIGHT.rise));
  f.emit('flight', { active: true });
  return true;
}
export function stopFlight(f, reason = 'cancel') {
  if (!f.flight?.active) return;
  f.flight.active = false; f.flight.reason = reason;
  // 中断不能保留飞行冲刺的悬浮重力豁免。
  f.flyT = 0; f.flyVel = null;
  if (reason !== 'land' && reason !== 'hit') f.vel.y = Math.min(f.vel.y, 0);
  f.emit('flight', { active: false, reason });
}
export function updateFlight(f, dt) {
  const b = f.flight;
  if (!b || f.clsId !== 'witch') return;
  if (f.onGround) {
    stopFlight(f, 'land'); b.used = false; b.elapsed = 0;
    f.flightTakeoffY = f.pos.y;
    return;
  }
  if (!b.active) return;
  if (flightBlocked(f)) { stopFlight(f, 'control'); return; }
  const remaining = Math.max(0, b.maxDuration - b.elapsed), elapsed = Math.min(dt, remaining);
  b.elapsed += elapsed;
  const cost = BROOM_FLIGHT.drain * elapsed;
  if (f.stamina + 1e-6 < cost) { f.stamina = 0; stopFlight(f, 'stamina'); return; }
  f.stamina = Math.max(0, f.stamina - cost); f.staminaDelay = .35; f.sprinting = false;
  if (b.elapsed + 1e-7 >= b.maxDuration) { stopFlight(f, 'duration'); return; }
  // 飞行上限锁定本次起跳地面；在山坡/屋顶上方滑行不会不断抬高上限。
  const target = f.jumpHeld ? BROOM_FLIGHT.rise : -BROOM_FLIGHT.descend;
  f.vel.y += (target - f.vel.y) * (1 - Math.exp(-10 * dt));
  f.vel.y = Math.min(f.vel.y, Math.max(0, b.floor + b.maxHeight - f.pos.y) / Math.max(dt, 1e-5));
}

export function flightSnapshot(f) {
  if (f.clsId !== 'witch') return undefined;
  return [f.flight.active ? 1 : 0, f.flight.used ? 1 : 0, +f.flight.elapsed.toFixed(2), +f.flight.floor.toFixed(2), f.flight.reason];
}
export function applyFlightSnapshot(f, snap) {
  if (f.clsId !== 'witch') return;
  if (!snap) { Object.assign(f.flight, createFlight()); return; }
  Object.assign(f.flight, { active: !!snap[0], used: !!snap[1], elapsed: snap[2], floor: snap[3], reason: snap[4] || '' });
}
