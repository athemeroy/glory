// 仅审计页使用：原始bind连通片识别与FP索引对照，生产代码不引用。
import * as THREE from 'three';
export function skeletonHeadRegion(body) {
  const mesh = body.meshes[0], g = mesh.geometry;
  if (!g.index || g.attributes.position.count !== 27415) return null;
  body.model.updateMatrixWorld(true); mesh.skeleton.update();
  const point = new THREE.Vector3(), points = new Float32Array(27415 * 3), welded = new Uint32Array(27415), cells = new Map(), parents = [];
  for (let i = 0; i < welded.length; i++) {
    mesh.getVertexPosition(i, point).applyMatrix4(mesh.matrixWorld).toArray(points, i * 3);
    const key = [point.x, point.y, point.z].map(v => Math.round(v / .00005)).join(',');
    let id = cells.get(key); if (id === undefined) { id = parents.length; parents.push(id); cells.set(key, id); } welded[i] = id;
  }
  const root = i => { while (parents[i] !== i) { parents[i] = parents[parents[i]]; i = parents[i]; } return i; };
  for (let i = 0; i < g.index.count; i += 3) { const a = root(welded[g.index.getX(i)]), b = root(welded[g.index.getX(i + 1)]), c = root(welded[g.index.getX(i + 2)]); parents[b] = a; parents[c] = a; }
  const parts = new Map();
  for (let i = 0; i < welded.length; i++) {
    const id = root(welded[i]); let part = parts.get(id);
    if (!part) { part = { count: 0, min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] }; parts.set(id, part); }
    part.count++; for (let k = 0; k < 3; k++) { part.min[k] = Math.min(part.min[k], points[i * 3 + k]); part.max[k] = Math.max(part.max[k], points[i * 3 + k]); }
  }
  const targetMin = [-.1050490, 1.4018001, .1808219], targetMax = [.0981604, 1.7599998, .4391391];
  const certified = [...parts].filter(([, part]) => part.count === 4176 && part.min.every((v, k) => Math.abs(v - targetMin[k]) < .003) && part.max.every((v, k) => Math.abs(v - targetMax[k]) < .003));
  if (certified.length !== 1) return null;
  const id = certified[0][0], mask = new Uint8Array(welded.length);
  for (let i = 0; i < mask.length; i++) if (root(welded[i]) === id) mask[i] = 1;
  return { mask, component: certified[0][1], sourcePosition: g.attributes.position };
}

export function excludeTrialHeadFaces(fp, region) {
  if (!region) return null;
  const changed = [];
  fp.root.traverse(mesh => {
    if (!mesh.isSkinnedMesh || mesh.geometry.attributes.position !== region.sourcePosition) return;
    const geometry = mesh.geometry, before = Array.from(geometry.index.array), keep = [], removed = [];
    for (let at = 0; at < before.length; at += 3) {
      const tri = before.slice(at, at + 3);
      if (tri.every(i => region.mask[i])) removed.push(tri); else keep.push(...tri);
    }
    geometry.setIndex(keep); changed.push({ mesh, before, keep, removed });
  });
  return changed;
}
