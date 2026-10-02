// 修复已审计角色的披风/裙摆错绑：保留人体关节，仅重绑远离肢体的布面。
import * as THREE from 'three';
import { markSharedResource } from './model.js';

const profiles = {
  berserker: { rear: [0.02, -0.08], front: [0.28, 0.40] },
  skeleton: { rear: [-0.08, -0.18], front: [0.28, 0.40], center: [0.04, 0.12], protectHands: true },
};
const prepared = new WeakMap();
const originalGeometries = new WeakMap();

// 原GLB仅作只读输入；独立服饰修复可从缓存结果找回其原蒙皮，不放进userData。
export function originalClothGeometry(geometry) { return originalGeometries.get(geometry) || geometry; }
const smooth = (a, b, value) => {
  const t = Math.max(0, Math.min(1, (value - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

function limbSegments(body) {
  const segments = [];
  for (const side of ['Left', 'Right']) for (const [a, b] of [
    ['Arm', 'ForeArm'], ['ForeArm', 'Hand'], ['UpLeg', 'Leg'], ['Leg', 'Foot'], ['Foot', 'ToeBase'],
  ]) {
    const start = body.bones[side + a], end = body.bones[side + b];
    if (start && end) segments.push(new THREE.Line3(start.getWorldPosition(new THREE.Vector3()), end.getWorldPosition(new THREE.Vector3())));
  }
  return segments;
}

function prepare(mesh, body, profile) {
  const source = mesh.geometry, si = source.attributes.skinIndex, sw = source.attributes.skinWeight;
  if (!si || !sw) return null;
  const names = mesh.skeleton.bones.map((bone) => bone.name), hip = names.indexOf('Hips'), spine = names.indexOf('Spine');
  if (hip < 0 || spine < 0) return null;
  const hips = body.bones.Hips.getWorldPosition(new THREE.Vector3()), hipY = hips.y;
  const segments = limbSegments(body), point = new THREE.Vector3(), nearest = new THREE.Vector3();
  // 24 骨模型没有指骨；真实长手指能离腕超过13cm，不能把它们当成低处衣摆。
  const hands = profile.protectHands ? ['Left', 'Right'].map(side => {
    const index = names.indexOf(side + 'Hand');
    return index >= 0 ? { index, position: mesh.skeleton.bones[index].getWorldPosition(new THREE.Vector3()) } : null;
  }).filter(Boolean) : [];
  const indices = new Uint16Array(si.count * 4), weights = new Float32Array(sw.count * 4), strength = new Float32Array(si.count);
  let changed = 0, protectedLimbVertices = 0;
  mesh.skeleton.update();
  for (let i = 0; i < si.count; i++) {
    for (let k = 0; k < 4; k++) { indices[i * 4 + k] = si.getComponent(i, k); weights[i * 4 + k] = sw.getComponent(i, k); }
    // 狂剑士宽护腿虽离骨段超过13cm，原完整拓扑与同侧腿骨权重已认证是真硬甲。
    if (mesh.userData.clothProtectedLimbMask?.[i]) { protectedLimbVertices++; continue; }
    mesh.getVertexPosition(i, point).applyMatrix4(mesh.matrixWorld);
    let protectedHand = false;
    for (const hand of hands) {
      let weight = 0;
      for (let k = 0; k < 4; k++) if (indices[i * 4 + k] === hand.index) weight += weights[i * 4 + k];
      if (weight >= 0.98 && point.distanceTo(hand.position) <= 0.22) { protectedHand = true; break; }
    }
    if (protectedHand) { protectedLimbVertices++; continue; }
    let distance = Infinity;
    for (const segment of segments) { segment.closestPointToPoint(point, true, nearest); distance = Math.min(distance, point.distanceTo(nearest)); }
    // 距骨段 13cm 内的实际手臂、肘、膝与腿完全不改。
    if (distance <= 0.13) { protectedLimbVertices++; continue; }
    // 骸骨卫兵两腿之间有一片内裙；中轴远离腿骨，不能继承左右腿交叉权重。
    const center = profile.center ? (1 - smooth(profile.center[0], profile.center[1], Math.abs(point.x - hips.x))) * (1 - smooth(hipY - 0.24, hipY - 0.12, point.y)) : 0;
    const side = Math.max(smooth(profile.rear[0], profile.rear[1], point.z), smooth(profile.front[0], profile.front[1], point.z), center);
    const amount = side * smooth(0.13, 0.23, distance) * smooth(0.01, 0.08, point.y) * (1 - smooth(hipY + 0.08, hipY + 0.25, point.y));
    if (amount <= 1e-6) continue;
    const torso = Math.max(0, Math.min(1, (point.y - hipY + 0.30) / 0.45)) * 0.65;
    const byBone = new Map();
    for (let k = 0; k < 4; k++) {
      const bone = indices[i * 4 + k], weight = weights[i * 4 + k] * (1 - amount);
      byBone.set(bone, (byBone.get(bone) || 0) + weight);
    }
    byBone.set(hip, (byBone.get(hip) || 0) + amount * (1 - torso));
    byBone.set(spine, (byBone.get(spine) || 0) + amount * torso);
    const selected = [...byBone].sort((a, b) => b[1] - a[1]).slice(0, 4), total = selected.reduce((sum, [, weight]) => sum + weight, 0);
    for (let k = 0; k < 4; k++) { indices[i * 4 + k] = selected[k]?.[0] || 0; weights[i * 4 + k] = selected[k] ? selected[k][1] / total : 0; }
    strength[i] = amount; changed++;
  }
  if (!changed) return null;
  // 所有实例复用只读修复结果；原始 GLB 与所有非蒙皮属性保持原样。
  const geometry = new THREE.BufferGeometry();
  for (const [name, attribute] of Object.entries(source.attributes)) geometry.setAttribute(name, attribute);
  geometry.setAttribute('skinIndex', markSharedResource(new THREE.Uint16BufferAttribute(indices, 4)));
  geometry.setAttribute('skinWeight', markSharedResource(new THREE.Float32BufferAttribute(weights, 4)));
  geometry.setIndex(source.index); geometry.groups = source.groups.map(group => ({...group}));
  geometry.morphAttributes = source.morphAttributes; geometry.morphTargetsRelative = source.morphTargetsRelative;
  geometry.boundingBox = source.boundingBox?.clone() || null; geometry.boundingSphere = source.boundingSphere?.clone() || null;
  geometry.userData = {...source.userData, shared: true}; markSharedResource(geometry);
  originalGeometries.set(geometry, source);
  return {geometry, strength, changed, protectedLimbVertices};
}

export function repairClothWeights(body, classId) {
  const profile = profiles[classId];
  if (!profile) return null;
  if (body.cloth?.classId === classId) return body.cloth;
  let changed = 0, protectedLimbVertices = 0;
  for (const mesh of body.meshes) {
    const source = mesh.geometry;
    let byClass = prepared.get(source);
    if (!byClass) { byClass = new Map(); prepared.set(source, byClass); }
    if (!byClass.has(classId)) byClass.set(classId, prepare(mesh, body, profile));
    const result = byClass.get(classId);
    if (!result) continue;
    mesh.geometry = result.geometry;
    mesh.userData.clothStrength = result.strength;
    changed += result.changed; protectedLimbVertices += result.protectedLimbVertices;
  }
  body.cloth = {classId, changed, protectedLimbVertices};
  return body.cloth;
}
