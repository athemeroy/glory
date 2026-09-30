// 命中判定：近战扇形扫掠、投射物、延时范围技、激光。
import * as THREE from 'three';
import { DEG, wrapAngle, distPointToVSeg, rand } from '../engine/util.js';

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();

export class Combat {
  constructor(game) {
    this.game = game;
    this.projectiles = [];
    this.aoes = [];
  }

  enemiesOf(f) { return this.game.fighters.filter((o) => o !== f && o.alive && o.team !== f.team && !o.untargetable); }

  // ---- 近战 ----
  meleeHit(att, h, def, idx) {
    const g = this.game;
    const fx = Math.sin(att.yaw), fz = Math.cos(att.yaw);
    const range = h.range * (att.scale > 1 ? 1 + (att.scale - 1) * 0.34 : 1);
    const half = (h.arc ?? 110) * DEG / 2;
    const hlo = att.pos.y + (h.h ? h.h[0] : -0.3) - 0.3, hhi = att.pos.y + (h.h ? h.h[1] : 2.6) + 0.4;
    let any = false;
    for (const t of this.enemiesOf(att)) {
      const dx = t.pos.x - att.pos.x, dz = t.pos.z - att.pos.z;
      const d = Math.hypot(dx, dz);
      if (d - t.radius > range) continue;
      if (half < Math.PI && d > 0.3) {
        const ang = Math.abs(wrapAngle(Math.atan2(dx, dz) - att.yaw));
        // 近身时放宽角度（目标体积）
        const pad = Math.atan2(t.radius, Math.max(0.3, d));
        if (ang > half + pad) continue;
      }
      const tlo = t.pos.y, thi = t.pos.y + (t.state === 'down' ? 0.5 : t.height);
      if (thi < hlo || tlo > hhi) continue;
      if (t.state === 'down' && !(h.otgOk || (h.h && h.h[0] < 0.3) || !h.h)) continue;
      // 墙体遮挡
      _v.set(att.pos.x, att.pos.y + 1.1, att.pos.z); _v2.set(t.pos.x, t.pos.y + 0.9, t.pos.z);
      if (g.world.blocked(_v, _v2)) continue;
      const dl = d || 1;
      const dirX = h.pull ? -dx / dl : (half >= Math.PI * 0.99 ? dx / dl : (dx / dl) * 0.6 + fx * 0.4);
      const dirZ = h.pull ? -dz / dl : (half >= Math.PI * 0.99 ? dz / dl : (dz / dl) * 0.6 + fz * 0.4);
      const nl = Math.hypot(dirX, dirZ) || 1;
      const res = t.receiveHit(att, h, dirX / nl, dirZ / nl);
      any = true;
      g.onHit(att, t, res, h, def);
    }
    if (!any && idx === 0) g.onWhiff(att, def);
    return any;
  }

  // ---- 投射物 ----
  aimFor(att, p) {
    // 返回发射起点与方向
    const g = this.game;
    const origin = new THREE.Vector3();
    const visual = new THREE.Vector3();
    att.eyePos(origin);
    const mz = p.left && att.leftWeapon ? (att.leftWeapon.userData.muzzle || att.leftWeapon) : (att.weapon.muzzle || att.weapon.tip || att.weapon.obj);
    mz.getWorldPosition(visual);
    // 第一人称：视觉起点用手臂层的枪口
    if (att.isPlayer && att.fp && g.firstPerson) {
      const fm = p.left && att.fp.left ? (att.fp.left.userData.muzzle || att.fp.left) : (att.fp.weapon.muzzle || att.fp.weapon.tip);
      if (fm) fm.getWorldPosition(visual);
    }
    let dir = new THREE.Vector3();
    if (att.isPlayer) {
      dir.copy(att.aimDir);
      // 从眼睛射线求瞄准点，再从枪口指向它（避免视差）
      const hit = g.world.raycast(origin, dir, 80, g.fighters, att.team, att);
      if (p.gravity) {
        dir.copy(att.aimDir);
      } else {
        dir.copy(hit.point).sub(origin).normalize();
      }
    } else {
      const t = att.target;
      if (t && t.alive) {
        const tc = t.center(new THREE.Vector3());
        const dist = origin.distanceTo(tc);
        const lead = p.speed ? dist / p.speed : 0;
        tc.x += t.vel.x * lead * 0.7; tc.z += t.vel.z * lead * 0.7;
        if (p.gravity) {
          // 抛物线：估算仰角
          const flat = Math.hypot(tc.x - origin.x, tc.z - origin.z);
          const tt = flat / p.speed;
          const vy = (tc.y - origin.y + 0.5 * p.gravity * tt * tt) / tt;
          dir.set((tc.x - origin.x) / flat * p.speed, vy, (tc.z - origin.z) / flat * p.speed).normalize();
        } else dir.copy(tc).sub(origin).normalize();
        const err = att.ai ? att.ai.aimSpread() : 0.02;
        dir.x += rand(-err, err); dir.y += rand(-err, err) * 0.5; dir.z += rand(-err, err);
        dir.normalize();
      } else att.forward(dir);
    }
    if (p.spread) {
      const s = p.spread * DEG;
      dir.x += rand(-s, s); dir.y += rand(-s, s) * 0.6; dir.z += rand(-s, s); dir.normalize();
    }
    if (p.arc && att.isPlayer) { dir.y += p.arc; dir.normalize(); }
    return { origin, visual, dir };
  }

  fireProjectile(att, p, def, i) {
    const g = this.game;
    const { origin, visual, dir } = this.aimFor(att, p);
    const color = p.color || (p.kind === 'bullet' ? '#ffe0a0' : p.kind === 'magic' ? (att.cls.magicColor || '#9ad0ff') : '#ffb35a');
    const mesh = g.vfx.projectileMesh(p.kind, color);
    mesh.position.copy(visual);
    g.scene.add(mesh);
    const pr = {
      owner: att, p, def, pos: origin.clone(), vis: visual.clone(), visOff: visual.clone().sub(origin),
      vel: dir.clone().multiplyScalar(p.speed), traveled: 0, mesh, hit: new Set(), age: 0, color,
    };
    this.projectiles.push(pr);
    g.onFire(att, p, def, visual, dir);
    if (att.isPlayer && att.fp) att.fp.kick = p.kind === 'shell' ? 0.12 : 0.04;
  }

  explode(owner, pos, e, def) {
    const g = this.game;
    const r = e.radius * (owner && owner.clsId === 'launcher' ? 1.15 : 1);
    g.vfx.explosion(pos, r, e.color || '#ffa050');
    g.sfx('explosion', pos);
    g.shake(pos, 0.5);
    for (const t of this.enemiesOf(owner)) {
      const c = t.center(_v3);
      const d = distPointToVSeg(pos.x, pos.y, pos.z, t.pos.x, t.pos.y + 0.2, t.pos.y + t.height - 0.2, t.pos.z);
      if (d > r + t.radius * 0.5) continue;
      _v.set(pos.x, pos.y + 0.3, pos.z);
      if (g.world.blocked(_v, c)) continue;
      let dx = t.pos.x - pos.x, dz = t.pos.z - pos.z; const dl = Math.hypot(dx, dz) || 1; dx /= dl; dz /= dl;
      const hit = { dmg: e.dmg, stun: e.stun || 400, knock: e.knock || 3, launch: e.launch || 0, down: !!e.down, unblockable: false, effect: e.effect };
      const res = t.receiveHit(owner, hit, dx, dz);
      g.onHit(owner, t, res, hit, def, true);
    }
  }

  updateProjectiles(dt) {
    const g = this.game;
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const pr = this.projectiles[i];
      const p = pr.p;
      pr.age += dt;
      let done = false;
      const steps = Math.max(1, Math.ceil(pr.vel.length() * dt / 0.3));
      const sdt = dt / steps;
      if (p.homing && pr.age > 0.08) {
        let tgt = pr.homeT;
        if (!tgt || !tgt.alive) {
          let best = 1e9; tgt = null;
          for (const t of this.enemiesOf(pr.owner)) { const d = t.pos.distanceTo(pr.pos); const dir = _v.copy(t.pos).sub(pr.pos).normalize(); const fwd = _v2.copy(pr.vel).normalize(); if (dir.dot(fwd) < 0.2) continue; if (d < best) { best = d; tgt = t; } }
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
        // 命中角色
        for (const t of this.enemiesOf(pr.owner)) {
          if (pr.hit.has(t)) continue;
          const d = distPointToVSeg(pr.pos.x, pr.pos.y, pr.pos.z, t.pos.x, t.pos.y + 0.15, t.pos.y + (t.state === 'down' ? 0.35 : t.height - 0.15), t.pos.z);
          if (d < t.radius + p.radius) {
            if (p.kind === 'grenade' && p.fuse) { pr.vel.multiplyScalar(-0.2); continue; }
            pr.hit.add(t);
            if (p.dmg > 0) {
              const vl = Math.hypot(pr.vel.x, pr.vel.z) || 1;
              const res = t.receiveHit(pr.owner, p, pr.vel.x / vl, pr.vel.z / vl);
              g.onHit(pr.owner, t, res, p, pr.def, true, pr.pos);
            }
            if (p.explode) this.explode(pr.owner, pr.pos, p.explode, pr.def);
            if (!p.pierce) { done = true; break; }
          }
        }
        if (done) break;
        // 地形
        const floor = g.world.floorHeight(pr.pos.x, pr.pos.z);
        if (p.ground) { pr.pos.y = floor + 0.4; pr.vel.y = 0; }
        let hitWorld = pr.pos.y <= floor + 0.02;
        if (!hitWorld && g.world.blocked(_v, pr.pos)) hitWorld = true;
        if (hitWorld) {
          if (p.kind === 'grenade' && p.fuse && pr.age * 1000 < p.fuse) {
            // 弹跳
            if (pr.pos.y <= floor + 0.02) { pr.pos.y = floor + 0.03; pr.vel.y = Math.abs(pr.vel.y) * 0.35; pr.vel.x *= 0.6; pr.vel.z *= 0.6; }
            else { pr.pos.copy(_v); pr.vel.x *= -0.4; pr.vel.z *= -0.4; }
          } else {
            if (pr.pos.y < floor) pr.pos.y = floor + 0.05;
            if (p.explode) this.explode(pr.owner, pr.pos, p.explode, pr.def);
            else g.vfx.burst(pr.pos, pr.color, 6, 3, 0.04, 0.2);
            done = true;
          }
        }
        if (p.kind === 'grenade' && p.fuse && pr.age * 1000 >= p.fuse) { this.explode(pr.owner, pr.pos, p.explode, pr.def); done = true; }
        if (pr.traveled > p.range && !(p.kind === 'grenade')) { if (p.explode) this.explode(pr.owner, pr.pos, p.explode, pr.def); done = true; }
      }
      // 视觉位置：起点偏移逐渐收敛到逻辑位置
      pr.visOff.multiplyScalar(Math.exp(-dt * 14));
      pr.mesh.position.copy(pr.pos).add(pr.visOff);
      if (pr.vel.lengthSq() > 0.01) pr.mesh.lookAt(_v2.copy(pr.mesh.position).add(pr.vel));
      if (p.kind !== 'bullet' && Math.random() < 0.7) g.vfx.particle(pr.mesh.position.x, pr.mesh.position.y, pr.mesh.position.z, 0, 0.3, 0, pr.color, p.kind === 'magic' ? 0.18 : 0.12, 0.25, -0.5);
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
      pos.y = g.world.floorHeight(pos.x, pos.z);
    } else if (att.target) {
      pos.copy(att.target.pos);
      pos.x += att.target.vel.x * a.delay / 1000 * 0.5; pos.z += att.target.vel.z * a.delay / 1000 * 0.5;
      pos.y = g.world.floorHeight(pos.x, pos.z);
    } else pos.copy(att.pos);
    if (a.scatter) { pos.x += (Math.random() - 0.5) * 2 * a.scatter; pos.z += (Math.random() - 0.5) * 2 * a.scatter; pos.y = g.world.floorHeight(pos.x, pos.z); }
    const tele = a.telegraph ? g.vfx.telegraph(pos, a.radius, a.delay / 1000, a.color || (att.team === g.player?.team ? '#4d9d9a' : '#cf624b')) : null;
    this.aoes.push({ owner: att, a, def, pos, t: 0, tele });
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
      if (a.vfx === 'zone') {
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
        const d = Math.hypot(t.pos.x - z.pos.x, t.pos.z - z.pos.z);
        if (d > a.radius + t.radius * 0.5) continue;
        if (t.pos.y > z.pos.y + (a.height || 3)) continue;
        let dx = t.pos.x - z.pos.x, dz = t.pos.z - z.pos.z; const dl = Math.hypot(dx, dz) || 1; dx /= dl; dz /= dl;
        if (a.pull) { dx = -dx; dz = -dz; }
        const res = t.receiveHit(z.owner, a, dx, dz);
        g.onHit(z.owner, t, res, a, z.def, true);
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
    const end = origin.clone().addScaledVector(dir, b.range);
    // 墙体截断
    const wr = g.world.raycast(origin, dir, b.range, null);
    end.copy(wr.point);
    g.vfx.beam(visual, end, b.width, def.color || '#9fe6ff', 0.12);
    for (const t of this.enemiesOf(att)) {
      // 点到线段距离
      const c = t.center(_v3);
      const ab = _v.copy(end).sub(origin); const L = ab.length(); ab.normalize();
      const along = Math.max(0, Math.min(L, _v2.copy(c).sub(origin).dot(ab)));
      const closest = _v2.copy(origin).addScaledVector(ab, along);
      if (closest.distanceTo(c) > b.width + t.radius + 0.3) continue;
      const res = t.receiveHit(att, { dmg: b.dmg, stun: b.stun, knock: b.knock, launch: b.launch || 0, drain: b.drain, effect: b.effect }, dir.x, dir.z);
      g.onHit(att, t, res, b, def, true);
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
      for (const o of allies) { const d = o.pos.distanceTo(att.pos); if (d > (h.range || 20)) continue; const r = o.hp / o.maxHp; if (r < br) { br = r; best = o; } }
      targets = [best];
    } else targets = allies.filter((o) => o.pos.distanceTo(att.pos) <= (h.radius || 12));
    for (const t of targets) {
      const amt = (h.amount || 0) + t.maxHp * (h.pct || 0);
      const got = t.heal(amt, att);
      if (h.hot) t.addEffect({ type: 'hot', t: h.hot.t, hps: h.hot.hps, src: att });
      if (h.armor) t.armor = Math.max(t.armor, h.armor);
      if (h.shield) t.addEffect({ type: 'shield', t: h.shield.t, amount: h.shield.amount });
      g.vfx.burst(t.center(_v3), '#ffe7a0', 18, 3, 0.08, 0.7, -3);
      g.vfx.ring(t.pos, 1.4, '#ffe7a0', 0.5);
    }
    g.sfx('heal', att.pos);
  }

  // ---- 瞬移到目标身后 ----
  doBlink(att, b) {
    const g = this.game;
    let t = null;
    if (att.isPlayer) {
      const o = att.eyePos(new THREE.Vector3());
      const r = g.world.raycast(o, att.aimDir, b.range || 10, g.fighters, att.team, att);
      t = r.fighter;
      if (!t) { // 准星附近最近的敌人
        let best = 30 * DEG;
        for (const e of this.enemiesOf(att)) { const dx = e.pos.x - att.pos.x, dz = e.pos.z - att.pos.z; if (Math.hypot(dx, dz) > (b.range || 10)) continue; const a = Math.abs(wrapAngle(Math.atan2(dx, dz) - att.yaw)); if (a < best) { best = a; t = e; } }
      }
    } else t = att.target;
    g.vfx.burst(att.center(_v3), '#6a4a9a', 20, 3, 0.12, 0.5, -1);
    if (!t || t.pos.distanceTo(att.pos) > (b.range || 10) + 1) {
      // 没有目标：向前瞬移
      const f = att.forward(); const nx = att.pos.x + f.x * (b.range || 10) * 0.5, nz = att.pos.z + f.z * (b.range || 10) * 0.5;
      const res = g.world.resolve(att, nx, att.pos.y, nz); att.pos.set(res.x, res.y, res.z);
    } else {
      const tf = t.forward();
      const nx = t.pos.x - tf.x * 1.3, nz = t.pos.z - tf.z * 1.3;
      const res = g.world.resolve(att, nx, t.pos.y, nz); att.pos.set(res.x, res.y, res.z);
      att.yaw = Math.atan2(t.pos.x - att.pos.x, t.pos.z - att.pos.z);
      if (att === g.player) { g.viewYaw = att.yaw; }
      if (att.remote) att.netYawReset = (att.netYawReset || 0) + 1;
    }
    g.vfx.burst(att.center(_v3), '#6a4a9a', 20, 3, 0.12, 0.5, -1);
    g.sfx('shadow_step', att.pos);
  }

  clear() {
    for (const p of this.projectiles) p.mesh.removeFromParent();
    this.projectiles.length = 0;
    this.aoes.length = 0;
  }
}
