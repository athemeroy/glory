// 联赛赛场：正八角形竞技场，边心距 20m（直径约 40m）。A 队在 -x 门前、B 队在 +x 门前，路径沿 x 轴；
// 看台环绕、两块大屏在 ±z 看台顶上。光照/布局对双方对称（太阳沿 z 方向高照，不逆光任一方）。
import * as THREE from 'three';
import { Kit, rng, TAU, canvasTex } from './kit.js';
import { baseMats, flatRing, flatShape, starShape, brazier } from './props.js';

const A = 20;                         // 场地边心距
const K = Math.tan(Math.PI / 8);      // 半边长 = 边心距 * K

function octShape(ap) {
  const s = new THREE.Shape();
  const R = ap / Math.cos(Math.PI / 8);
  for (let i = 0; i < 8; i++) {
    const a = Math.PI / 8 + i * Math.PI / 4;
    const x = Math.cos(a) * R, y = Math.sin(a) * R;
    if (i === 0) s.moveTo(x, y); else s.lineTo(x, y);
  }
  s.closePath();
  return s;
}
function octPath(ap) {
  const s = new THREE.Path();
  const R = ap / Math.cos(Math.PI / 8);
  for (let i = 0; i < 8; i++) {
    const a = Math.PI / 8 - i * Math.PI / 4;
    const x = Math.cos(a) * R, y = Math.sin(a) * R;
    if (i === 0) s.moveTo(x, y); else s.lineTo(x, y);
  }
  s.closePath();
  return s;
}
// 八角环，y0→y1（ExtrudeGeometry 沿 +Z 挤出后转成竖直）
function octRing(a0, a1, y0, y1) {
  const s = octShape(a1);
  if (a0 > 0) s.holes.push(octPath(a0));
  const g = new THREE.ExtrudeGeometry(s, { depth: y1 - y0, bevelEnabled: false });
  g.rotateX(-Math.PI / 2);
  g.translate(0, y0, 0);
  return g;
}

export function buildArena(ctx) {
  const kit = new Kit(ctx, 'arena', '荣耀联赛赛场');
  const R = rng(2468);
  baseMats(kit, {});
  kit.mat('arenaFloor', { tex: 'stone', tile: 3.0, color: 0xe7e2d8, roughness: 0.66, bump: 0.02 });
  kit.mat('floorDark', { tex: 'stone', tile: 1.5, color: 0x6f7a80, roughness: 0.55 });
  kit.mat('lane', { tex: 'stone', tile: 1.2, color: 0x5c9c98, roughness: 0.45, env: 1.2 });
  kit.mat('laneGold', { tex: 'stone', tile: 1.2, color: 0xb59a64, roughness: 0.45, env: 1.2 });
  kit.mat('wall', { tex: 'stone', tile: 2.0, color: 0xd9d3c7, roughness: 0.85, bump: 0.03 });
  kit.mat('wallDark', { tex: 'stone', tile: 1.6, color: 0x8e8a82, roughness: 0.9, bump: 0.03 });
  kit.mat('stands', { tex: 'stone', tile: 2.2, color: 0xbdb7ab, roughness: 0.9, bump: 0.02 });
  kit.mat('doorIron', { tex: 'iron', tile: 1.6, color: 0x7f8a96, metalness: 0.5, roughness: 0.55 });
  kit.mat('canopyTeal', { tex: 'cloth', tile: 1.5, color: 0x3f8a86, roughness: 0.9, side: THREE.DoubleSide });
  kit.mat('canopyCream', { tex: 'cloth', tile: 1.5, color: 0xe7e2d7, roughness: 0.9, side: THREE.DoubleSide });
  kit.mat('lamp', { color: 0xfff6e0, emissive: 0xfff0d0, emissiveIntensity: 2.4, roughness: 0.5, noEnv: true });
  kit.mat('hill', { vertexColors: true, roughness: 1, env: 0.3 });

  // ---------- 天空、远景、光 ----------
  const sunDir = [0.12, 0.88, 0.46];
  kit.sky({ top: 0x2c68b8, horizon: 0xd2e0ec, bottom: 0xd9e3ea, sunDir, sunColor: 0xffe6c0, clouds: 0.42, cloudShade: 0xa9b8cc });
  kit.mountains({ seed: 71, count: 34, rMin: 170, rMax: 260, hMin: 40, hMax: 110, base: -25, aspect: [0.55, 0.9], seg: 14, hseg: 8, colTop: 0x5f7b52, colMid: 0x6f8466, colBase: 0x9fb2a4, key: 'hill' });
  kit.mountains({ seed: 72, count: 16, rMin: 330, rMax: 420, hMin: 120, hMax: 220, base: -40, aspect: [0.35, 0.6], colTop: 0xdfe6ee, colMid: 0x9fb2c2, colBase: 0xc6d3dd, snow: 0.6, key: 'mountainFar' });
  kit.hemi(0xdce8f5, 0x938675, 0.8);
  kit.sun({ dir: sunDir, color: 0xfff2dc, intensity: 3.1, extent: 36, center: [0, 0, 0], dist: 80 });

  // ---------- 场地 ----------
  kit.add('arenaFloor', octRing(0, A + 0.8, -0.4, 0), { cast: false });
  kit.add('wallDark', octRing(A + 0.8, 36, -2.5, -0.1), { cast: false });
  kit.mat('ground', { color: 0x7f9168, roughness: 1, env: 0.3 });
  kit.add('ground', new THREE.CircleGeometry(400, 24).rotateX(-Math.PI / 2), { pos: [0, -2.6, 0], cast: false, receive: false });
  // 中心纹样
  flatRing(kit, 'bronze', 0, 0.007, 0, 6.0, 6.15, 96);
  flatRing(kit, 'floorDark', 0, 0.004, 0, 5.4, 6.0, 96);
  flatRing(kit, 'lane', 0, 0.006, 0, 5.3, 5.4, 96);
  flatShape(kit, 'bronze', starShape(3.0, 1.0, 8, Math.PI / 8), 0, 0, 0, 0.009);
  flatShape(kit, 'floorDark', starShape(1.7, 0.7, 4, Math.PI / 4), 0, 0, 0, 0.012);
  flatRing(kit, 'bronze', 0, 0.014, 0, 0.35, 0.5, 32);
  flatRing(kit, 'bronze', 0, 0.006, 0, 13.0, 13.1, 96);
  // 双方路径：沿 x 轴的青/金嵌条
  for (const sx of [-1, 1]) {
    const key = sx < 0 ? 'lane' : 'laneGold';
    kit.slab(key, sx < 0 ? [-A + 0.2, 0, -0.6] : [6.1, 0, -0.6], sx < 0 ? [-6.1, 0.006, 0.6] : [A - 0.2, 0.006, 0.6], { cast: false });
    kit.slab('bronze', sx < 0 ? [-A + 0.2, 0, -0.72] : [6.1, 0, -0.72], sx < 0 ? [-6.1, 0.007, -0.6] : [A - 0.2, 0.007, -0.6], { cast: false });
    kit.slab('bronze', sx < 0 ? [-A + 0.2, 0, 0.6] : [6.1, 0, 0.6], sx < 0 ? [-6.1, 0.007, 0.72] : [A - 0.2, 0.007, 0.72], { cast: false });
    flatRing(kit, key, sx * 16, 0.008, 0, 3.4, 3.6, 64);
    flatRing(kit, 'bronze', sx * 16, 0.009, 0, 3.6, 3.66, 64);
    kit.box(key, [sx * 9.5, 0.008, 0], [1.4, 0.016, 1.4], { rotY: Math.PI / 4, cast: false });
  }
  for (const sz of [-1, 1]) {
    kit.slab('floorDark', [-0.35, 0, sz > 0 ? 6.1 : -A + 0.2], [0.35, 0.005, sz > 0 ? A - 0.2 : -6.1], { cast: false });
  }
  for (let i = 0; i < 4; i++) {
    const a = Math.PI / 4 + i * Math.PI / 2;
    kit.box('floorDark', [Math.cos(a) * 12.5, 0.004, Math.sin(a) * 12.5], [12, 0.008, 0.25], { rotY: -a, cast: false });
  }

  // ---------- 场边护墙（八角） ----------
  const WH = 2.4, WT = 0.8;
  const R8 = (ap) => ap / Math.cos(Math.PI / 8);
  const verts = [];
  for (let i = 0; i < 8; i++) { const a = Math.PI / 8 + i * Math.PI / 4; verts.push([Math.cos(a) * R8(A + WT / 2), Math.sin(a) * R8(A + WT / 2)]); }
  for (let i = 0; i < 8; i++) {
    const a = i * Math.PI / 4;           // 面法线方向
    const cx = Math.cos(a) * (A + WT / 2), cz = Math.sin(a) * (A + WT / 2);
    const len = 2 * (A + WT) * K + 0.05;
    const ry = -a + Math.PI / 2;
    const isGate = i === 0 || i === 4;
    if (isGate) {
      // 门洞两侧的墙段
      for (const s of [-1, 1]) {
        const seg = len / 2 - 4.6;
        const off = 4.6 + seg / 2;
        kit.box('wall', [cx, WH / 2, s * off], [WT, WH, seg], {});
        kit.box('bronze', [cx - Math.sign(cx) * 0.02, WH - 0.12, s * off], [WT + 0.08, 0.1, seg], { cast: false });
        kit.box('wallDark', [cx, 0.2, s * off], [WT + 0.12, 0.4, seg], {});
      }
    } else {
      kit.box('wall', [cx, WH / 2, cz], [len, WH, WT], { rotY: ry });
      kit.box('wallDark', [cx, 0.2, cz], [len, 0.4, WT + 0.12], { rotY: ry });
      kit.box('bronze', [cx - Math.cos(a) * 0.02, WH - 0.12, cz - Math.sin(a) * 0.02], [len, 0.1, WT + 0.08], { rotY: ry, cast: false });
      // 墙面青色嵌板
      for (let k = -2; k <= 2; k++) {
        const t = k * 3.2;
        const px = cx - Math.cos(a) * (WT / 2 + 0.01) + Math.cos(ry) * t, pz = cz - Math.sin(a) * (WT / 2 + 0.01) - Math.sin(ry) * t;
        kit.box('lane', [px, 1.25, pz], [1.8, 0.9, 0.04], { rotY: ry, cast: false });
      }
    }
  }
  kit.polyColliders(verts, true, WT, 0, WH + 0.6, 1.0, 'wall');

  // ---------- 双方大门 ----------
  kit.bannerVariants = [
    { bg: '#2e6d6a', bg2: '#1c4644', trim: '#d8bd7a', emblem: '#efe2c0' },
    { bg: '#b8975c', bg2: '#7d6236', trim: '#f1e6c8', emblem: '#2a3440' },
    { bg: '#e7e2d7', bg2: '#cfc8b8', trim: '#a98954', emblem: '#3f7f7c' },
  ];
  for (const sx of [-1, 1]) {
    const gx = sx * (A + WT / 2);
    // 门楼主体（向外延伸，嵌入看台）
    kit.slab('wall', sx < 0 ? [-A - 7, 0, -6] : [A + 0.8, 0, -6], sx < 0 ? [-A - 0.8, 12, 6] : [A + 7, 12, 6]);
    kit.slab('wallDark', sx < 0 ? [-A - 7.2, 11.6, -6.2] : [A + 0.6, 11.6, -6.2], sx < 0 ? [-A - 0.6, 12.4, 6.2] : [A + 7.2, 12.4, 6.2]);
    // 门
    kit.slab('doorIron', sx < 0 ? [-A - 0.95, 0, -3.4] : [A + 0.8, 0, -3.4], sx < 0 ? [-A - 0.8, 7.2, 3.4] : [A + 0.95, 7.2, 3.4]);
    const dx = sx * (A + 0.78);
    for (const zz of [-1.7, 1.7]) for (const yy of [1.2, 3.6, 6.0]) kit.box('bronze', [dx, yy, zz], [0.06, 0.12, 3.0], { cast: false });
    kit.box('bronze', [dx, 3.6, 0], [0.08, 7.0, 0.14], { cast: false });
    for (const zz of [-0.5, 0.5]) kit.add('bronze', new THREE.TorusGeometry(0.28, 0.05, 6, 16), { pos: [dx - sx * 0.04, 3.4, zz], rotY: Math.PI / 2 });
    kit.box('wallDark', [gx - sx * 0.35, 7.6, 0], [0.5, 0.8, 7.8]);
    kit.box(sx < 0 ? 'lane' : 'laneGold', [sx * (A + 0.74), 9.6, 0], [0.1, 1.8, 5.0], { cast: false });
    kit.add('bronze', new THREE.OctahedronGeometry(0.9, 0), { pos: [sx * (A + 0.66), 9.6, 0], scale: [0.3, 1, 1] });
    // 两侧塔柱
    for (const sz of [-1, 1]) {
      const px = sx * (A + 0.2), pz = sz * 4.6;
      kit.solid('wall', [px - 1.1, 0, pz - 1.1], [px + 1.1, 1.0, pz + 1.1], 'pillar');
      kit.slab('wall', [px - 0.85, 1.0, pz - 0.85], [px + 0.85, 10.5, pz + 0.85]);
      kit.collider([px - 1.1, 0, pz - 1.1], [px + 1.1, 10.5, pz + 1.1], 'pillar');
      for (const yy of [3.0, 6.5]) kit.slab('bronze', [px - 0.9, yy, pz - 0.9], [px + 0.9, yy + 0.16, pz + 0.9], { cast: false });
      kit.slab('wallDark', [px - 1.05, 10.5, pz - 1.05], [px + 1.05, 11.0, pz + 1.05]);
      const cap = new THREE.ConeGeometry(1.0, 3.2, 4); cap.rotateY(Math.PI / 4);
      kit.add('bronze', cap, { pos: [px, 12.6, pz] });
      kit.banner([px - sx * 0.87, 9.8, pz], sx < 0 ? Math.PI / 2 : -Math.PI / 2, 1.3, 5.6, sx < 0 ? 0 : 1);
      // 门前蓝焰火盆
      const bp = brazier(kit, sx * 17.6, sz * 6.2, { ped: 1.1, stone: 'wallDark', kind: 'blue' });
      if (sz > 0) kit.point(0x5aa8ff, 16, 12, [bp[0], bp[1] + 0.3, bp[2]]);
    }
  }

  // ---------- 场内掩体（对称） ----------
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const x = sx * 8.2, z = sz * 7.2;
    kit.solid('wall', [x - 1.2, 0, z - 0.8], [x + 1.2, 1.1, z + 0.8], 'wall');
    kit.slab('wallDark', [x - 1.3, 0, z - 0.9], [x + 1.3, 0.2, z + 0.9]);
    kit.slab('wallDark', [x - 1.28, 1.1, z - 0.88], [x + 1.28, 1.2, z + 0.88], { cast: false });
    kit.slab(sx < 0 ? 'lane' : 'laneGold', [x - 0.6, 0.35, z + sz * 0.8 - 0.01], [x + 0.6, 0.8, z + sz * 0.8 + 0.01], { cast: false });
  }
  // 南北方尖碑 + 蓝焰
  for (const sz of [-1, 1]) {
    const z = sz * 12.5;
    kit.solid('wallDark', [-1.1, 0, z - 1.1], [1.1, 0.8, z + 1.1], 'pillar');
    kit.slab('wall', [-0.6, 0.8, z - 0.6], [0.6, 4.6, z + 0.6]);
    kit.collider([-0.7, 0, z - 0.7], [0.7, 4.6, z + 0.7], 'pillar');
    for (const s of [-1, 1]) kit.slab('lane', [s * 0.61 - 0.02, 1.4, z - 0.25], [s * 0.61 + 0.02, 4.0, z + 0.25], { cast: false });
    kit.slab('bronze', [-0.7, 4.6, z - 0.7], [0.7, 4.75, z + 0.7]);
    brazier(kit, 0, z, { y0: 4.75, ped: 0, kind: 'blue', s: 0.9, collide: false });
  }

  // ---------- 看台 ----------
  const TIERS = 11, T0 = A + 1.4, TD = 1.1, TH0 = 2.6, TDH = 0.8;
  for (let i = 0; i < TIERS; i++) {
    const a0 = T0 + i * TD, a1 = a0 + TD, top = TH0 + i * TDH;
    kit.add('stands', octRing(a0, a1, top - 0.8 - (i === 0 ? 1.8 : 0), top), { cast: i % 3 === 0 });
    kit.add('wallDark', octRing(a0, a0 + 0.12, top - 0.02, top + 0.03), { cast: false });
  }
  kit.add('stands', octRing(A + 0.8, T0, 0, TH0 - 0.4), { cast: false });
  const OW = T0 + TIERS * TD;
  kit.add('wall', octRing(OW, OW + 1.0, -0.2, TH0 + TIERS * TDH + 2.2));
  kit.add('bronze', octRing(OW - 0.05, OW + 1.05, TH0 + TIERS * TDH + 2.2, TH0 + TIERS * TDH + 2.4), { cast: false });
  const topY = TH0 + TIERS * TDH + 2.4;
  // 看台过道（八个面中点的阶梯，深色条）
  for (let f = 0; f < 8; f++) {
    if (f === 0 || f === 4) continue;
    const a = f * Math.PI / 4;
    for (const t of [-0.55, 0.55]) {
      for (let i = 0; i < TIERS; i++) {
        const ap = T0 + i * TD + TD / 2;
        const half = ap * K * t;
        const x = Math.cos(a) * ap - Math.sin(a) * half, z = Math.sin(a) * ap + Math.cos(a) * half;
        kit.box('wallDark', [x, TH0 + i * TDH + 0.01, z], [1.0, 0.03, TD], { rotY: -a + Math.PI / 2, cast: false });
      }
    }
  }

  // 观众（InstancedMesh，顶点着色器里轻微起伏）
  {
    const body = new THREE.CylinderGeometry(0.17, 0.22, 0.62, 6); body.translate(0, 0.31, 0);
    const head = new THREE.SphereGeometry(0.12, 6, 4); head.translate(0, 0.74, 0.02);
    for (const g of [body, head]) g.deleteAttribute('uv');
    const fig = (await_merge([body.toNonIndexed(), head.toNonIndexed()]));
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0 });
    const uT = kit.uTime;
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = uT;
      sh.vertexShader = 'uniform float uTime;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
        float fi = float(gl_InstanceID);
        transformed.y += max(0.0, sin(uTime * (2.0 + mod(fi, 3.0)) + fi * 1.37)) * 0.09 * step(0.6, fract(fi * 0.618));`);
    };
    const seats = [];
    const density = kit.low ? 0.3 : 0.62;
    for (let i = 0; i < TIERS; i++) {
      const ap = T0 + i * TD + 0.62;
      const y = TH0 + i * TDH;
      for (let f = 0; f < 8; f++) {
        const a = f * Math.PI / 4;
        const half = ap * K - 0.3;
        for (let t = -half; t <= half; t += 0.62) {
          if (Math.abs(t / (ap * K)) > 0.5 && Math.abs(t / (ap * K)) < 0.6 && f !== 0 && f !== 4) continue; // 过道
          if ((f === 0 || f === 4) && Math.abs(t) < 7.2) continue; // 门楼
          if (R() > density) continue;
          const x = Math.cos(a) * ap - Math.sin(a) * t, z = Math.sin(a) * ap + Math.cos(a) * t;
          seats.push([x, y, z, Math.atan2(-Math.cos(a), -Math.sin(a)), x < 0 ? 0 : 1]);
        }
      }
    }
    const inst = new THREE.InstancedMesh(fig, mat, seats.length);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), pos = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
    const colA = [0x3f8a86, 0x4d9d9a, 0xe7e2d7, 0x2f5f5c, 0x6fb3ae], colB = [0xb8975c, 0xa98954, 0xe7e2d7, 0x7d6236, 0xd8bd7a], colN = [0x3a4452, 0x8e8a82, 0xc9c6be, 0x5b6470, 0xcf624b];
    const c = new THREE.Color();
    seats.forEach((s, k) => {
      const sz = 0.9 + R() * 0.25;
      m4.compose(pos.set(s[0], s[1], s[2]), q.setFromAxisAngle(up, s[3] + (R() - 0.5) * 0.5), sc.set(sz, sz, sz));
      inst.setMatrixAt(k, m4);
      const pal = R() < 0.65 ? (s[4] === 0 ? colA : colB) : colN;
      c.setHex(pal[Math.floor(R() * pal.length)]).multiplyScalar(0.8 + R() * 0.3);
      inst.setColorAt(k, c);
    });
    inst.castShadow = false; inst.receiveShadow = true; inst.name = 'crowd';
    inst.computeBoundingSphere();
    kit.group.add(inst);
    kit.disposables.push(fig, mat);
    kit.crowdCount = seats.length;
  }

  // ---------- 大屏幕（±z 看台顶） ----------
  const screenTex = canvasTex(1024, 512, (g, W, H) => {
    const grd = g.createLinearGradient(0, 0, 0, H);
    grd.addColorStop(0, '#26303c'); grd.addColorStop(1, '#141b24');
    g.fillStyle = grd; g.fillRect(0, 0, W, H);
    g.strokeStyle = 'rgba(77,157,154,0.25)'; g.lineWidth = 1;
    for (let x = 0; x < W; x += 32) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke(); }
    for (let y = 0; y < H; y += 32) { g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); }
    g.strokeStyle = '#a98954'; g.lineWidth = 6; g.strokeRect(14, 14, W - 28, H - 28);
    g.lineWidth = 2; g.strokeRect(28, 28, W - 56, H - 56);
    // 菱形徽记
    g.save(); g.translate(W / 2, 112); g.fillStyle = '#4d9d9a';
    g.beginPath(); g.moveTo(0, -46); g.lineTo(34, 0); g.lineTo(0, 46); g.lineTo(-34, 0); g.closePath(); g.fill();
    g.fillStyle = '#e7e2d7'; g.beginPath(); g.moveTo(0, -30); g.lineTo(6, 14); g.lineTo(0, 26); g.lineTo(-6, 14); g.closePath(); g.fill();
    g.fillRect(-18, 10, 36, 4); g.restore();
    const font = '"PingFang SC","Hiragino Sans GB","Microsoft YaHei","Noto Sans CJK SC","Noto Sans SC",sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = `bold 118px ${font}`;
    const tg = g.createLinearGradient(0, 180, 0, 300);
    tg.addColorStop(0, '#fff6dc'); tg.addColorStop(1, '#d8bd7a');
    g.fillStyle = tg; g.shadowColor = 'rgba(77,157,154,0.8)'; g.shadowBlur = 18;
    g.fillText('荣耀职业联赛', W / 2, 238);
    g.shadowBlur = 0;
    g.font = `600 34px ${font}`; g.fillStyle = '#6fc7c2';
    g.fillText('G L O R Y   P R O   L E A G U E', W / 2, 322);
    g.fillStyle = 'rgba(169,137,84,0.9)'; g.fillRect(W / 2 - 300, 356, 600, 3);
    g.font = `bold 46px ${font}`;
    g.fillStyle = '#4d9d9a'; g.textAlign = 'right'; g.fillText('青队', W / 2 - 90, 420);
    g.fillStyle = '#d8bd7a'; g.textAlign = 'left'; g.fillText('金队', W / 2 + 90, 420);
    g.fillStyle = '#e7e2d7'; g.textAlign = 'center'; g.font = `bold 40px ${font}`; g.fillText('VS', W / 2, 420);
    g.font = `26px ${font}`; g.fillStyle = 'rgba(231,226,215,0.7)'; g.fillText('团队赛 · 常规赛', W / 2, 468);
  });
  const screenMat = new THREE.MeshBasicMaterial({ map: screenTex, toneMapped: false });
  kit.disposables.push(screenTex, screenMat);
  const screens = [];
  for (const sz of [-1, 1]) {
    const z = sz * (OW + 0.2), y = topY + 5.2, W = 17, H = 8.5;
    kit.box('doorIron', [0, y, z + sz * 0.4], [W + 1.0, H + 1.0, 0.6]);
    kit.box('bronze', [0, y + H / 2 + 0.55, z + sz * 0.1], [W + 1.2, 0.2, 0.3], { cast: false });
    kit.box('bronze', [0, y - H / 2 - 0.55, z + sz * 0.1], [W + 1.2, 0.2, 0.3], { cast: false });
    for (const s of [-1, 1]) kit.box('doorIron', [s * 6, (topY + y - H / 2) / 2, z + sz * 0.5], [0.6, y - H / 2 - topY + 0.4, 0.6]);
    const scr = new THREE.Mesh(new THREE.PlaneGeometry(W, H), screenMat);
    scr.position.set(0, y, z + sz * 0.08);
    scr.rotation.y = sz > 0 ? Math.PI : 0;
    scr.name = 'screen';
    kit.group.add(scr); kit.disposables.push(scr.geometry);
    screens.push({ pos: [0, y, z], normal: [0, 0, -sz] });
    kit.glow([0, y, z - sz * 1.5], 9, 0x4d9d9a, 0.12);
  }

  // ---------- 看台顶棚（四个斜角面）与灯塔 ----------
  for (let f = 1; f < 8; f += 2) {
    const a = f * Math.PI / 4;
    const ap = OW + 0.5, half = ap * K * 0.8;
    const cx = Math.cos(a) * (ap - 5), cz = Math.sin(a) * (ap - 5);
    const ry = -a + Math.PI / 2;
    for (const t of [-half, 0, half]) {
      const x = Math.cos(a) * ap - Math.sin(a) * t, z = Math.sin(a) * ap + Math.cos(a) * t;
      kit.cyl('doorIron', [x, topY - 0.2, z], 0.18, 0.22, 6.2, 8);
    }
    kit.box(f % 4 === 1 ? 'canopyTeal' : 'canopyCream', [cx, topY + 5.2, cz], [half * 2 + 1.2, 0.14, 11], { rotY: ry, rot: [-0.18, ry, 0] });
    kit.box('bronze', [Math.cos(a) * (ap - 10.4), topY + 4.2, Math.sin(a) * (ap - 10.4)], [half * 2 + 1.2, 0.18, 0.18], { rotY: ry, cast: false });
    // 灯塔
    const lx = Math.cos(a) * (OW + 3.5), lz = Math.sin(a) * (OW + 3.5);
    kit.slab('wall', [lx - 1.2, -1, lz - 1.2], [lx + 1.2, topY + 12, lz + 1.2]);
    kit.slab('bronze', [lx - 1.3, topY + 3, lz - 1.3], [lx + 1.3, topY + 3.3, lz + 1.3], { cast: false });
    const hx = Math.cos(a) * (OW + 2.6), hz = Math.sin(a) * (OW + 2.6);
    kit.box('doorIron', [hx, topY + 13.2, hz], [5.2, 3.0, 0.6], { rotY: ry, rot: [0.35, ry, 0] });
    for (let r = 0; r < 2; r++) for (let c = 0; c < 4; c++) {
      const t = (c - 1.5) * 1.15, yy = topY + 12.6 + r * 1.2;
      const px = hx - Math.cos(a) * 0.35 - Math.sin(a) * t, pz = hz - Math.sin(a) * 0.35 + Math.cos(a) * t;
      kit.box('lamp', [px, yy, pz], [0.9, 0.9, 0.12], { rotY: ry, rot: [0.35, ry, 0], cast: false });
      kit.glow([px - Math.cos(a) * 0.4, yy, pz - Math.sin(a) * 0.4], 1.3, 0xfff0d0, 0.35);
    }
  }
  // 看台上沿的旗帜
  for (let f = 0; f < 8; f++) {
    if (f === 2 || f === 6) continue;
    const a = f * Math.PI / 4;
    for (const t of [-0.6, 0.6]) {
      const ap = OW - 0.1, half = ap * K * t;
      const x = Math.cos(a) * ap - Math.sin(a) * half, z = Math.sin(a) * ap + Math.cos(a) * half;
      kit.banner([x, topY - 0.3, z], -a - Math.PI / 2, 1.2, 3.8, x < -1 ? 0 : x > 1 ? 1 : 2);
    }
  }

  kit.finish();
  const background = new THREE.Color(0xe1eaf1);
  const fog = new THREE.Fog(0xe1eaf1, 60, 520);
  kit.bakeEnv([0.3, 2, 0.4], background, 0.5);
  const crowd = kit.group.getObjectByName('crowd');
  if (crowd && kit.envRT) { crowd.material.envMap = kit.envRT.texture; crowd.material.envMapIntensity = 0.4; }

  const teamA = [[-16, 0, -3, Math.PI / 2], [-16, 0, 0, Math.PI / 2], [-16, 0, 3, Math.PI / 2]];
  const teamB = [[16, 0, -3, -Math.PI / 2], [16, 0, 0, -Math.PI / 2], [16, 0, 3, -Math.PI / 2]];
  return kit.result({
    background, fog,
    bounds: { minX: -A, maxX: A, minZ: -A, maxZ: A },
    spawns: { player: teamA[1], enemy: teamB[1], teamA, teamB },
    markers: {
      center: [0, 0],
      apothem: A,
      gates: { teamA: [-A, 0, 0], teamB: [A, 0, 0] },
      covers: [[-8.2, -7.2], [8.2, -7.2], [-8.2, 7.2], [8.2, 7.2]],
      obelisks: [[0, -12.5], [0, 12.5]],
      screens,
      crowd: kit.crowdCount,
    },
  });
}

function await_merge(geos) {
  // 合并两段无索引几何（只保留 position/normal）
  const pos = [], nor = [];
  for (const g of geos) { pos.push(...g.attributes.position.array); nor.push(...g.attributes.normal.array); g.dispose(); }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  return out;
}
