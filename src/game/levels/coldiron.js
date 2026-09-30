// 寒铁遗庭（副本）：入口通道 x∈[-4,4]、z∈[12,52]（8×40m）→ 铁闸门 z=11.5 → 核心圆场（圆心 0,0，战斗半径 9m）。
// 门：colliders 里 tag:'gate' 的盒子；openGate() 升起闸门并移除该碰撞盒，closeGate() 复原（失败重来时用）。
import * as THREE from 'three';
import { mergeGeometries } from '../../../vendor/BufferGeometryUtils.js';
import { Kit, rng, TAU } from './kit.js';
import { baseMats, flatRing, flatShape, starShape, brazier, archGeo } from './props.js';

const CW = 4, CZ0 = 12.2, CZ1 = 52, AR = 11.55, GATE_Z = 11.5;

export function buildColdiron(ctx) {
  const kit = new Kit(ctx, 'coldiron', '寒铁遗庭');
  const R = rng(9090);
  baseMats(kit, { iron: 0x9aa3ad });
  kit.mat('floorCold', { tex: 'stone', tile: 2.8, color: 0xc3cad3, roughness: 0.62, bump: 0.02 });
  kit.mat('wallCold', { tex: 'stone', tile: 1.9, color: 0xb3bcc6, roughness: 0.88, bump: 0.035 });
  kit.mat('wallDark', { tex: 'stone', tile: 1.5, color: 0x6d7782, roughness: 0.85, bump: 0.03 });
  kit.mat('ironDark', { tex: 'iron', tile: 1.2, color: 0xb4bdc7, metalness: 0.6, roughness: 0.45, env: 1.4 });
  kit.mat('doorIron', { tex: 'iron', tile: 1.6, color: 0x7f8a96, metalness: 0.45, roughness: 0.6, env: 1.2 });
  kit.mat('frost', { color: 0xeef3f8, roughness: 0.9, env: 0.9 });
  kit.mat('drift', { color: 0xd9e2ea, roughness: 0.95, env: 0.6 });
  kit.mat('ice', { color: 0xd6eefa, roughness: 0.12, metalness: 0.05, env: 1.6 });
  kit.mat('crystal', { color: 0x8ae8ea, emissive: 0x39c9cc, emissiveIntensity: 1.6, roughness: 0.18, metalness: 0.1, env: 1.2 });
  kit.mat('rock', { vertexColors: true, roughness: 1, env: 0.4 });

  // ---------- 天空、远景、光 ----------
  const sunDir = [-0.45, 0.62, -0.64];
  kit.sky({ top: 0x6d8db0, horizon: 0xd3dde6, bottom: 0xcbd6df, sunDir, sunColor: 0xe9f1ff, clouds: 0.72, cloudColor: 0xf1f4f8, cloudShade: 0x97a6b6, sunDisk: 0.5 });
  kit.mountains({ seed: 51, count: 30, rMin: 220, rMax: 320, hMin: 110, hMax: 220, base: -130, aspect: [0.2, 0.34], seg: 14, hseg: 12, colTop: 0x9fb0bd, colMid: 0x7f8f9d, colBase: 0xbac7d2, snow: 0.55, center: [0, 20] });
  kit.mountains({ seed: 52, count: 18, rMin: 380, rMax: 450, hMin: 140, hMax: 240, base: -140, aspect: [0.4, 0.65], colTop: 0xe4ebf2, colMid: 0xa9b8c5, colBase: 0xc9d5de, snow: 0.45, key: 'mountainFar', center: [0, 20] });
  kit.hemi(0xc6d6e8, 0x5d6670, 0.85);
  kit.sun({ dir: sunDir, color: 0xe8f0ff, intensity: 2.6, extent: 38, center: [0, 0, 20], dist: 80 });

  // ---------- 地面与崖体 ----------
  kit.cyl('floorCold', [0, -0.4, 0], AR + 0.3, AR + 0.3, 0.4, 72, { cast: false });
  kit.cyl('wallCold', [0, -3.2, 0], AR + 0.6, AR + 0.2, 2.8, 48, { cast: false });
  kit.slab('floorCold', [-CW - 1, -0.4, 9.5], [CW + 1, 0, CZ1 + 1], { cast: false });
  kit.rockMass('rock', [0, -3.1, 0], 15, 46, { seed: 3, colTop: 0xe8eef4, colHi: 0x9aa2ab, colLo: 0x5f6770 });
  for (let i = 0; i < 4; i++) kit.rockMass('rock', [(R() - 0.5) * 3, -0.5, 18 + i * 10], 9, 34 + R() * 10, { seed: 10 + i, colTop: 0xe8eef4, colHi: 0x9aa2ab, colLo: 0x5f6770 });

  // 圆场纹样
  flatRing(kit, 'bronze', 0, 0.007, 0, 9.0, 9.15, 96);
  flatRing(kit, 'wallDark', 0, 0.004, 0, 8.3, 9.0, 96);
  flatRing(kit, 'bronze', 0, 0.007, 0, 8.22, 8.3, 96);
  flatRing(kit, 'bronze', 0, 0.007, 0, 5.8, 5.9, 72);
  flatShape(kit, 'ironDark', starShape(3.2, 1.1, 8, Math.PI / 8), 0, 0, 0, 0.009);
  flatShape(kit, 'crystal', starShape(1.8, 0.5, 4, 0), 0, 0, 0, 0.012);
  flatRing(kit, 'bronze', 0, 0.013, 0, 0.3, 0.42, 24);
  for (let i = 0; i < 8; i++) {
    const a = i / 8 * TAU + Math.PI / 8;
    kit.box('bronze', [Math.cos(a) * 7.05, 0.004, Math.sin(a) * 7.05], [2.3, 0.008, 0.09], { rotY: -a, cast: false });
    kit.box('crystal', [Math.cos(a) * 8.65, 0.006, Math.sin(a) * 8.65], [0.28, 0.012, 0.28], { rotY: -a + Math.PI / 4, cast: false });
  }
  // 地面霜斑（不挡路，无碰撞）
  const frostPatch = (x, z, r) => {
    const g = new THREE.CircleGeometry(1, 12);
    const p = g.attributes.position;
    for (let i = 1; i < p.count; i++) { const k = 0.7 + R() * 0.5; p.setXY(i, p.getX(i) * k, p.getY(i) * k); }
    g.rotateX(-Math.PI / 2);
    kit.add('frost', g, { pos: [x, 0.012 + R() * 0.004, z], scale: [r * (0.7 + R() * 0.6), 1, r], rotY: R() * 3, cast: false });
  };
  for (let i = 0; i < 22; i++) { const a = R() * TAU, d = 9.8 + R() * 1.3; frostPatch(Math.cos(a) * d, Math.sin(a) * d, 0.25 + R() * 0.45); }
  for (let i = 0; i < 26; i++) frostPatch((R() > 0.5 ? 1 : -1) * (3.1 + R() * 0.6), CZ0 + 1 + R() * (CZ1 - CZ0 - 2), 0.2 + R() * 0.4);

  // ---------- 圆场护墙（入口处留缺口） ----------
  const gapA = Math.asin((CW + 0.2) / AR);
  const arcPts = [];
  const N = 44;
  for (let i = 0; i <= N; i++) {
    const a = Math.PI / 2 + gapA + (TAU - 2 * gapA) * i / N;
    arcPts.push([Math.cos(a) * AR, Math.sin(a) * AR]);
  }
  for (let i = 0; i < N; i++) {
    const [ax, az] = arcPts[i], [bx, bz] = arcPts[i + 1];
    const mx = (ax + bx) / 2, mz = (az + bz) / 2, len = Math.hypot(bx - ax, bz - az) + 0.05;
    const ry = Math.atan2(bx - ax, bz - az) - Math.PI / 2;
    const h = 1.05 + (i % 5 === 2 ? 0.25 : 0);
    kit.box('wallCold', [mx, h / 2, mz], [len, h, 0.7], { rotY: ry });
    kit.box('frost', [mx, h + 0.05, mz], [len + 0.02, 0.1, 0.78], { rotY: ry, cast: false });
    if (i % 5 === 2) kit.box('wallDark', [mx, 0.2, mz], [len + 0.1, 0.4, 0.86], { rotY: ry });
  }
  kit.polyColliders(arcPts, false, 0.7, 0, 1.3, 1.0, 'wall');

  // ---------- 四根边缘巨柱 ----------
  const PR = 9.7, PH = 10.5;
  const pillars = [];
  for (let i = 0; i < 4; i++) {
    const a = Math.PI / 4 + i * Math.PI / 2;
    const x = Math.cos(a) * PR, z = Math.sin(a) * PR;
    pillars.push([x, z]);
    kit.slab('wallCold', [x - 1.15, 0, z - 1.15], [x + 1.15, 1.0, z + 1.15]);
    kit.slab('wallDark', [x - 1.25, 0, z - 1.25], [x + 1.25, 0.3, z + 1.25]);
    kit.slab('frost', [x - 1.18, 1.0, z - 1.18], [x + 1.18, 1.08, z + 1.18], { cast: false });
    kit.collider([x - 1.25, 0, z - 1.25], [x + 1.25, PH, z + 1.25], 'pillar');
    const shaft = new THREE.CylinderGeometry(0.78, 0.85, PH - 1.0, 8, 1);
    shaft.rotateY(Math.PI / 8);
    kit.add('wallCold', shaft, { pos: [x, 1.0 + (PH - 1.0) / 2, z], swap: true });
    for (const yy of [1.3, 3.6, 6.4, 9.0]) {
      const band = new THREE.CylinderGeometry(0.9, 0.9, 0.22, 8, 1); band.rotateY(Math.PI / 8);
      kit.add('ironDark', band, { pos: [x, yy, z] });
    }
    const cap = new THREE.CylinderGeometry(1.25, 0.9, 0.8, 8, 1); cap.rotateY(Math.PI / 8);
    kit.add('wallCold', cap, { pos: [x, PH + 0.4, z] });
    kit.add('frost', new THREE.CylinderGeometry(1.2, 1.25, 0.14, 8, 1), { pos: [x, PH + 0.86, z], cast: false, rotY: Math.PI / 8 });
    for (let k = 0; k < 4; k++) {
      const b = k / 4 * TAU + Math.PI / 4;
      kit.add('ironDark', new THREE.ConeGeometry(0.16, 1.1, 5), { pos: [x + Math.cos(b) * 1.0, PH + 1.2, z + Math.sin(b) * 1.0], rot: [Math.sin(b) * 0.25, 0, -Math.cos(b) * 0.25], order: 'XYZ' });
    }
    // 朝向圆心的晶石嵌槽
    const ix = -Math.cos(a), iz = -Math.sin(a);
    const cx = x + ix * 0.8, cz = z + iz * 0.8;
    kit.box('ironDark', [cx, 4.2, cz], [0.5, 2.9, 0.5], { rotY: -a + Math.PI / 2 });
    kit.add('crystal', new THREE.OctahedronGeometry(0.5, 0), { pos: [cx + ix * 0.12, 4.2, cz + iz * 0.12], scale: [0.4, 2.6, 0.4], rotY: -a });
    kit.glow([cx + ix * 0.5, 4.2, cz + iz * 0.5], 1.5, 0x55d8dc, 0.35);
    // 冰凌
    for (let k = 0; k < 5; k++) {
      const b = R() * TAU, l = 0.4 + R() * 0.9;
      kit.add('ice', new THREE.ConeGeometry(0.06 + R() * 0.05, l, 5), { pos: [x + Math.cos(b) * 1.15, PH - l / 2, z + Math.sin(b) * 1.15], rot: [Math.PI, 0, 0], cast: false });
    }
  }

  // ---------- 顶部拱环与十字肋拱、悬挂晶石 ----------
  const archTopY = PH + 0.8;
  const side = PR * Math.SQRT1_2;
  for (let i = 0; i < 4; i++) {
    const g = archGeo(side - 0.9, 0, 0.9, 1.1, 1.25, 16);
    const horiz = i % 2 === 0;
    const off = (i < 2 ? 1 : -1) * side;
    kit.add('wallCold', g, { pos: horiz ? [0, archTopY, off] : [off, archTopY, 0], rotY: horiz ? 0 : Math.PI / 2 });
  }
  for (const ry of [Math.PI / 4, -Math.PI / 4]) {
    const g = archGeo(PR - 0.9, 0, 0.7, 0.8, 1.15, 20);
    kit.add('wallDark', g, { pos: [0, archTopY, 0], rotY: ry });
  }
  {
    const cy = 15.2;
    kit.add('ironDark', new THREE.CylinderGeometry(0.04, 0.04, 20.6 + archTopY - 10.5 - cy - 1.8 + 1.0, 5), { pos: [0, (cy + 1.8 + archTopY + 9.3) / 2, 0], cast: false });
    kit.add('crystal', new THREE.OctahedronGeometry(1.0, 0), { pos: [0, cy, 0], scale: [0.7, 2.0, 0.7] });
    kit.add('ironDark', new THREE.TorusGeometry(0.75, 0.07, 5, 16), { pos: [0, cy + 0.8, 0], rot: [Math.PI / 2, 0, 0], order: 'XYZ' });
    for (let k = 0; k < 3; k++) kit.add('crystal', new THREE.OctahedronGeometry(0.35, 0), { pos: [Math.cos(k * 2.1) * 1.4, cy - 0.6 - k * 0.3, Math.sin(k * 2.1) * 1.4], scale: [0.5, 1.8, 0.5] });
    kit.glow([0, cy, 0], 4.5, 0x5fe0e6, 0.4);
    kit.point(0x7fe6ee, 60, 26, [0, cy - 1.5, 0]);
  }

  // ---------- 背景：封印之门（出界，仅视觉） ----------
  {
    const z = -15.5;
    kit.slab('floorCold', [-7.5, -0.4, -19], [7.5, 0, -11], { cast: false });
    kit.slab('wallCold', [-7.7, -3.5, -19.2], [7.7, -0.4, -11], { cast: false });
    for (const sx of [-1, 1]) {
      kit.slab('wallCold', [sx * 7 - 1.6, 0, z - 1.6], [sx * 7 + 1.6, 17, z + 1.6]);
      kit.slab('wallDark', [sx * 7 - 1.8, 0, z - 1.8], [sx * 7 + 1.8, 1.2, z + 1.8]);
      kit.add('ironDark', new THREE.ConeGeometry(1.4, 4.5, 4), { pos: [sx * 7, 19.25, z], rotY: Math.PI / 4 });
      kit.add('crystal', new THREE.OctahedronGeometry(0.5, 0), { pos: [sx * 7, 11, z + 1.62], scale: [0.35, 2.2, 0.35] });
      kit.slab('frost', [sx * 7 - 1.65, 17, z - 1.65], [sx * 7 + 1.65, 17.12, z + 1.65], { cast: false });
    }
    kit.add('wallCold', archGeo(5.4, 7.5, 1.1, 2.4, 1.3, 16), { pos: [0, 0, z] });
    kit.slab('doorIron', [-5.4, 0, z - 0.3], [5.4, 7.5, z + 0.1]);
    const tymp = new THREE.Shape();
    {
      const hw = 5.4, R0 = hw * 1.3, cx0 = -hw + R0;
      tymp.moveTo(-hw, 7.5);
      const th1 = Math.acos((0 - cx0) / R0);
      for (let i = 0; i <= 12; i++) { const t = Math.PI + (th1 - Math.PI) * i / 12; tymp.lineTo(cx0 + Math.cos(t) * R0, 7.5 + Math.sin(t) * R0); }
      for (let i = 12; i >= 0; i--) { const t = Math.PI + (th1 - Math.PI) * i / 12; tymp.lineTo(-(cx0 + Math.cos(t) * R0), 7.5 + Math.sin(t) * R0); }
      tymp.closePath();
    }
    kit.add('doorIron', new THREE.ExtrudeGeometry(tymp, { depth: 0.4, bevelEnabled: false }), { pos: [0, 0, z - 0.3] });
    kit.slab('crystal', [-0.08, 0.3, z + 0.1], [0.08, 12.5, z + 0.18], { cast: false });
    for (const y of [2.5, 5, 9.5]) kit.add('crystal', new THREE.OctahedronGeometry(0.45, 0), { pos: [0, y, z + 0.25], scale: [0.6, 1.3, 0.3] });
    kit.glow([0, 6, z + 0.6], 3.2, 0x5fe0e6, 0.3);
    for (const sx of [-1, 1]) for (let k = 0; k < 3; k++) kit.box('ironDark', [sx * 2.7, 1.5 + k * 2.2, z + 0.15], [4.6, 0.18, 0.12], { cast: false });
  }

  // ---------- 入口通道 ----------
  // 墙体（顶部残缺），扶壁，积雪
  for (const sx of [-1, 1]) {
    const xi = sx * CW, xo = sx * (CW + 1.1);
    const [x0, x1] = sx < 0 ? [xo, xi] : [xi, xo];
    kit.collider([x0, 0, CZ0 - 1.5], [x1, 7, CZ1 + 1], 'wall');
    for (let z = CZ0 - 1.4; z < CZ1 + 1; z += 2.0) {
      const h = 5.2 + R() * 1.8, z2 = Math.min(z + 2.0, CZ1 + 1);
      kit.slab('wallCold', [x0, 0, z], [x1, h, z2], { uvOff: [R(), 0] });
      kit.slab('frost', [x0 - 0.02, h, z], [x1 + 0.02, h + 0.1, z2], { cast: false });
      kit.slab('wallDark', [x0 - (sx < 0 ? 0 : 0.08), 0, z], [x1 + (sx > 0 ? 0 : 0.08), 0.45, z2], { cast: false });
    }
    // 墙脚积雪
    for (let z = CZ0 + 0.5; z < CZ1; z += 1.6 + R() * 1.4) {
      const s = new THREE.SphereGeometry(1, 10, 5, 0, TAU, 0, Math.PI / 2);
      kit.add('drift', s, { pos: [xi - sx * 0.1, 0, z], scale: [0.5 + R() * 0.3, 0.14 + R() * 0.12, 0.9 + R() * 0.8], cast: false });
    }
  }
  const buttZ = [15, 21, 27, 33, 39, 45, 50];
  buttZ.forEach((z, i) => {
    for (const sx of [-1, 1]) {
      const xi = sx * (CW - 0.45), xw = sx * CW;
      const [x0, x1] = sx < 0 ? [xw, xi] : [xi, xw];
      kit.solid('wallCold', [x0 - (sx < 0 ? 0.4 : 0), 0, z - 0.55], [x1 + (sx > 0 ? 0.4 : 0), 7.4, z + 0.55], 'pillar');
      kit.slab('wallDark', [Math.min(x0, x1) - 0.08, 0, z - 0.63], [Math.max(x0, x1) + 0.08, 0.6, z + 0.63]);
      kit.box('wallCold', [sx * (CW - 0.1), 7.55, z], [0.9, 0.5, 1.1], { rot: [0, 0, sx * 0.5], order: 'XYZ' });
      kit.slab('ironDark', [Math.min(x0, x1) - 0.04, 2.6, z - 0.58], [Math.max(x0, x1) + 0.04, 2.8, z + 0.58], { cast: false });
      if ((i + (sx > 0 ? 1 : 0)) % 2 === 0) {
        kit.add('crystal', new THREE.OctahedronGeometry(0.3, 0), { pos: [xi - sx * 0.05, 4.4, z], scale: [0.6, 2.2, 0.6] });
        kit.glow([xi - sx * 0.4, 4.4, z], 0.9, 0x55d8dc, 0.3);
      }
    }
  });
  // 通道横拱（在扶壁上起拱）与冰凌
  for (const z of [21, 33, 45]) {
    kit.add('wallCold', archGeo(CW - 0.45, 5.6, 0.6, 1.0, 1.3, 14), { pos: [0, 0, z] });
    for (let k = 0; k < 9; k++) {
      const x = (k / 8 - 0.5) * 5.4, l = 0.3 + R() * 0.9;
      const yTop = 5.6 + Math.sqrt(Math.max(0, 16 - x * x)) * 0.95;
      kit.add('ice', new THREE.ConeGeometry(0.05 + R() * 0.05, l, 5), { pos: [x, yTop - l / 2 - 0.05, z + (R() - 0.5) * 0.6], rot: [Math.PI, 0, 0], cast: false });
    }
  }
  // 通道尽头（入口）残门
  kit.solid('wallCold', [-CW - 1.1, 0, CZ1], [CW + 1.1, 5.0, CZ1 + 1.2], 'wall');
  kit.add('wallDark', archGeo(2.2, 2.6, 0.5, 0.3, 1.2, 12), { pos: [0, 0, CZ1 - 0.05] });
  kit.slab('doorIron', [-2.2, 0, CZ1 - 0.1], [2.2, 2.6, CZ1]);
  kit.slab('frost', [-CW - 1.1, 5.0, CZ1], [CW + 1.1, 5.1, CZ1 + 1.2], { cast: false });

  // 通道火盆（2 盏点光）
  kit.bannerVariants = [
    { bg: '#1f3a4d', bg2: '#101f2a', trim: '#8fb8c8', emblem: '#bfe9ee' },
    { bg: '#3d4a57', bg2: '#1f272f', trim: '#a98954', emblem: '#6fd6da' },
  ];
  for (const [x, z] of [[-3.0, 24], [3.0, 36]]) {
    const p = brazier(kit, x, z, { ped: 0.9, stone: 'wallDark' });
    kit.point(0xff9a4a, 22, 13, [p[0] - Math.sign(x) * 0.4, p[1] + 0.4, p[2]], { flicker: true });
  }
  for (const z of [18, 30, 42]) for (const sx of [-1, 1]) kit.banner([sx * (CW - 0.06), 5.1, z], sx > 0 ? -Math.PI / 2 : Math.PI / 2, 1.0, 3.0, (z / 12) % 2 | 0);

  // ---------- 闸门楼 ----------
  const GW = 3.0, GH = 5.4;
  for (const sx of [-1, 1]) {
    const [x0, x1] = sx < 0 ? [-CW - 1.1, -GW] : [GW, CW + 1.1];
    kit.solid('wallCold', [x0, 0, GATE_Z - 0.8], [x1, 11, GATE_Z + 0.8], 'wall');
    kit.slab('wallDark', [x0 - 0.1, 0, GATE_Z - 0.9], [x1 + 0.1, 0.8, GATE_Z + 0.9]);
    kit.add('ironDark', new THREE.ConeGeometry(0.5, 2.0, 4), { pos: [sx * (CW - 0.2), 12.0, GATE_Z], rotY: Math.PI / 4 });
  }
  kit.slab('wallCold', [-GW, GH, GATE_Z - 0.8], [GW, 11, GATE_Z + 0.8]);
  kit.slab('frost', [-CW - 1.15, 11, GATE_Z - 0.85], [CW + 1.15, 11.12, GATE_Z + 0.85], { cast: false });
  for (const zf of [GATE_Z + 0.85, GATE_Z - 0.85]) {
    kit.add('wallDark', archGeo(GW, GH - 0.2, 0.45, 0.2, 1.25, 14), { pos: [0, 0, zf] });
    kit.add('crystal', new THREE.OctahedronGeometry(0.35, 0), { pos: [0, GH + 2.3, zf], scale: [0.8, 1.6, 0.4] });
  }
  kit.glow([0, GH + 2.3, GATE_Z + 1.2], 1.4, 0x55d8dc, 0.35);
  kit.glow([0, GH + 2.3, GATE_Z - 1.2], 1.4, 0x55d8dc, 0.35);
  for (let k = 0; k < 10; k++) {
    const x = (R() - 0.5) * (2 * CW + 1.5), l = 0.3 + R() * 0.8;
    kit.add('ice', new THREE.ConeGeometry(0.05 + R() * 0.05, l, 5), { pos: [x, 11 - l / 2, GATE_Z + (R() > 0.5 ? 0.82 : -0.82)], rot: [Math.PI, 0, 0], cast: false });
  }

  // 闸门（独立网格，可升起）
  const gateGeos = [];
  for (let x = -GW + 0.2; x <= GW - 0.19; x += 0.4) {
    gateGeos.push(new THREE.BoxGeometry(0.1, GH, 0.1).translate(x, GH / 2 + 0.25, 0));
    gateGeos.push(new THREE.ConeGeometry(0.08, 0.3, 4).rotateX(Math.PI).translate(x, 0.12, 0));
  }
  for (const y of [0.9, 2.3, 3.7, 5.1]) gateGeos.push(new THREE.BoxGeometry(2 * GW - 0.1, 0.12, 0.16).translate(0, y, 0));
  for (const g of gateGeos) { for (const n of Object.keys(g.attributes)) if (n !== 'position' && n !== 'normal') g.deleteAttribute(n); }
  const gateGeo = mergeGeometries(gateGeos.map(g => (g.index ? g.toNonIndexed() : g)), false);
  gateGeos.forEach(g => g.dispose());
  const gateMat = kit.mats.get('ironDark').mat;
  const gateMesh = new THREE.Mesh(gateGeo, gateMat);
  gateMesh.position.set(0, 0, GATE_Z);
  gateMesh.castShadow = true; gateMesh.receiveShadow = true; gateMesh.name = 'gate';
  if (!(ctx.debugSkip || []).includes('gate')) kit.group.add(gateMesh);
  kit.disposables.push(gateGeo);
  const gateCol = kit.collider([-GW, 0, GATE_Z - 0.3], [GW, GH, GATE_Z + 0.3], 'gate');

  // 圆场火盆（2 盏点光）
  for (const sx of [-1, 1]) {
    const p = brazier(kit, sx * 9.9, 0, { ped: 1.1, stone: 'wallDark', s: 1.2 });
    kit.point(0xff9a4a, 30, 16, [p[0] - sx * 0.8, p[1] + 0.5, p[2]], { flicker: true });
  }

  // ---------- 飘雪 ----------
  kit.particles({ count: 1500, min: [-16, 0, -16], max: [16, 20, 54], size: 0.07, fall: 1.0, sway: 0.6, color: 0xffffff, opacity: 0.85, name: 'snow' });

  kit.finish();
  const background = new THREE.Color(0xd0dae3);
  const fog = new THREE.Fog(0xd0dae3, 30, 330);
  kit.bakeEnv([0.3, 2, 0.4], background, 0.5);

  // 闸门逻辑
  let gateOpen = false, gateLift = 0;
  kit.updaters.push((dt) => {
    const target = gateOpen ? GH - 0.3 : 0;
    if (gateLift !== target) {
      const sp = gateOpen ? 3.0 : 6.0;
      gateLift = gateOpen ? Math.min(target, gateLift + dt * sp) : Math.max(0, gateLift - dt * sp);
      gateMesh.position.y = gateLift;
    }
  });
  const colliders = kit.colliders;
  function openGate() {
    if (gateOpen) return;
    gateOpen = true;
    const i = colliders.indexOf(gateCol);
    if (i >= 0) colliders.splice(i, 1);
  }
  function closeGate() {
    gateOpen = false;
    if (!colliders.includes(gateCol)) colliders.push(gateCol);
  }

  const mobGroups = [
    [[-1.8, 40.0], [1.8, 41.0]],
    [[-2.2, 30.5], [2.2, 29.5]],
    [[-1.5, 18.5], [1.5, 17.5]],
  ];
  return kit.result({
    background, fog,
    bounds: { minX: -AR, maxX: AR, minZ: -AR, maxZ: CZ1 },
    spawns: { player: [0, 0, 48, Math.PI], checkpoint: [0, 0, 14, Math.PI] },
    markers: {
      bossCenter: [0, 0],
      bossSpawn: [0, 0, -3, 0],
      arenaRadius: 9,
      adds: [[-6, -3.5], [6, -3.5]],
      pillars,
      mobs: mobGroups.flat(),
      mobGroups,
      gate: { pos: [0, 0, GATE_Z], width: GW * 2, height: GH, normal: [0, 0, 1] },
      corridor: { minX: -CW, maxX: CW, minZ: CZ0, maxZ: CZ1 },
      respawn: [0, 0, 48, Math.PI],
    },
    gate: { mesh: gateMesh, collider: gateCol },
    openGate, closeGate,
    isGateOpen: () => gateOpen,
  });
}
