// 关卡碰撞：轴对齐盒 + 地面 + 边界；射线与遮挡检测。
import * as THREE from 'three';
import { segAABB } from '../engine/util.js';
import { segmentHitCharacter } from './combat-volumes.js';

const STEP = 0.46;

export class World {
  constructor() {
    this.colliders = [];
    this.bounds = { minX: -50, maxX: 50, minZ: -50, maxZ: 50 };
    this.killY = -20;
  }
  setLevel(level) {
    this.level = level;
    this.colliders = level.colliders;
    this.bounds = level.bounds || this.bounds;
  }

  // 返回解算后的位置
  resolve(f, nx, ny, nz) {
    const r = f.radius;
    let x = nx, y = ny, z = nz;
    const h = f.collisionHeight ?? f.height;
    let wallHit = false, grounded = false, ceiling = false;
    const feetPrev = f.pos.y;
    // Sweep before pushing out of overlaps. Fast dashes and knockbacks used to
    // cross a thin wall if their final position was already beyond its box.
    const sweepY = Math.min(feetPrev, y), sweepTop = Math.max(feetPrev, y) + h;
    let sx = f.pos.x, sz = f.pos.z, dx = nx - sx, dz = nz - sz;
    for (let pass = 0; pass < 3 && dx * dx + dz * dz > 1e-10; pass++) {
      let best = 1, normal = null;
      for (const c of this.colliders) {
        if (c.max[1] <= sweepY + STEP * (f.onGround ? 1 : 0.35) || c.min[1] >= sweepTop) continue;
        const min = [c.min[0] - r, sweepY - 1, c.min[2] - r], max = [c.max[0] + r, sweepTop + 1, c.max[2] + r];
        const start = new THREE.Vector3(sx, sweepY, sz), end = new THREE.Vector3(sx + dx, sweepY, sz + dz);
        const t = segAABB(start, end, min, max);
        if (t < 0 || t >= best) continue;
        const p = start.lerp(end, t);
        const faces = [[Math.abs(p.x - min[0]), -1, 0], [Math.abs(p.x - max[0]), 1, 0],
          [Math.abs(p.z - min[2]), 0, -1], [Math.abs(p.z - max[2]), 0, 1]];
        faces.sort((a, b) => a[0] - b[0]);
        // A tangent start has t=0 too. Only ignore it when moving away or
        // along the face, otherwise the very next dash could tunnel through.
        if (t <= 1e-7 && dx * faces[0][1] + dz * faces[0][2] >= -1e-8) continue;
        best = t; normal = faces[0];
      }
      if (!normal) { sx += dx; sz += dz; dx = 0; dz = 0; break; }
      sx += dx * Math.max(0, best - 1e-5); sz += dz * Math.max(0, best - 1e-5);
      wallHit = true;
      dx *= 1 - best; dz *= 1 - best;
      const into = dx * normal[1] + dz * normal[2];
      if (into < 0) { dx -= into * normal[1]; dz -= into * normal[2]; }
    }
    x = sx; z = sz;
    // A low ceiling is solid too, including under raised platforms.
    if (y > feetPrev) for (const c of this.colliders) {
      if (x < c.min[0] - r * 0.7 || x > c.max[0] + r * 0.7 || z < c.min[2] - r * 0.7 || z > c.max[2] + r * 0.7) continue;
      if (feetPrev + h <= c.min[1] + 0.002 && y + h >= c.min[1]) { y = c.min[1] - h; ceiling = true; }
    }
    // 水平推出
    for (let iter = 0; iter < 2; iter++) {
      for (const c of this.colliders) {
        const [x0, y0, z0] = c.min, [x1, y1, z1] = c.max;
        if (y1 <= y + STEP * (f.onGround ? 1 : 0.35) || y0 >= y + h) continue; // 可以跨上去或在头顶之上
        const cx = Math.max(x0, Math.min(x, x1));
        const cz = Math.max(z0, Math.min(z, z1));
        let dx = x - cx, dz = z - cz;
        const d2 = dx * dx + dz * dz;
        if (d2 >= r * r) continue;
        if (d2 > 1e-8) {
          const d = Math.sqrt(d2);
          x = cx + dx / d * r; z = cz + dz / d * r;
        } else {
          // 中心在盒内：沿最短轴推出
          const pl = x - x0 + r, pr = x1 - x + r, pb = z - z0 + r, pf = z1 - z + r;
          const m = Math.min(pl, pr, pb, pf);
          if (m === pl) x = x0 - r; else if (m === pr) x = x1 + r; else if (m === pb) z = z0 - r; else z = z1 + r;
        }
        wallHit = true;
      }
    }
    // 边界
    const b = this.bounds;
    if (x < b.minX + r) { x = b.minX + r; wallHit = true; }
    if (x > b.maxX - r) { x = b.maxX - r; wallHit = true; }
    if (z < b.minZ + r) { z = b.minZ + r; wallHit = true; }
    if (z > b.maxZ - r) { z = b.maxZ - r; wallHit = true; }
    // 地面高度：脚下（圆内）所有顶面不高于 当前脚+台阶 的盒子
    let floor = this.level && this.level.floorAt ? this.level.floorAt(x, z) : 0;
    const maxStep = Math.max(feetPrev, y) + (f.onGround ? STEP : 0.12);
    for (const c of this.colliders) {
      const [x0, , z0] = c.min, [x1, y1, z1] = c.max;
      if (x < x0 - r * 0.6 || x > x1 + r * 0.6 || z < z0 - r * 0.6 || z > z1 + r * 0.6) continue;
      if (y1 <= maxStep && y1 > floor) floor = y1;
    }
    if (y <= floor + 0.001) { y = floor; grounded = true; }
    else if (f.onGround && y - floor < 0.25 && f.vel.y <= 0.01) { y = floor; grounded = true; } // 贴地下台阶
    return { x, y, z, wallHit, grounded, ceiling };
  }

  floorHeight(x, z, maxHeight = Infinity) {
    let floor = this.level && this.level.floorAt ? this.level.floorAt(x, z) : 0;
    for (const c of this.colliders) {
      if (x < c.min[0] || x > c.max[0] || z < c.min[2] || z > c.max[2]) continue;
      if (c.max[1] > floor && c.max[1] < 6 && c.max[1] <= maxHeight + 1e-5) floor = c.max[1];
    }
    return floor;
  }

  // First contact with solid terrain, with optional projectile thickness.
  // Raised steps/platforms also block a bullet or sword instead of transmitting
  // damage through their undersides. Ground is the level floor, not an
  // unrelated collider's top surface above the projectile.
  traceSegment(p0, p1, radius = 0, { floor = false, ignoreSteps = false } = {}) {
    // AI path probes and level helpers also pass plain xyz coordinates.
    if (!p0.isVector3) p0 = new THREE.Vector3(p0.x, p0.y, p0.z);
    if (!p1.isVector3) p1 = new THREE.Vector3(p1.x, p1.y, p1.z);
    let best = null;
    for (const c of this.colliders) {
      if (ignoreSteps && (c.tag === 'platform' || c.tag === 'step')) continue;
      const min = radius ? c.min.map(v => v - radius) : c.min;
      const max = radius ? c.max.map(v => v + radius) : c.max;
      const t = segAABB(p0, p1, min, max);
      if (t < 0 || t > 1 || best && t >= best.fraction) continue;
      const point = p0.clone().lerp(p1, t), faces = [];
      for (let axis = 0; axis < 3; axis++) {
        const key = ['x', 'y', 'z'][axis];
        faces.push({ distance: Math.abs(point[key] - min[axis]), axis, sign: -1 });
        faces.push({ distance: Math.abs(point[key] - max[axis]), axis, sign: 1 });
      }
      faces.sort((a, b) => a.distance - b.distance);
      const normal = new THREE.Vector3(); normal.setComponent(faces[0].axis, faces[0].sign);
      best = { fraction: t, point, normal, collider: c };
    }
    if (floor) {
      const ground = (p) => this.level?.floorAt ? this.level.floorAt(p.x, p.z) : 0;
      const clearance = (t) => { const p = p0.clone().lerp(p1, t); return p.y - radius - ground(p); };
      if (clearance(0) <= 0) {
        if (!best || best.fraction > 0) best = { fraction: 0, point: p0.clone(), normal: new THREE.Vector3(0, 1, 0), floor: true };
      } else if (clearance(1) <= 0) {
        let lo = 0, hi = 1;
        for (let i = 0; i < 16; i++) { const mid = (lo + hi) * 0.5; if (clearance(mid) > 0) lo = mid; else hi = mid; }
        if (!best || hi < best.fraction) best = { fraction: hi, point: p0.clone().lerp(p1, hi), normal: new THREE.Vector3(0, 1, 0), floor: true };
      }
    }
    return best;
  }

  // Ignore only the last contact at an endpoint on the wall itself.
  blocked(p0, p1, radius = 0) {
    const hit = this.traceSegment(p0, p1, radius);
    return !!hit && hit.fraction < 1 - 1e-5;
  }

  // 射线：返回 { dist, point, fighter }
  raycast(origin, dir, maxDist, fighters, ignoreTeam, self) {
    let best = maxDist, hitF = null;
    const direction = dir.clone().normalize();
    const end = new THREE.Vector3().copy(origin).addScaledVector(direction, maxDist);
    let contact = this.traceSegment(origin, end, 0, { floor: true });
    if (contact) best = contact.fraction * maxDist;
    if (fighters) {
      for (const f of fighters) {
        if (f === self || !f.alive || f.team === ignoreTeam || f.untargetable) continue;
        const hit = segmentHitCharacter(origin, end, f);
        if (hit && hit.fraction * maxDist < best) { best = hit.fraction * maxDist; hitF = f; contact = hit; }
      }
    }
    return { dist: best, point: new THREE.Vector3().copy(origin).addScaledVector(direction, best), fighter: hitF, contact };
  }
}
