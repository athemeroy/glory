// 已确认的牧师右肘关节偏移；仅修复实例，保持源 GLB 与绑定网格原样。
import * as THREE from 'three';

export function calibrateRig(body, classId) {
  if (classId !== 'cleric') return null;
  if (body.rigCalibration) return body.rigCalibration;
  const { model, bones, meshes } = body;
  const arm = bones.RightArm, elbow = bones.RightForeArm, hand = bones.RightHand;
  const leftArm = bones.LeftArm, leftElbow = bones.LeftForeArm, leftHand = bones.LeftHand;
  if (!arm || !elbow || !hand || !leftArm || !leftElbow || !leftHand || hand.parent !== elbow || elbow.parent !== arm) return null;
  model.updateMatrixWorld(true);
  const point = new THREE.Vector3(), inverse = model.matrixWorld.clone().invert();
  const localPoint = bone => bone.getWorldPosition(new THREE.Vector3()).applyMatrix4(inverse);
  const left = [localPoint(leftArm), localPoint(leftElbow), localPoint(leftHand)];
  const right = [localPoint(arm), localPoint(elbow), localPoint(hand)];
  const lengths = points => [points[0].distanceTo(points[1]), points[1].distanceTo(points[2])];
  const oldLeft = lengths(left), oldRight = lengths(right);
  // 已审计资源的右上臂仅为左侧80%，前臂却175%；正常或后来替换的骨架不进入校准。
  if (!(oldLeft[0] > 0 && oldLeft[1] > 0 && oldRight[0] / oldLeft[0] < 0.90 && oldRight[1] / oldLeft[1] > 1.50)) return null;
  const target = right[1].clone(); target.y = left[1].y; target.z = left[1].z;
  if (target.distanceTo(right[1]) < 0.08) return null;
  const skeletons = [...new Set(meshes.map(mesh => mesh.skeleton))];
  if (!skeletons.length || skeletons.some(skeleton => skeleton.boneInverses.length !== skeleton.bones.length)) return null;
  const oldElbowWorld = elbow.matrixWorld.clone(), oldHandWorld = hand.matrixWorld.clone();
  // SkeletonUtils.clone 的 inverse 数组仍与源共享；每个数组及 Matrix4 都先独立。
  for (const skeleton of skeletons) skeleton.boneInverses = skeleton.boneInverses.map(matrix => matrix.clone());
  target.applyMatrix4(model.matrixWorld);
  elbow.position.copy(arm.worldToLocal(target));
  arm.updateMatrixWorld(true);
  point.setFromMatrixPosition(oldHandWorld);
  hand.position.copy(elbow.worldToLocal(point));
  elbow.updateMatrixWorld(true);
  // 保留导出时的 bind palette Wold*Iold，而非假设它一定是单位矩阵。
  const correction = elbow.matrixWorld.clone().invert().multiply(oldElbowWorld);
  for (const skeleton of skeletons) {
    const index = skeleton.bones.indexOf(elbow);
    if (index >= 0) skeleton.boneInverses[index].premultiply(correction);
    skeleton.update();
  }
  let handWorldError = 0;
  for (let i = 0; i < 16; i++) handWorldError = Math.max(handWorldError, Math.abs(hand.matrixWorld.elements[i] - oldHandWorld.elements[i]));
  body.rigCalibration = {
    classId, joint: 'RightForeArm', oldLeftLengths: oldLeft, oldRightLengths: oldRight,
    rightLengths: lengths([localPoint(arm), localPoint(elbow), localPoint(hand)]),
    elbowShift: right[1].distanceTo(localPoint(elbow)), handWorldError,
  };
  return body.rigCalibration;
}
