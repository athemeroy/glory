// 断桥庭院（1v1）：可战斗区 x∈[-24,24]、z∈[-18,18]。
// 中央决斗圆（r=7.5），两侧翼各一个 2m 高台（带两端台阶），残垣分隔中路与侧翼；双方出生点 (0,±12)。
import * as THREE from 'three';
import { Kit, rng, TAU, lerp } from './kit.js';
import { baseMats, flatRing, flatShape, starShape, balustrade, brazier, pagoda, archGeo } from './props.js';

const BX = 24, BZ = 18;

export function buildCourtyard(ctx) {
  const kit = new Kit(ctx, 'courtyard', '断桥庭院');
  const R = rng(4242);
  baseMats(kit, {});
  kit.mat('plaza', { tex: 'stone', tile: 3.4, color: 0xe2ddd2, roughness: 0.72, bump: 0.022 });
  kit.mat('plazaWorn', { tex: 'stone', tile: 3.4, color: 0xc9c1b2, roughness: 0.8, bump: 0.022 });
  kit.mat('plazaDark', { tex: 'stone', tile: 1.6, color: 0x7f878d, roughness: 0.6 });
  kit.mat('block', { tex: 'stone', tile: 1.7, color: 0xd3cec4, roughness: 0.85, bump: 0.03 });
  kit.mat('blockDark', { tex: 'stone', tile: 1.4, color: 0xa39e95, roughness: 0.9, bump: 0.03 });
  kit.mat('rock', { vertexColors: true, roughness: 1, env: 0.4 });
  kit.mat('tealStone', { tex: 'stone', tile: 1.2, color: 0x5f9f9b, roughness: 0.5 });
  kit.mat('roofTile', { tex: 'iron', tile: 1.5, color: 0x6f878a, roughness: 0.7, metalness: 0.2 });
  kit.mat('pineLeaf', { color: 0x4a6a44, roughness: 0.95, env: 0.4 });
  kit.mat('pineTrunk', { tex: 'wood', tile: 0.8, color: 0x8a7a6a, roughness: 0.9 });
  kit.mat('farWall', { color: 0xd8d2c6, roughness: 0.9, env: 0.5 });

  // ---------- 天空、远景、光 ----------
  const sunDir = [0.78, 0.86, 0.18];
  kit.sky({ top: 0x2f6fbf, horizon: 0xcfdeea, bottom: 0xd6e0e8, sunDir, sunColor: 0xffe6c0, clouds: 0.5, cloudShade: 0xa9b8cc });
  kit.mountains({ seed: 31, count: 30, rMin: 230, rMax: 330, hMin: 110, hMax: 230, base: -130, aspect: [0.16, 0.28], seg: 14, hseg: 12, colTop: 0x5a7457, colMid: 0x8193a0, colBase: 0xbfccd6 });
  kit.mountains({ seed: 32, count: 18, rMin: 380, rMax: 450, hMin: 120, hMax: 220, base: -120, aspect: [0.35, 0.6], colTop: 0x92a6b4, colMid: 0xa3b5c2, colBase: 0xc9d6de, key: 'mountainFar' });
  kit.hemi(0xdfeaf5, 0x8f8272, 0.85);
  kit.sun({ dir: sunDir, color: 0xfff1dc, intensity: 3.3, extent: 32, center: [0, 0, 0], dist: 70 });

  // ---------- 地台与崖体 ----------
  kit.slab('plaza', [-BX - 0.5, -0.4, -BZ - 0.5], [BX + 0.5, 0, BZ + 0.5], { cast: false });
  kit.slab('block', [-BX - 0.3, -3.5, -BZ - 0.3], [BX + 0.3, -0.4, BZ + 0.3], { cast: false });
  kit.slab('stoneTrim', [-BX - 0.7, -0.55, -BZ - 0.7], [BX + 0.7, -0.35, BZ + 0.7], { cast: false });
  kit.rockMass('rock', [0, -3.2, 0], 33, 70, { seed: 7, tip: 0.1, seg: 18 });
  kit.rockMass('rock', [2, -14, -30], 14, 30, { seed: 8 });
  kit.rockMass('rock', [-6, -12, 30], 16, 34, { seed: 9 });

  // ---------- 地面纹样 ----------
  flatRing(kit, 'bronze', 0, 0.006, 0, 7.4, 7.6, 96);
  flatRing(kit, 'plazaDark', 0, 0.004, 0, 6.8, 7.4, 96);
  flatRing(kit, 'bronze', 0, 0.006, 0, 6.72, 6.8, 96);
  flatRing(kit, 'tealStone', 0, 0.005, 0, 3.9, 4.05, 72);
  flatShape(kit, 'bronze', starShape(2.4, 0.9, 8, Math.PI / 8), 0, 0, 0, 0.008);
  flatShape(kit, 'tealStone', starShape(1.3, 0.55, 4, 0), 0, 0, 0, 0.011);
  flatRing(kit, 'plazaDark', 0, 0.012, 0, 0.35, 0.5, 32);
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const len = dx ? BX - 7.6 : BZ - 7.6;
    const cx = dx * (7.6 + len / 2), cz = dz * (7.6 + len / 2);
    kit.box('bronze', [cx, 0.004, cz], dx ? [len, 0.008, 0.14] : [0.14, 0.008, len], { cast: false });
    kit.box('tealStone', [dx * 7.5, 0.008, dz * 7.5], [0.7, 0.016, 0.7], { rotY: Math.PI / 4, cast: false });
    // 1/4 圆弧外的方格引导线
    for (const k of [-1, 1]) {
      if (dx) kit.box('plazaDark', [cx, 0.003, k * 3.2], [len, 0.006, 0.1], { cast: false });
      else kit.box('plazaDark', [k * 3.2, 0.003, cz], [0.1, 0.006, len], { cast: false });
    }
  }
  // 磨损色块：打破大面积同色地面
  for (let i = 0; i < 26; i++) {
    const x = (R() - 0.5) * 44, z = (R() - 0.5) * 32;
    if (Math.hypot(x, z) < 7.8) continue;
    const w = 1.5 + R() * 4, d = 1.5 + R() * 3;
    kit.slab('plazaWorn', [x - w / 2, 0, z - d / 2], [x + w / 2, 0.002, z + d / 2], { cast: false });
  }
  // 出生标记
  for (const s of [-1, 1]) flatRing(kit, 'bronze', 0, 0.006, s * 12, 0.9, 1.0, 40);

  // ---------- 外沿栏杆（留出入口/桥口的视觉缺口，碰撞全封闭） ----------
  const E = 0.25;
  const railSeg = (a, b) => balustrade(kit, 'stoneTrim', a, b, 0, 1.05, { collide: false });
  railSeg([-BX - E, BZ + E], [-3.2, BZ + E]); railSeg([3.2, BZ + E], [BX + E, BZ + E]);
  railSeg([-BX - E, -BZ - E], [-3.2, -BZ - E]); railSeg([3.2, -BZ - E], [BX + E, -BZ - E]);
  for (const sx of [-1, 1]) {
    railSeg([sx * (BX + E), -BZ - E], [sx * (BX + E), -2.4]);
    railSeg([sx * (BX + E), 2.4], [sx * (BX + E), BZ + E]);
  }
  kit.collider([-BX - 1, 0, BZ], [BX + 1, 3, BZ + 1], 'wall');
  kit.collider([-BX - 1, 0, -BZ - 1], [BX + 1, 3, -BZ], 'wall');
  kit.collider([BX, 0, -BZ - 1], [BX + 1, 3, BZ + 1], 'wall');
  kit.collider([-BX - 1, 0, -BZ - 1], [-BX, 3, BZ + 1], 'wall');

  // ---------- 掩体：四块刻纹石台 ----------
  const cover = (x, z) => {
    const sx = 3.2, sy = 1.15, sz = 1.3;
    kit.slab('block', [x - sx / 2, 0, z - sz / 2], [x + sx / 2, sy, z + sz / 2]);
    kit.slab('blockDark', [x - sx / 2 - 0.08, 0, z - sz / 2 - 0.08], [x + sx / 2 + 0.08, 0.18, z + sz / 2 + 0.08]);
    kit.slab('stoneTrim', [x - sx / 2 - 0.05, sy, z - sz / 2 - 0.05], [x + sx / 2 + 0.05, sy + 0.1, z + sz / 2 + 0.05]);
    for (const s of [-1, 1]) {
      kit.slab('blockDark', [x - sx / 2 + 0.25, 0.3, z + s * (sz / 2) - 0.02], [x + sx / 2 - 0.25, sy - 0.18, z + s * (sz / 2) + 0.02], { cast: false });
      kit.slab('bronze', [x - 0.35, 0.5, z + s * (sz / 2 + 0.02) - 0.01], [x + 0.35, 0.8, z + s * (sz / 2 + 0.02) + 0.01], { cast: false });
    }
    kit.collider([x - sx / 2 - 0.05, 0, z - sz / 2 - 0.05], [x + sx / 2 + 0.05, sy + 0.1, z + sz / 2 + 0.05], 'wall');
  };
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) cover(sx * 6.2, sz * 7.4);

  // ---------- 断柱 ----------
  const brokenColumn = (x, z, h, seed) => {
    const r = rng(seed);
    kit.solid('stoneTrim', [x - 0.75, 0, z - 0.75], [x + 0.75, 0.45, z + 0.75], 'pillar');
    kit.add('block', new THREE.TorusGeometry(0.58, 0.09, 6, 20), { pos: [x, 0.5, z], rot: [Math.PI / 2, 0, 0], order: 'XYZ' });
    const g = new THREE.CylinderGeometry(0.52, 0.56, h, 16, 3);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      if (p.getY(i) > h / 2 - 0.01) {
        const a = Math.atan2(p.getZ(i), p.getX(i));
        p.setY(i, p.getY(i) - (0.25 + 0.3 * Math.sin(a * 2 + seed) + 0.15 * Math.sin(a * 5 + seed * 2) + 0.2) * (Math.hypot(p.getX(i), p.getZ(i)) > 0.1 ? 1 : 0.6));
      }
    }
    g.computeVertexNormals();
    kit.add('block', g, { pos: [x, 0.45 + h / 2, z] });
    for (let k = 0; k < 4; k++) {
      const a = k / 4 * TAU + 0.3;
      kit.box('bronze', [x + Math.cos(a) * 0.53, 1.6, z + Math.sin(a) * 0.53], [0.08, 0.12, 0.08], { rotY: -a, cast: false });
    }
    kit.add('bronze', new THREE.TorusGeometry(0.54, 0.035, 4, 24), { pos: [x, 1.6, z], rot: [Math.PI / 2, 0, 0], order: 'XYZ', cast: false });
    kit.collider([x - 0.56, 0, z - 0.56], [x + 0.56, 0.45 + h - 0.3, z + 0.56], 'pillar');
    // 脚边碎块（很低，不挡路）
    for (let k = 0; k < 4; k++) {
      const a = r() * TAU, d = 0.9 + r() * 0.5, s = 0.12 + r() * 0.16;
      kit.box('block', [x + Math.cos(a) * d, s / 2, z + Math.sin(a) * d], [s * 1.4, s, s], { rot: [r() * 0.4, r() * 3, r() * 0.4], cast: false });
    }
  };
  brokenColumn(-10, 0, 3.4, 3);
  brokenColumn(10, 0, 2.7, 5);

  // ---------- 残垣（中路与侧翼的分隔） ----------
  const ruinWall = (x, z0, z1, seed) => {
    const r = rng(seed);
    const n = Math.round(Math.abs(z1 - z0) / 0.9);
    const step = (z1 - z0) / n;
    for (let i = 0; i < n; i++) {
      const za = z0 + step * i, zb = za + step;
      const edge = Math.min(i, n - 1 - i);
      const h = edge === 0 ? 0.55 + r() * 0.35 : 0.95 + r() * 0.65;
      const lo = Math.min(za, zb), hi = Math.max(za, zb);
      kit.slab('block', [x - 0.42, 0, lo + 0.01], [x + 0.42, h, hi - 0.01], { uvOff: [r(), r()] });
      if (r() < 0.5) kit.box('blockDark', [x + (r() - 0.5) * 0.1, h + 0.12, (lo + hi) / 2], [0.7, 0.24, step * 0.8], { rotY: (r() - 0.5) * 0.3 });
      kit.collider([x - 0.45, 0, lo], [x + 0.45, h + 0.1, hi], 'wall');
    }
    kit.slab('blockDark', [x - 0.55, 0, Math.min(z0, z1)], [x + 0.55, 0.22, Math.max(z0, z1)]);
  };
  for (const sx of [-1, 1]) { ruinWall(sx * 11.6, -10.6, -5, 11 + sx); ruinWall(sx * 11.6, 5, 10.6, 21 + sx); }

  // ---------- 两个 2m 高台 + 台阶 ----------
  const platforms = [];
  for (const sx of [-1, 1]) {
    const x0 = sx > 0 ? 14 : -21, x1 = sx > 0 ? 21 : -14, z0 = -5, z1 = 5, h = 2.0;
    kit.slab('block', [x0, 0, z0], [x1, h - 0.3, z1]);
    kit.slab('plaza', [x0, h - 0.3, z0], [x1, h, z1]);
    kit.slab('stoneTrim', [x0 - 0.12, h - 0.14, z0 - 0.12], [x1 + 0.12, h + 0.02, z1 + 0.12], { cast: false });
    kit.slab('blockDark', [x0 - 0.1, 0, z0 - 0.1], [x1 + 0.1, 0.3, z1 + 0.1]);
    kit.collider([x0, 0, z0], [x1, h, z1], 'platform');
    platforms.push({ min: [x0, 0, z0], max: [x1, h, z1], top: h });
    // 墙面浮雕带（面向中路）
    const fx = sx > 0 ? x0 : x1;
    kit.slab('bronze', [fx - 0.03, 1.15, -3.2], [fx + 0.03, 1.25, 3.2], { cast: false });
    for (const zz of [-2.2, 0, 2.2]) kit.box('tealStone', [fx, 0.8, zz], [0.08, 0.5, 0.5], { rot: [Math.PI / 4, 0, 0], order: 'XYZ', cast: false });
    // 台阶：两端各 5 级，每级 0.4m
    const cx = sx * 17.5;
    kit.stairs('stoneTrim', { x: cx, z: z1 + 2.5, dir: 'z-', width: 3.2, height: h, steps: 5, depth: 0.5 });
    kit.stairs('stoneTrim', { x: cx, z: z0 - 2.5, dir: 'z+', width: 3.2, height: h, steps: 5, depth: 0.5 });
    for (const zs of [z1, z0]) {
      const zc = zs + Math.sign(zs) * 1.25;
      for (const k of [-1, 1]) kit.solid('block', [cx + k * 1.6 - 0.2 + (k > 0 ? 0 : 0), 0, zc - 1.25], [cx + k * 1.6 + 0.2, 0.6, zc + 1.25], 'wall');
    }
    // 外沿栏杆 + 台上火盆与旗杆
    const ox = sx > 0 ? x1 - 0.2 : x0 + 0.2;
    balustrade(kit, 'stoneTrim', [ox, z0 + 0.2], [ox, z1 - 0.2], h, 1.0);
    brazier(kit, ox - sx * 0.9, 0, { y0: h, ped: 0.8 });
    for (const zz of [z0 + 0.4, z1 - 0.4]) {
      kit.cyl('iron', [ox, h, zz], 0.06, 0.07, 5.2, 8);
      kit.box('bronze', [ox, h + 5.0, zz], [0.08, 0.08, 1.2], { rotY: 0 });
      kit.add('bronze', new THREE.ConeGeometry(0.1, 0.35, 6), { pos: [ox, h + 5.4, zz] });
      kit.banner([ox, h + 4.95, zz], Math.PI / 2, 0.9, 3.0, 0);
    }
  }

  // ---------- 入口（+z，玩家身后）与后台（-z，敌方身后）----------
  kit.bannerVariants = [
    { bg: '#2e6d6a', bg2: '#1c4644', trim: '#c9a764', emblem: '#efe2c0' },
    { bg: '#e7e2d7', bg2: '#cfc8b8', trim: '#a98954', emblem: '#3f7f7c' },
  ];
  for (const sz of [-1, 1]) {
    for (const sx of [-1, 1]) {
      brazier(kit, sx * 4.6, sz * 16.9, { ped: 1.2 });
      kit.cyl('iron', [sx * 7.4, 0, sz * 17.4], 0.07, 0.08, 6.0, 8);
      kit.add('bronze', new THREE.ConeGeometry(0.12, 0.4, 6), { pos: [sx * 7.4, 6.2, sz * 17.4] });
      kit.box('bronze', [sx * 7.4, 5.9, sz * 17.4], [1.1, 0.08, 0.08]);
      kit.banner([sx * 7.4, 5.85, sz * 17.4 - sz * 0.08], 0, 0.95, 3.4, 0);
      kit.collider([sx * 7.4 - 0.15, 0, sz * 17.4 - 0.15], [sx * 7.4 + 0.15, 6, sz * 17.4 + 0.15], 'pillar');
    }
  }
  // 入口石阶（向下，出界，仅视觉）
  for (let i = 0; i < 8; i++) kit.slab('stoneTrim', [-3.2, -0.3 - i * 0.3, BZ + 0.5 + i * 0.55], [3.2, -i * 0.3, BZ + 0.5 + (i + 1) * 0.55], { cast: false });
  for (const sx of [-1, 1]) kit.slab('block', [sx * 3.2 - 0.3, -2.8, BZ + 0.3], [sx * 3.2 + 0.3, 0.5, BZ + 4.9]);
  // 后台（-z）：升起的平台 + 台阶 + 牌楼亭
  const TZ0 = -BZ - 0.5, TZ1 = -33, TH = 2.6;
  kit.slab('block', [-11, -3.5, TZ1], [11, TH - 0.3, TZ0 - 3.0]);
  kit.slab('plaza', [-11, TH - 0.3, TZ1], [11, TH, TZ0 - 3.0], { cast: false });
  kit.slab('stoneTrim', [-11.15, TH - 0.14, TZ1 - 0.15], [11.15, TH + 0.02, TZ0 - 2.85], { cast: false });
  for (let i = 0; i < 6; i++) {
    const hh = TH * (i + 1) / 6;
    kit.slab('stoneTrim', [-3.2, 0, TZ0 - 0.5 * (i + 1)], [3.2, hh, TZ0 - 0.5 * i], { cast: false });
  }
  for (const sx of [-1, 1]) {
    kit.slab('block', [sx * 3.2 - 0.3 * (sx > 0 ? 0 : 1) - (sx > 0 ? 0 : 0), 0, TZ0 - 3.0], [sx * 3.2 + 0.3 * (sx > 0 ? 1 : 0), TH + 0.5, TZ0]);
    balustrade(kit, 'stoneTrim', [sx * 3.6, TZ0 - 3.0], [sx * 11, TZ0 - 3.0], TH, 1.0, { collide: false });
    brazier(kit, sx * 4.4, TZ0 - 3.8, { y0: TH, ped: 0.9, collide: false });
  }
  // 牌楼亭
  {
    const z = -27.5, y0 = TH;
    for (const sx of [-1, 1]) for (const zz of [z - 2.2, z + 2.2]) {
      kit.slab('stoneTrim', [sx * 4.2 - 0.55, y0, zz - 0.55], [sx * 4.2 + 0.55, y0 + 0.5, zz + 0.55]);
      kit.cyl('woodDark', [sx * 4.2, y0 + 0.5, zz], 0.3, 0.32, 5.2, 12, { swap: true });
      kit.cyl('bronze', [sx * 4.2, y0 + 5.4, zz], 0.36, 0.36, 0.2, 12);
    }
    kit.slab('woodDark', [-5.2, y0 + 5.6, z - 2.6], [5.2, y0 + 6.2, z + 2.6]);
    kit.slab('bronze', [-5.25, y0 + 5.62, z + 2.58], [5.25, y0 + 5.72, z + 2.64], { cast: false });
    kit.slab('tealStone', [-4.8, y0 + 5.75, z + 2.61], [4.8, y0 + 6.05, z + 2.66], { cast: false });
    const roof = new THREE.CylinderGeometry(1.2, 8.4, 2.4, 4, 1);
    roof.rotateY(Math.PI / 4); roof.scale(1, 1, 0.62);
    kit.add('roofTile', roof, { pos: [0, y0 + 7.4, z] });
    kit.slab('roofTile', [-1.4, y0 + 8.5, z - 0.35], [1.4, y0 + 8.9, z + 0.35]);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      kit.add('bronze', new THREE.ConeGeometry(0.16, 0.9, 5), { pos: [sx * 5.8, y0 + 6.5, z + sz * 3.6], rot: [sz * 0.9, 0, -sx * 0.9], order: 'XYZ' });
    }
    for (const sx of [-1, 1]) {
      kit.add('bronze', new THREE.ConeGeometry(0.22, 1.1, 6), { pos: [sx * 1.6, y0 + 9.4, z] });
      kit.banner([sx * 2.6, y0 + 5.55, z + 2.7], 0, 0.8, 2.6, 0);
    }
    kit.banner([0, y0 + 5.55, z + 2.7], 0, 1.4, 2.2, 1);
  }

  // ---------- 断桥（±x 方向伸出） ----------
  const bridge = (sx) => {
    const x0 = sx * (BX + 0.5), W = 4.2;
    const len = 12 + R() * 2;
    const xa = x0, xb = x0 + sx * len;
    kit.slab('stoneTrim', [Math.min(xa, xb), -0.7, -W / 2], [Math.max(xa, xb), -0.05, W / 2]);
    // 断口：锯齿碎块
    for (let i = 0; i < 5; i++) {
      const xx = xb + sx * (0.3 + i * 0.6), w = W * (0.8 - i * 0.14) * (0.6 + R() * 0.4), zc = (R() - 0.5) * (W - w);
      kit.slab('stoneTrim', [Math.min(xx, xx + sx * 0.6), -0.7 - R() * 0.2, zc - w / 2], [Math.max(xx, xx + sx * 0.6), -0.05 - i * 0.12, zc + w / 2]);
    }
    for (let i = 0; i < 3; i++) kit.box('block', [xb + sx * (0.5 + R() * 2), -1.4 - i * 0.9, (R() - 0.5) * 3], [0.5 + R() * 0.6, 0.4, 0.5 + R() * 0.6], { rot: [R(), R(), R()], cast: false });
    // 两侧矮栏（残缺）
    for (const sz of [-1, 1]) {
      const l2 = len * (sz > 0 ? 0.75 : 0.5);
      kit.slab('stoneTrim', [Math.min(xa, xa + sx * l2), -0.05, sz * W / 2 - (sz > 0 ? 0.3 : 0)], [Math.max(xa, xa + sx * l2), 0.75, sz * W / 2 + (sz > 0 ? 0 : 0.3)]);
    }
    // 桥墩与拱
    const pierX = [x0 + sx * 1.5, x0 + sx * 9.5];
    for (const px of pierX) kit.slab('block', [px - 1.0, -26, -W / 2 + 0.2], [px + 1.0, -0.7, W / 2 - 0.2], { cast: false });
    const ag = archGeo(3.0, 0.0, 0.9, W - 0.2, 1.0, 12);
    kit.add('block', ag, { pos: [(pierX[0] + pierX[1]) / 2, -4.3, 0], cast: false });
    // 桥下垂藤：几根长条
    for (let i = 0; i < 6; i++) kit.box('pineLeaf', [xa + sx * (2 + R() * (len - 3)), -2.2 - R() * 1.5, (R() > 0.5 ? 1 : -1) * (W / 2 - 0.05)], [0.08, 2.5 + R() * 2, 0.08], { cast: false });
  };
  bridge(1); bridge(-1);

  // ---------- 松树（台外崖边） ----------
  const pineSpots = [[-27.5, 13], [-28.5, 5.5], [-27, -12.5], [27.5, -13], [28.5, -6], [27, 12.5], [-16, 22.5], [16, 22.5], [-14, -22], [14, -22], [-9, -31], [9, -31]];
  for (const [x, z] of pineSpots) kit.pine('pineLeaf', 'pineTrunk', [x, (z < -21 && Math.abs(x) < 11) ? 2.6 : -3.3, z], (z < -21 && Math.abs(x) < 11) ? 5 + R() * 2 : 8 + R() * 4, R);

  // ---------- 远处浮岛、宝塔、瀑布 ----------
  const islands = [[-120, 26, -130, 16], [135, 18, -95, 13], [-150, 8, 55, 12], [150, 30, 80, 18], [30, 42, -190, 20]];
  kit.mat('pagodaWall', { color: 0xd8cfbf, roughness: 0.9, env: 0.5 });
  kit.mat('pagodaRoof', { color: 0x4f6365, roughness: 0.8, env: 0.5 });
  const falls = [];
  islands.forEach(([x, y, z, r], i) => {
    kit.rockMass('rock', [x, y, z], r, r * 2.6, { seed: 40 + i, receive: false, tile: 14 });
    for (let k = 0; k < 5; k++) kit.pine('pineLeaf', 'pineTrunk', [x + (R() - 0.5) * r * 1.2, y, z + (R() - 0.5) * r * 1.2], 5 + R() * 5, R);
    if (i % 2 === 0) pagoda(kit, x + r * 0.2, y, z - r * 0.1, 1.6 + r * 0.05, 'pagodaWall', 'pagodaRoof');
    const d = Math.atan2(-x, -z);
    if (i < 4) falls.push([x + Math.sin(d) * r * 0.95, y - 0.3, z + Math.cos(d) * r * 0.95, 2.2 + r * 0.1, r * 2.2]);
  });
  // 瀑布：竖直面片 + 流动噪声
  {
    const pos = [], uv = [], idx = [];
    for (const [x, y, z, w, h] of falls) {
      const dir = Math.atan2(-x, -z);
      const c = Math.cos(dir), s = Math.sin(dir);
      const b = pos.length / 3;
      const p = (u, v) => [x + u * c, y - v, z - u * s];
      pos.push(...p(-w / 2, 0), ...p(w / 2, 0), ...p(w / 2 * 1.4, h), ...p(-w / 2 * 1.4, h));
      uv.push(0, 0, 1, 0, 1, 1, 0, 1);
      idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    const m = new THREE.ShaderMaterial({
      uniforms: { uTime: kit.uTime },
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: /* glsl */`
        uniform float uTime; varying vec2 vUv;
        float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }
        float n(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f); return mix(mix(h(i),h(i+vec2(1,0)),f.x), mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x), f.y); }
        void main(){
          float streak = n(vec2(vUv.x * 14.0, vUv.y * 3.0 - uTime * 1.6)) * 0.6 + n(vec2(vUv.x * 30.0, vUv.y * 6.0 - uTime * 2.4)) * 0.4;
          float edge = smoothstep(0.0, 0.2, vUv.x) * smoothstep(1.0, 0.8, vUv.x);
          float a = edge * (0.35 + streak * 0.55) * (1.0 - smoothstep(0.55, 1.0, vUv.y));
          gl_FragColor = vec4(vec3(0.93, 0.96, 1.0), a * 0.85);
          #include <colorspace_fragment>
        }`,
    });
    const mesh = new THREE.Mesh(g, m); mesh.name = 'waterfalls'; mesh.renderOrder = 5;
    kit.group.add(mesh); kit.disposables.push(g, m);
  }

  kit.finish();
  const background = new THREE.Color(0xe3ebf0);
  const fog = new THREE.Fog(0xe3ebf0, 40, 480);
  kit.bakeEnv([0, 2, 0], background, 0.5);

  return kit.result({
    background, fog,
    bounds: { minX: -BX, maxX: BX, minZ: -BZ, maxZ: BZ },
    spawns: { player: [0, 0, 12, Math.PI], enemy: [0, 0, -12, 0] },
    markers: {
      center: [0, 0],
      duelRadius: 7.5,
      platforms,
      covers: [[-6.2, -7.4], [6.2, -7.4], [-6.2, 7.4], [6.2, 7.4]],
      columns: [[-10, 0], [10, 0]],
      stairs: [[17.5, 6.25], [17.5, -6.25], [-17.5, 6.25], [-17.5, -6.25]],
    },
  });
}
