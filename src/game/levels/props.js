// 可复用的道具：武器、武器架、灯笼、火盆、栏杆、拱、宝塔、平面花纹。都写进 Kit 的材质桶（合并）。
import * as THREE from 'three';
import { TAU } from './kit.js';

// 局部坐标 → 世界：原点 (ox,oy,oz)，绕 Y 旋转 ry
export function frame(ox, oy, oz, ry = 0) {
  const c = Math.cos(ry), s = Math.sin(ry);
  return {
    ry,
    p: (x, y, z) => [ox + x * c + z * s, oy + y, oz - x * s + z * c],
  };
}

// ---------- 平面花纹 ----------
export function flatRing(kit, key, cx, y, cz, r0, r1, seg = 64, o = {}) {
  const g = new THREE.RingGeometry(r0, r1, seg, 1);
  g.rotateX(-Math.PI / 2);
  kit.add(key, g, { pos: [cx, y, cz], cast: false, ...o });
}
export function starShape(rOut, rIn, n, rot = 0) {
  const s = new THREE.Shape();
  for (let i = 0; i < n * 2; i++) {
    const r = i % 2 ? rIn : rOut, a = rot + i * Math.PI / n;
    const x = Math.cos(a) * r, y = Math.sin(a) * r;
    if (i === 0) s.moveTo(x, y); else s.lineTo(x, y);
  }
  s.closePath();
  return s;
}
export function flatShape(kit, key, shape, cx, y, cz, thick = 0.01, o = {}) {
  const g = new THREE.ExtrudeGeometry(shape, { depth: thick, bevelEnabled: false, curveSegments: 12 });
  g.rotateX(-Math.PI / 2);
  kit.add(key, g, { pos: [cx, y, cz], cast: false, ...o });
}

// ---------- 拱（圆拱/尖拱），挤出成厚板；局部 XY 平面、沿 Z 挤出，以底部中心为原点 ----------
export function archGeo(halfW, legH, thick, depth, pointed = 1, seg = 14) {
  const curve = (hw, sign) => {
    const R = hw * pointed;
    const cx0 = -hw + R;
    const th0 = Math.PI, th1 = Math.acos(Math.max(-1, Math.min(1, (0 - cx0) / R)));
    const pts = [];
    for (let i = 0; i <= seg; i++) {
      const t = th0 + (th1 - th0) * i / seg;
      pts.push([cx0 + Math.cos(t) * R, legH + Math.sin(t) * R]);
    }
    const right = pts.slice(0, -1).reverse().map(([x, y]) => [-x, y]);
    const all = pts.concat(right);
    return sign > 0 ? all : all.reverse();
  };
  const s = new THREE.Shape();
  const ho = halfW + thick;
  s.moveTo(-ho, 0);
  for (const [x, y] of curve(ho, 1)) s.lineTo(x, y);
  s.lineTo(ho, 0); s.lineTo(halfW, 0);
  for (const [x, y] of curve(halfW, -1)) s.lineTo(x, y);
  s.lineTo(-halfW, 0);
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: false, curveSegments: 4 });
  g.translate(0, 0, -depth / 2);
  return g;
}
// 拱顶的高度（外缘）
export function archApex(halfW, legH, pointed) {
  const R = halfW * pointed, cx0 = -halfW + R;
  return legH + Math.sqrt(Math.max(0, R * R - cx0 * cx0));
}

// ---------- 栏杆：a→b（xz），柱距 step ----------
export function balustrade(kit, key, a, b, y0 = 0, h = 1.0, o = {}) {
  const dx = b[0] - a[0], dz = b[1] - a[1], len = Math.hypot(dx, dz);
  const ry = Math.atan2(dx, dz) - Math.PI / 2;
  const step = o.step ?? 1.8;
  const n = Math.max(1, Math.round(len / step));
  const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  kit.box(key, [mid[0], y0 + h - 0.06, mid[1]], [len + 0.2, 0.12, 0.3], { rotY: ry });
  kit.box(key, [mid[0], y0 + 0.08, mid[1]], [len, 0.16, 0.34], { rotY: ry });
  for (let i = 0; i <= n; i++) {
    const t = i / n, x = a[0] + dx * t, z = a[1] + dz * t;
    kit.box(key, [x, y0 + h / 2, z], [0.26, h, 0.26], { rotY: ry });
    kit.box(key, [x, y0 + h + 0.06, z], [0.32, 0.12, 0.32], { rotY: ry });
    if (i < n) {
      // 两柱之间的瓶形栏杆柱
      const k = 3;
      for (let j = 1; j <= k; j++) {
        const tt = (i + j / (k + 1)) / n;
        const bx = a[0] + dx * tt, bz = a[1] + dz * tt;
        kit.add(key, new THREE.CylinderGeometry(0.05, 0.08, h - 0.28, 6), { pos: [bx, y0 + 0.16 + (h - 0.28) / 2, bz], uv: 'world' });
      }
    }
  }
  if (o.collide !== false) {
    const th = 0.36;
    kit.polyColliders([a, b], false, th, y0, y0 + Math.max(h, 1.2), 1.0, 'wall');
  }
}

// ---------- 武器 ----------
// 局部：沿 +Y 竖立，底部在 (x,y,z)，tilt 为绕局部 X 的倾斜
export function sword(kit, F, x, y, z, o = {}) {
  const ry = F.ry + (o.ry || 0), tilt = o.tilt ?? -0.06;
  const L = o.len ?? 0.85;
  const at = (dy) => F.p(x, y + dy * Math.cos(tilt), z + dy * Math.sin(tilt));
  kit.add('leather', new THREE.CylinderGeometry(0.02, 0.02, 0.2, 6), { pos: at(0.12), rot: [tilt, ry, 0], uv: 'keep' });
  kit.add('bronze', new THREE.SphereGeometry(0.032, 8, 6), { pos: at(0.01), rot: [tilt, ry, 0] });
  kit.add('bronze', new THREE.BoxGeometry(o.guard ?? 0.2, 0.035, 0.05), { pos: at(0.235), rot: [tilt, ry, 0] });
  kit.add('steel', new THREE.BoxGeometry(o.width ?? 0.05, L, 0.012), { pos: at(0.25 + L / 2), rot: [tilt, ry, 0] });
  const tip = new THREE.CylinderGeometry(0, (o.width ?? 0.05) / 2 * 1.41, 0.09, 4, 1);
  tip.rotateY(Math.PI / 4); tip.scale(1, 1, 0.24);
  kit.add('steel', tip, { pos: at(0.25 + L + 0.045), rot: [tilt, ry, 0] });
}
export function spear(kit, F, x, y, z, o = {}) {
  const ry = F.ry, tilt = o.tilt ?? -0.05;
  const L = o.len ?? 2.2;
  const at = (dy) => F.p(x, y + dy * Math.cos(tilt), z + dy * Math.sin(tilt));
  kit.add('wood', new THREE.CylinderGeometry(0.018, 0.022, L, 6), { pos: at(L / 2), rot: [tilt, ry, 0], swap: true });
  kit.add('bronze', new THREE.CylinderGeometry(0.028, 0.028, 0.06, 6), { pos: at(L), rot: [tilt, ry, 0] });
  kit.add('cloth_red', new THREE.ConeGeometry(0.06, 0.16, 7), { pos: at(L - 0.02), rot: [tilt + Math.PI, ry, 0] });
  const tip = new THREE.ConeGeometry(0.045, 0.3, 4);
  tip.scale(1, 1, 0.35);
  kit.add('steel', tip, { pos: at(L + 0.18), rot: [tilt, ry, 0] });
}
export function guandao(kit, F, x, y, z, o = {}) {
  const ry = F.ry, tilt = o.tilt ?? -0.05, L = 2.0;
  const at = (dy, dz = 0) => F.p(x, y + dy * Math.cos(tilt), z + dz + dy * Math.sin(tilt));
  kit.add('wood', new THREE.CylinderGeometry(0.022, 0.025, L, 6), { pos: at(L / 2), rot: [tilt, ry, 0], swap: true });
  const s = new THREE.Shape();
  s.moveTo(0, 0); s.lineTo(0.05, 0); s.quadraticCurveTo(0.2, 0.3, 0.02, 0.62); s.quadraticCurveTo(-0.02, 0.35, -0.03, 0.05); s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: 0.012, bevelEnabled: false, curveSegments: 8 });
  g.translate(0, 0, -0.006);
  kit.add('steel', g, { pos: at(L - 0.02), rot: [tilt, ry + Math.PI / 2, 0] });
  kit.add('bronze', new THREE.CylinderGeometry(0.035, 0.03, 0.08, 6), { pos: at(L - 0.02), rot: [tilt, ry, 0] });
}
// 千机伞（收拢）——彩蛋
export function umbrella(kit, F, x, y, z, o = {}) {
  const ry = F.ry, tilt = o.tilt ?? -0.07;
  const at = (dy) => F.p(x, y + dy * Math.cos(tilt), z + dy * Math.sin(tilt));
  kit.add('iron', new THREE.CylinderGeometry(0.012, 0.012, 1.25, 6), { pos: at(0.62), rot: [tilt, ry, 0] });
  const can = new THREE.CylinderGeometry(0.018, 0.075, 0.95, 8, 1);
  kit.add('umbrella', can, { pos: at(0.72), rot: [tilt, ry + 0.2, 0], uv: 'keep' });
  for (let i = 0; i < 8; i++) {
    const a = i / 8 * TAU;
    const rib = new THREE.BoxGeometry(0.008, 0.95, 0.008);
    rib.rotateZ(0.058); rib.translate(0.047, 0, 0); rib.rotateY(a);
    kit.add('bronze', rib, { pos: at(0.72), rot: [tilt, ry, 0] });
  }
  kit.add('leather', new THREE.CylinderGeometry(0.025, 0.022, 0.22, 8), { pos: at(0.11), rot: [tilt, ry, 0], uv: 'keep' });
  kit.add('bronze', new THREE.CylinderGeometry(0.03, 0.03, 0.03, 8), { pos: at(0.23), rot: [tilt, ry, 0] });
  kit.add('steel', new THREE.ConeGeometry(0.014, 0.1, 6), { pos: at(1.3), rot: [tilt, ry, 0] });
}

// 武器架：局部沿 X 长 len，靠墙面在局部 z=-depth/2，朝局部 +Z
export function weaponRack(kit, ox, oz, ry, len, items) {
  const F = frame(ox, 0, oz, ry);
  const P = (x, y, z) => F.p(x, y, z);
  const hl = len / 2;
  kit.add('woodDark', new THREE.BoxGeometry(len, 0.14, 0.5), { pos: P(0, 0.07, 0), rotY: ry, collide: 'wall' });
  for (const sx of [-1, 1]) {
    kit.add('woodDark', new THREE.BoxGeometry(0.14, 1.95, 0.14), { pos: P(sx * (hl - 0.1), 1.05, -0.1), rotY: ry, swap: true });
    kit.add('woodDark', new THREE.BoxGeometry(0.2, 0.2, 0.46), { pos: P(sx * (hl - 0.1), 0.24, 0), rotY: ry });
    kit.add('bronze', new THREE.ConeGeometry(0.07, 0.16, 6), { pos: P(sx * (hl - 0.1), 2.1, -0.1), rotY: ry });
  }
  kit.add('woodDark', new THREE.BoxGeometry(len, 0.1, 0.14), { pos: P(0, 1.95, -0.1), rotY: ry });
  kit.add('woodDark', new THREE.BoxGeometry(len - 0.2, 0.08, 0.2), { pos: P(0, 1.05, -0.02), rotY: ry });
  kit.add('bronze', new THREE.BoxGeometry(len - 0.25, 0.03, 0.02), { pos: P(0, 1.95, -0.02), rotY: ry });
  // 碰撞：整个架子一块（不高于 2.2）
  const a = P(-hl, 0, -0.25), b = P(hl, 0, 0.3);
  kit.collider([Math.min(a[0], b[0]), 0, Math.min(a[2], b[2])], [Math.max(a[0], b[0]), 2.2, Math.max(a[2], b[2])], 'wall');
  const n = items.length;
  items.forEach((it, i) => {
    const x = -hl + 0.35 + (len - 0.7) * (n === 1 ? 0.5 : i / (n - 1));
    if (it === 'sword') sword(kit, F, x, 0.14, 0.02, { tilt: -0.1 });
    else if (it === 'broad') sword(kit, F, x, 0.14, 0.02, { tilt: -0.1, width: 0.075, len: 0.95, guard: 0.26 });
    else if (it === 'spear') spear(kit, F, x, 0.14, -0.02, { tilt: -0.04 });
    else if (it === 'guandao') guandao(kit, F, x, 0.14, -0.02, { tilt: -0.04 });
    else if (it === 'umbrella') umbrella(kit, F, x, 0.14, 0.02, { tilt: -0.1 });
  });
}

// ---------- 灯笼（六角纸灯） ----------
export function lantern(kit, x, y, z, s = 1, o = {}) {
  const h = 0.62 * s, r = 0.26 * s;
  kit.add('paper', new THREE.CylinderGeometry(r, r, h, 6, 1), { pos: [x, y, z], uv: 'keep', cast: false });
  kit.add('woodDark', new THREE.CylinderGeometry(r * 0.75, r * 1.12, 0.1 * s, 6), { pos: [x, y + h / 2 + 0.05 * s, z] });
  kit.add('woodDark', new THREE.CylinderGeometry(r * 1.12, r * 0.75, 0.1 * s, 6), { pos: [x, y - h / 2 - 0.05 * s, z] });
  for (let i = 0; i < 6; i++) {
    const a = i / 6 * TAU;
    kit.box('woodDark', [x + Math.cos(a) * r * 1.02, y, z + Math.sin(a) * r * 1.02], [0.03 * s, h, 0.03 * s], { cast: false });
  }
  kit.add('bronze', new THREE.ConeGeometry(r * 0.35, 0.16 * s, 6), { pos: [x, y + h / 2 + 0.18 * s, z] });
  kit.add('cloth_teal', new THREE.ConeGeometry(0.05 * s, 0.32 * s, 6), { pos: [x, y - h / 2 - 0.26 * s, z], rot: [Math.PI, 0, 0], cast: false });
  if (o.chainTo) kit.add('iron', new THREE.CylinderGeometry(0.012, 0.012, o.chainTo - (y + h / 2 + 0.2 * s), 4), { pos: [x, (o.chainTo + y + h / 2 + 0.2 * s) / 2, z], cast: false });
  kit.glow([x, y, z], 0.9 * s, 0xffc27a, 0.5);
}

// ---------- 火盆：石座 + 铜盆 + 火焰 ----------
export function brazier(kit, x, z, o = {}) {
  const ped = o.ped ?? 1.0, y0 = o.y0 ?? 0, stone = o.stone || 'stoneTrim', kind = o.kind || 'fire';
  if (ped > 0) {
    kit.box(stone, [x, y0 + 0.1, z], [0.95, 0.2, 0.95]);
    kit.box(stone, [x, y0 + ped / 2, z], [0.72, ped, 0.72]);
    kit.box(stone, [x, y0 + ped - 0.06, z], [0.9, 0.12, 0.9]);
    if (o.collide !== false) kit.collider([x - 0.48, y0, z - 0.48], [x + 0.48, y0 + ped + 0.5, z + 0.48], 'wall');
  }
  const top = y0 + ped;
  const pts = [[0.05, 0], [0.22, 0.02], [0.26, 0.12], [0.44, 0.22], [0.56, 0.42], [0.6, 0.48], [0.54, 0.46], [0.42, 0.3], [0.1, 0.22]].map(([a, b]) => new THREE.Vector2(a * (o.s ?? 1), b * (o.s ?? 1)));
  kit.add('bronze', new THREE.LatheGeometry(pts, 12), { pos: [x, top, z] });
  for (let i = 0; i < 4; i++) {
    const a = i / 4 * TAU + Math.PI / 4;
    kit.add('bronze', new THREE.BoxGeometry(0.06, 0.28, 0.14), { pos: [x + Math.cos(a) * 0.55 * (o.s ?? 1), top + 0.44 * (o.s ?? 1), z + Math.sin(a) * 0.55 * (o.s ?? 1)], rotY: -a });
  }
  if (kind === 'blue') {
    kit.add('ember_blue', new THREE.CylinderGeometry(0.4 * (o.s ?? 1), 0.3, 0.06, 10), { pos: [x, top + 0.34 * (o.s ?? 1), z], cast: false, uv: 'keep' });
  } else {
    kit.add('ember', new THREE.CylinderGeometry(0.4 * (o.s ?? 1), 0.3, 0.06, 10), { pos: [x, top + 0.34 * (o.s ?? 1), z], cast: false, uv: 'keep' });
  }
  kit.flame([x, top + 0.34 * (o.s ?? 1), z], 1.1 * (o.s ?? 1) * (o.fs ?? 1), kind);
  kit.glow([x, top + 0.8 * (o.s ?? 1), z], 1.3 * (o.s ?? 1), kind === 'blue' ? 0x4aa8ff : 0xff9a40, 0.45);
  return [x, top + 0.9, z];
}

// ---------- 宝塔（远景剪影） ----------
export function pagoda(kit, x, y, z, s, keyWall, keyRoof) {
  let yy = y;
  for (let i = 0; i < 3; i++) {
    const w = (3.2 - i * 0.7) * s, h = 1.6 * s;
    kit.box(keyWall, [x, yy + h / 2, z], [w, h, w], { cast: false });
    const roof = new THREE.CylinderGeometry(w * 0.3, w * 0.95, 0.9 * s, 4, 1);
    roof.rotateY(Math.PI / 4);
    kit.add(keyRoof, roof, { pos: [x, yy + h + 0.45 * s, z], cast: false });
    yy += h + 0.7 * s;
  }
  kit.add(keyRoof, new THREE.ConeGeometry(0.2 * s, 1.6 * s, 6), { pos: [x, yy + 0.6 * s, z], cast: false });
}

// ---------- 通用材质（道具要用到的键） ----------
export function baseMats(kit, o = {}) {
  kit.mat('bronze', { tex: 'bronze', tile: 0.9, color: 0xffe6b8, metalness: 0.85, roughness: 0.3, env: 2.0 });
  kit.mat('steel', { color: 0xc9d0d8, metalness: 0.85, roughness: 0.26, env: 2.2 });
  kit.mat('iron', { tex: 'iron', tile: 1.0, color: o.iron ?? 0xb9bec4, metalness: 0.7, roughness: 0.5 });
  kit.mat('leather', { tex: 'leather', tile: 0.5, color: 0xd8c3ad, roughness: 0.7 });
  kit.mat('wood', { tex: 'wood', tile: 1.6, color: o.wood ?? 0xc9b49c, roughness: 0.72, bump: 0.01 });
  kit.mat('woodDark', { tex: 'wood', tile: 1.4, color: o.woodDark ?? 0x8f7c6c, roughness: 0.68, bump: 0.01 });
  kit.mat('cloth_red', { tex: 'cloth', tile: 0.5, color: PALC.danger, roughness: 0.9 });
  kit.mat('cloth_teal', { tex: 'cloth', tile: 0.8, color: PALC.teal, roughness: 0.9 });
  kit.mat('umbrella', { tex: 'leather', tile: 0.4, color: 0x5a5f6a, roughness: 0.55 });
  kit.mat('paper', { tex: 'cloth', tile: 0.4, color: 0xfff1dc, emissive: 0xffc987, emissiveIntensity: 1.25, roughness: 0.9, noEnv: true });
  kit.mat('stoneTrim', { tex: 'stone', tile: 1.2, color: o.trim ?? 0xe0dcd3, roughness: 0.8, bump: 0.015 });
  kit.mat('ember', { color: 0x301008, emissive: 0xff6a20, emissiveIntensity: 2.2, roughness: 1, noEnv: true });
  kit.mat('ember_blue', { color: 0x081830, emissive: 0x2a8cff, emissiveIntensity: 2.2, roughness: 1, noEnv: true });
}
const PALC = { danger: 0xcf624b, teal: 0x4d9d9a };
