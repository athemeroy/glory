// Private cache candidate: live Ground math remains identical to the frozen constructor.
import * as THREE from 'three';
import { clamp } from '../src/engine/util.js';
import { GroundReactionSupport, reactionGroundOffset } from '../src/game/ground-contact.js';

import { cachedFootIndices } from './ground-indices-trial.js';

export class CachedGroundFeet {
  constructor(body) {
    this.body = body; this.offset = 0; this.probes = [];
    this.v = new THREE.Vector3(); this.origin = new THREE.Vector3(); this.inverse = new THREE.Matrix4();
    body.model.updateMatrixWorld(true); this.inverse.copy(body.model.matrixWorld).invert();
    const hipHeight = body.bones.Hips.getWorldPosition(this.v).applyMatrix4(this.inverse).y;
    this.moveLimit = clamp(hipHeight * 0.35, 0.25, 0.30);
    const seen = new Set(), reactionCandidates = [];
    for (const mesh of body.meshes) {
      const { position, skinIndex, skinWeight } = mesh.geometry.attributes;
      if (!skinIndex || !skinWeight || seen.has(position)) continue;
      seen.add(position); mesh.skeleton.update();
      for (const side of ['Left', 'Right']) {
        const eligible = cachedFootIndices(mesh, side);
        if (!eligible) continue;
        const candidates = []; let floor = Infinity;
        for (const i of eligible) {
          mesh.getVertexPosition(i, this.v).applyMatrix4(mesh.matrixWorld).applyMatrix4(this.inverse);
          floor = Math.min(floor, this.v.y);
          candidates.push({ index: i, x: this.v.x, y: this.v.y, z: this.v.z });
        }
        reactionCandidates.push({ mesh, side, candidates });
        const sole = candidates.filter(p => p.y <= floor + 0.025);
        if (!sole.length) continue;
        const minX = Math.min(...sole.map(p => p.x)), maxX = Math.max(...sole.map(p => p.x));
        const minZ = Math.min(...sole.map(p => p.z)), maxZ = Math.max(...sole.map(p => p.z));
        const cells = new Map();
        for (const p of sole) {
          const x = Math.min(2, Math.floor(3 * (p.x - minX) / Math.max(1e-6, maxX - minX)));
          const z = Math.min(2, Math.floor(3 * (p.z - minZ) / Math.max(1e-6, maxZ - minZ)));
          const key = x + ':' + z;
          if (!cells.has(key) || p.y < cells.get(key).y) cells.set(key, p);
        }
        for (const p of cells.values()) this.probes.push({ mesh, index: p.index });
      }
    }
    this.meshes = [...new Set(this.probes.map(p => p.mesh))];
    this.reactionSupport = new GroundReactionSupport(body, reactionCandidates);
  }
  update(dt, st) {
    if (!this.probes.length) return;
    const active = st.onGround && !st.action && !st.react && !st.dash;
    const reactionType = st.react?.type;
    const groundReaction = st.onGround && (reactionType === 'down' || reactionType === 'getup') && this.reactionSupport?.probes.length;
    const moving = active && !st.guard && (st.speed || 0) > 0.6;
    const { body, v, inverse } = this;
    let target = 0;
    if (groundReaction) {
      target = this.reactionSupport.floor();
    } else if (active) {
      body.model.updateMatrixWorld(true); inverse.copy(body.model.matrixWorld).invert();
      for (const mesh of this.meshes) mesh.skeleton.update();
      let floor = Infinity;
      for (const { mesh, index } of this.probes) {
        mesh.getVertexPosition(index, v).applyMatrix4(mesh.matrixWorld).applyMatrix4(inverse);
        floor = Math.min(floor, v.y);
      }
      const limit = moving ? this.moveLimit : 0.15;
      target = clamp(-floor, -limit, limit);
    }
    // 跑步每秒约两轮步态；站姿的25ms平滑会落后脚底5cm以上。
    // 移动用13ms响应，兼顾脚底跟踪与髋部平滑，退出动作按原速度归零。
    if (groundReaction) this.offset = reactionGroundOffset(this.offset, target, dt);
    else this.offset += (target - this.offset) * (1 - Math.exp(-(moving ? 75 : 40) * Math.max(0, dt)));
    if (Math.abs(this.offset) < 1e-6) this.offset = 0;
    if (!this.offset) return;
    // 转为髋骨父节点的位移，不依赖导出骨架的厘米单位或根节点朝向。
    v.set(0, this.offset, 0).applyMatrix4(body.model.matrixWorld);
    this.origin.set(0, 0, 0).applyMatrix4(body.model.matrixWorld);
    body.bones.Hips.parent.worldToLocal(v).sub(body.bones.Hips.parent.worldToLocal(this.origin));
    body.bones.Hips.position.add(v);
    body.bones.Hips.updateMatrixWorld(true);
  }
}
