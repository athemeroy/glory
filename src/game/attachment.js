// 修复已审计服饰连通片的错绑，所有非目标人体网格保持原绑定。
import * as THREE from 'three';
import { markSharedResource } from './model.js';

const prepared = new WeakMap();
const classes = new Set(['skeleton', 'berserker', 'warlock', 'frostcaster']);
const contaminatingBones = new Set(['LeftShoulder', 'RightShoulder', 'LeftArm', 'RightArm', 'LeftForeArm', 'RightForeArm', 'LeftHand', 'RightHand']);
const smooth = (a, b, value) => { const t = Math.max(0, Math.min(1, (value - a) / (b - a))); return t * t * (3 - 2 * t); };

function limbSegments(body, armsOnly = false) {
  const segments = [];
  const parts = armsOnly ? [['Arm', 'ForeArm'], ['ForeArm', 'Hand']] : [['Arm', 'ForeArm'], ['ForeArm', 'Hand'], ['UpLeg', 'Leg'], ['Leg', 'Foot'], ['Foot', 'ToeBase']];
  for (const side of ['Left', 'Right']) for (const [a, b] of parts) {
    const start = body.bones[side + a], end = body.bones[side + b];
    if (start && end) segments.push(new THREE.Line3(start.getWorldPosition(new THREE.Vector3()), end.getWorldPosition(new THREE.Vector3())));
  }
  return segments;
}

function prepare(mesh, body, classId) {
  const source = mesh.geometry, si = source.attributes.skinIndex, sw = source.attributes.skinWeight;
  if (!si || !sw || !source.index) return null;
  const names = mesh.skeleton.bones.map(bone => bone.name), headIndex = names.indexOf('Head'), hipIndex = names.indexOf('Hips'), spineIndex = names.indexOf('Spine02') >= 0 ? names.indexOf('Spine02') : names.indexOf('Spine');
  if (headIndex < 0 || hipIndex < 0 || spineIndex < 0 || !body.bones.neck || !body.bones.Head || !body.bones.Hips) return null;
  const head = body.bones.Head.getWorldPosition(new THREE.Vector3()), neck = body.bones.neck.getWorldPosition(new THREE.Vector3());
  const hips = body.bones.Hips.getWorldPosition(new THREE.Vector3());
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
    if (!component) { component = {count: 0, headWeight: 0, lowHeadVertices: 0, minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity, minZ: Infinity, maxZ: -Infinity}; components.set(id, component); }
    component.count++;
    let headWeight = 0;
    for (let k = 0; k < 4; k++) if (si.getComponent(i, k) === headIndex) headWeight += sw.getComponent(i, k);
    component.headWeight += headWeight;
    if (headWeight > .05 && points[i * 3 + 1] < neck.y - .50) component.lowHeadVertices++;
    component.minX = Math.min(component.minX, points[i * 3]); component.maxX = Math.max(component.maxX, points[i * 3]);
    component.minY = Math.min(component.minY, points[i * 3 + 1]); component.maxY = Math.max(component.maxY, points[i * 3 + 1]);
    component.minZ = Math.min(component.minZ, points[i * 3 + 2]); component.maxZ = Math.max(component.maxZ, points[i * 3 + 2]);
  }
  const selectedComponents = new Set();
  for (const [id, component] of components) {
    // 骸骨卫兵的后侧羽缨是独立、平均 Head>90% 的头饰片；头颈与肩甲不满足这些条件。
    if (classId === 'skeleton' && component.count > 100 && component.headWeight / component.count > .90 && component.minY > neck.y + .01 && component.maxY > head.y + .15 && component.maxZ < head.z - .025 && component.minZ < head.z - .18) selectedComponents.add(id);
    // 狂战士前腰白色挂布是独立 294 顶点片；不可能的低处 Head 权重与腰带边界共同确认它。
    if (classId === 'berserker' && component.count > 200 && component.count < 400 && component.lowHeadVertices > 10 && component.minY > hips.y - .60 && component.minY < hips.y - .35 && component.maxY > hips.y && component.maxY < hips.y + .12 && component.minZ > hips.z + .06 && component.maxZ < hips.z + .25 && component.minX < hips.x && component.maxX > hips.x && component.maxX - component.minX < .40) selectedComponents.add(id);
    // 术士腰带挂下的独立 855 顶点中央袍片跨两腿，真实腿脚位于其他连通片。
    if (classId === 'warlock' && component.count > 500 && component.count < 1200 && component.headWeight / component.count < .05 && component.minY > .08 && component.minY < hips.y - .65 && component.maxY > hips.y - .05 && component.maxY < hips.y + .18 && component.minZ < hips.z - .15 && component.maxZ > hips.z + .10 && component.maxX - component.minX > .50 && component.maxX - component.minX < .90) selectedComponents.add(id);
    // 霜法师外袍连到头袖，但真正腿脚是另一个独立 2647 顶点片；只选择外袍后再限定下摆。
    if (classId === 'frostcaster' && component.count > 12000 && component.count < 14000 && component.minY > .06 && component.minY < .10 && component.maxY > head.y + .15 && component.minZ < -.30 && component.minX < hips.x - .45 && component.maxX > hips.x + .45) selectedComponents.add(id);
  }
  if (!selectedComponents.size) return null;
  const indices = new Uint16Array(si.count * 4), weights = new Float32Array(sw.count * 4), strength = new Float32Array(si.count), componentMask = new Uint8Array(si.count);
  const segments = classId === 'frostcaster' ? limbSegments(body, true) : [], nearest = new THREE.Vector3();
  let changed = 0, targetVertices = 0;
  for (let i = 0; i < si.count; i++) {
    for (let k = 0; k < 4; k++) { indices[i * 4 + k] = si.getComponent(i, k); weights[i * 4 + k] = sw.getComponent(i, k); }
    if (!selectedComponents.has(root(welded[i]))) continue;
    let amount = 1;
    if (classId === 'frostcaster') {
      point.fromArray(points, i * 3); let distance = Infinity;
      for (const segment of segments) { segment.closestPointToPoint(point, true, nearest); distance = Math.min(distance, point.distanceTo(nearest)); }
      // 整个真实腿脚片由拓扑保护；认证外袍内部不按 Foot 距离切权重，否则会产生新的裙角裂边。
      // 手臂/袖口仍保留 13cm 边界；下袍统一随腰身，靠近腰线再逐渐退出，避免袖口混入。
      const side = 1 - smooth(.38, .43, Math.abs(point.x - hips.x));
      const lower = smooth(hips.y - .06, hips.y - .12, point.y);
      amount = smooth(.13, .16, distance) * (1 - smooth(hips.y - .12, hips.y + .02, point.y)) * (side + (1 - side) * lower);
      if (amount <= 1e-6) continue;
    }
    componentMask[i] = 1; targetVertices++;
    if (classId !== 'skeleton') {
      // 精确连通片已确认是挂布；真实腿/膝在其他片，原 cloth 的 13cm 人体保护门槛不变。
      const torso = smooth(hips.y - .10, hips.y + .12, points[i * 3 + 1]) * .40;
      if (amount === 1) { indices.set([hipIndex, spineIndex, 0, 0], i * 4); weights.set([1 - torso, torso, 0, 0], i * 4); }
      else {
        const byBone = new Map();
        for (let k = 0; k < 4; k++) { const bone = indices[i * 4 + k]; byBone.set(bone, (byBone.get(bone) || 0) + weights[i * 4 + k] * (1 - amount)); }
        byBone.set(hipIndex, (byBone.get(hipIndex) || 0) + amount * (1 - torso)); byBone.set(spineIndex, (byBone.get(spineIndex) || 0) + amount * torso);
        const selected = [...byBone].sort((a, b) => b[1] - a[1]).slice(0, 4), total = selected.reduce((sum, [, weight]) => sum + weight, 0);
        for (let k = 0; k < 4; k++) { indices[i * 4 + k] = selected[k]?.[0] || 0; weights[i * 4 + k] = selected[k] ? selected[k][1] / total : 0; }
      }
      strength[i] = amount; changed++; continue;
    }
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
  if (!classes.has(classId)) return null;
  let changed = 0, targetVertices = 0;
  for (const mesh of body.meshes) {
    const source = mesh.geometry;
    let byClass = prepared.get(source);
    if (!byClass) { byClass = new Map(); prepared.set(source, byClass); }
    if (!byClass.has(classId)) byClass.set(classId, prepare(mesh, body, classId));
    const result = byClass.get(classId); if (!result) continue;
    mesh.geometry = result.geometry; mesh.userData.attachmentStrength = result.strength; mesh.userData.attachmentComponent = result.componentMask;
    changed += result.changed; targetVertices += result.targetVertices;
  }
  if (!changed) return null;
  body.attachment = {classId, changed, targetVertices};
  return body.attachment;
}
