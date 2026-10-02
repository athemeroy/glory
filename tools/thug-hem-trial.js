// 隔离候选：认证右后破衣角原index4点及14点硬法线重复闭包。
// 保留原来两段右腿骨的平均运动；跨boundary原面必须通过连续动作检查。
import * as THREE from 'three';

export function trialThugHem(original, body) {
  if (body.model.userData.gloryClass !== 'thug') return null;
  const raw = original.meshes[0], mesh = body.meshes[0], source = raw.geometry, current = mesh.geometry;
  const {position, skinIndex: si, skinWeight: sw} = source.attributes;
  if (!source.index || position.count !== 28816 || si?.count !== 28816 || sw?.count !== 28816) return null;
  const names = raw.skeleton.bones.map(bone => bone.name), up = names.indexOf('RightUpLeg'), leg = names.indexOf('RightLeg');
  if (up < 0 || leg < 0) return null;
  const parents = Uint32Array.from({length: si.count}, (_, i) => i);
  const root = i => { while (parents[i] !== i) { parents[i] = parents[parents[i]]; i = parents[i]; } return i; };
  for (let at = 0; at < source.index.count; at += 3) {
    const a = root(source.index.getX(at)), b = root(source.index.getX(at + 1)), c = root(source.index.getX(at + 2)); parents[b] = a; parents[c] = a;
  }
  const seed = root(10168), sheet = [];
  for (let i = 0; i < si.count; i++) if (root(i) === seed) sheet.push(i);
  if (sheet.length !== 4 || sheet.join(',') !== '10150,10168,10173,10178') return null;
  original.model.updateMatrixWorld(true); raw.skeleton.update();
  const point = new THREE.Vector3(), keys = new Set(), points = new Float32Array(si.count * 3);
  const key = p => [p.x, p.y, p.z].map(v => Math.round(v / .00005)).join(',');
  for (const i of sheet) { raw.getVertexPosition(i, point).applyMatrix4(raw.matrixWorld); keys.add(key(point)); }
  const roi = [], target = new Uint8Array(si.count), bounds = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  let upWeight = 0, legWeight = 0;
  for (let i = 0; i < si.count; i++) {
    raw.getVertexPosition(i, point).applyMatrix4(raw.matrixWorld).toArray(points, i * 3);
    if (!keys.has(key(point))) continue;
    roi.push(i); target[i] = 1;
    for (let k = 0; k < 3; k++) { bounds[k] = Math.min(bounds[k], points[i * 3 + k]); bounds[k + 3] = Math.max(bounds[k + 3], points[i * 3 + k]); }
    let total = 0;
    for (let k = 0; k < 4; k++) {
      const bone = si.getComponent(i, k), weight = sw.getComponent(i, k);
      if (bone === up) { upWeight += weight; total += weight; }
      else if (bone === leg) { legWeight += weight; total += weight; }
      else if (weight > 1e-6) return null;
    }
    if (Math.abs(total - 1) > 1e-6) return null;
  }
  const certifiedBounds = [-.31514671, .49596873, -.09127205, -.30481404, .50974555, -.08782782];
  if (roi.length !== 14 || !bounds.every((v, k) => Math.abs(v - certifiedBounds[k]) < .00005)) return null;
  const boundaryFaces = [];
  for (let at = 0; at < source.index.count; at += 3) {
    const tri = [source.index.getX(at), source.index.getX(at + 1), source.index.getX(at + 2)], count = tri.reduce((n, i) => n + target[i], 0);
    if (count > 0 && count < 3) boundaryFaces.push(tri);
  }
  if (boundaryFaces.length !== 12) return null;
  const sum = upWeight + legWeight, meanUp = upWeight / sum, meanLeg = legWeight / sum;
  const indices = new Uint16Array(si.count * 4), weights = new Float32Array(si.count * 4), ci = current.attributes.skinIndex, cw = current.attributes.skinWeight;
  for (let i = 0; i < si.count; i++) for (let k = 0; k < 4; k++) { indices[i * 4 + k] = ci.getComponent(i, k); weights[i * 4 + k] = cw.getComponent(i, k); }
  for (const i of roi) for (let k = 0; k < 4; k++) { indices[i * 4 + k] = k === 0 ? up : k === 1 ? leg : 0; weights[i * 4 + k] = k === 0 ? meanUp : k === 1 ? meanLeg : 0; }
  const geometry = new THREE.BufferGeometry(); for (const [name, attribute] of Object.entries(current.attributes)) geometry.setAttribute(name, attribute);
  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(indices, 4)); geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(weights, 4)); geometry.setIndex(current.index);
  geometry.groups = current.groups.map(group => ({...group})); geometry.morphAttributes = current.morphAttributes; geometry.morphTargetsRelative = current.morphTargetsRelative;
  geometry.boundingBox = current.boundingBox?.clone() || null; geometry.boundingSphere = current.boundingSphere?.clone() || null; mesh.geometry = geometry;
  return {roi, target, boundaryFaces, meanUp, meanLeg, bounds, rawSheet: sheet, changed: roi.length};
}
