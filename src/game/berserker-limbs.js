// 原绑定姿态认证的狂剑士护腿不参与衣摆重绑；只缓存只读掩码。
import * as THREE from 'three';

const prepared = new WeakMap();
const profiles = [
  { count: 571, side: 'Right', bounds: [-.3736989, .0895500, -.0223863, -.1326030, .5407437, .2083758] },
  { count: 563, side: 'Left', bounds: [.1326027, .0826612, -.0189433, .3840312, .5372993, .2083757] },
];

function prepare(mesh) {
  const geometry = mesh.geometry, {position, skinIndex, skinWeight} = geometry.attributes;
  if (position?.count !== 27036 || skinIndex?.count !== position.count || skinWeight?.count !== position.count || !geometry.index) return null;
  const names = mesh.skeleton.bones.map(bone => bone.name);
  const point = new THREE.Vector3(), welded = new Uint32Array(position.count), points = new Float32Array(position.count * 3), cells = new Map(), parent = [];
  const root = id => { while (parent[id] !== id) { parent[id] = parent[parent[id]]; id = parent[id]; } return id; };
  mesh.skeleton.update();
  for (let i = 0; i < position.count; i++) {
    mesh.getVertexPosition(i, point).applyMatrix4(mesh.matrixWorld).toArray(points, i * 3);
    const key = `${Math.round(point.x / .00005)},${Math.round(point.y / .00005)},${Math.round(point.z / .00005)}`;
    let id = cells.get(key);
    if (id === undefined) { id = parent.length; parent.push(id); cells.set(key, id); }
    welded[i] = id;
  }
  for (let i = 0; i < geometry.index.count; i += 3) {
    const a = root(welded[geometry.index.getX(i)]), b = root(welded[geometry.index.getX(i + 1)]), c = root(welded[geometry.index.getX(i + 2)]);
    parent[b] = a; parent[c] = a;
  }
  const components = new Map();
  for (let i = 0; i < position.count; i++) {
    const id = root(welded[i]);
    if (!components.has(id)) components.set(id, []);
    components.get(id).push(i);
  }
  const mask = new Uint8Array(position.count);
  let protectedLimbVertices = 0;
  for (const profile of profiles) {
    const certified = [...components.values()].filter(ids => {
      if (ids.length !== profile.count) return false;
      const bounds = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
      const limbs = new Set(['UpLeg', 'Leg', 'Foot', 'ToeBase'].map(part => profile.side + part));
      for (const i of ids) {
        for (let k = 0; k < 3; k++) { bounds[k] = Math.min(bounds[k], points[i * 3 + k]); bounds[k + 3] = Math.max(bounds[k + 3], points[i * 3 + k]); }
        let limbWeight = 0;
        for (let k = 0; k < 4; k++) if (limbs.has(names[skinIndex.getComponent(i, k)])) limbWeight += skinWeight.getComponent(i, k);
        if (limbWeight < .99999) return false;
      }
      return bounds.every((value, k) => Math.abs(value - profile.bounds[k]) < .0035);
    });
    // 网格/绑定变化时退出，不能以相似位置猜测真实腿和衣袍。
    if (certified.length !== 1) return null;
    for (const i of certified[0]) mask[i] = 1;
    protectedLimbVertices += certified[0].length;
  }
  return {mask, protectedLimbVertices};
}

export function protectBerserkerLimbs(body, classId) {
  if (classId !== 'berserker') return null;
  if (body.berserkerLimbs) return body.berserkerLimbs;
  let protectedLimbVertices = 0;
  for (const mesh of body.meshes) {
    const source = mesh.geometry;
    if (!prepared.has(source)) prepared.set(source, prepare(mesh));
    const result = prepared.get(source);
    if (!result) continue;
    mesh.userData.clothProtectedLimbMask = result.mask;
    protectedLimbVertices += result.protectedLimbVertices;
  }
  return body.berserkerLimbs = {classId, protectedLimbVertices};
}
