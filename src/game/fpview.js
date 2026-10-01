// 第一人称专用手臂（视图模型）：只保留手臂与武器，跟随主相机，
// 骨骼旋转逐帧从世界身体复制，所以镜子里的动作和第一人称看到的出招时刻一致。
import * as THREE from 'three';
import { buildCharacter, disposeRig } from './model.js';
import { buildWeapon } from './weapons.js';
import { applySkinnedModel } from './skin.js';
import { createMocapBody, splitForFirstPerson, handSocket } from './mocap.js';
import { buildGripHand, handColor } from './grip.js';
import { TwoBoneIK } from './ik.js';

export const FP_LAYER = 2;

// 离镜头过近的片元直接丢弃（半条前臂贴脸时不露断口），带抖动过渡
function nearFade(mat, near = 0.42, band = 0.06) {
  const m = mat.clone();
  m.side = THREE.DoubleSide;
  m.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace('void main() {', `void main() {
      { float d = vViewPosition.z; float h = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
        if (d < ${near.toFixed(3)} + ${band.toFixed(3)} * h) discard; }`);
  };
  m.customProgramCacheKey = () => 'fpNearFade';
  return m;
}
const ARM_BONES = ['shL', 'elL', 'haL', 'shR', 'elR', 'haR', 'gripR', 'gripL'];

export class FPView {
  constructor(look, weaponType, weaponOpts = {}, glb = null, modelKey = '') {
    this.root = new THREE.Group();
    this.sourceGlb = glb;
    this.weaponType = weaponType;
    this.gripOrientation = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), weaponType === 'pistol' ? 0 : -Math.PI / 2);
    this.root.name = 'fpView';
    this.rig = buildCharacter(look);
    this.inner = new THREE.Group();
    this.root.add(this.inner);
    this.inner.add(this.rig.root);
    let skinned = false;
    let meshyArms = false;
    if (glb && !look.proc && glb.getObjectByName('RightForeArm')) {
      try { meshyArms = this.initMeshyArms(glb); } catch (e) { console.warn('第一人称手臂创建失败', e); meshyArms = false; }
    }
    if (meshyArms) { /* 已用绑骨模型的真实手臂 */ } else if (glb && !look.proc) {
      try { skinned = applySkinnedModel(this.rig, glb, { key: `${modelKey}|${look.sex}|${look.build || 1}` }); } catch { skinned = false; }
    }
    if (meshyArms) { /* */ } else if (skinned) {
      const sk = this.rig.skinned;
      if (sk.head) sk.head.visible = false;
      if (sk.body) sk.body.visible = false;
      // 精模的手是张开的：第一人称换回程序化握拳，颜色取自模型手套
      if (sk.hands) {
        sk.hands.visible = false;
        const handSet = new Set();
        for (const b of ['haL', 'haR']) this.rig.bones[b].traverse((o) => handSet.add(o));
        for (const p of this.rig.procParts || []) {
          if (!handSet.has(p)) continue;
          p.visible = true;
          if (sk.gloveColor && p.material) { p.material = p.material.clone(); p.material.color.copy(sk.gloveColor); }
        }
      }
    } else {
      const keep = new Set();
      for (const b of ['shL', 'shR']) this.rig.bones[b].traverse((o) => keep.add(o));
      for (const p of this.rig.parts) {
        if (!keep.has(p)) p.visible = false;
      }
    }
    this.weapon = buildWeapon(weaponType, weaponOpts);
    this.rig.bones.gripR.add(this.weapon.obj);
    if (this.weapon.makeLeft) {
      this.left = this.weapon.makeLeft();
      this.rig.bones.gripL.add(this.left);
    }
    if (this.mc) {
      this.mc.wR = this.weapon.obj.position.clone();
      this.mc.wL = this.left ? this.left.position.clone() : null;
    }
    this.root.traverse((o) => {
      o.layers.set(FP_LAYER);
      // 伞面在第一人称下半透明，避免挡住读招区域
      if (o.isMesh && o.material && o.material.userData && o.material.userData.canopy) { o.material = o.material.clone(); o.material.transparent = true; o.material.opacity = 0.42; o.material.depthWrite = false; }
      if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; o.frustumCulled = false; }
    });
    // 胸口在相机空间的位置（相机看向 -Z）
    this.offset = this.mc ? new THREE.Vector3(0.02, -0.27, -0.24) : new THREE.Vector3(0, -0.35, -0.2);
    // 双枪：模型的手和前臂较粗，沿视线会挡住枪身——手臂放低、枪放大
    if (this.mc && weaponType === 'pistol') {
      this.offset.y = -0.43; this.offset.z = -0.3;
      this.weapon.obj.scale.multiplyScalar(1.35);
      if (this.left) this.left.scale.multiplyScalar(1.35);
    }
    this.sway = new THREE.Vector2();
    this.kick = 0;
    this.bobT = 0;
  }

  // 从世界身体复制手臂姿态；twist 取胸部扭转以保留挥砍的腰部发力
  sync(worldRig, dt, moveSpeed = 0, mouseDX = 0, mouseDY = 0, enabledBob = true) {
    const src = worldRig.bones, dst = this.rig.bones;
    for (const b of ARM_BONES) dst[b].rotation.copy(src[b].rotation);
    // 双枪保持两侧握持，避免精模较长的前臂把两把枪挤到准星上。
    if (this.weaponType === 'pistol') {
      dst.shR.rotation.y -= 14 * Math.PI / 180;
      dst.shL.rotation.y += 14 * Math.PI / 180;
    }
    dst.chest.rotation.set(0, src.chest.rotation.y * 0.5, src.chest.rotation.z * 0.4);
    dst.spine.rotation.set(0, src.spine.rotation.y * 0.5, 0);
    dst.hips.rotation.set(0, 0, 0);
    // 旋转整体（身体 spin 技能）只取一部分，避免第一人称看不到武器
    const spinY = src.body.rotation.y;
    // 惯性摆动
    this.sway.x += (-mouseDX * 0.0006 - this.sway.x) * Math.min(1, dt * 10);
    this.sway.y += (mouseDY * 0.0006 - this.sway.y) * Math.min(1, dt * 10);
    this.bobT += dt * (enabledBob ? moveSpeed * 1.6 : 0);
    const bob = enabledBob ? Math.min(1, moveSpeed / 6) : 0;
    this.kick *= Math.exp(-dt * 12);
    // 胸骨原位在角色空间 y≈1.27；让胸口对准 offset
    this.rig.root.position.set(0, -1.27, 0);
    this.inner.position.set(
      this.offset.x + this.sway.x + Math.sin(this.bobT) * 0.012 * bob,
      this.offset.y + this.sway.y - Math.abs(Math.cos(this.bobT)) * 0.012 * bob,
      this.offset.z + this.kick,
    );
    this.inner.rotation.set(0, Math.PI + Math.sin(spinY) * 0.25, 0);
    this.inner.scale.setScalar(0.9);
    if (this.mc) this.retarget();
  }

  // 用 Meshy 绑骨模型的手臂：程序化骨骼只作姿态来源（隐藏），逐帧按骨段方向重定向到模型骨骼
  initMeshyArms(glb) {
    const body = createMocapBody(glb);
    const palms = { Right: handSocket(body, 'Right'), Left: handSocket(body, 'Left') };
    const colors = { Right: handColor(body, 'Right'), Left: handColor(body, 'Left') };
    const split = splitForFirstPerson(body);
    for (const m of [...split.head, ...split.body]) m.removeFromParent();
    if (!split.arms.length) return false;
    // 贴近镜头的上臂由 nearFade 抖动淡出，比直接裁掉上臂（露出袖口断面）自然
    // 锁骨/肩甲（Shoulder 主导）永远在镜头旁边，直接去掉
    for (const m of split.arms) {
      const g = m.geometry, si = g.attributes.skinIndex, sw = g.attributes.skinWeight;
      const names = m.skeleton.bones.map((b) => b.name);
      const region = (vi) => {
        let best = 0, bw = -1; for (let k = 0; k < 4; k++) { const w = sw.getComponent(vi, k); if (w > bw) { bw = w; best = si.getComponent(vi, k); } }
        const name = names[best] || '';
        return /Shoulder/.test(name) ? 'shoulder' : /Hand/.test(name) ? 'hand' : 'arm';
      };
      const idx = g.index.array, keep = [];
      for (let t = 0; t < idx.length; t += 3) {
        const regions = [region(idx[t]), region(idx[t + 1]), region(idx[t + 2])];
        if (regions.every(r => r === 'shoulder') || regions.filter(r => r === 'hand').length >= 2) continue;
        keep.push(idx[t], idx[t + 1], idx[t + 2]);
      }
      g.setIndex(keep);
      m.material = nearFade(m.material);
    }
    for (const p of this.rig.parts) p.visible = false;
    for (const p of this.rig.procParts || []) p.visible = false;
    this.rig.root.add(body.model);
    this.rig.root.updateMatrixWorld(true);
    const B = body.bones;
    const need = ['Spine02', 'LeftArm', 'LeftForeArm', 'LeftHand', 'RightArm', 'RightForeArm', 'RightHand'];
    if (need.some((n) => !B[n])) { body.model.removeFromParent(); return false; }
    const rest = new Map(need.map((n) => [n, B[n].quaternion.clone()]));
    this.mc = {
      B, rest, palms,
      handFrames: Object.fromEntries([['Right', 'haR'], ['Left', 'haL']].map(([side, name]) => [side,
        this.rig.bones[name].getWorldQuaternion(new THREE.Quaternion()).invert()
          .multiply(B[side + 'Hand'].getWorldQuaternion(new THREE.Quaternion())),
      ])),
      chestRest: this.rig.bones.chest.getWorldQuaternion(new THREE.Quaternion()),
      spineRest: B.Spine02.getWorldQuaternion(new THREE.Quaternion()),
      v1: new THREE.Vector3(), v2: new THREE.Vector3(), v3: new THREE.Vector3(), v4: new THREE.Vector3(),
      q1: new THREE.Quaternion(), q2: new THREE.Quaternion(), q3: new THREE.Quaternion(),
      supportIK: new TwoBoneIK(), supportGoal: new THREE.Vector3(), supportUpper: new THREE.Quaternion(), supportLower: new THREE.Quaternion(),
    };
    this.gripHands = [];
    for (const side of ['Right', 'Left']) {
      const hand = B[side + 'Hand'], grip = buildGripHand(side, colors[side]);
      const scale = 1 / hand.getWorldScale(new THREE.Vector3()).x;
      grip.root.quaternion.copy(this.mc.handFrames[side]).invert();
      grip.root.scale.setScalar(scale);
      grip.root.position.copy(palms[side]).sub(grip.grip.clone().applyQuaternion(grip.root.quaternion).multiplyScalar(scale));
      hand.add(grip.root);
      const faded = new Map();
      grip.root.traverse(object => {
        if (!object.isMesh) return;
        const materials = [].concat(object.material).map(material => {
          if (!faded.has(material)) faded.set(material, nearFade(material));
          return faded.get(material);
        });
        object.material = Array.isArray(object.material) ? materials : materials[0];
      });
      this.gripHands.push(grip);
    }
    return true;
  }

  retarget() {
    const mc = this.mc, B = mc.B, P = this.rig.bones;
    const { v1, v2, v3, v4, q1, q2 } = mc;
    for (const [n, q] of mc.rest) B[n].quaternion.copy(q);
    this.root.updateMatrixWorld(true);
    // 胸口扭转：按世界空间增量复制
    P.chest.getWorldQuaternion(q1).multiply(q2.copy(mc.chestRest).invert());
    q1.multiply(mc.spineRest);
    B.Spine02.parent.getWorldQuaternion(q2).invert();
    B.Spine02.quaternion.copy(q2.multiply(q1));
    B.Spine02.updateMatrixWorld(true);
    // 让 bone→child 的朝向对齐目标方向（最小旋转）
    const swing = (bone, cur, target) => {
      cur.normalize(); target.normalize();
      q1.setFromUnitVectors(cur, target);
      bone.getWorldQuaternion(q2).premultiply(q1);
      const qp = bone.parent.getWorldQuaternion(mc.q3).invert();
      bone.quaternion.copy(qp.multiply(q2));
      bone.updateMatrixWorld(true);
    };
    const wp = (o, v) => o.getWorldPosition(v);
    let handIndex = 0;
    for (const [s, sh, el, ha, grip, w, base] of [
      ['Right', P.shR, P.elR, P.haR, P.gripR, this.weapon.obj, mc.wR],
      ['Left', P.shL, P.elL, P.haL, P.gripL, this.left, mc.wL],
    ]) {
      const arm = B[s + 'Arm'], fore = B[s + 'ForeArm'], hand = B[s + 'Hand'];
      swing(arm, wp(fore, v1).sub(wp(arm, v2)), wp(el, v3).sub(wp(sh, v4)));
      swing(fore, wp(hand, v1).sub(wp(fore, v2)), wp(ha, v3).sub(wp(el, v4)));
      // 手掌不仅要朝向握把，还要保留绕前臂的扭转（旋前/旋后）。
      ha.getWorldQuaternion(q1).multiply(mc.handFrames[s]);
      hand.parent.getWorldQuaternion(q2).invert();
      hand.quaternion.copy(q2.multiply(q1));
      hand.updateMatrixWorld(true);
      let supported = false;
      if (s === 'Left' && !this.left && this.weapon.offhandGrip) {
        mc.supportGoal.copy(this.weapon.offhandGrip); this.weapon.obj.localToWorld(mc.supportGoal);
        const offset = hand.localToWorld(v1.copy(mc.palms[s])).sub(hand.getWorldPosition(v2));
        mc.supportGoal.sub(offset);
        mc.supportUpper.copy(arm.quaternion); mc.supportLower.copy(fore.quaternion);
        const error = mc.supportIK.solve(arm, fore, hand, mc.supportGoal);
        supported = error < 0.02;
        if (!supported) { arm.quaternion.copy(mc.supportUpper); fore.quaternion.copy(mc.supportLower); arm.updateMatrixWorld(true); }
        hand.parent.getWorldQuaternion(q2).invert();
        hand.quaternion.copy(q2.multiply(q1)); hand.updateMatrixWorld(true);
      }
      // 武器：朝向沿用程序化握把，位置移到模型手心
      if (w && base) {
        w.position.copy(base);
        const palm = hand.localToWorld(v1.copy(mc.palms[s]));
        const cur = grip.localToWorld(v2.copy(base));
        const target = cur.add(palm.sub(wp(grip, v4)));
        w.position.copy(grip.worldToLocal(target));
        if (this.weaponType === 'pistol') {
          // 只消除水平发散，保留程序化开火动作的仰角与后坐力。
          w.getWorldQuaternion(q1);
          v1.set(0, 1, 0).applyQuaternion(q1);
          this.root.getWorldQuaternion(q2);
          v2.set(0, 0, -1).applyQuaternion(q2);
          const up = v3.set(0, 1, 0).applyQuaternion(q2);
          v4.copy(v1).addScaledVector(up, -v1.dot(up)).normalize();
          v2.addScaledVector(up, -v2.dot(up)).normalize();
          q2.setFromUnitVectors(v4, v2);
          q1.premultiply(q2);
          grip.getWorldQuaternion(q2).invert();
          w.quaternion.copy(q2.multiply(q1));
        }
      }
      // 握持手的指列对齐实际握柄轴，而不只跟随前臂朝向。
      const fitted = this.gripHands[handIndex++];
      (w || (supported ? this.weapon.obj : grip)).getWorldQuaternion(q1).multiply(this.gripOrientation);
      hand.getWorldQuaternion(q2).invert();
      fitted.root.quaternion.copy(q2.multiply(q1));
      fitted.root.position.copy(mc.palms[s]).sub(v1.copy(fitted.grip).applyQuaternion(fitted.root.quaternion).multiplyScalar(fitted.root.scale.x));
      fitted.root.updateMatrixWorld(true);
      fitted.connectWrist(fitted.root.worldToLocal(hand.getWorldPosition(v1)));
    }
  }

  setForm(form) { if (this.weapon.setForm) this.weapon.setForm(form); }
  update(dt) { if (this.weapon.update) this.weapon.update(dt); }
  dispose() {
    disposeRig(this.rig, { sharedRoots: [this.sourceGlb, ...(this.gripHands || []).map(hand => hand.root)] });
    for (const hand of this.gripHands || []) hand.dispose();
    this.gripHands = [];
    this.root.removeFromParent();
  }
}

// 第一人称时隐藏世界身体的手臂与武器（避免重复），镜子里仍可见
export function hideWorldArmsForFP(rig, weaponObj, leftObj, hidden) {
  const layer = hidden ? 1 : 0;
  for (const b of ['shL', 'shR']) rig.bones[b].traverse((o) => { if (o.isMesh) o.layers.set(layer); });
  for (const m of rig.armParts || []) m.layers.set(layer);
  if (weaponObj) weaponObj.traverse((o) => { if (o.isMesh) o.layers.set(layer); });
  if (leftObj) leftObj.traverse((o) => { if (o.isMesh) o.layers.set(layer); });
}
