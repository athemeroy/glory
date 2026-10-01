// 霜法师袖面曾整片绑 Hand，肘边又混入 neck/Spine；仅修复已审计的外袍近臂区域。
import * as THREE from 'three';
import { markSharedResource } from './model.js';

const prepared = new WeakMap();
const smooth = (a, b, value) => { const t = Math.max(0, Math.min(1, (value - a) / (b - a))); return t * t * (3 - 2 * t); };

// 沿上臂/前臂的弧长连续混合，袖口保留前臂主导，防止被原手掌过滤器误删。
export function sampleArmWeights(point, chain) {
  const upper = new THREE.Vector3().subVectors(chain.elbow, chain.arm), fore = new THREE.Vector3().subVectors(chain.wrist, chain.elbow);
  const upperLength = upper.length(), foreLength = fore.length();
  if (upperLength < 1e-6 || foreLength < 1e-6) return null;
  const upperT = new THREE.Vector3().subVectors(point, chain.arm).dot(upper) / (upperLength * upperLength);
  const foreT = new THREE.Vector3().subVectors(point, chain.elbow).dot(fore) / (foreLength * foreLength);
  const upperDistance = point.distanceTo(new THREE.Vector3().copy(chain.arm).addScaledVector(upper, THREE.MathUtils.clamp(upperT, 0, 1)));
  const foreDistance = point.distanceTo(new THREE.Vector3().copy(chain.elbow).addScaledVector(fore, THREE.MathUtils.clamp(foreT, 0, 1)));
  // 用肘处两段切向的平均方向构造单一连续场，避免最近骨段切换时出现权重跳变。
  const tangent = upper.clone().divideScalar(upperLength).add(fore.clone().divideScalar(foreLength)).normalize();
  const arc = new THREE.Vector3().subVectors(point, chain.elbow).dot(tangent);
  const elbowBlend = smooth(-.055, .075, arc), wristBlend = .35 * smooth(foreLength - .055, foreLength + .025, arc);
  return {weights: [1 - elbowBlend, elbowBlend * (1 - wristBlend), elbowBlend * wristBlend], distance: Math.min(upperDistance, foreDistance)};
}

function prepare(mesh, body) {
  const source = mesh.geometry, si = source.attributes.skinIndex, sw = source.attributes.skinWeight;
  if (!si || !sw || !source.index || !body.bones.Head || !body.bones.Hips) return null;
  const names = mesh.skeleton.bones.map(bone => bone.name), hips = body.bones.Hips.getWorldPosition(new THREE.Vector3()), head = body.bones.Head.getWorldPosition(new THREE.Vector3());
  const chains = [];
  for (const [side, sign] of [['Left', 1], ['Right', -1]]) {
    const bones = ['Arm', 'ForeArm', 'Hand'].map(part => body.bones[side + part]);
    if (bones.some(bone => !bone)) continue;
    chains.push({side, sign, arm: bones[0].getWorldPosition(new THREE.Vector3()), elbow: bones[1].getWorldPosition(new THREE.Vector3()), wrist: bones[2].getWorldPosition(new THREE.Vector3()), indices: ['Arm', 'ForeArm', 'Hand'].map(part => names.indexOf(side + part))});
  }
  if (chains.length !== 2 || chains.some(chain => chain.indices.some(index => index < 0))) return null;
  const point = new THREE.Vector3(), points = new Float32Array(si.count * 3), welded = new Uint32Array(si.count), cells = new Map(), parent = [];
  mesh.skeleton.update();
  for (let i = 0; i < si.count; i++) {
    mesh.getVertexPosition(i, point).applyMatrix4(mesh.matrixWorld); point.toArray(points, i * 3);
    const key = `${Math.round(point.x / .00005)},${Math.round(point.y / .00005)},${Math.round(point.z / .00005)}`;
    let id = cells.get(key);
    if (id === undefined) { id = parent.length; parent.push(id); cells.set(key, id); }
    welded[i] = id;
  }
  const root = id => { while (parent[id] !== id) { parent[id] = parent[parent[id]]; id = parent[id]; } return id; };
  for (let i = 0; i < source.index.count; i += 3) {
    const a = root(welded[source.index.getX(i)]), b = root(welded[source.index.getX(i + 1)]), c = root(welded[source.index.getX(i + 2)]);
    parent[b] = a; parent[c] = a;
  }
  const components = new Map();
  for (let i = 0; i < si.count; i++) {
    const id = root(welded[i]); let component = components.get(id);
    if (!component) { component = {count: 0, minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity, minZ: Infinity}; components.set(id, component); }
    component.count++; component.minX = Math.min(component.minX, points[i * 3]); component.maxX = Math.max(component.maxX, points[i * 3]);
    component.minY = Math.min(component.minY, points[i * 3 + 1]); component.maxY = Math.max(component.maxY, points[i * 3 + 1]); component.minZ = Math.min(component.minZ, points[i * 3 + 2]);
  }
  // 真实手掌1600/1611点和腿脚2647点都在独立组件；禁止依赖 Hand 权重区分衣袖/真人手掌。
  const selected = new Set([...components].filter(([, c]) => c.count > 12000 && c.count < 14000 && c.minY > .06 && c.minY < .10 && c.maxY > head.y + .15 && c.minZ < -.30 && c.minX < hips.x - .45 && c.maxX > hips.x + .45).map(([id]) => id));
  if (!selected.size) return null;
  const indices = new Uint16Array(si.count * 4), weights = new Float32Array(sw.count * 4), strength = new Float32Array(si.count), componentMask = new Uint8Array(si.count);
  let changed = 0;
  for (let i = 0; i < si.count; i++) {
    for (let k = 0; k < 4; k++) { indices[i * 4 + k] = si.getComponent(i, k); weights[i * 4 + k] = sw.getComponent(i, k); }
    if (!selected.has(root(welded[i]))) continue;
    point.fromArray(points, i * 3);
    const chain = chains.find(chain => chain.sign * (point.x - hips.x) > 0), sample = chain && sampleArmWeights(point, chain);
    if (!sample) continue;
    const side = smooth(.13, .24, chain.sign * (point.x - hips.x));
    const upper = 1 - smooth(chain.arm.y - .05, chain.arm.y + .10, point.y);
    const amount = side * upper * (1 - smooth(.15, .22, sample.distance));
    if (amount <= 1e-6) continue;
    const byBone = new Map();
    for (let k = 0; k < 4; k++) { const index = indices[i * 4 + k]; byBone.set(index, (byBone.get(index) || 0) + weights[i * 4 + k] * (1 - amount)); }
    for (let k = 0; k < 3; k++) byBone.set(chain.indices[k], (byBone.get(chain.indices[k]) || 0) + sample.weights[k] * amount);
    const best = [...byBone].filter(([, weight]) => weight > 0).sort((a, b) => b[1] - a[1]).slice(0, 4), sum = best.reduce((value, [, weight]) => value + weight, 0);
    for (let k = 0; k < 4; k++) { indices[i * 4 + k] = best[k]?.[0] || 0; weights[i * 4 + k] = best[k] ? best[k][1] / sum : 0; }
    strength[i] = amount; componentMask[i] = 1; changed++;
  }
  if (!changed) return null;
  const geometry = new THREE.BufferGeometry();
  for (const [name, attribute] of Object.entries(source.attributes)) geometry.setAttribute(name, attribute);
  geometry.setAttribute('skinIndex', markSharedResource(new THREE.Uint16BufferAttribute(indices, 4)));
  geometry.setAttribute('skinWeight', markSharedResource(new THREE.Float32BufferAttribute(weights, 4)));
  geometry.setIndex(source.index); geometry.groups = source.groups.map(group => ({...group}));
  geometry.morphAttributes = source.morphAttributes; geometry.morphTargetsRelative = source.morphTargetsRelative;
  geometry.boundingBox = source.boundingBox?.clone() || null; geometry.boundingSphere = source.boundingSphere?.clone() || null;
  geometry.userData = {...source.userData, shared: true}; markSharedResource(geometry);
  return {geometry, strength, componentMask, changed};
}

export function repairSleeveWeights(body, classId) {
  if (classId !== 'frostcaster') return null;
  let changed = 0;
  for (const mesh of body.meshes) {
    const source = mesh.geometry;
    if (!prepared.has(source)) prepared.set(source, prepare(mesh, body));
    const result = prepared.get(source); if (!result) continue;
    mesh.geometry = result.geometry; mesh.userData.sleeveStrength = result.strength; mesh.userData.sleeveComponent = result.componentMask; changed += result.changed;
  }
  if (!changed) return null;
  body.sleeve = {classId, changed}; return body.sleeve;
}
