// 枪系飞枪/飞炮取自原著；具体冲量、重力与镜头幅度是本作平衡值。
// 独立分类防止法术、召唤兽和投掷物被误当成枪弹。
import { clamp, DEG } from '../engine/util.js';

const PISTOL = Object.freeze({ gravity: 9.8, ground: .14, air: 2.2, lift: 1.35, pitch: .48, yaw: .08 });
const RIFLE = Object.freeze({ gravity: 9.8, ground: .3, air: 3.7, lift: 1.8, pitch: .68, yaw: .11 });
const CANNON = Object.freeze({ gravity: 4.5, ground: 2.4, air: 7.6, lift: 4, pitch: 1.8, yaw: .16 });
const LASER = Object.freeze({ gravity: 0, ground: 3, air: 8.2, lift: 4.3, pitch: 1.65, yaw: .05 });

export function gunProfile(att, p, def = {}) {
  if (!att || p.summon || p.chaser || p.fromHand) return null;
  const gun = att.clsId === 'sharpshooter' || att.clsId === 'launcher' || att.clsId === 'unspecialized' && (att.form === 'gun' || def.form === 'gun');
  if (!gun) return null;
  if (p.kind === 'beam') return att.clsId === 'launcher' ? LASER : null;
  if (p.kind === 'shell') return CANNON;
  if (p.kind !== 'bullet') return null;
  return att.clsId === 'sharpshooter' ? PISTOL : RIFLE;
}

export function gunProjectile(att, p, def) {
  const profile = gunProfile(att, p, def);
  if (!profile) return p;
  return { ...p, gravity: p.gravity > 0 ? p.gravity : profile.gravity, ballisticGun: true };
}

export function applyGunRecoil(game, att, p, def, dir, { physics = true, view = true } = {}) {
  const profile = gunProfile(att, p, def);
  if (!profile || att.dead || !dir) return null;
  const now = game.time || 0;
  // A fan of pellets in one physics step is one discharge, not twelve kicks.
  const feedbackKey = physics ? '_gunFeedback' : '_gunViewFeedback';
  const previous = att[feedbackKey];
  if (previous && Math.abs(previous.time - now) < 1 / 120) return null;
  const serial = (previous?.serial || 0) + 1;
  att[feedbackKey] = { time: now, serial };
  const grounded = !!att.onGround;
  const charge = 1 + clamp(att.action?.chargeFrac || 0, 0, 1) * .3;
  const braced = grounded && (att.moveInput?.y || 0) < -.2 ? .55 : 1;
  const strength = (grounded ? Math.max(profile.ground, (def.recoil || 0) * 1.5) * braced : profile.air) * charge;
  if (physics && !game.netGuest && !att.movementLocked?.()) {
    att.knockVel.x -= dir.x * strength;
    att.knockVel.z -= dir.z * strength;
    const horizontal = Math.hypot(att.knockVel.x, att.knockVel.z);
    if (horizontal > 18) { att.knockVel.x *= 18 / horizontal; att.knockVel.z *= 18 / horizontal; }
    if (!grounded) {
      const push = -dir.y * profile.lift * charge;
      const ceiling = Math.max(att.vel.y, 8);
      att.vel.y = Math.min(ceiling, att.vel.y + push);
    }
  }
  // Suppress legacy recoil even while rooted; otherwise its horizontal push
  // would bypass the movement lock we just respected.
  if (physics && !game.netGuest && att.action) att.action.recoiled = true;
  const aimed = att.aiming ? .62 : 1;
  const kick = { pitch: profile.pitch * aimed * charge * DEG, yaw: profile.yaw * aimed * (serial % 2 ? 1 : -1) * DEG, heat: p.kind === 'shell' || p.kind === 'beam' ? 1 : .35 };
  if (view && att === game.player) {
    game.viewPitch = clamp(game.viewPitch + kick.pitch, -85 * DEG, 85 * DEG);
    game.viewYaw += kick.yaw;
    game.shotHeat = Math.min(1.7, (game.shotHeat || 0) + kick.heat);
    game.shotRoll = (game.shotRoll || 0) + kick.yaw * .65;
  }
  return kick;
}
