// Shared three-dimensional hurt volumes, active melee sweeps and continuous
// projectile/terrain contacts. The rendered weapon and its hit path coincide.
import * as THREE from 'three';
import { gunProjectile, applyGunRecoil } from './ballistics.js';
import { DEG, wrapAngle, clamp, rand } from '../engine/util.js';
import { attackKind, attackWindow, attackSegments, hurtCapsules, segmentHitCharacter,
  sweptMeleeContact, rangedMeleeContact, sphereContact, cylinderContact } from './combat-volumes.js';
import { isCleanseable } from './statuses.js';

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();

export class Combat {
  constructor(game) {
    this.game = game;
    this.projectiles = [];
    this.aoes = [];
    this.meleeWindows = [];
    this.poses = new WeakMap();
    this.currentBodies = new WeakMap();
  }

  targets() { return this.game.summons?.units.length ? [...this.game.fighters, ...this.game.summons.units] : this.game.fighters; }
  enemiesOf(f) { return this.targets().filter((o) => o !== f && o.alive && o.team !== f?.team && !o.untargetable); }

  // ---- 近战 ----
  meleeHit(att, h, def, idx) {
    const a = att.action;
    this.meleeWindows.push({ att, h, def, idx, uid: a?.uid, start: h.t || 0,
      duration: attackWindow(h, def, idx), hit: new Set(), any: false, first: true });
    return true;
  }

  // Called after every fighter has updated physics and its actual skeleton.
  // Each hit entry has its own bounded window/victim set: multihit skills can
  // strike again, while one blade sweep cannot damage the same victim per frame.
  updateMelee(dt) {
    const g = this.game;
    const snapshots = new WeakMap();
    const extents = new WeakMap();
    this.currentBodies = new WeakMap();
    for (const f of this.targets()) {
      if (!f.alive) continue;
      const caps = hurtCapsules(f); this.currentBodies.set(f, caps);
      extents.set(f,Math.max(f.radius || 0,...caps.map(c => Math.max(
        Math.hypot(c.a.x-f.pos.x,c.a.z-f.pos.z),Math.hypot(c.b.x-f.pos.x,c.b.z-f.pos.z))+c.radius)));
      const a = f.action;
      const activeTime = !a ? -Infinity : a.stage === 'wind' ? a.t - a.def.wind : a.stage === 'active' ? a.t : a.def.active + a.t;
      // A multihit skill shares its physical pose this frame. Reuse identical
      // volumes instead of recalculating the whole rig for every damage entry.
      const volumeCache = new Map();
      const segments = (a?.def.hits || []).map(h => {
        const key = [attackKind(h,a.def,f),h.hitRadius,h.shape?.radius,h.hand,h.leg,h.range].join(':');
        let volume = volumeCache.get(key);
        if (!volume) { volume = attackSegments(f,h,a.def);volumeCache.set(key,volume); }
        return volume;
      });
      snapshots.set(f, { uid: a?.uid, activeTime, segments, yaw:f.yaw });
    }
    for (let i = 0; i < this.meleeWindows.length;) {
      const w = this.meleeWindows[i], { att, h, def, idx } = w;
      const now = snapshots.get(att), previous = this.poses.get(att);
      if (!att.alive || !now || att.action?.uid !== w.uid) { this.meleeWindows.splice(i, 1); continue; }
      const prior = previous?.uid === w.uid ? previous.activeTime : now.activeTime - dt * 1000;
      const elapsed = Math.max(1e-6, now.activeTime - prior);
      const from = clamp((w.start - prior) / elapsed, 0, 1), to = clamp((w.start + w.duration - prior) / elapsed, 0, 1);
      const kind = attackKind(h, def, att), area = ['ground', 'cylinder', 'sphere', 'cone'].includes(kind);
      const scale = att.scale || 1, maxRange = (h.range || 2.4) * scale;
      for (const t of this.enemiesOf(att)) {
        if (w.hit.has(t)) continue;
        if (Math.hypot(t.pos.x - att.pos.x, t.pos.z - att.pos.z) > maxRange + (extents.get(t) || t.radius) + .02) continue;
        const caps = this.currentBodies.get(t);
        const currentSegments = now.segments[idx] || attackSegments(att, h, def);
        const oldSegments = previous?.uid === w.uid ? previous.segments[idx] : currentSegments;
        const contact = area ? rangedMeleeContact(att, t, h, def, caps) : sweptMeleeContact(oldSegments, currentSegments, t, from, to, caps);
        if (!contact) continue;
        if (h.h) {
          const relativeHeight = (contact.point.y - att.pos.y) / scale;
          if (relativeHeight < h.h[0] - 0.025 || relativeHeight > h.h[1] + 0.025) continue;
        }
        const dx = contact.point.x - att.pos.x, dz = contact.point.z - att.pos.z;
        const yaw = !area && previous?.uid === w.uid ? previous.yaw +
          wrapAngle(now.yaw-previous.yaw)*(contact.fraction ?? 1) : att.yaw;
        if (!area && (h.arc ?? 110) < 359 && Math.hypot(dx, dz) > 0.15) {
          if (Math.abs(wrapAngle(Math.atan2(dx, dz) - yaw)) > (h.arc ?? 110) * DEG * 0.5 + 0.025) continue;
        }
        _v.set(att.pos.x, att.pos.y + att.height * 0.65, att.pos.z);
        if (g.world.blocked(_v, contact.point)) continue;
        let dirX = t.pos.x - att.pos.x, dirZ = t.pos.z - att.pos.z;
        if (h.pull) { dirX = -dirX; dirZ = -dirZ; }
        const length = Math.hypot(dirX, dirZ) || 1;
        const hit = { ...h, grab: h.grab ?? def.grab, noTech: h.noTech ?? def.noTech, contact };
        w.hit.add(t);
        const res = t.receiveHit(att, hit, dirX / length, dirZ / length);
        w.any = true; g.onHit(att, t, res, hit, def, false, contact.point);
      }
      w.first = false;
      if (now.activeTime >= w.start + w.duration || area) {
        if (!w.any && idx === 0) g.onWhiff(att, def);
        this.meleeWindows.splice(i, 1);
      } else i++;
    }
    this.poses = snapshots;
  }

  // ---- 投射物 ----
  aimFor(att, p) {
    // 返回发射起点与方向
    const g = this.game;
    const origin = new THREE.Vector3();
    const eye = new THREE.Vector3();
    const visual = new THREE.Vector3();
    att.eyePos(eye);
    att.rig?.root.updateWorldMatrix(true, true);
    const mz = p.left && att.leftWeapon ? (att.leftWeapon.userData.muzzle || att.leftWeapon) : (att.weapon.muzzle || att.weapon.tip || att.weapon.obj);
    mz.getWorldPosition(visual);
    // Throws leave the hand; guns leave their physical barrel. Eye-origin
    // bullets used to hit around corners while the visible gun was blocked.
    if (p.kind === 'sand' || p.fromHand || p.kind === 'grenade' && att.weapon.type !== 'cannon') {
      const hand = att.mocapBody?.bones?.RightHand || att.rig?.bones?.haR;
      if (hand) hand.getWorldPosition(visual);
    }
    origin.copy(visual);
    let dir = new THREE.Vector3();
    if (p.chaser && att.chaserCast?.origin && att.chaserCast?.target?.alive) {
      origin.copy(att.chaserCast.origin); visual.copy(origin);
      dir.copy(att.chaserCast.target.center(new THREE.Vector3())).sub(origin).normalize();
    } else if (att.isPlayer) {
      dir.copy(att.aimDir);
      // 从眼睛射线求瞄准点，再从枪口指向它（避免视差）
      const hit = g.world.raycast(eye, dir, p.range || 80, this.targets(), att.team, att);
      if (p.gravity && !p.ballisticGun) {
        dir.copy(att.aimDir);
      } else {
        dir.copy(hit.point).sub(origin).normalize();
      }
    } else {
      const t = att.targetVisible !== false && !att.hasEffect?.('blind') ? att.target : null;
      if (t && t.alive) {
        const tc = p.eyeOnlyBlind || p.headOnlyStatus ? t.eyePos(new THREE.Vector3()) : t.center(new THREE.Vector3());
        const dist = origin.distanceTo(tc);
        const lead = p.speed ? dist / p.speed : 0;
        tc.x += t.vel.x * lead * 0.7; tc.z += t.vel.z * lead * 0.7;
        if (p.gravity) {
          // 抛物线：估算仰角
          const flat = Math.max(0.001, Math.hypot(tc.x - origin.x, tc.z - origin.z));
          const tt = Math.max(0.01, flat / p.speed);
          const vy = (tc.y - origin.y + 0.5 * p.gravity * tt * tt) / tt;
          dir.set((tc.x - origin.x) / flat * p.speed, vy, (tc.z - origin.z) / flat * p.speed).normalize();
        } else dir.copy(tc).sub(origin).normalize();
        const err = att.ai ? att.ai.aimSpread() : 0.02;
        dir.x += rand(-err, err); dir.y += rand(-err, err) * 0.5; dir.z += rand(-err, err);
        dir.normalize();
      } else if (att.lastKnownTargetPos && att.hasEffect?.('blind')) dir.copy(att.lastKnownTargetPos).add(_v.set(0, 0.9, 0)).sub(origin).normalize();
      else dir.copy(att.aimDir || att.forward());
    }
    if (p.spread) {
      const s = p.spread * DEG;
      dir.x += rand(-s, s); dir.y += rand(-s, s) * 0.6; dir.z += rand(-s, s); dir.normalize();
    }
    if (p.arc && att.isPlayer) { dir.y += p.arc; dir.normalize(); }
    // The body-to-muzzle segment must also be clear. A long barrel sticking
    // through a wall produces an impact on this side of that wall.
    const body = att.center(new THREE.Vector3());
    const obstructed = g.world.traceSegment(body, origin, 0.015);
    if (obstructed) origin.copy(obstructed.point).addScaledVector(obstructed.normal, 0.02);
    visual.copy(origin);
    return { origin, visual, dir, obstructed };
  }

  fireProjectile(att, p, def, i) {
    const g = this.game;
    p = gunProjectile(att, p, def);
    const { origin, visual, dir, obstructed } = this.aimFor(att, p);
    const color = p.color || (p.kind === 'bullet' ? '#ffe0a0' : p.kind === 'magic' ? (att.cls.magicColor || '#9ad0ff') : '#ffb35a');
    const mesh = g.vfx.projectileMesh(p.kind, color, def, p, att);
    mesh.position.copy(visual);
    g.scene.add(mesh);
    const pr = {
      owner: att, p, def, pos: origin.clone(), vis: visual.clone(), visOff: visual.clone().sub(origin),
      origin: origin.clone(),
      vel: dir.clone().multiplyScalar(p.speed), traveled: 0, mesh, hit: new Set(), age: 0, color, obstructed,
    };
    this.projectiles.push(pr);
    applyGunRecoil(g, att, p, def, dir, { view: false });
    g.vfx.fire?.(att, p, def, visual, dir);
    g.onFire(att, p, def, visual, dir);
    if (att.isPlayer && att.fp) att.fp.kick = p.kind === 'shell' ? 0.12 : 0.04;
    return pr;
  }

  explode(owner, pos, e, def) {
    const g = this.game;
    const r = e.radius * (owner && owner.clsId === 'launcher' ? 1.15 : 1);
    if (!g.vfx.explosionEvent?.(owner, pos, { ...e, radius: r }, def)) g.vfx.explosion(pos, r, e.color || '#ffa050');
    g.sfx('explosion', pos);
    g.shake(pos, 0.5);
    for (const t of this.enemiesOf(owner)) {
      const contact = sphereContact(pos, r, t, this.currentBodies.get(t));
      if (!contact) continue;
      _v.copy(pos).addScaledVector(contact.point.clone().sub(pos).normalize(), 0.03); _v.y += 0.015;
      if (g.world.blocked(_v, contact.point)) continue;
      let dx = t.pos.x - pos.x, dz = t.pos.z - pos.z; const dl = Math.hypot(dx, dz) || 1; dx /= dl; dz /= dl;
      const hit = { ...e, dmg: e.dmg, stun: e.stun ?? 400, knock: e.knock ?? 3, launch: e.launch || 0, down: !!e.down, unblockable: false, contact };
      const res = t.receiveHit(owner, hit, dx, dz);
      g.onHit(owner, t, res, hit, def, true, contact.point);
    }
  }

  updateProjectiles(dt) {
    const g = this.game;
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const pr = this.projectiles[i];
      const p = pr.p;
      pr.age += dt;
      let done = false;
      // Continuous segments catch fast bullets without expensive endpoint
      // stepping. Curved grenades use short gravity substeps instead.
      const steps = Math.max(1, Math.min(8, Math.ceil(dt * Math.sqrt(p.gravity || 0) * 12)));
      const sdt = dt / steps;
      const hitRadius = p.hitRadius ?? (p.kind === 'bullet' ? Math.min(p.radius ?? 0.02, 0.035) : p.radius || 0.06);
      if (p.homing && pr.age > 0.08) {
        let tgt = pr.homeT;
        if (!tgt || !tgt.alive) {
          let best = 1e9; tgt = null;
          for (const t of this.enemiesOf(pr.owner)) { const d = t.pos.distanceTo(pr.pos); const dir = _v.copy(t.pos).sub(pr.pos).normalize(); const fwd = _v2.copy(pr.vel).normalize(); if (dir.dot(fwd) < 0.2 || g.world.blocked(pr.pos, t.center(_v3))) continue; if (d < best) { best = d; tgt = t; } }
          pr.homeT = tgt;
        }
        if (tgt) {
          const want = tgt.center(_v).sub(pr.pos).normalize().multiplyScalar(p.speed);
          pr.vel.lerp(want, Math.min(1, p.homing * dt)).setLength(p.speed);
        }
      }
      for (let s = 0; s < steps && !done; s++) {
        if (p.gravity) pr.vel.y -= p.gravity * sdt;
        _v.copy(pr.pos);
        pr.pos.addScaledVector(pr.vel, sdt);
        pr.traveled += pr.vel.length() * sdt;
        if (p.ground) {
          const aboveGround = p.groundHeight ?? 0.35;
          pr.pos.y = g.world.floorHeight(pr.pos.x, pr.pos.z, pr.pos.y - aboveGround + .46) + aboveGround;
          pr.vel.y = 0;
        }
        const start = _v.clone(), end = pr.pos.clone();
        let terrain = pr.obstructed ? { ...pr.obstructed, fraction: 0 } : g.world.traceSegment(start, end, p.ground ? Math.min(hitRadius, 0.1) : hitRadius, { floor: !p.ground });
        pr.obstructed = null;
        if (terrain && terrain.fraction === undefined) terrain = { ...terrain, fraction: 0 };
        const contacts = [];
        for (const t of this.enemiesOf(pr.owner)) {
          if (pr.hit.has(t)) continue;
          let caps = this.currentBodies.get(t) || hurtCapsules(t);
          // Sand's damaging grains target the exposed face. A cloud beside a
          // torso cannot manufacture blindness from a generic body hit.
          if (p.eyeOnlyBlind) caps = caps.filter(cap => cap.region === 'head');
          const hit = segmentHitCharacter(start, end, t, hitRadius, caps);
          if (hit && (!terrain || hit.fraction < terrain.fraction - 1e-6)) contacts.push(hit);
        }
        contacts.sort((a, b) => a.fraction - b.fraction);
        for (const contact of contacts) {
          const t = contact.fighter;
          pr.hit.add(t);
          if (p.kind === 'grenade' && p.fuse && pr.age * 1000 < p.fuse) {
            pr.pos.copy(contact.center).addScaledVector(contact.normal, 0.005);
            const into = pr.vel.dot(contact.normal);
            if (into < 0) pr.vel.addScaledVector(contact.normal, -1.25 * into);
            pr.vel.multiplyScalar(0.65); terrain = null; break;
          }
          const vl = Math.hypot(pr.vel.x, pr.vel.z) || 1;
          const hit = { ...p, contact, origin: pr.origin || start.clone(), incomingDir: pr.vel.clone().normalize() };
          if (p.dmg > 0 || p.effect || p.effects) {
            const res = t.receiveHit(pr.owner, hit, pr.vel.x / vl, pr.vel.z / vl);
            g.onHit(pr.owner, t, res, hit, pr.def, true, contact.point);
          }
          if (p.explode) this.explode(pr.owner, contact.center, p.explode, pr.def);
          if (!p.pierce) { pr.pos.copy(contact.center); done = true; break; }
        }
        if (done) break;
        if (terrain) {
          pr.pos.copy(terrain.point).addScaledVector(terrain.normal, 0.005);
          if (p.kind === 'grenade' && p.fuse && pr.age * 1000 < p.fuse) {
            const into = pr.vel.dot(terrain.normal);
            if (into < 0) pr.vel.addScaledVector(terrain.normal, -1.35 * into);
            pr.vel.multiplyScalar(0.72);
          } else {
            if (p.explode) this.explode(pr.owner, pr.pos, p.explode, pr.def);
            else g.vfx.burst(pr.pos, pr.color, 6, 3, 0.04, 0.2);
            done = true;
          }
        }
        if (p.kind === 'grenade' && p.fuse && pr.age * 1000 >= p.fuse) { if (p.explode) this.explode(pr.owner, pr.pos, p.explode, pr.def); done = true; }
        if (pr.traveled > p.range && !(p.kind === 'grenade')) { if (p.explode) this.explode(pr.owner, pr.pos, p.explode, pr.def); done = true; }
      }
      // 视觉位置：起点偏移逐渐收敛到逻辑位置
      pr.visOff.multiplyScalar(Math.exp(-dt * 14));
      pr.mesh.position.copy(pr.pos).add(pr.visOff);
      if (pr.vel.lengthSq() > 0.01) pr.mesh.lookAt(_v2.copy(pr.mesh.position).add(pr.vel));
      if (g.vfx.projectileStep) g.vfx.projectileStep(pr, dt);
      else if (p.kind !== 'bullet' && Math.random() < 0.7) g.vfx.particle(pr.mesh.position.x, pr.mesh.position.y, pr.mesh.position.z, 0, 0.3, 0, pr.color, p.kind === 'magic' ? 0.18 : 0.12, 0.25, -0.5);
      if (done || pr.age > 6) {
        pr.mesh.removeFromParent();
        this.projectiles.splice(i, 1);
      }
    }
  }

  // ---- 延时范围技 ----
  placeAoe(att, a, def) {
    const g = this.game;
    const pos = new THREE.Vector3();
    if (a.at === 'self') pos.copy(att.pos);
    else if (att.isPlayer) {
      const o = att.eyePos(new THREE.Vector3());
      const hit = g.world.raycast(o, att.aimDir, 26, g.fighters, att.team, att);
      pos.copy(hit.point);
      pos.y = g.world.floorHeight(pos.x, pos.z, hit.point.y + .02);
    } else if (att.target && att.targetVisible !== false && !att.hasEffect?.('blind')) {
      pos.copy(att.target.pos);
      pos.x += att.target.vel.x * a.delay / 1000 * 0.5; pos.z += att.target.vel.z * a.delay / 1000 * 0.5;
      pos.y = g.world.floorHeight(pos.x, pos.z, pos.y + .46);
    } else if (att.lastKnownTargetPos) { pos.copy(att.lastKnownTargetPos); pos.y = g.world.floorHeight(pos.x, pos.z, pos.y + .46); }
    else pos.copy(att.pos);
    if (a.scatter) { pos.x += (Math.random() - 0.5) * 2 * a.scatter; pos.z += (Math.random() - 0.5) * 2 * a.scatter; pos.y = g.world.floorHeight(pos.x, pos.z, pos.y + .46); }
    const tele = a.telegraph ? g.vfx.telegraph(pos, a.radius, a.delay / 1000, a.color || (att.team === g.player?.team ? '#4d9d9a' : '#cf624b')) : null;
    this.aoes.push({ owner: att, a, def, pos, t: 0, tele, effectVictims: new Set() });
    if (a.vfx === 'satellite') g.vfx.beam(new THREE.Vector3(pos.x, pos.y + 40, pos.z), new THREE.Vector3(pos.x, pos.y + 30, pos.z), 0.3, '#9fe6ff', a.delay / 1000);
  }

  updateAoes(dt) {
    const g = this.game;
    for (let i = this.aoes.length - 1; i >= 0; i--) {
      const z = this.aoes[i];
      z.t += dt * 1000;
      if (z.t < z.a.delay + (z.tick || 0) * (z.a.interval || 0)) continue;
      const a = z.a;
      z.tick = (z.tick || 0) + 1;
      if (g.vfx.areaEvent?.(z.owner, a, z.def, z.pos, z.tick)) {
        // Skill-specific visual supplied by VFX.
      } else if (a.vfx === 'zone') {
        g.vfx.ring(z.pos, a.radius, a.color || '#9a5cff', 0.45); g.vfx.burst(z.pos, a.color || '#9a5cff', 14, 2, 0.14, 0.6, -2, 0.5);
      } else if (a.vfx === 'vortex') {
        g.vfx.ring(z.pos, a.radius, '#b05cff', 0.6); g.vfx.explosion(z.pos, a.radius * 0.6, '#8a3cff');
      } else if (a.vfx === 'meteor') {
        g.vfx.beam(new THREE.Vector3(z.pos.x + 3, z.pos.y + 14, z.pos.z - 2), z.pos.clone(), 0.5, '#ff9a4a', 0.2);
        g.vfx.explosion(z.pos, a.radius, '#ff8a3a');
        g.shake(z.pos, 0.6);
      } else if (a.vfx === 'satellite') {
        g.vfx.beam(new THREE.Vector3(z.pos.x, z.pos.y + 40, z.pos.z), z.pos.clone(), a.radius * 1.2, '#bff0ff', 0.6);
        g.vfx.explosion(z.pos, a.radius, '#9fe6ff');
        g.shake(z.pos, 1);
      } else if (a.vfx === 'holy') {
        g.vfx.ring(z.pos, a.radius, '#ffe7a0', 0.5); g.vfx.burst(z.pos, '#ffe7a0', 30, 5, 0.08, 0.6, -2);
      } else {
        g.vfx.explosion(z.pos, a.radius, a.color || '#ffa050');
      }
      g.sfx(a.sfx || 'explosion', z.pos);
      for (const t of this.enemiesOf(z.owner)) {
        const caps = this.currentBodies.get(t);
        let contact;
        const column = a.vfx === 'satellite' || a.shape === 'column';
        if (column) contact = cylinderContact(z.pos, a.radius, a.height ?? 40, t, caps, a.bottom ?? 0);
        else if (a.vfx === 'zone' || a.vfx === 'vortex' || a.shape === 'cylinder' || Number.isFinite(a.height)) {
          contact = cylinderContact(z.pos, a.radius, a.height ?? (a.vfx === 'zone' ? 0.9 : 2.8), t, caps, a.bottom ?? -0.1);
        } else {
          _v.copy(z.pos); _v.y += Math.min(0.5, a.radius * 0.2);
          contact = sphereContact(_v, a.radius, t, caps);
        }
        if (!contact) continue;
        _v.copy(z.pos); _v.y += column ? (a.height ?? 40) : 0.08;
        if (g.world.blocked(_v, contact.point)) continue;
        let dx = t.pos.x - z.pos.x, dz = t.pos.z - z.pos.z; const dl = Math.hypot(dx, dz) || 1; dx /= dl; dz /= dl;
        if (a.pull) { dx = -dx; dz = -dz; }
        const hit = { ...a, contact };
        if (a.statusOnce && z.effectVictims.has(t)) { delete hit.effect; delete hit.effects; }
        const res = t.receiveHit(z.owner, hit, dx, dz);
        if (a.statusOnce && res !== 'miss' && res !== 'parry' && res !== 'block') z.effectVictims.add(t);
        g.onHit(z.owner, t, res, hit, z.def, true, contact.point);
      }
      if (z.tick < (a.ticks || 1)) continue;
      this.aoes.splice(i, 1);
    }
  }

  // ---- 激光 ----
  beamTick(att, def, tick) {
    const g = this.game;
    const b = def.beam;
    const { origin, visual, dir } = this.aimFor(att, {});
    if (tick === 0 && att.clsId === 'launcher') {
      applyGunRecoil(g, att, { kind: 'beam' }, def, dir, { view: false });
      g.onFire(att, { kind: 'beam' }, def, visual, dir);
    }
    const end = origin.clone().addScaledVector(dir, b.range);
    // 墙体截断
    const wr = g.world.raycast(origin, dir, b.range, null);
    end.copy(wr.point);
    if (!g.vfx.channelBeam?.(att, def, visual, end, b.width, 0.12)) g.vfx.beam(visual, end, b.width, def.color || '#9fe6ff', 0.12);
    for (const t of this.enemiesOf(att)) {
      const contact = segmentHitCharacter(origin, end, t, b.width * 0.5, this.currentBodies.get(t));
      if (!contact) continue;
      const hit = { ...b, dmg: b.dmg, stun: b.stun, knock: b.knock, launch: b.launch || 0, contact };
      const res = t.receiveHit(att, hit, dir.x, dir.z);
      g.onHit(att, t, res, hit, def, true, contact.point);
    }
  }

  // ---- 治疗 ----
  doHeal(att, h, def) {
    const g = this.game;
    const allies = g.fighters.filter((o) => o.alive && o.team === att.team && o.kind !== 'dummy');
    let targets = [];
    if (h.target === 'self') targets = [att];
    else if (h.target === 'lowest') {
      let best = att, br = att.hp / att.maxHp;
      let statuses = h.cleanse ? (att.effects || []).filter(e => e.t > 0 && isCleanseable(e)).length : 0;
      for (const o of allies) {
        const d = o.pos.distanceTo(att.pos); if (d > (h.range || 20)) continue;
        if (o !== att && (att.hasEffect?.('blind') || g.world.blocked(att.eyePos(_v), o.center(_v2)))) continue;
        const count = h.cleanse ? (o.effects || []).filter(e => e.t > 0 && isCleanseable(e)).length : 0;
        const r = o.hp / o.maxHp;
        if (count > statuses || count === statuses && r < br) { br = r; best = o; statuses = count; }
      }
      targets = [best];
    } else targets = allies.filter((o) => o.pos.distanceTo(att.pos) <= (h.radius || 12));
    for (const t of targets) {
      const amt = (h.amount || 0) + t.maxHp * (h.pct || 0);
      const got = t.heal(amt, att);
      if (h.hot) t.addEffect({ type: 'hot', t: h.hot.t, hps: h.hot.hps, src: att });
      if (h.armor) t.armor = Math.max(t.armor, h.armor);
      if (h.shield) t.addEffect({ type: 'shield', t: h.shield.t, amount: h.shield.amount });
      if (h.cleanse) t.cleanse?.(typeof h.cleanse === 'number' ? h.cleanse : Infinity);
      if (!g.vfx.healTarget?.(t, h, att)) {
        g.vfx.burst(t.center(_v3), '#ffe7a0', 18, 3, 0.08, 0.7, -3);
        g.vfx.ring(t.pos, 1.4, '#ffe7a0', 0.5);
      }
    }
    g.sfx('heal', att.pos);
  }

  // ---- 瞬移到目标身后 ----
  doBlink(att, b) {
    const g = this.game;
    if (att.movementLocked?.()) return false;
    const from = att.pos.clone();
    let t = null;
    if (att.isPlayer) {
      const o = att.eyePos(new THREE.Vector3());
      const r = g.world.raycast(o, att.aimDir, b.range || 10, g.fighters, att.team, att);
      t = r.fighter;
    } else t = att.targetVisible !== false && !att.hasEffect?.('blind') ? att.target : null;
    if (t && g.world.blocked(att.eyePos(_v), t.center(_v2))) t = null;
    if (!t || t.pos.distanceTo(att.pos) > (b.range || 10) + 1) {
      // 没有目标：向前瞬移
      const f = att.forward(); const nx = att.pos.x + f.x * (b.range || 10) * 0.5, nz = att.pos.z + f.z * (b.range || 10) * 0.5;
      const res = g.world.resolve(att, nx, att.pos.y, nz); att.pos.set(res.x, res.y, res.z);
    } else {
      const tf = t.forward();
      const separation = att.radius + t.radius + 0.15;
      const nx = t.pos.x - tf.x * separation, nz = t.pos.z - tf.z * separation;
      const res = g.world.resolve(att, nx, t.pos.y, nz); att.pos.set(res.x, res.y, res.z);
      att.yaw = Math.atan2(t.pos.x - att.pos.x, t.pos.z - att.pos.z);
      // The attack belongs to the destination pose after this deliberate turn.
      // Keeping the pre-blink aim would reject a real dagger contact behind us.
      if (att.action) att.action.aimYaw = att.yaw;
      if (att === g.player) { g.viewYaw = att.yaw; }
      if (att.remote) att.netYawReset = (att.netYawReset || 0) + 1;
    }
    if (!g.vfx.blinkTrail?.(att, from, att.pos.clone())) {
      _v.copy(from); _v.y += att.height * 0.5;
      g.vfx.burst(_v, '#6a4a9a', 20, 3, 0.12, 0.5, -1);
      g.vfx.burst(att.center(_v3), '#6a4a9a', 20, 3, 0.12, 0.5, -1);
    }
    g.sfx('shadow_step', att.pos);
    return true;
  }

  clear() {
    for (const p of this.projectiles) p.mesh.removeFromParent();
    this.projectiles.length = 0;
    this.aoes.length = 0;
    this.meleeWindows.length = 0;
    this.poses = new WeakMap(); this.currentBodies = new WeakMap();
  }
}
