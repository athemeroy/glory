// Shared body and attack volumes. Distances are metres in world space; armour,
// capes, hair and weapon ornaments are deliberately outside the hurt volumes.
import * as THREE from 'three';
import { clamp, DEG } from '../engine/util.js';

const EPS = 1e-8;
const DEFAULT_PROFILE = Object.freeze({
  height: 1.8, radius: 0.28, headRadius: 0.145, torsoRadius: 0.19,
  hipRadius: 0.18, limbRadius: 0.07, shoulderWidth: 0.43,
  downHeight: 0.45, eyeHeight: 1.62, reach: 0.62,
});

export function characterProfile(f) {
  const measured = f.mocapBody?.shape || f.collisionProfile || f.cls?.collision || {};
  const build = f.lookData?.build || f.cls?.look?.build || 1;
  const feminine = (f.lookData?.sex || f.cls?.look?.sex) === 'f';
  const width = build * (feminine ? 0.9 : 1);
  const result = { ...DEFAULT_PROFILE, radius: DEFAULT_PROFILE.radius * width,
    torsoRadius: DEFAULT_PROFILE.torsoRadius * width,
    hipRadius: DEFAULT_PROFILE.hipRadius * width,
    shoulderWidth: DEFAULT_PROFILE.shoulderWidth * width,
    limbRadius: DEFAULT_PROFILE.limbRadius * width, ...measured };
  for (const [key, value] of Object.entries(DEFAULT_PROFILE)) {
    if (!Number.isFinite(result[key]) || result[key] <= 0) result[key] = value;
  }
  return result;
}

function capsule(region, a, b, radius) { return { region, a, b, radius }; }
function point(x, y, z) { return new THREE.Vector3(x, y, z); }

// Return the simulated pose, never a renderer's interpolated skin mesh. Bones
// give disjoint head/torso/limb volumes, so a shot through empty space beside a
// shoulder or between the legs no longer hits a full-height cylinder.
export function hurtCapsules(f) {
  if (f.customHurtCapsules) return f.customHurtCapsules();
  const profile = characterProfile(f), scale = f.scale || 1;
  const bones = f.mocapBody?.bones || f.rig?.bones;
  const root = f.rig?.root;
  if (root) {
    root.position.copy(f.pos); root.rotation.y = f.yaw || 0;
    root.updateWorldMatrix(true, true);
  }
  const mocap = !!f.mocapBody;
  const names = mocap ? {
    hips: 'Hips', chest: profile.chestBone || 'Spine', neck: 'Neck', head: 'Head',
    armL: 'LeftArm', elbowL: 'LeftForeArm', handL: 'LeftHand',
    armR: 'RightArm', elbowR: 'RightForeArm', handR: 'RightHand',
    thighL: 'LeftUpLeg', kneeL: 'LeftLeg', footL: 'LeftFoot',
    thighR: 'RightUpLeg', kneeR: 'RightLeg', footR: 'RightFoot',
  } : {
    hips: 'hips', chest: 'chest', neck: 'neck', head: 'head',
    armL: 'shL', elbowL: 'elL', handL: 'haL', armR: 'shR', elbowR: 'elR', handR: 'haR',
    thighL: 'thL', kneeL: 'knL', footL: 'ftL', thighR: 'thR', kneeR: 'knR', footR: 'ftR',
  };
  const positions = {};
  if (bones) for (const [key, name] of Object.entries(names)) {
    const bone = bones[name] || (key === 'chest' && (bones.Spine01 || bones.Spine02)) || (key === 'neck' && bones.neck);
    if (bone) positions[key] = bone.getWorldPosition(new THREE.Vector3());
  }
  if (!positions.hips || !positions.chest || !positions.head) return fallbackCapsules(f, profile);

  const caps = [];
  const add = (region, from, to, radius) => {
    if (positions[from] && positions[to]) caps.push(capsule(region, positions[from].clone(), positions[to].clone(), radius * scale));
  };
  const spine = mocap && profile.spineBones?.map(name => bones[name]).filter(Boolean);
  if (spine?.length) {
    let from = positions.hips;
    for (const bone of spine) {
      const to = bone.getWorldPosition(new THREE.Vector3());
      caps.push(capsule('torso', from.clone(), to.clone(), profile.torsoRadius * scale));
      from = to;
    }
  } else add('torso', 'hips', 'chest', profile.torsoRadius);
  // The joint at the top of the ribcage still sits below the collarbones.
  // Extend to the true neck so visible upper chest remains hittable.
  if (positions.neck) {
    const top = positions.chest.clone().lerp(positions.neck, 0.8);
    caps.push(capsule('torso', positions.chest.clone(), top, profile.torsoRadius * scale));
  }
  caps.push(capsule('hips', positions.hips.clone(), positions.hips.clone(), profile.hipRadius * scale));
  add('neck', 'chest', 'neck', Math.min(profile.headRadius * 0.55, profile.torsoRadius * 0.5));
  const head = bones[names.head];
  let hc;
  if (mocap && Array.isArray(profile.headOffset)) hc = head.localToWorld(new THREE.Vector3(...profile.headOffset));
  else {
    // Procedural Head is near the jaw. The local up axis is also valid after a
    // knockdown, so its head sphere follows the actual falling body.
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(head.getWorldQuaternion(new THREE.Quaternion()));
    hc = positions.head.clone().addScaledVector(up, profile.headRadius * scale * 0.4);
  }
  caps.push(capsule('head', hc, hc.clone(), profile.headRadius * scale));
  const armRadius = profile.armRadius || profile.limbRadius;
  const legRadius = profile.legRadius || profile.limbRadius * 1.1;
  for (const side of ['L', 'R']) {
    add('shoulder', 'chest', 'arm' + side, armRadius * 1.25);
    add('arm', 'arm' + side, 'elbow' + side, armRadius);
    add('forearm', 'elbow' + side, 'hand' + side, armRadius * 0.85);
    if (positions['hand' + side]) caps.push(capsule('hand', positions['hand' + side].clone(), positions['hand' + side].clone(), armRadius * 0.95 * scale));
    add('thigh', 'thigh' + side, 'knee' + side, legRadius * 1.18);
    add('leg', 'knee' + side, 'foot' + side, legRadius);
    if (positions['foot' + side]) caps.push(capsule('foot', positions['foot' + side].clone(), positions['foot' + side].clone(), legRadius * 1.05 * scale));
  }
  return caps;
}

function fallbackCapsules(f, p) {
  const s = f.scale || 1, h = f.height || p.height * s, x = f.pos.x, y = f.pos.y, z = f.pos.z;
  const r = f.radius || p.radius * s;
  const forward = point(Math.sin(f.yaw || 0), 0, Math.cos(f.yaw || 0));
  const right = point(forward.z, 0, -forward.x);
  const local = (side, up, front = 0) => point(x, y + up, z).addScaledVector(right, side).addScaledVector(forward, front);
  if (f.state === 'down' || f.state === 'dead') {
    const low = Math.min((f.downHeight || p.downHeight * s) * 0.5, p.torsoRadius * s + 0.05);
    return [capsule('torso', local(0, low, -0.35 * s), local(0, low, 0.35 * s), p.torsoRadius * s),
      capsule('head', local(0, low, -0.6 * s), local(0, low, -0.6 * s), p.headRadius * s),
      capsule('leg', local(0.1 * s, low, 0.35 * s), local(0.1 * s, low, 0.8 * s), p.limbRadius * s),
      capsule('leg', local(-0.1 * s, low, 0.35 * s), local(-0.1 * s, low, 0.8 * s), p.limbRadius * s)];
  }
  const gettingUp = f.state === 'getup' ? clamp((f.stateT || 0) / 0.45, 0.15, 1) : 1;
  const ch = h * gettingUp;
  return [capsule('torso', local(0, ch * 0.48), local(0, ch * 0.74), Math.min(p.torsoRadius * s, r)),
    capsule('head', local(0, ch - p.headRadius * s), local(0, ch - p.headRadius * s), p.headRadius * s),
    capsule('arm', local(p.shoulderWidth * s / 2, ch * 0.77), local(p.shoulderWidth * s / 2, ch * 0.48), p.limbRadius * s),
    capsule('arm', local(-p.shoulderWidth * s / 2, ch * 0.77), local(-p.shoulderWidth * s / 2, ch * 0.48), p.limbRadius * s),
    capsule('leg', local(0.1 * s, p.limbRadius * s), local(0.1 * s, ch * 0.49), p.limbRadius * s * 1.1),
    capsule('leg', local(-0.1 * s, p.limbRadius * s), local(-0.1 * s, ch * 0.49), p.limbRadius * s * 1.1)];
}

export function closestPointOnSegment(p, a, b, out = new THREE.Vector3()) {
  const ab = b.clone().sub(a), den = ab.lengthSq();
  return out.copy(a).addScaledVector(ab, den > EPS ? clamp(p.clone().sub(a).dot(ab) / den, 0, 1) : 0);
}

export function segmentDistance(a0, a1, b0, b1) {
  const u = a1.clone().sub(a0), v = b1.clone().sub(b0), w = a0.clone().sub(b0);
  const aa = u.dot(u), bb = u.dot(v), cc = v.dot(v), dd = u.dot(w), ee = v.dot(w);
  let s = 0, t = 0;
  if (aa <= EPS && cc <= EPS) return { distance: a0.distanceTo(b0), a: a0.clone(), b: b0.clone() };
  if (aa <= EPS) t = clamp(ee / cc, 0, 1);
  else if (cc <= EPS) s = clamp(-dd / aa, 0, 1);
  else {
    const den = aa * cc - bb * bb;
    s = den > EPS ? clamp((bb * ee - cc * dd) / den, 0, 1) : 0;
    t = (bb * s + ee) / cc;
    if (t < 0) { t = 0; s = clamp(-dd / aa, 0, 1); }
    else if (t > 1) { t = 1; s = clamp((bb - dd) / aa, 0, 1); }
  }
  const ap = a0.clone().addScaledVector(u, s), bp = b0.clone().addScaledVector(v, t);
  return { distance: ap.distanceTo(bp), a: ap, b: bp };
}

function sphereEntry(start, delta, center, radius) {
  const oc = start.clone().sub(center), aa = delta.lengthSq(), cc = oc.lengthSq() - radius * radius;
  if (cc <= 0) return 0;
  if (aa <= EPS) return null;
  const bb = oc.dot(delta), disc = bb * bb - aa * cc;
  if (disc < -EPS) return null;
  const t = (-bb - Math.sqrt(Math.max(0, disc))) / aa;
  return t >= -EPS && t <= 1 + EPS ? clamp(t, 0, 1) : null;
}

// First contact with a finite capsule; no endpoint stepping and no centre
// projection approximation. A fast bullet cannot skip a thin limb.
export function segmentCapsule(start, end, cap, padding = 0) {
  const d = end.clone().sub(start), axis = cap.b.clone().sub(cap.a), oa = start.clone().sub(cap.a);
  const radius = cap.radius + Math.max(0, padding), axisSq = axis.lengthSq();
  const nearest = closestPointOnSegment(start, cap.a, cap.b);
  let fraction = start.distanceToSquared(nearest) <= radius * radius ? 0 : null;
  if (axisSq > EPS && fraction === null) {
    const ad = axis.dot(d), ao = axis.dot(oa);
    const aa = axisSq * d.lengthSq() - ad * ad;
    const bb = axisSq * oa.dot(d) - ao * ad;
    const cc = axisSq * oa.lengthSq() - ao * ao - radius * radius * axisSq;
    const disc = bb * bb - aa * cc;
    if (aa > EPS && disc >= -EPS) {
      const t = (-bb - Math.sqrt(Math.max(0, disc))) / aa;
      const along = ao + t * ad;
      if (t >= -EPS && t <= 1 + EPS && along >= 0 && along <= axisSq) fraction = clamp(t, 0, 1);
    }
  }
  for (const center of [cap.a, cap.b]) {
    const t = sphereEntry(start, d, center, radius);
    if (t !== null && (fraction === null || t < fraction)) fraction = t;
  }
  if (fraction === null) return null;
  const center = start.clone().addScaledVector(d, fraction);
  const onAxis = closestPointOnSegment(center, cap.a, cap.b);
  const normal = center.clone().sub(onAxis);
  if (normal.lengthSq() < EPS) normal.copy(d).negate();
  if (normal.lengthSq() < EPS) normal.set(0, 1, 0);
  normal.normalize();
  return { fraction, point: center.clone().addScaledVector(normal, -padding), center, normal, region: cap.region };
}

export function segmentHitCharacter(start, end, f, padding = 0, capsules = null) {
  let best = null;
  for (const cap of capsules || hurtCapsules(f)) {
    const hit = segmentCapsule(start, end, cap, padding);
    if (hit && (!best || hit.fraction < best.fraction - EPS || Math.abs(hit.fraction - best.fraction) < EPS && hit.region === 'head')) best = hit;
  }
  if (best) best.fighter = f;
  return best;
}

export function sphereContact(pos, radius, f, capsules = null) {
  let best = null;
  for (const cap of capsules || hurtCapsules(f)) {
    const axis = closestPointOnSegment(pos, cap.a, cap.b);
    const distance = axis.distanceTo(pos) - cap.radius;
    if (distance > radius) continue;
    if (!best || distance < best.distance) {
      const normal = pos.clone().sub(axis).normalize();
      best = { point: axis.clone().addScaledVector(normal, cap.radius), normal, region: cap.region, distance, fighter: f };
    }
  }
  return best;
}

export function cylinderContact(pos, radius, height, f, capsules = null, bottom = 0) {
  let best = null;
  for (const cap of capsules || hurtCapsules(f)) {
    const low = Math.min(cap.a.y, cap.b.y) - cap.radius, high = Math.max(cap.a.y, cap.b.y) + cap.radius;
    if (high < pos.y + bottom || low > pos.y + height) continue;
    // Clip the capsule axis to the cylinder's finite height before testing XZ.
    const aa = cap.a.clone(), bb = cap.b.clone();
    if (Math.abs(bb.y - aa.y) > EPS) {
      const t0 = (pos.y + bottom - cap.radius - aa.y) / (bb.y - aa.y);
      const t1 = (pos.y + height + cap.radius - aa.y) / (bb.y - aa.y);
      const from = clamp(Math.min(t0, t1), 0, 1), to = clamp(Math.max(t0, t1), 0, 1);
      aa.lerp(cap.b, from); bb.copy(cap.a).lerp(cap.b, to);
    }
    const flat = point(pos.x, 0, pos.z), aFlat = point(aa.x, 0, aa.z), bFlat = point(bb.x, 0, bb.z);
    const near = closestPointOnSegment(flat, aFlat, bFlat), distance = near.distanceTo(flat) - cap.radius;
    if (distance > radius) continue;
    if (!best || distance < best.distance) {
      const along = aFlat.distanceToSquared(bFlat) > EPS ? clamp(near.clone().sub(aFlat).dot(bFlat.clone().sub(aFlat)) / aFlat.distanceToSquared(bFlat), 0, 1) : 0;
      const cp = aa.clone().lerp(bb, along); cp.y = clamp(cp.y, pos.y + bottom, pos.y + height);
      best = { point: cp, normal: cp.clone().sub(pos).normalize(), distance, region: cap.region, fighter: f };
    }
  }
  return best;
}

export function attackKind(h, def, att) {
  const explicit = typeof h.shape === 'string' ? h.shape : h.shape?.kind;
  if (explicit) return explicit;
  const anim = def.altAnims?.[att.action?.animIdx || 0] || def.anim || '';
  if (def.slamOnLand) return 'ground';
  if (/^cast/.test(anim)) return (h.arc || 0) >= 359 ? 'sphere' : 'cone';
  if (def.flyDash || def.vfx === 'bash') return 'body';
  if (anim === 'stomp') return 'stomp';
  if (/kick|lowSweep/i.test(anim)) return 'kick';
  if (/punch|uppercut|palm|grab/.test(anim)) return 'fist';
  if (/thrust/i.test(anim)) return 'thrust';
  return 'blade';
}

export function attackWindow(h, def, index = 0) {
  const next = def.hits?.[index + 1]?.t ?? def.active ?? 100;
  const available = Math.max(1, Math.min(next, def.active ?? next) - (h.t || 0));
  return Math.min(available, h.window ?? available);
}

export function attackSegments(att, h, def) {
  const kind = attackKind(h, def, att), scale = att.scale || 1;
  const bones = att.mocapBody?.bones || att.rig?.bones;
  const mocap = !!att.mocapBody, root = att.rig?.root;
  if (root) { root.position.copy(att.pos); root.rotation.y = att.yaw || 0; root.updateWorldMatrix(true, true); }
  const clip = def.altAnims?.[att.action?.animIdx || 0] || def.anim || '';
  const position = (name, procedural, fallback) => (bones?.[mocap ? name : procedural]?.getWorldPosition(new THREE.Vector3()) || fallback.clone());
  const chest = att.pos.clone().add(point(0, (att.height || 1.8 * scale) * 0.65, 0));
  // The authored palm action leads with its free left hand. A grab can close
  // either hand around the target; using only RightHand missed real left palms.
  const side = h.hand === 'left' || /punchL|^palm$/.test(clip) ? 'Left' : 'Right';
  const hand = position(side + 'Hand', side === 'Left' ? 'haL' : 'haR', chest);
  const elbow = position(side + 'ForeArm', side === 'Left' ? 'elL' : 'elR', hand);
  if (kind === 'fist') {
    const segments=[{a:elbow,b:hand,radius:(h.hitRadius ?? 0.105)*scale,part:side+'Forearm'}];
    if(clip==='grab') segments.push({a:position('LeftForeArm','elL',elbow),
      b:position('LeftHand','haL',hand),radius:(h.hitRadius ?? 0.105)*scale,part:'LeftForearm'});
    return segments;
  }
  if (kind === 'kick' || kind === 'stomp') {
    const segments = [];
    // Certified source clips: Lunge_Spin_Kick attacks with LeftFoot;
    // Roundhouse_Kick and Leg_Sweep attack with RightFoot. The supporting
    // planted foot must not manufacture a low kick while the other leg is high.
    const sides = h.leg === 'both' ? ['Left','Right'] : [h.leg === 'left' ||
      h.leg !== 'right' && clip === 'spinkick' ? 'Left' : 'Right'];
    for (const s of sides) {
      const foot = position(s + 'Foot', s === 'Left' ? 'ftL' : 'ftR', att.pos);
      const knee = position(s + 'Leg', s === 'Left' ? 'knL' : 'knR', foot);
      segments.push({ a: knee, b: foot, radius: (h.hitRadius ?? 0.115) * scale,part:s+'Shin' });
    }
    return segments;
  }
  if (kind === 'body') {
    // Imported Spine02 can sit at the abdomen. Shoulder charges also use the
    // actual upper chest, shoulder and head; a low belly-only cylinder missed
    // bodies that visibly collided during Iron Mountain / aerial charges.
    const segments = hurtCapsules(att).filter(c => def.flyDash || ['torso','hips','shoulder','arm','head'].includes(c.region))
      .map((c,i) => ({a:c.a,b:c.b,radius:c.radius,part:'body:'+i+':'+c.region}));
    if (att.leftWeapon && ['axe','knight'].includes(att.weapon?.type)) {
      const shield=att.leftWeapon, tower=att.weapon.type==='axe';
      for (const x of [-.2,0,.2]) segments.push({
        a:shield.localToWorld(point(x,tower ? -.3 : -.2,tower ? .12 : .08)),
        b:shield.localToWorld(point(x,tower ? .5 : .3,tower ? .12 : .08)),radius:.035*scale,part:'shield:'+x});
    }
    if (att.form==='shield' && att.weapon?.obj) {
      const canopy=att.weapon.obj.children.find(c=>c.material?.userData?.canopy);
      if (canopy) {
        const apex=canopy.localToWorld(point(0,.5,0));
        for(let i=0;i<8;i++) segments.push({a:apex.clone(),
          b:canopy.localToWorld(point(Math.cos(i*Math.PI/4),-.5,Math.sin(i*Math.PI/4))),radius:.055*scale,part:'canopy:'+i});
      }
    }
    return segments;
  }
  if (att.weapon?.base && att.weapon?.tip) {
    const a = att.weapon.base.getWorldPosition(new THREE.Vector3()), b = att.weapon.tip.getWorldPosition(new THREE.Vector3());
    const type = att.weapon.type;
    const obj = att.weapon.obj;
    // Markers are trail anchors, sometimes halfway along a weapon. Contact
    // starts at the actual metal/wood instead of deleting its lower half.
    const bladeStart = { sword: 0.075, greatsword: 0.2, dagger: 0.05, club: -0.09, knight: 0.08,
      broom: -0.35 }[type];
    if (obj && bladeStart !== undefined) a.copy(obj.localToWorld(new THREE.Vector3(0, bladeStart, 0)));
    // A spear sweep can contact its shaft. A thrust still uses its pointed end.
    if (kind === 'blade' && (/spear/.test(att.weapon.type || att.form || '') || type === 'umbrella')) a.copy(hand);
    const segments = [{ a, b, radius: (h.hitRadius ?? h.shape?.radius ?? (/greatsword|axe|club/.test(att.weapon.type || '') ? 0.095 : 0.055)) * scale,part:'weapon:'+type }];
    if (kind === 'blade' && obj && ['sword', 'greatsword', 'knight', 'dagger'].includes(type)) {
      const y = type === 'greatsword' ? 0.18 : type === 'dagger' ? 0.045 : 0.065;
      const halfWidth = type === 'greatsword' ? 0.17 : type === 'dagger' ? 0.04 : 0.1;
      segments.push({ a: obj.localToWorld(new THREE.Vector3(-halfWidth, y, 0)),
        b: obj.localToWorld(new THREE.Vector3(halfWidth, y, 0)), radius: 0.025 * scale,part:'guard:'+type });
      segments.push({ a: obj.localToWorld(new THREE.Vector3(0, type === 'greatsword' ? -0.17 : -0.12, 0)),
        b: obj.localToWorld(new THREE.Vector3(0, y, 0)), radius: 0.025 * scale,part:'hilt:'+type });
    }
    if (type === 'dagger' && att.leftWeapon) {
      // Both rendered daggers are physical during a strike. The left model has
      // no trail markers, but shares the actual blade's local coordinates.
      segments.push({ a: att.leftWeapon.localToWorld(new THREE.Vector3(0, 0.05, 0)),
        b: att.leftWeapon.localToWorld(new THREE.Vector3(0, 0.33, 0)), radius: 0.035 * scale,part:'left-dagger' });
    }
    if (kind === 'blade' && type === 'axe' && obj) {
      segments.push({ a: obj.localToWorld(new THREE.Vector3(0.47, 0.8, 0)),
        b: obj.localToWorld(new THREE.Vector3(0.47, 1.2, 0)), radius: 0.055 * scale,part:'axe-edge' });
    }
    if (kind === 'blade' && type === 'broom' && obj) {
      segments.push({ a: obj.localToWorld(new THREE.Vector3(0, -0.75, 0)),
        b: obj.localToWorld(new THREE.Vector3(0, -0.35, 0)), radius: 0.085 * scale,part:'broom-base' });
    }
    return segments;
  }
  // Models loading late retain precise aimed capsules instead of a broad fan.
  const yaw = att.yaw, pitch = att.pitch ?? 0;
  const dir = point(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
  return [{ a: hand, b: hand.clone().addScaledVector(dir, Math.min(h.range || 1, 1.2) * scale), radius: 0.09 * scale,part:'fallback:'+side }];
}

export function sweptMeleeContact(previous, current, target, from = 0, to = 1, capsules = null) {
  let best = null;
  const caps = capsules || hurtCapsules(target);
  for (let i = 0; i < current.length; i++) {
    const now = current[i], before = (now.part ? previous?.find(s=>s.part===now.part) : previous?.[i]) || now;
    const distance = Math.max(before.a.distanceTo(now.a), before.b.distanceTo(now.b));
    // Adaptive sampling of the swept blade surface, bounded by small enough
    // gaps to catch a hand or forearm even during a fast dash/spinning slash.
    const steps = Math.max(1, Math.min(32, Math.ceil(distance * (to - from) / Math.max(0.035, now.radius * 0.65))));
    for (let j = 0; j <= steps; j++) {
      const time = from + (to - from) * j / steps;
      const a = before.a.clone().lerp(now.a, time), b = before.b.clone().lerp(now.b, time);
      for (const cap of caps) {
        const nearest = segmentDistance(a, b, cap.a, cap.b);
        if (nearest.distance > now.radius + cap.radius) continue;
        const normal = nearest.a.clone().sub(nearest.b).normalize();
        const hit = { point: nearest.b.clone().addScaledVector(normal, cap.radius), normal, region: cap.region, fraction: time, fighter: target };
        if (!best || time < best.fraction) best = hit;
      }
      if (best) break;
    }
  }
  return best;
}

export function rangedMeleeContact(att, target, h, def, capsules = null) {
  const kind = attackKind(h, def, att), scale = att.scale || 1;
  const r = (h.range || 2) * scale;
  let caps = capsules || hurtCapsules(target);
  if (h.h) {
    const low = att.pos.y + h.h[0] * scale, high = att.pos.y + h.h[1] * scale;
    caps = caps.filter(c => Math.max(c.a.y,c.b.y) + c.radius >= low && Math.min(c.a.y,c.b.y) - c.radius <= high);
  }
  if (kind === 'ground' || kind === 'cylinder') {
    return cylinderContact(att.pos, r, h.shape?.height ?? h.height ?? 0.85 * scale, target, caps, h.shape?.bottom ?? -0.1 * scale);
  }
  const origin = att.pos.clone().add(point(0, (att.height || 1.8 * scale) * 0.65, 0));
  if (kind === 'sphere') return sphereContact(origin, r, target, caps);
  if (kind !== 'cone') return null;
  const yaw = att.yaw, pitch = att.pitch ?? 0;
  const dir = point(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
  const end = origin.clone().addScaledVector(dir, r), half = Math.min(85, (h.arc || 60) / 2) * DEG;
  for (const cap of caps) {
    const closest = segmentDistance(origin, end, cap.a, cap.b);
    const delta = closest.b.clone().sub(origin), along = delta.dot(dir);
    if (along < -cap.radius || along > r + cap.radius || delta.length() - cap.radius > r) continue;
    if (closest.distance > Math.max(0, along) * Math.tan(half) + cap.radius) continue;
    return { point: closest.b, normal: dir.clone().negate(), region: cap.region, fighter: target };
  }
  return null;
}
