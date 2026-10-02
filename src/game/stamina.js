// 体力独立于法力：只承担通用移动，数值为本项目平衡配置。
export const STAMINA_COST = Object.freeze({ jump: 12, dash: 22, tech: 18 });
const CAPACITY = Object.freeze({ battlemage: 115, striker: 110, berserker: 120, assassin: 100, swordmaster: 105, thug: 105, launcher: 95, sharpshooter: 95, warlock: 85, cleric: 85, witch: 90, frostcaster: 85, unspecialized: 100 });
export function staminaProfile(clsId, cls = {}) {
  return { max: cls.stamina ?? CAPACITY[clsId] ?? 100, regen: cls.staminaRegen ?? 20, sprintDrain: cls.sprintDrain ?? 21, sprintSpeed: cls.sprintSpeed ?? 1.45 };
}
export function spendStamina(f, amount, action = '') {
  if (f.kind === 'dummy' || f.kind === 'boss' || f.kind === 'mob') return true;
  if (f.stamina + 1e-6 < amount) {
    if (f.isPlayer && (f.staminaNoticeT || 0) <= 0) { f.emit('nostamina', { action }); f.staminaNoticeT = .65; }
    return false;
  }
  f.stamina = Math.max(0, f.stamina - amount); f.staminaDelay = .35;
  return true;
}
export function updateStamina(f, dt) {
  f.staminaNoticeT = Math.max(0, (f.staminaNoticeT || 0) - dt);
  const moving = f.moveInput.lengthSq() > .04;
  const ready = f.state === 'idle' || f.state === 'move';
  const blocked = f.dead || f.guarding || f.aiming || f.movementLocked?.() || f.hasEffect('fear');
  // 耗尽后必须恢复至少一个动作的余量再开始疾跑，避免1帧疾跑/1帧走路抖动。
  if (f.stamina <= .001) f.staminaExhausted = true;
  if (f.stamina >= STAMINA_COST.jump) f.staminaExhausted = false;
  f.sprinting = !!f.wantSprint && moving && ready && f.onGround && !blocked && !f.staminaExhausted;
  if (f.sprinting) {
    const drain = f.staminaSpec.sprintDrain * dt;
    f.stamina = Math.max(0, f.stamina - drain); f.staminaDelay = .35;
    if (!f.stamina) { f.staminaExhausted = true; f.sprinting = false; }
  } else {
    f.staminaDelay = Math.max(0, (f.staminaDelay || 0) - dt);
    if (!f.staminaDelay && !f.dead) f.stamina = Math.min(f.maxStamina, f.stamina + f.staminaSpec.regen * dt * (f.onGround ? 1 : .5));
  }
}
