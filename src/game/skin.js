// 把图生 3D 得到的静态角色网格（GLB，A 字姿势）自动蒙皮到程序化骨架上。
// 做法：直接用 rig 的骨骼节点作为 THREE.Skeleton 的骨骼；绑定时把肩关节摆成与网格一致的 A 字角度；
// 顶点权重按到各骨段的距离（带区域约束）计算；头部、手臂按主导骨骼拆成独立网格，
// 以便第一人称时隐藏自己的头和手臂（镜子里仍可见）。
import * as THREE from 'three';
import { GLTFLoader } from '../../vendor/GLTFLoader.js';

const cache = new Map();
const loader = new GLTFLoader();

export function loadModel(url) {
  if (!cache.has(url)) cache.set(url, loader.loadAsync(url).then((g) => g.scene).catch(() => null));
  return cache.get(url);
}
export function hasModel(url) { return cache.has(url); }

// 线段距离
function segDist(p, a, b) {
  const abx = b.x - a.x, aby = b.y - a.y, abz = b.z - a.z;
  const apx = p.x - a.x, apy = p.y - a.y, apz = p.z - a.z;
  const L = abx * abx + aby * aby + abz * abz;
  let t = L > 1e-9 ? (apx * abx + apy * aby + apz * abz) / L : 0;
  t = Math.max(0, Math.min(1, t));
  const dx = apx - abx * t, dy = apy - aby * t, dz = apz - abz * t;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

// 合并 GLB 场景里的所有网格为一个几何（保留第一个材质）
function mergeScene(root) {
  root.updateMatrixWorld(true);
  const geos = []; let material = null;
  root.traverse((o) => {
    if (!o.isMesh) return;
    const g = o.geometry.clone();
    g.applyMatrix4(o.matrixWorld);
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
    if (!g.attributes.normal) g.computeVertexNormals();
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    geos.push(g.index ? g.toNonIndexed() : g);
    if (!material) material = o.material;
  });
  if (!geos.length) return null;
  // 手动拼接（非索引）
  let n = 0; for (const g of geos) n += g.attributes.position.count;
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), uv = new Float32Array(n * 2);
  let off = 0;
  for (const g of geos) {
    pos.set(g.attributes.position.array, off * 3); nor.set(g.attributes.normal.array, off * 3); uv.set(g.attributes.uv.array, off * 2);
    off += g.attributes.position.count;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return { geo, material };
}

const BONE_NAMES = ['hips', 'spine', 'chest', 'neck', 'head', 'shL', 'elL', 'haL', 'shR', 'elR', 'haR', 'thL', 'knL', 'ftL', 'thR', 'knR', 'ftR'];

const prepared = new Map();

function setBindPose(rig, aL, aR) {
  const B = rig.bones;
  const saved = new Map();
  const rootState = [rig.root.position.clone(), rig.root.quaternion.clone(), rig.root.scale.clone()];
  rig.root.position.set(0, 0, 0); rig.root.rotation.set(0, 0, 0); rig.root.scale.set(1, 1, 1);
  for (const n of [...BONE_NAMES, 'body', 'gripR', 'gripL']) { const b = B[n]; saved.set(n, [b.position.clone(), b.quaternion.clone()]); b.rotation.set(0, 0, 0); }
  B.body.position.set(0, 0, 0);
  B.shL.rotation.set(0, 0, aL); B.shR.rotation.set(0, 0, aR);
  rig.root.updateMatrixWorld(true);
  return () => {
    for (const [n, [p, q]] of saved) { B[n].position.copy(p); B[n].quaternion.copy(q); }
    rig.root.position.copy(rootState[0]); rig.root.quaternion.copy(rootState[1]); rig.root.scale.copy(rootState[2]);
    rig.root.updateMatrixWorld(true);
  };
}

// 每个 rig 各自绑定（几何与材质可共享；材质由 Fighter 另行克隆）
function bindPrepared(prep, rig) {
  const restore = setBindPose(rig, prep.aL, prep.aR);
  const skeleton = new THREE.Skeleton(BONE_NAMES.map((n) => rig.bones[n]));
  const out = { skeleton, armAngles: [prep.aL, prep.aR], gloveColor: prep.gloveColor };
  for (const k of ['head', 'arms', 'hands', 'body']) {
    if (!prep.geos[k]) continue;
    const m = new THREE.SkinnedMesh(prep.geos[k], prep.material);
    m.castShadow = true; m.frustumCulled = false; m.name = 'skin_' + k;
    rig.root.add(m);
    m.updateMatrixWorld(true);
    m.bind(skeleton, new THREE.Matrix4());
    out[k] = m;
  }
  restore();
  return out;
}

export function skinToRig(scene, rig, opts = {}) {
  const key = opts.key;
  if (key && prepared.has(key)) return bindPrepared(prepared.get(key), rig);
  const prep = prepare(scene, rig, opts);
  if (!prep) return null;
  if (key) prepared.set(key, prep);
  return bindPrepared(prep, rig);
}

// 计算权重并拆分网格（开销较大，按 key 缓存）
function prepare(scene, rig, opts = {}) {
  const merged = mergeScene(scene);
  if (!merged) return null;
  const { geo } = merged;
  // 归一化：脚底 y=0、身高 1.76、x/z 居中
  geo.computeBoundingBox();
  const bb = geo.boundingBox;
  const H = bb.max.y - bb.min.y;
  const s = (opts.height || 1.76) / H;
  const cx = (bb.min.x + bb.max.x) / 2, cz = (bb.min.z + bb.max.z) / 2;
  geo.translate(-cx, -bb.min.y, -cz);
  geo.scale(s, s, s);
  const P = geo.attributes.position;
  const N = P.count;
  const v = new THREE.Vector3();

  // ---- 估计手臂外展角：肩高以下、躯干之外的顶点 ----
  const Hs = opts.height || 1.76;
  const shoulderY = Hs * 0.815;
  let sumL = new THREE.Vector3(), cntL = 0, sumR = new THREE.Vector3(), cntR = 0;
  for (let i = 0; i < N; i++) {
    v.fromBufferAttribute(P, i);
    if (v.y > shoulderY - 0.05 || v.y < Hs * 0.42) continue;
    const torsoHalf = 0.2;
    if (v.x > torsoHalf) { sumL.add(v); cntL++; } else if (v.x < -torsoHalf) { sumR.add(v); cntR++; }
  }
  const armAngle = (sum, cnt, sign) => {
    if (cnt < 30) return 0.35 * sign;
    sum.divideScalar(cnt);
    const dx = Math.abs(sum.x) - 0.19, dy = shoulderY - sum.y;
    return Math.max(0.12, Math.min(0.9, Math.atan2(dx, Math.max(0.05, dy)))) * sign;
  };
  const aL = armAngle(sumL, cntL, 1), aR = armAngle(sumR, cntR, -1);

  // ---- 绑定姿势：rig 站直、肩外展到 A 字 ----
  const B = rig.bones;
  const restore = setBindPose(rig, aL, aR);

  // 骨段（世界坐标，绑定姿势）
  const wp = (b) => b.getWorldPosition(new THREE.Vector3());
  const J = {}; for (const n of BONE_NAMES) J[n] = wp(B[n]);
  const headTop = J.head.clone().add(new THREE.Vector3(0, 0.22, 0));
  const handEnd = (ha, el) => ha.clone().add(ha.clone().sub(el).normalize().multiplyScalar(0.12));
  const toe = (ft) => ft.clone().add(new THREE.Vector3(0, -0.05, 0.14));
  const segs = [
    ['hips', J.hips.clone().add(new THREE.Vector3(0, -0.08, 0)), J.spine],
    ['spine', J.spine, J.chest],
    ['chest', J.chest, J.neck],
    ['neck', J.neck, J.head],
    ['head', J.head, headTop],
    ['shL', J.shL, J.elL], ['elL', J.elL, J.haL], ['haL', J.haL, handEnd(J.haL, J.elL)],
    ['shR', J.shR, J.elR], ['elR', J.elR, J.haR], ['haR', J.haR, handEnd(J.haR, J.elR)],
    ['thL', J.thL, J.knL], ['knL', J.knL, J.ftL], ['ftL', J.ftL, toe(J.ftL)],
    ['thR', J.thR, J.knR], ['knR', J.knR, J.ftR], ['ftR', J.ftR, toe(J.ftR)],
  ];
  const boneIndex = new Map(BONE_NAMES.map((n, i) => [n, i]));
  const skinIndex = new Uint16Array(N * 4), skinWeight = new Float32Array(N * 4);
  const hipY = J.hips.y, neckY = J.neck.y;
  const armRegion = (p, side) => {
    // 躯干之外，或低于胸口的“手臂外侧”
    const ax = Math.abs(p.x);
    return (side > 0 ? p.x > 0 : p.x < 0) && ax > 0.17 && p.y > hipY - 0.35 && p.y < neckY + 0.02;
  };
  const cand = [];
  for (let i = 0; i < N; i++) {
    v.fromBufferAttribute(P, i);
    cand.length = 0;
    const side = v.x >= 0 ? 1 : -1;
    const isArm = armRegion(v, side) && Math.abs(v.x) > 0.2 + Math.max(0, (v.y - (neckY - 0.1))) * 0;
    for (const [name, a, b] of segs) {
      const isArmBone = name.startsWith('sh') || name.startsWith('el') || name.startsWith('ha');
      const isLeg = name.startsWith('th') || name.startsWith('kn') || name.startsWith('ft');
      const bSide = name.endsWith('L') ? 1 : name.endsWith('R') ? -1 : 0;
      if (bSide && bSide !== side && Math.abs(v.x) > 0.03) continue;
      if (isArmBone && !isArm) continue;
      if (isArm && !isArmBone && name !== 'chest' && name !== 'spine') continue;
      if (isLeg && v.y > hipY + 0.06) continue;
      if ((name === 'head' || name === 'neck') && v.y < neckY - 0.06) continue;
      if (!isLeg && name !== 'hips' && v.y < hipY - 0.12 && Math.abs(v.x) < 0.3) continue;
      const d = segDist(v, a, b);
      cand.push([name, d]);
    }
    if (!cand.length) cand.push(['hips', 1]);
    cand.sort((x, y) => x[1] - y[1]);
    let tot = 0; const top = cand.slice(0, 3);
    const ws = top.map(([, d]) => { const w = 1 / Math.pow(Math.max(0.01, d), 4); tot += w; return w; });
    for (let k = 0; k < 4; k++) {
      if (k < top.length) { skinIndex[i * 4 + k] = boneIndex.get(top[k][0]); skinWeight[i * 4 + k] = ws[k] / tot; }
      else { skinIndex[i * 4 + k] = 0; skinWeight[i * 4 + k] = 0; }
    }
  }
  geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndex, 4));
  geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skinWeight, 4));

  // ---- 按三角形主导骨骼拆分：头 / 左右臂 / 身体 ----
  const groupOf = (vi) => {
    const b = BONE_NAMES[skinIndex[vi * 4]];
    if (b === 'head' || b === 'neck') return 'head';
    if (b === 'haL' || b === 'haR') return 'hands';
    if (b === 'shL' || b === 'elL' || b === 'shR' || b === 'elR') return 'arms';
    return 'body';
  };
  const tris = { head: [], arms: [], hands: [], body: [] };
  for (let t = 0; t < N / 3; t++) {
    const g = [groupOf(t * 3), groupOf(t * 3 + 1), groupOf(t * 3 + 2)];
    const k = g[0] === g[1] || g[0] === g[2] ? g[0] : g[1] === g[2] ? g[1] : 'body';
    tris[k].push(t);
  }
  const material = merged.material && merged.material.isMaterial ? merged.material : new THREE.MeshStandardMaterial({ color: '#bbb' });
  if (material.map) material.map.colorSpace = THREE.SRGBColorSpace;
  material.roughness = Math.max(material.roughness ?? 0.7, 0.6);
  material.metalness = Math.min(material.metalness ?? 0, 0.15);
  const geos = {};
  for (const k of ['head', 'arms', 'hands', 'body']) {
    const list = tris[k];
    if (!list.length) continue;
    const g = new THREE.BufferGeometry();
    for (const [name, attr] of Object.entries(geo.attributes)) {
      const size = attr.itemSize;
      const arr = new attr.array.constructor(list.length * 3 * size);
      let o = 0;
      for (const t of list) for (let c = 0; c < 3; c++) { const vi = t * 3 + c; for (let q = 0; q < size; q++) arr[o++] = attr.array[vi * size + q]; }
      g.setAttribute(name, new THREE.BufferAttribute(arr, size, attr.normalized));
    }
    geos[k] = g;
  }
  restore();
  let gloveColor = null;
  try {
    const img = material.map && material.map.image;
    if (img && geos.hands) {
      const cv = document.createElement('canvas'); const W = 64, Hh = 64; cv.width = W; cv.height = Hh;
      const cx2 = cv.getContext('2d'); cx2.drawImage(img, 0, 0, W, Hh);
      const data = cx2.getImageData(0, 0, W, Hh).data;
      const uv = geos.hands.attributes.uv; let r = 0, g = 0, b = 0, n = 0;
      for (let i = 0; i < uv.count; i += 7) {
        const x = Math.min(W - 1, Math.max(0, Math.floor(uv.getX(i) * W))), y = Math.min(Hh - 1, Math.max(0, Math.floor((1 - uv.getY(i)) * Hh)));
        const o = (y * W + x) * 4; r += data[o]; g += data[o + 1]; b += data[o + 2]; n++;
      }
      if (n) gloveColor = new THREE.Color(`rgb(${Math.round(r / n)},${Math.round(g / n)},${Math.round(b / n)})`);
    }
  } catch { gloveColor = null; }
  return { geos, material, aL, aR, gloveColor };
}

// 用蒙皮网格替换程序化身体（武器、挂点保留）
export function applySkinnedModel(rig, scene, opts = {}) {
  const res = skinToRig(scene, rig, opts);
  if (!res) return false;
  for (const p of rig.parts) p.visible = false;
  rig.procParts = rig.parts;
  rig.parts = [res.head, res.arms, res.hands, res.body].filter(Boolean);
  rig.headParts.length = 0;
  if (res.head) rig.headParts.push(res.head);
  // 精模的手多为张开姿势：换成程序化握拳（颜色取自模型手套），握持武器更自然
  const fists = [];
  if (res.hands && opts.fists !== false) {
    res.hands.visible = false;
    const handSet = new Set();
    for (const b of ['haL', 'haR']) rig.bones[b].traverse((o) => handSet.add(o));
    for (const p of rig.procParts || []) {
      if (!handSet.has(p)) continue;
      p.visible = true;
      if (res.gloveColor && p.material) { p.material = p.material.clone(); p.material.color.copy(res.gloveColor); }
      fists.push(p);
    }
    rig.parts.push(...fists);
  }
  rig.armParts = [res.arms, res.hands, ...fists].filter(Boolean);
  rig.skinned = res;
  return true;
}
