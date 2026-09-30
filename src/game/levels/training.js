// 镜廊训练室：室内 x∈[-6,6]、z∈[-8,8]（约 12×16m），镜子在 x=-6 墙，门在 x=+6 墙 z=5。
import * as THREE from 'three';
import { Reflector } from '../../../vendor/Reflector.js';
import { Kit, rng, TAU, plasterTex } from './kit.js';
import { baseMats, weaponRack, lantern, flatRing, flatShape, starShape, balustrade, frame } from './props.js';

const X0 = -6, X1 = 6, Z0 = -8, Z1 = 8, T = 0.4, H = 6.0, RIDGE = 8.3;

export function buildTraining(ctx) {
  const kit = new Kit(ctx, 'training', '镜廊训练室');
  const R = rng(1201);
  baseMats(kit, { wood: 0xd4bea6, woodDark: 0xae9888 });
  kit.mat('floor', { tex: 'stone', tile: 2.6, color: 0xf4f0e8, roughness: 0.38, bump: 0.018, env: 1.0 });
  kit.mat('floorDark', { tex: 'stone', tile: 1.3, color: 0x5d646b, roughness: 0.45 });
  kit.mat('terrace', { tex: 'stone', tile: 3.2, color: 0xd6d2c9, roughness: 0.8, bump: 0.02 });
  const plaster = plasterTex('#efe8dc', 17);
  kit.disposables.push(plaster);
  kit.mat('plaster', { map: plaster, tile: 3.0, color: 0xffffff, roughness: 0.95, env: 0.6 });
  kit.mat('beam', { tex: 'wood', tile: 2.2, color: 0x9a8674, roughness: 0.75, bump: 0.01 });
  kit.mat('ceiling', { tex: 'wood', tile: 1.2, color: 0xd8c4a8, roughness: 0.8 });
  kit.mat('tealTrim', { tex: 'cloth', tile: 0.6, color: 0x3f7f7c, roughness: 0.7 });
  kit.mat('roofOut', { tex: 'iron', tile: 2, color: 0x4a525c, roughness: 0.8 });
  kit.mat('gem', { color: 0x9fe3dc, emissive: 0x3fb3aa, emissiveIntensity: 0.6, metalness: 0.2, roughness: 0.15, env: 1.5 });

  // ---------- 天空、远山、光 ----------
  const sunDir = [0.72, 0.6, -0.36];
  kit.sky({ top: 0x6f9cc8, horizon: 0xdfe8ee, bottom: 0xc9d6df, sunDir, sunColor: 0xfff0d8, clouds: 0.42 });
  kit.mountains({ seed: 21, count: 26, rMin: 110, rMax: 190, hMin: 70, hMax: 150, base: -70, aspect: [0.18, 0.3], colTop: 0x55704f, colMid: 0x7b8a86, colBase: 0xb2c1cc });
  kit.mountains({ seed: 22, count: 16, rMin: 230, rMax: 300, hMin: 90, hMax: 170, base: -80, aspect: [0.35, 0.6], colTop: 0x8a9fae, colMid: 0x9fb2c0, colBase: 0xc5d3dd, key: 'mountainFar' });
  kit.hemi(0xdde8f2, 0x8c7a66, 1.05);
  kit.sun({ dir: sunDir, color: 0xfff1dc, intensity: 3.4, extent: 13, center: [0, 0, 0], dist: 40 });

  // ---------- 地面 ----------
  kit.slab('floor', [X0 - T, -0.3, Z0 - T], [X1 + T, 0, Z1 + T], { cast: false });
  kit.slab('terrace', [-14, -0.5, -20], [16, -0.06, 18], { cast: false });
  // 外平台栏杆（只作远景边缘）
  balustrade(kit, 'stoneTrim', [15.4, -17], [15.4, 17], -0.06, 1.0, { collide: false });
  balustrade(kit, 'stoneTrim', [-13.4, -19.4], [15.4, -19.4], -0.06, 1.0, { collide: false });
  // 地面嵌线：边框
  const y = 0.004, w = 0.14;
  kit.slab('floorDark', [-5.0 - w / 2, 0, -7.0], [-5.0 + w / 2, y, 7.0], { cast: false });
  kit.slab('floorDark', [5.0 - w / 2, 0, -7.0], [5.0 + w / 2, y, 7.0], { cast: false });
  kit.slab('floorDark', [-5.0, 0, -7.0 - w / 2], [5.0, y, -7.0 + w / 2], { cast: false });
  kit.slab('floorDark', [-5.0, 0, 7.0 - w / 2], [5.0, y, 7.0 + w / 2], { cast: false });
  // 纹章圆（假人区）
  const MX = 2.3;
  flatRing(kit, 'bronze', MX, 0.006, 0, 2.5, 2.6, 72);
  flatRing(kit, 'floorDark', MX, 0.004, 0, 2.02, 2.5, 72);
  flatRing(kit, 'bronze', MX, 0.006, 0, 1.96, 2.02, 72);
  flatShape(kit, 'tealTrim', starShape(1.5, 0.55, 8, Math.PI / 8), MX, 0.0, 0, 0.007);
  flatRing(kit, 'bronze', MX, 0.008, 0, 0.42, 0.5, 40);
  // 连向镜子的暗色引导线
  kit.slab('floorDark', [-5.0, 0, -0.07], [MX - 2.6, y, 0.07], { cast: false });

  // ---------- 墙体 ----------
  // x=-6 镜墙（实墙）
  kit.solid('plaster', [X0 - T, 0, Z0 - T], [X0, H, Z1 + T]);
  // z=+8 墙（实墙）
  kit.solid('plaster', [X0, 0, Z1], [X1, H, Z1 + T]);
  // x=+6 窗墙：视觉分段，碰撞一整块
  const winZ = [[-6.6, -4.2], [-3.4, -1.0], [-0.2, 2.2]];
  const WY0 = 0.9, WY1 = 4.4;
  const door = [4.1, 5.9], DH = 3.2;
  kit.collider([X1, 0, Z0 - T], [X1 + T, H, Z1 + T], 'wall');
  {
    const cuts = [...winZ.map(z => ({ a: z[0], b: z[1], y0: WY0, y1: WY1 })), { a: door[0], b: door[1], y0: 0, y1: DH }];
    let z = Z0 - T;
    for (const c of cuts) {
      if (c.a > z) kit.slab('plaster', [X1, 0, z], [X1 + T, H, c.a]);
      if (c.y0 > 0) kit.slab('plaster', [X1, 0, c.a], [X1 + T, c.y0, c.b]);
      kit.slab('plaster', [X1, c.y1, c.a], [X1 + T, H, c.b]);
      z = c.b;
    }
    kit.slab('plaster', [X1, 0, z], [X1 + T, H, Z1 + T]);
  }
  // z=-8 端墙：大花窗
  const EW = [-2.6, 2.6], EY0 = 0.7, EY1 = 4.8;
  kit.collider([X0, 0, Z0 - T], [X1, H, Z0], 'wall');
  kit.slab('plaster', [X0, 0, Z0 - T], [EW[0], H, Z0]);
  kit.slab('plaster', [EW[1], 0, Z0 - T], [X1, H, Z0]);
  kit.slab('plaster', [EW[0], 0, Z0 - T], [EW[1], EY0, Z0]);
  kit.slab('plaster', [EW[0], EY1, Z0 - T], [EW[1], H, Z0]);
  // 山墙
  for (const zz of [Z0 - T, Z1]) {
    const s = new THREE.Shape();
    s.moveTo(X0 - T, 0); s.lineTo(X1 + T, 0); s.lineTo(0, RIDGE - H); s.closePath();
    const g = new THREE.ExtrudeGeometry(s, { depth: T, bevelEnabled: false });
    kit.add('plaster', g, { pos: [0, H, zz] });
  }

  // 护墙板（木）+ 腰线
  const wains = (min, max) => kit.slab('woodDark', min, max, { cast: false });
  wains([X0, 0, Z0], [X0 + 0.05, 1.0, Z1]);
  wains([X0, 0, Z1 - 0.05], [X1, 1.0, Z1]);
  wains([X0, 0, Z0], [EW[0], 1.0, Z0 + 0.05]);
  wains([EW[1], 0, Z0], [X1, 1.0, Z0 + 0.05]);
  {
    let z = Z0;
    for (const [a, b] of [...winZ, door]) { if (a > z) wains([X1 - 0.05, 0, z], [X1, 1.0, a]); if (b !== door[1]) wains([X1 - 0.05, 0, a], [X1, WY0, b]); z = b; }
    wains([X1 - 0.05, 0, z], [X1, 1.0, Z1]);
  }
  // 腰线铜条与青色饰带
  for (const [min, max] of [
    [[X0, 1.0, Z0], [X0 + 0.08, 1.07, Z1]], [[X0, 1.0, Z1 - 0.08], [X1, 1.07, Z1]],
  ]) kit.slab('bronze', min, max, { cast: false });
  kit.slab('tealTrim', [X0, 0.42, Z0], [X0 + 0.055, 0.52, Z1], { cast: false });
  kit.slab('tealTrim', [X0, 0.42, Z1 - 0.055], [X1, 0.52, Z1], { cast: false });

  // ---------- 木构架 ----------
  const post = (x, z, dx, dz) => {
    kit.solid('beam', [x - dx, 0, z - dz], [x + dx, H, z + dz], 'pillar', { swap: true });
    kit.box('stoneTrim', [x, 0.15, z], [dx * 2 + 0.12, 0.3, dz * 2 + 0.12]);
  };
  // 镜墙柱：避开镜子，两柱夹镜
  for (const z of [-7.8, -3.4, -1.35, 1.35, 3.4, 7.8]) post(X0 + 0.1, z, 0.18, 0.18);
  for (const z of [-7.8, -3.8, -0.6, 3.15, 7.8]) post(X1 - 0.1, z, 0.18, 0.18);
  for (const x of [-2.95, 2.95]) post(x, Z0 + 0.1, 0.18, 0.18);
  for (const x of [-4.2, 4.2]) post(x, Z1 - 0.1, 0.18, 0.18);
  // 侧墙顶部封檐（挡住屋面与墙顶之间的漏光）
  kit.slab('plaster', [X0 - T, H, Z0 - T], [X0, H + 0.7, Z1 + T]);
  kit.slab('plaster', [X1, H, Z0 - T], [X1 + T, H + 0.7, Z1 + T]);
  // 顶部圈梁、中腰梁
  kit.slab('beam', [X0, 5.5, Z0], [X0 + 0.3, 5.95, Z1]);
  kit.slab('beam', [X1 - 0.3, 5.5, Z0], [X1, 5.95, Z1]);
  kit.slab('beam', [X0, 5.5, Z0], [X1, 5.95, Z0 + 0.3]);
  kit.slab('beam', [X0, 5.5, Z1 - 0.3], [X1, 5.95, Z1]);
  kit.slab('beam', [X0, 4.55, Z0], [X0 + 0.1, 4.72, Z1], { cast: false });
  kit.slab('beam', [X0, 4.55, Z1 - 0.1], [X1, 4.72, Z1], { cast: false });
  kit.slab('beam', [X1 - 0.1, 4.55, Z0], [X1, 4.72, Z1], { cast: false });
  kit.slab('beam', [X0, 4.9, Z0], [X1, 5.07, Z0 + 0.1], { cast: false });
  // 横梁、瓜柱、斜撑、托架
  const tieZ = [-6, -2, 2, 6];
  for (const z of tieZ) {
    kit.slab('beam', [X0, 5.45, z - 0.18], [X1, 5.95, z + 0.18]);
    kit.slab('beam', [-0.14, 5.95, z - 0.14], [0.14, RIDGE - 0.2, z + 0.14], { swap: true });
    for (const sx of [-1, 1]) {
      // 托架（雀替）
      kit.slab('beam', sx < 0 ? [X0 + 0.3, 5.1, z - 0.12] : [X1 - 1.0, 5.1, z - 0.12], sx < 0 ? [X0 + 1.0, 5.45, z + 0.12] : [X1 - 0.3, 5.45, z + 0.12]);
      kit.slab('bronze', sx < 0 ? [X0 + 0.3, 5.05, z - 0.13] : [X1 - 0.7, 5.05, z - 0.13], sx < 0 ? [X0 + 0.7, 5.1, z + 0.13] : [X1 - 0.3, 5.1, z + 0.13], { cast: false });
      // 斜撑
      const len = 3.6, ang = Math.atan2(1.6, 3.2);
      kit.box('beam', [sx * 1.7, 6.75, z], [len, 0.16, 0.16], { rot: [0, 0, -sx * ang], order: 'XYZ' });
    }
  }
  // 屋面（内侧木板 + 椽子）
  const slopeLen = Math.hypot(X1 + T + 0.6, RIDGE - H);
  const slopeAng = Math.atan2(RIDGE - H, X1 + T + 0.6);
  for (const sx of [-1, 1]) {
    const cx = sx * (X1 + T + 0.6) / 2, cy = (H + RIDGE) / 2 + 0.08;
    kit.box('ceiling', [cx, cy + 0.12, 0], [slopeLen, 0.12, Z1 * 2 + T * 2 + 1.2], { rot: [0, 0, -sx * slopeAng], order: 'XYZ', uvOff: [0.3, 0] });
    kit.box('roofOut', [cx, cy + 0.26, 0], [slopeLen + 0.2, 0.14, Z1 * 2 + T * 2 + 1.4], { rot: [0, 0, -sx * slopeAng], order: 'XYZ' });
    for (let z = Z0 + 0.5; z <= Z1 - 0.4; z += 1.0) {
      kit.box('woodDark', [cx, cy - 0.02, z], [slopeLen - 0.2, 0.16, 0.1], { rot: [0, 0, -sx * slopeAng], order: 'XYZ', cast: false });
    }
  }
  kit.slab('beam', [-0.2, RIDGE - 0.25, Z0 - T], [0.2, RIDGE + 0.1, Z1 + T]);
  for (const x of [-3.2, 3.2]) kit.slab('beam', [x - 0.12, H + (RIDGE - H) * (1 - Math.abs(x) / (X1 + T + 0.6)) - 0.05, Z0], [x + 0.12, H + (RIDGE - H) * (1 - Math.abs(x) / (X1 + T + 0.6)) + 0.18, Z1], { cast: false });

  // ---------- 花窗 ----------
  const lattice = (axis, fixed, a, b, y0, y1) => {
    // axis 'x' 表示窗在 x=fixed 平面，沿 z 从 a 到 b；'z' 表示在 z=fixed 平面，沿 x
    const put = (u0, u1, v0, v1, d = 0.1) => {
      if (axis === 'x') kit.slab('woodDark', [fixed - d / 2, v0, u0], [fixed + d / 2, v1, u1], { tile: 1.2 });
      else kit.slab('woodDark', [u0, v0, fixed - d / 2], [u1, v1, fixed + d / 2], { tile: 1.2 });
    };
    const fw = 0.12, bw = 0.045;
    put(a, a + fw, y0, y1, 0.22); put(b - fw, b, y0, y1, 0.22);
    put(a, b, y0, y0 + fw, 0.26); put(a, b, y1 - fw, y1, 0.22);
    const W = b - a, nv = Math.max(2, Math.round(W / 0.55));
    for (let i = 1; i < nv; i++) { const u = a + W * i / nv; put(u - bw / 2, u + bw / 2, y0, y1, 0.08); }
    const band = y1 - 0.75;
    put(a, b, band - 0.05, band + 0.05, 0.1);
    for (let yy = y0 + 0.8; yy < band - 0.3; yy += 0.8) put(a, b, yy - bw / 2, yy + bw / 2, 0.08);
    // 上部回纹
    const nd = nv * 2;
    for (let i = 0; i < nd; i++) {
      const u = a + W * (i + 0.5) / nd;
      put(u - 0.02, u + 0.02, band + 0.05, band + 0.36 + (i % 2) * 0.2, 0.06);
    }
    put(a, b, band + 0.36, band + 0.4, 0.06);
    // 窗台石
    if (axis === 'x') kit.slab('stoneTrim', [fixed - 0.35, y0 - 0.08, a - 0.1], [fixed + 0.3, y0 + 0.02, b + 0.1]);
    else kit.slab('stoneTrim', [a - 0.1, y0 - 0.08, fixed - 0.3], [b + 0.1, y0 + 0.02, fixed + 0.35]);
  };
  for (const [a, b] of winZ) lattice('x', X1 + T / 2, a, b, WY0, WY1);
  lattice('z', Z0 - T / 2, EW[0], EW[1], EY0, EY1);

  // ---------- 门（双扇，关闭）----------
  {
    const dx = X1 + 0.28;
    kit.slab('beam', [X1 - 0.08, 0, door[0] - 0.22], [X1 + 0.2, DH + 0.25, door[0]]);
    kit.slab('beam', [X1 - 0.08, 0, door[1]], [X1 + 0.2, DH + 0.25, door[1] + 0.22]);
    kit.slab('beam', [X1 - 0.1, DH, door[0] - 0.3], [X1 + 0.2, DH + 0.34, door[1] + 0.3]);
    const mid = (door[0] + door[1]) / 2;
    for (const [a, b] of [[door[0], mid - 0.01], [mid + 0.01, door[1]]]) {
      kit.slab('woodDark', [dx - 0.05, 0.02, a], [dx + 0.05, DH, b]);
      for (const [y0, y1] of [[0.25, 1.35], [1.6, 2.95]]) kit.slab('beam', [dx - 0.08, y0, a + 0.12], [dx - 0.05, y1, b - 0.12], { cast: false });
      for (const yy of [0.5, 1.6, 2.7]) kit.slab('iron', [dx - 0.075, yy, a + 0.04], [dx - 0.05, yy + 0.06, b - 0.04], { cast: false });
    }
    for (const s of [-1, 1]) kit.add('bronze', new THREE.TorusGeometry(0.09, 0.015, 6, 16), { pos: [dx - 0.1, 1.45, mid + s * 0.16], rotY: Math.PI / 2 });
    // 门匾
    kit.slab('woodDark', [X1 - 0.16, DH + 0.45, mid - 0.7], [X1 - 0.08, DH + 0.95, mid + 0.7]);
    kit.slab('bronze', [X1 - 0.18, DH + 0.5, mid - 0.64], [X1 - 0.15, DH + 0.9, mid + 0.64], { cast: false });
  }

  // ---------- 镜子（Reflector）----------
  const MZ = 0, MB = 0.05, MW = 1.3, MH = 2.4;
  {
    const hw = MW / 2 + 0.14, top = MB + MH + 0.14, bot = MB - 0.14;
    const s = new THREE.Shape();
    s.moveTo(-hw, bot); s.lineTo(hw, bot); s.lineTo(hw, top);
    s.lineTo(0.46, top); s.bezierCurveTo(0.34, top + 0.02, 0.26, top + 0.16, 0.12, top + 0.2);
    s.bezierCurveTo(0.06, top + 0.24, 0.05, top + 0.34, 0, top + 0.38);
    s.bezierCurveTo(-0.05, top + 0.34, -0.06, top + 0.24, -0.12, top + 0.2);
    s.bezierCurveTo(-0.26, top + 0.16, -0.34, top + 0.02, -0.46, top);
    s.lineTo(-hw, top); s.closePath();
    const hole = new THREE.Path();
    hole.moveTo(-MW / 2 + 0.02, MB + 0.02); hole.lineTo(-MW / 2 + 0.02, MB + MH - 0.02); hole.lineTo(MW / 2 - 0.02, MB + MH - 0.02); hole.lineTo(MW / 2 - 0.02, MB + 0.02); hole.closePath();
    s.holes.push(hole);
    const g = new THREE.ExtrudeGeometry(s, { depth: 0.07, bevelEnabled: true, bevelThickness: 0.025, bevelSize: 0.025, bevelSegments: 2, curveSegments: 10 });
    kit.add('bronze', g, { pos: [X0 + 0.03, 0, MZ], rotY: Math.PI / 2 });
    // 内圈细线脚
    const s2 = new THREE.Shape();
    s2.moveTo(-MW / 2 - 0.04, MB - 0.04); s2.lineTo(MW / 2 + 0.04, MB - 0.04); s2.lineTo(MW / 2 + 0.04, MB + MH + 0.04); s2.lineTo(-MW / 2 - 0.04, MB + MH + 0.04); s2.closePath();
    const h2 = new THREE.Path();
    h2.moveTo(-MW / 2 + 0.01, MB + 0.01); h2.lineTo(-MW / 2 + 0.01, MB + MH - 0.01); h2.lineTo(MW / 2 - 0.01, MB + MH - 0.01); h2.lineTo(MW / 2 - 0.01, MB + 0.01); h2.closePath();
    s2.holes.push(h2);
    kit.add('woodDark', new THREE.ExtrudeGeometry(s2, { depth: 0.03, bevelEnabled: false }), { pos: [X0 + 0.135, 0, MZ], rotY: Math.PI / 2 });
    // 角花与顶饰
    for (const [cz, cy] of [[-hw + 0.07, bot + 0.07], [hw - 0.07, bot + 0.07], [-hw + 0.07, top - 0.07], [hw - 0.07, top - 0.07]]) {
      kit.add('bronze', new THREE.CylinderGeometry(0.075, 0.085, 0.05, 12), { pos: [X0 + 0.16, cy, MZ - cz], rot: [0, 0, Math.PI / 2], order: 'XYZ' });
    }
    kit.add('gem', new THREE.OctahedronGeometry(0.075, 0), { pos: [X0 + 0.17, top + 0.14, MZ], scale: [0.6, 1.3, 1] });
    kit.add('gem', new THREE.OctahedronGeometry(0.05, 0), { pos: [X0 + 0.17, MB - 0.07, MZ], scale: [0.6, 1, 1.4] });
    // 背板 + 脚
    kit.slab('woodDark', [X0, MB - 0.2, MZ - hw - 0.05], [X0 + 0.03, top + 0.2, MZ + hw + 0.05]);
    for (const sz of [-1, 1]) kit.box('bronze', [X0 + 0.2, 0.05, MZ + sz * (hw - 0.1)], [0.28, 0.1, 0.16]);
    kit.collider([X0, 0, MZ - hw - 0.05], [X0 + 0.34, top + 0.4, MZ + hw + 0.05], 'wall');
  }
  const q = kit.low;
  const mirror = new Reflector(new THREE.PlaneGeometry(MW, MH), {
    textureWidth: q ? 512 : 1024, textureHeight: q ? 1024 : 2048, color: 0x8b8f93, clipBias: 0.003, multisample: q ? 0 : 4,
  });
  mirror.position.set(X0 + 0.1, MB + MH / 2, MZ);
  mirror.rotation.y = Math.PI / 2;
  mirror.reflectLayers = 0b11;
  mirror.maxDistance = 14;
  mirror.name = 'mirror';
  kit.group.add(mirror);
  kit.mirrors.push(mirror);

  // 镜侧壁灯
  for (const sz of [-1, 1]) {
    const z = sz * 1.35;
    kit.box('bronze', [X0 + 0.42, 2.72, z], [0.34, 0.04, 0.06]);
    lantern(kit, X0 + 0.55, 2.45, z, 0.55);
  }

  // ---------- 武器架 ----------
  weaponRack(kit, X0 + 0.3, -5.6, Math.PI / 2, 2.8, ['spear', 'sword', 'broad', 'sword', 'guandao', 'spear']);
  weaponRack(kit, -2.3, Z1 - 0.3, Math.PI, 3.2, ['sword', 'umbrella', 'broad', 'spear', 'sword', 'spear', 'sword']);

  // 长凳与箱子（靠墙）
  {
    const bx0 = 1.2, bx1 = 3.4, bz = Z1 - 0.45;
    kit.slab('woodDark', [bx0, 0.4, bz - 0.22], [bx1, 0.48, bz + 0.22]);
    for (const x of [bx0 + 0.15, bx1 - 0.15]) kit.slab('woodDark', [x - 0.06, 0, bz - 0.18], [x + 0.06, 0.4, bz + 0.18]);
    kit.collider([bx0, 0, bz - 0.22], [bx1, 0.48, bz + 0.22], 'wall');
    const chest = (x, z, ry) => {
      const F = frame(x, 0, z, ry);
      kit.add('woodDark', new THREE.BoxGeometry(1.1, 0.5, 0.62), { pos: F.p(0, 0.25, 0), rotY: ry });
      kit.add('woodDark', new THREE.BoxGeometry(1.14, 0.1, 0.66), { pos: F.p(0, 0.55, 0), rotY: ry });
      for (const sx of [-0.38, 0.38]) kit.add('iron', new THREE.BoxGeometry(0.06, 0.62, 0.68), { pos: F.p(sx, 0.3, 0), rotY: ry });
      kit.add('bronze', new THREE.BoxGeometry(0.14, 0.14, 0.04), { pos: F.p(0, 0.44, 0.32), rotY: ry });
      kit.collider(...(() => { const a = F.p(-0.57, 0, -0.33), b = F.p(0.57, 0, 0.33); return [[Math.min(a[0], b[0]), 0, Math.min(a[2], b[2])], [Math.max(a[0], b[0]), 0.6, Math.max(a[2], b[2])]]; })(), 'wall');
    };
    chest(4.6, Z1 - 0.5, Math.PI);
    chest(X0 + 0.5, 6.4, Math.PI / 2);
    // 瓷瓶
    const vase = [[0.02, 0], [0.14, 0.02], [0.2, 0.18], [0.17, 0.36], [0.08, 0.46], [0.07, 0.56], [0.11, 0.6]].map(p => new THREE.Vector2(p[0], p[1]));
    kit.mat('porcelain', { color: 0xdfe7e6, roughness: 0.25, metalness: 0.0, env: 1.2 });
    kit.add('porcelain', new THREE.LatheGeometry(vase, 14), { pos: [X0 + 0.5, 0.6, 6.4], uv: 'keep' });
    kit.add('porcelain', new THREE.LatheGeometry(vase, 14), { pos: [X1 - 0.55, 0, -7.1], scale: 1.6, uv: 'keep', collide: 'wall' });
  }

  // ---------- 旗帜、灯笼 ----------
  kit.bannerVariants = [
    { bg: '#2e6d6a', bg2: '#1c4644', trim: '#c9a764', emblem: '#efe2c0' },
    { bg: '#e7e2d7', bg2: '#cfc8b8', trim: '#a98954', emblem: '#3f7f7c' },
  ];
  kit.banner([X0 + 0.12, 4.5, -4.3], Math.PI / 2, 1.0, 2.6, 0);
  kit.banner([X0 + 0.12, 4.5, 4.3], Math.PI / 2, 1.0, 2.6, 0);
  kit.banner([-4.5, 4.85, Z0 + 0.12], 0, 1.1, 3.0, 1);
  kit.banner([4.5, 4.85, Z0 + 0.12], 0, 1.1, 3.0, 1);
  kit.banner([2.3, 4.5, Z1 - 0.12], Math.PI, 1.2, 2.8, 0);
  for (const z of [-2, 2]) lantern(kit, 0.8, 4.0, z, 1.0, { chainTo: 5.45 });
  kit.point(0xffc98a, 14, 11, [0.8, 3.7, -2], { flicker: true });
  kit.point(0xffc98a, 14, 11, [0.8, 3.7, 2], { flicker: true });
  kit.point(0xffd9a8, 6, 6, [X0 + 1.1, 2.3, 0]);

  // ---------- 光束与浮尘 ----------
  const beams = winZ.map(([a, b]) => [[X1 + 0.1, WY0 + 0.05, a + 0.1], [X1 + 0.1, WY0 + 0.05, b - 0.1], [X1 + 0.1, WY1 - 0.1, b - 0.1], [X1 + 0.1, WY1 - 0.1, a + 0.1]]);
  beams.push([[EW[0] + 0.1, EY0 + 0.05, Z0 - 0.1], [EW[1] - 0.1, EY0 + 0.05, Z0 - 0.1], [EW[1] - 0.1, EY1 - 0.1, Z0 - 0.1], [EW[0] + 0.1, EY1 - 0.1, Z0 - 0.1]]);
  kit.beams(beams, 0xffe8c4, 0.12);
  kit.particles({ count: 260, min: [-2, 0.2, -8], max: [6, 4.8, 4], size: 0.022, fall: -0.04, sway: 0.25, color: 0xfff0d0, opacity: 0.55, additive: true, name: 'dust' });

  kit.finish();
  const background = new THREE.Color(0xdfe8ee);
  const fog = new THREE.Fog(0xdfe8ee, 60, 420);
  kit.bakeEnv([0, 1.6, 0], background, 0.55);

  return kit.result({
    background, fog,
    bounds: { minX: X0, maxX: X1, minZ: Z0, maxZ: Z1 },
    spawns: { player: [-1.2, 0, -0.3, -Math.PI / 2] },
    markers: {
      dummies: [[MX, -2.3, -Math.PI / 2 + 0.25], [MX + 0.4, 0, -Math.PI / 2], [MX, 2.3, -Math.PI / 2 - 0.25]],
      mirror: { pos: [X0 + 0.1, MB + MH / 2, MZ], normal: [1, 0, 0], size: [MW, MH] },
      mirrorZone: { center: [X0 + 1.6, MZ], radius: 1.6 },
      door: { pos: [X1, 0, 5], normal: [-1, 0, 0] },
      weaponRacks: [[X0 + 0.6, -5.6], [-2.3, Z1 - 0.6]],
      medallion: [MX, 0],
    },
  });
}
