// 修复已审计头饰连通片中的肩臂污染，真实头颈与肩甲保持原绑定。
import * as THREE from 'three';
import { markSharedResource } from './model.js';

const prepared = new WeakMap();
const contaminatingBones = new Set(['LeftShoulder', 'RightShoulder', 'LeftArm', 'RightArm', 'LeftForeArm', 'RightForeArm', 'LeftHand', 'RightHand']);

function prepare(mesh, body) {
  const source = mesh.geometry, si = source.attributes.skinIndex, sw = source.attributes.skinWeight;
  if (!si || !sw || !source.index) return null;
  const names = mesh.skeleton.bones.map(bone => bone.name), headIndex = names.indexOf('Head');
  if (headIndex < 0 || !body.bones.neck || !body.bones.Head) return null;
  const head = body.bones.Head.getWorldPosition(new THREE.Vector3()), neck = body.bones.neck.getWorldPosition(new THREE.Vector3());
  const point = new THREE.Vector3(), points = new Float32Array(si.count * 3), welded = new Uint32Array(si.count), cells = new Map(), parent = [];
  mesh.skeleton.update();
  for (let i = 0; i < si.count; i++) {
    mesh.getVertexPosition(i, point).applyMatrix4(mesh.matrixWorld); point.toArray(points, i * 3);
    // GLB 的硬法线/UV 缝有重复顶点；按 0.05mm 焊接后再检查真实三角连通片。
    const key = `${Math.round(point.x / .00005)},${Math.round(point.y / .00005)},${Math.round(point.z / .00005)}`;
    let id = cells.get(key);
    if (id === undefined) { id = parent.length; parent.push(id); cells.set(key, id); }
    welded[i] = id;
  }
  const root = id => {
    while (parent[id] !== id) { parent[id] = parent[parent[id]]; id = parent[id]; }
    return id;
  };
  for (let i = 0; i < source.index.count; i += 3) {
    const a = root(welded[source.index.getX(i)]), b = root(welded[source.index.getX(i + 1)]), c = root(welded[source.index.getX(i + 2)]);
    parent[b] = a; parent[c] = a;
  }
  const components = new Map();
  for (let i = 0; i < si.count; i++) {
    const id = root(welded[i]); let component = components.get(id);
    if (!component) { component = {count: 0, headWeight: 0, minY: Infinity, maxY: -Infinity, minZ: Infinity, maxZ: -Infinity}; components.set(id, component); }
    component.count++;
    for (let k = 0; k < 4; k++) if (si.getComponent(i, k) === headIndex) component.headWeight += sw.getComponent(i, k);
    component.minY = Math.min(component.minY, points[i * 3 + 1]); component.maxY = Math.max(component.maxY, points[i * 3 + 1]);
    component.minZ = Math.min(component.minZ, points[i * 3 + 2]); component.maxZ = Math.max(component.maxZ, points[i * 3 + 2]);
  }
  const selectedComponents = new Set();
  for (const [id, component] of components) {
    // 骸骨卫兵的后侧羽缨是独立、平均 Head>90% 的头饰片；头颈与肩甲不满足这些条件。
    if (component.count > 100 && component.headWeight / component.count > .90 && component.minY > neck.y + .01 && component.maxY > head.y + .15 && component.maxZ < head.z - .025 && component.minZ < head.z - .18) selectedComponents.add(id);
  }
  if (!selectedComponents.size) return null;
  const indices = new Uint16Array(si.count * 4), weights = new Float32Array(sw.count * 4), strength = new Float32Array(si.count), componentMask = new Uint8Array(si.count);
  let changed = 0, targetVertices = 0;
  for (let i = 0; i < si.count; i++) {
    for (let k = 0; k < 4; k++) { indices[i * 4 + k] = si.getComponent(i, k); weights[i * 4 + k] = sw.getComponent(i, k); }
    if (!selectedComponents.has(root(welded[i]))) continue;
    componentMask[i] = 1; targetVertices++;
    let contamination = 0; const byBone = new Map();
    for (let k = 0; k < 4; k++) {
      const index = indices[i * 4 + k], weight = weights[i * 4 + k];
      if (contaminatingBones.has(names[index])) contamination += weight;
      else byBone.set(index, (byBone.get(index) || 0) + weight);
    }
    if (contamination <= 1e-6) continue;
    // 仅把误入的肩/臂影响还给 Head，原有 Head/neck/Spine 过渡继续保留。
    byBone.set(headIndex, (byBone.get(headIndex) || 0) + contamination);
    const selected = [...byBone].filter(([, weight]) => weight > 0).sort((a, b) => b[1] - a[1]).slice(0, 4), total = selected.reduce((sum, [, weight]) => sum + weight, 0);
    for (let k = 0; k < 4; k++) { indices[i * 4 + k] = selected[k]?.[0] || 0; weights[i * 4 + k] = selected[k] ? selected[k][1] / total : 0; }
    strength[i] = contamination; changed++;
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
  return {geometry, strength, componentMask, changed, targetVertices};
}

export function repairAttachmentWeights(body, classId) {
  if (classId !== 'skeleton') return null;
  let changed = 0, targetVertices = 0;
  for (const mesh of body.meshes) {
    const source = mesh.geometry;
    if (!prepared.has(source)) prepared.set(source, prepare(mesh, body));
    const result = prepared.get(source); if (!result) continue;
    mesh.geometry = result.geometry; mesh.userData.attachmentStrength = result.strength; mesh.userData.attachmentComponent = result.componentMask;
    changed += result.changed; targetVertices += result.targetVertices;
  }
  if (!changed) return null;
  body.attachment = {classId, changed, targetVertices};
  return body.attachment;
}
