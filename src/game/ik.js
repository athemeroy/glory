import * as THREE from 'three';

// 双关节 IK：仅旋转骨骼，保持原绑定骨长；不可达目标会收敛到手臂可达范围。
export class TwoBoneIK {
  constructor() {
    this.a = new THREE.Vector3(); this.b = new THREE.Vector3(); this.c = new THREE.Vector3();
    this.axis = new THREE.Vector3(); this.bend = new THREE.Vector3(); this.elbow = new THREE.Vector3();
    this.goal = new THREE.Vector3(); this.cur = new THREE.Vector3(); this.want = new THREE.Vector3();
    this.q = new THREE.Quaternion(); this.world = new THREE.Quaternion(); this.parent = new THREE.Quaternion();
  }
  align(bone, child, target) {
    bone.getWorldPosition(this.a); child.getWorldPosition(this.cur).sub(this.a).normalize();
    this.want.copy(target).sub(this.a).normalize();
    this.q.setFromUnitVectors(this.cur, this.want);
    bone.getWorldQuaternion(this.world).premultiply(this.q);
    bone.parent.getWorldQuaternion(this.parent).invert();
    bone.quaternion.copy(this.parent.multiply(this.world));
    bone.updateMatrixWorld(true);
  }
  solve(upper, lower, hand, target, pole = null) {
    upper.getWorldPosition(this.a); lower.getWorldPosition(this.b); hand.getWorldPosition(this.c);
    const l1 = this.a.distanceTo(this.b), l2 = this.b.distanceTo(this.c);
    if (l1 < 1e-6 || l2 < 1e-6) return Infinity;
    this.axis.copy(target).sub(this.a);
    const distance = this.axis.length();
    if (distance < 1e-6) this.axis.set(0, -1, 0); else this.axis.divideScalar(distance);
    const reach = THREE.MathUtils.clamp(distance, Math.abs(l1-l2)+1e-5, l1+l2-1e-5);
    this.bend.copy(pole || this.b).sub(this.a);
    this.bend.addScaledVector(this.axis, -this.bend.dot(this.axis));
    if (this.bend.lengthSq() < 1e-10) {
      this.bend.set(Math.abs(this.axis.x)<0.8 ? 1 : 0, Math.abs(this.axis.x)<0.8 ? 0 : 1, 0);
      this.bend.addScaledVector(this.axis, -this.bend.dot(this.axis));
    }
    this.bend.normalize();
    const along = (l1*l1-l2*l2+reach*reach)/(2*reach);
    const height = Math.sqrt(Math.max(0,l1*l1-along*along));
    this.elbow.copy(this.a).addScaledVector(this.axis,along).addScaledVector(this.bend,height);
    this.goal.copy(this.a).addScaledVector(this.axis,reach);
    this.align(upper,lower,this.elbow);
    this.align(lower,hand,this.goal);
    return hand.getWorldPosition(this.c).distanceTo(target);
  }
}
