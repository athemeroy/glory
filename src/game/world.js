// 关卡碰撞：轴对齐盒 + 地面 + 边界；射线与遮挡检测。
import * as THREE from 'three';
import { segAABB, distPointToVSeg } from '../engine/util.js';

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
    const h = f.height;
    let wallHit = false, grounded = false, ceiling = false;
    const feetPrev = f.pos.y;
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

  floorHeight(x, z) {
    let floor = this.level && this.level.floorAt ? this.level.floorAt(x, z) : 0;
    for (const c of this.colliders) {
      if (x < c.min[0] || x > c.max[0] || z < c.min[2] || z > c.max[2]) continue;
      if (c.max[1] > floor && c.max[1] < 6) floor = c.max[1];
    }
    return floor;
  }

  // 线段是否被墙体遮挡
  blocked(p0, p1) {
    for (const c of this.colliders) {
      if (c.tag === 'platform' || c.tag === 'step') continue;
      const t = segAABB(p0, p1, c.min, c.max);
      if (t >= 0 && t < 1) return true;
    }
    return false;
  }

  // 射线：返回 { dist, point, fighter }
  raycast(origin, dir, maxDist, fighters, ignoreTeam, self) {
    let best = maxDist, hitF = null;
    const end = new THREE.Vector3().copy(origin).addScaledVector(dir, maxDist);
    for (const c of this.colliders) {
      const t = segAABB(origin, end, c.min, c.max);
      if (t >= 0 && t * maxDist < best) best = t * maxDist;
    }
    // 地面
    if (dir.y < -1e-4) { const t = (0 - origin.y) / dir.y; if (t > 0 && t < best) best = t; }
    if (fighters) {
      const p = new THREE.Vector3();
      for (const f of fighters) {
        if (f === self || !f.alive || f.team === ignoreTeam) continue;
        // 步进采样：胶囊近似
        const toC = new THREE.Vector3(f.pos.x - origin.x, f.pos.y + f.height * 0.5 - origin.y, f.pos.z - origin.z);
        const along = toC.dot(dir);
        if (along < 0 || along > best) continue;
        p.copy(origin).addScaledVector(dir, along);
        const d = distPointToVSeg(p.x, p.y, p.z, f.pos.x, f.pos.y + f.radius, f.pos.y + f.height - f.radius * 0.5, f.pos.z);
        if (d < f.radius * 1.05) { best = along; hitF = f; }
      }
    }
    return { dist: best, point: new THREE.Vector3().copy(origin).addScaledVector(dir, best), fighter: hitF };
  }
}
