// 倒地/起身的单向脚部支撑：仅使用近脚/脚趾骨的蒙皮顶点，不把抬起的双脚压回地面。
import * as THREE from 'three';

const directions = [];
for (let x = -1; x <= 1; x++) for (let y = -1; y <= 1; y++) for (let z = -1; z <= 1; z++) {
  if (x || y || z) directions.push([x, y, z]);
}

export class GroundReactionSupport {
  constructor(body, footCandidates = null, retainFull = false) {
    this.body = body; this.probes = []; this.fullProbes = retainFull ? [] : null;
    this.v = new THREE.Vector3(); this.inverse = new THREE.Matrix4();
    body.model.updateMatrixWorld(true); this.inverse.copy(body.model.matrixWorld).invert();
    const feet = [];
    for (const mesh of body.meshes) {
      if (!mesh.geometry.attributes.skinIndex) continue;
      mesh.skeleton.update();
      for (const side of ['Left', 'Right']) {
        const foot = body.bones[side + 'Foot'], toe = body.bones[side + 'ToeBase'];
        if (!foot || !toe) continue;
        const start = foot.getWorldPosition(new THREE.Vector3()).applyMatrix4(this.inverse);
        const end = toe.getWorldPosition(new THREE.Vector3()).applyMatrix4(this.inverse);
        const axis = end.clone().sub(start), lengthSquared = axis.lengthSq();
        if (!lengthSquared) continue;
        const footIndex = mesh.skeleton.bones.indexOf(foot), toeIndex = mesh.skeleton.bones.indexOf(toe);
        if (footIndex < 0 || toeIndex < 0) continue;
        feet.push({ mesh, side, start, axis, lengthSquared, footIndex, toeIndex });
      }
    }
    const seen = new Map();
    for (const foot of feet) {
      const { mesh, side, start, axis, lengthSquared, footIndex, toeIndex } = foot;
      const key = mesh.geometry.attributes.position;
      let sides = seen.get(key);
      if (!sides) { sides = new Set(); seen.set(key, sides); }
      if (sides.has(side)) continue;
      sides.add(side);
      const { position, skinIndex, skinWeight } = mesh.geometry.attributes;
      let candidates = footCandidates?.find(entry => entry.mesh === mesh && entry.side === side)?.candidates;
      if (!candidates) {
        candidates = [];
        for (let i = 0; i < position.count; i++) {
          let weight = 0;
          for (let k = 0; k < 4; k++) {
            const index = skinIndex.getComponent(i, k);
            if (index === footIndex || index === toeIndex) weight += skinWeight.getComponent(i, k);
          }
          if (weight < 0.5) continue;
          mesh.getVertexPosition(i, this.v).applyMatrix4(mesh.matrixWorld).applyMatrix4(this.inverse);
          candidates.push({ index: i, x: this.v.x, y: this.v.y, z: this.v.z });
        }
      }
      const groups = new Map();
      for (const candidate of candidates) {
        const i = candidate.index;
        if (mesh.userData.clothStrength?.[i] > 0 || mesh.userData.attachmentComponent?.[i] || mesh.userData.sleeveComponent?.[i]) continue;
        const { x, y, z } = candidate;
        const t = THREE.MathUtils.clamp(((x - start.x) * axis.x + (y - start.y) * axis.y + (z - start.z) * axis.z) / lengthSquared, 0, 1);
        if (Math.hypot(x - start.x - axis.x * t, y - start.y - axis.y * t, z - start.z - axis.z * t) > 0.18) continue;
        let footWeight = 0, toeWeight = 0; const influences = [];
        for (let k = 0; k < 4; k++) {
          const index = skinIndex.getComponent(i, k), weight = skinWeight.getComponent(i, k);
          if (index === footIndex) footWeight += weight;
          if (index === toeIndex) toeWeight += weight;
          if (weight >= 0.1) influences.push(index);
        }
        if (footWeight + toeWeight < 0.5) continue;
        const groupKey = influences.sort((a, b) => a - b).join(',') + ':' + Math.round(footWeight * 4) + ':' + Math.round(toeWeight * 4);
        let extrema = groups.get(groupKey);
        if (!extrema) { extrema = new Array(directions.length).fill(null); groups.set(groupKey, extrema); }
        if (this.fullProbes) this.fullProbes.push({ mesh, index: i, side });
        for (let d = 0; d < directions.length; d++) {
          const direction = directions[d], projection = x * direction[0] + y * direction[1] + z * direction[2];
          if (!extrema[d] || projection < extrema[d].projection) extrema[d] = { index: i, projection };
        }
      }
      const selected = new Set();
      for (const extrema of groups.values()) for (const p of extrema) if (p) selected.add(p.index);
      for (const index of selected) this.probes.push({ mesh, index, side });
    }
    this.meshes = [...new Set(this.probes.map(p => p.mesh))];
  }

  floor(probes = this.probes) {
    const { body, v, inverse } = this;
    body.model.updateMatrixWorld(true); inverse.copy(body.model.matrixWorld).invert();
    for (const mesh of this.meshes) mesh.skeleton.update();
    let floor = Infinity; this.lowestProbe = null;
    for (const probe of probes) {
      const { mesh, index } = probe;
      mesh.getVertexPosition(index, v).applyMatrix4(mesh.matrixWorld).applyMatrix4(inverse);
      if (v.y < floor) { floor = v.y; this.lowestProbe = probe; }
    }
    return floor;
  }
}

export function reactionGroundOffset(offset, floor, dt) {
  // 上抬只抵消负穿透；支撑解除后慢慢释放，避免脚朝向变化让整个上身上下抖动。
  return Math.max(0, -floor - 0.005, offset * Math.exp(-8 * Math.max(0, dt)));
}
