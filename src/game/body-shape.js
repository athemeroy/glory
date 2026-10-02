// 只在绑定姿态测量一次人体；帽子、披风、武器不会扩大受击体积。
// 尺寸是 model 根空间的米制值，Fighter.scale 由物理/战斗调用方乘一次。
import * as THREE from 'three';

const cache = new WeakMap();
const clothFields = ['clothStrength', 'attachmentStrength', 'robeStrength', 'skirtStrength'];
const percentile = (values, p, fallback) => {
  if (!values.length) return fallback;
  values.sort((a, b) => a - b);
  return values[Math.min(values.length - 1, Math.floor((values.length - 1) * p))];
};
const bounded = (value, low, high) => Math.max(low, Math.min(high, value));

export function measureBodyShape(body, template = body.model) {
  const classId = template.userData?.gloryClass || '';
  const prepared = cache.get(template);
  if (prepared?.has(classId)) return prepared.get(classId);
  const { model, bones, meshes } = body;
  model.updateMatrixWorld(true);
  const inverse = model.matrixWorld.clone().invert();
  const position = new THREE.Vector3(), world = new THREE.Vector3();
  const joint = name => bones[name]?.getWorldPosition(new THREE.Vector3()).applyMatrix4(inverse);
  const spine = ['Spine','Spine01','Spine02'].map(name=>({name,position:joint(name)})).filter(entry=>entry.position).sort((a,b)=>a.position.y-b.position.y);
  const hip = joint('Hips'), chest = spine.at(-1)?.position;
  const head = joint('Head'), neck = joint('neck') || joint('Neck') || chest;
  if (!hip || !chest || !head) return null;
  const nominal = bounded(head.y + .18, 1.1, 3);
  const proportion = nominal / 1.76;
  const armL = joint('LeftArm'), armR = joint('RightArm');
  const shoulderJoints = armL && armR ? armL.distanceTo(armR) : .30 * proportion;
  const torso = [], pelvis = [], limbs = [], arms = [], legs = [], headPoints = [], feet = [];
  const fullBounds = new THREE.Box3();
  const headBounds = new THREE.Box3();
  const limbSegments = [];
  for (const side of ['Left', 'Right']) for (const [a, b] of [['Arm', 'ForeArm'], ['ForeArm', 'Hand'], ['UpLeg', 'Leg'], ['Leg', 'Foot']]) {
    const start = joint(side + a), end = joint(side + b);
    if (start && end) limbSegments.push({ names: new Set([side + a, side + b]), line: new THREE.Line3(start, end), arm: /Arm/.test(a) });
  }
  let vertexCount = 0;
  const seen = new Set(), closest = new THREE.Vector3();
  for (const mesh of meshes) {
    const { position: vertices, skinIndex: si, skinWeight: sw } = mesh.geometry.attributes;
    if (!si || !sw || seen.has(vertices)) continue;
    seen.add(vertices); mesh.skeleton.update(); vertexCount += vertices.count;
    const names = mesh.skeleton.bones.map(bone => bone.name);
    for (let i = 0; i < vertices.count; i++) {
      mesh.getVertexPosition(i, world).applyMatrix4(mesh.matrixWorld);
      position.copy(world).applyMatrix4(inverse); fullBounds.expandByPoint(position);
      let best = '', maximum = -1;
      for (let k = 0; k < 4; k++) if (sw.getComponent(i, k) > maximum) {
        maximum = sw.getComponent(i, k); best = names[si.getComponent(i, k)] || '';
      }
      if (/Foot|ToeBase/.test(best)) feet.push(position.y);
      if (clothFields.some(field => (mesh.userData[field]?.[i] || 0) > .15)) continue;
      // 头盔/长发的外轮廓不应算头骨；限制在颈部以上的解剖包络内。
      if (/head|neck/i.test(best) && position.y >= neck.y - .015 * proportion && position.y <= head.y + .205 * proportion
          && Math.abs(position.x - head.x) <= .20 * proportion && Math.abs(position.z - head.z) <= .21 * proportion) {
        headBounds.expandByPoint(position); headPoints.push(position.clone());
      }
      if (/^(Hips|Spine|Spine01|Spine02)$/.test(best)) {
        const radial = Math.hypot(position.x - hip.x, position.z - hip.z);
        if (position.y > hip.y + .08 * proportion && position.y < chest.y + .05 * proportion) torso.push(radial);
        if (position.y > hip.y - .09 * proportion && position.y < hip.y + .075 * proportion) pelvis.push(radial);
      }
      if (maximum >= .65) for (const segment of limbSegments) if (segment.names.has(best)) {
        segment.line.closestPointToPoint(position, true, closest);
        const distance = position.distanceTo(closest);
        if (distance < .20 * proportion) { limbs.push(distance); (segment.arm ? arms : legs).push(distance); }
      }
    }
  }
  const floor = percentile(feet, .01, 0);
  const headCenter = headPoints.length > 30 ? headBounds.getCenter(new THREE.Vector3()) : head.clone().add(new THREE.Vector3(0, .075 * proportion, 0));
  const radii = headPoints.map(point => point.distanceTo(headCenter));
  const headRadius = bounded(percentile(radii, .75, .145 * proportion), .105 * proportion, .19 * proportion);
  const height = bounded(Math.max(head.y + .13 * proportion, headCenter.y + headRadius) - floor, 1.1, 3);
  const torsoRadius = bounded(percentile(torso, .75, .22 * proportion), .14 * proportion, .30 * proportion);
  const hipRadius = bounded(percentile(pelvis, .72, torsoRadius), .14 * proportion, .30 * proportion);
  const limbRadius = bounded(percentile(limbs, .70, .075 * proportion), .045 * proportion, .11 * proportion);
  const armRadius = bounded(percentile(arms, .65, .065 * proportion), .04 * proportion, .09 * proportion);
  const legRadius = bounded(percentile(legs, .65, .09 * proportion), .055 * proportion, .12 * proportion);
  const shoulderWidth = shoulderJoints + armRadius * 1.6;
  const reaches = ['Left', 'Right'].map(side => {
    const arm = joint(side + 'Arm'), fore = joint(side + 'ForeArm'), hand = joint(side + 'Hand');
    return arm && fore && hand ? arm.distanceTo(fore) + fore.distanceTo(hand) : .60 * proportion;
  });
  const headOffset = headCenter.clone().applyMatrix4(model.matrixWorld);
  bones.Head.worldToLocal(headOffset);
  const profile = {
    version: 1, height, radius: Math.max(torsoRadius, shoulderWidth / 2), chestBone:spine.at(-1)?.name, waistBone:spine[0]?.name, spineBones:Object.freeze(spine.map(entry=>entry.name)),
    headRadius, torsoRadius, hipRadius, limbRadius, armRadius, legRadius, shoulderWidth,
    eyeHeight: bounded(headCenter.y + headRadius * .25 - floor, height * .84, height * .97),
    downHeight: Math.max(torsoRadius, hipRadius) * 2,
    reach: Math.max(...reaches), headCenter: Object.freeze(headCenter.toArray()), headOffset: Object.freeze(headOffset.toArray()),
    measured: Object.freeze({ vertices: vertexCount, head: headPoints.length, torso: torso.length, hip: pelvis.length, limb: limbs.length,
      floor, fullBounds: Object.freeze([fullBounds.min.toArray(), fullBounds.max.toArray()]) }),
  };
  Object.freeze(profile);
  const byClass = prepared || new Map(); byClass.set(classId, profile); cache.set(template, byClass); return profile;
}
