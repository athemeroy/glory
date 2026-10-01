// 可弯曲的近景握持手。旧精模只有 Hand 骨，不能把张开的手指收成握持姿势。
import * as THREE from 'three';
import { TwoBoneIK } from './ik.js';

const sphere = new THREE.SphereGeometry(1, 12, 8);
const segment = new THREE.CapsuleGeometry(1, 1, 4, 8);
sphere.userData.shared = true;
segment.userData.shared = true;
const DOWN = new THREE.Vector3(0, -1, 0);
const handSamples = new WeakMap();

function surface(geometry, material, parent, position, scale) {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(...position); mesh.scale.set(...scale);
  mesh.frustumCulled = false;
  parent.add(mesh);
  return mesh;
}

// 使用手部区域的贴图取色，保留角色肤色/手套颜色；不复制大贴图。
export function handColor(body, side, fallback = '#665247') {
  const hand = body.bones[side + 'Hand'];
  const color = new THREE.Color(fallback);
  if (!hand) return color;
  for (const mesh of body.meshes) {
    const bone = mesh.skeleton.bones.indexOf(hand);
    const { skinIndex: si, skinWeight: sw, uv } = mesh.geometry.attributes;
    const material = [].concat(mesh.material)[0], image = material.map?.image;
    if (bone < 0 || !si || !sw || !uv || !image) continue;
    // 同一只读贴图/权重跨世界实例和第一人称复用采样，换装颜色仍逐实例应用。
    let byWeights = handSamples.get(material.map);
    if (!byWeights) { byWeights = new WeakMap(); handSamples.set(material.map, byWeights); }
    let samplesByBone = byWeights.get(sw);
    if (!samplesByBone) { samplesByBone = new Map(); byWeights.set(sw, samplesByBone); }
    const key = `${bone}:${material.map.flipY}:${material.map.version}:${uv.version}`;
    if (samplesByBone.has(key)) return color.copy(samplesByBone.get(key)).multiply(material.color);
    try {
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 64;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      context.drawImage(image, 0, 0, 64, 64);
      const pixels = context.getImageData(0, 0, 64, 64).data;
      const samples = [[], [], []];
      for (let i = 0; i < si.count; i += 3) {
        let weight = 0;
        for (let k = 0; k < 4; k++) if (si.getComponent(i, k) === bone) weight += sw.getComponent(i, k);
        if (weight < 0.8) continue;
        const x = Math.min(63, Math.max(0, Math.floor(uv.getX(i) * 64)));
        const y = Math.min(63, Math.max(0, Math.floor((material.map.flipY ? 1 - uv.getY(i) : uv.getY(i)) * 64)));
        const p = (y * 64 + x) * 4;
        for (let c = 0; c < 3; c++) samples[c].push(pixels[p + c]);
      }
      if (samples[0].length) {
        const rgb = samples.map(values => { values.sort((a,b)=>a-b); return values[Math.floor(values.length / 2)] / 255; });
        color.setRGB(...rgb, THREE.SRGBColorSpace);
        samplesByBone.set(key, color.clone());
        return color.multiply(material.color);
      }
    } catch { /* 保留外观指定的颜色 */ }
  }
  return color;
}

export function buildGripHand(side, color) {
  const sign = side === 'Right' ? 1 : -1;
  const root = new THREE.Group(); root.name = side + 'GripHand';
  const material = new THREE.MeshStandardMaterial({ color, roughness: 0.72 });
  const crease = material.clone(); crease.color.multiplyScalar(0.96);
  // 手腕向袖口延伸，覆盖新旧网格的连接；拳心的握柄轴为 +Z。
  const wrist = surface(sphere, material, root, [0, -0.011, 0], [0.027, 0.031, 0.028]);
  surface(sphere, material, root, [-sign * 0.009, -0.051, 0], [0.029, 0.039, 0.04]);
  const joints = [];
  const digit = (name, points, radius) => {
    let parent = root;
    const previousWorld = new THREE.Quaternion();
    for (let i = 0; i < points.length - 1; i++) {
      const start = new THREE.Vector3(...points[i]), end = new THREE.Vector3(...points[i + 1]);
      start.x *= sign; end.x *= sign;
      const direction = end.clone().sub(start), length = direction.length();
      const orientation = new THREE.Quaternion().setFromUnitVectors(DOWN, direction.normalize());
      const bone = new THREE.Bone(); bone.name = side + name + (i + 1);
      if (i === 0) bone.position.copy(start);
      else bone.position.set(0, -new THREE.Vector3(...points[i]).distanceTo(new THREE.Vector3(...points[i - 1])), 0);
      const closed = previousWorld.clone().invert().multiply(orientation);
      bone.quaternion.copy(closed); parent.add(bone);
      surface(segment, material, bone, [0, -length / 2, 0], [radius, length / 3, radius]);
      surface(sphere, i === 0 ? material : crease, bone, [0, 0, 0], [radius * 0.96, radius * 0.75, radius * 0.98]);
      joints.push({ bone, closed, open: new THREE.Quaternion() });
      previousWorld.copy(orientation); parent = bone;
    }
  };
  for (let i = 0; i < 4; i++) {
    const z = 0.03 - i * 0.02, size = i === 3 ? 0.008 : 0.009;
    digit(['Index', 'Middle', 'Ring', 'Pinky'][i], [[0.027,-0.045,z], [0.038,-0.068,z], [0.019,-0.094,z], [-0.002,-0.098,z]], size);
  }
  digit('Thumb', [[-0.027,-0.032,0.034], [-0.041,-0.061,0.044], [-0.015,-0.085,0.04]], 0.011);
  // 把掌部和指节合成一个蒙皮网格，避免每只手几十个 draw call。
  // 腕部保持独立，实时连接原精模的袖口切面。
  const rigid = new THREE.Bone(); rigid.name = side + 'Palm'; root.add(rigid);
  const bones = [rigid, ...joints.map(joint => joint.bone)];
  root.updateMatrixWorld(true);
  const pieces = [];
  root.traverse(object => { if (object.isMesh && object !== wrist) pieces.push(object); });
  const vertexCount = pieces.reduce((n,mesh)=>n+mesh.geometry.attributes.position.count,0);
  const positions = new Float32Array(vertexCount*3), normals = new Float32Array(vertexCount*3);
  const indices = new Uint16Array(vertexCount*4), weights = new Float32Array(vertexCount*4);
  const triangles = [[],[]], point = new THREE.Vector3(), normal = new THREE.Vector3(), normalMatrix = new THREE.Matrix3();
  let offset=0;
  for (const mesh of pieces) {
    const geometry=mesh.geometry, position=geometry.attributes.position, sourceNormal=geometry.attributes.normal;
    normalMatrix.getNormalMatrix(mesh.matrixWorld);
    const boneIndex=Math.max(0,bones.indexOf(mesh.parent));
    for (let i=0;i<position.count;i++) {
      point.fromBufferAttribute(position,i).applyMatrix4(mesh.matrixWorld).toArray(positions,(offset+i)*3);
      normal.fromBufferAttribute(sourceNormal,i).applyNormalMatrix(normalMatrix).toArray(normals,(offset+i)*3);
      indices[(offset+i)*4]=boneIndex; weights[(offset+i)*4]=1;
    }
    const list=triangles[mesh.material===crease?1:0];
    if (geometry.index) for (const index of geometry.index.array) list.push(offset+index);
    else for (let i=0;i<position.count;i++) list.push(offset+i);
    offset+=position.count;
    mesh.removeFromParent();
  }
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.BufferAttribute(positions,3));
  geometry.setAttribute('normal',new THREE.BufferAttribute(normals,3));
  geometry.setAttribute('skinIndex',new THREE.BufferAttribute(indices,4));
  geometry.setAttribute('skinWeight',new THREE.BufferAttribute(weights,4));
  geometry.setIndex([...triangles[0],...triangles[1]]);
  geometry.addGroup(0,triangles[0].length,0); geometry.addGroup(triangles[0].length,triangles[1].length,1);
  const mesh=new THREE.SkinnedMesh(geometry,[material,crease]); mesh.name=side+'GripSkin';
  mesh.frustumCulled=false; root.add(mesh); mesh.bind(new THREE.Skeleton(bones));
  root.userData.grip = true;
  const wristEnd = new THREE.Vector3(0, -0.036, 0);
  const wristDirection = new THREE.Vector3(), wristUp = new THREE.Vector3(0, 1, 0);
  return {
    root, joints, mesh, wrist, grip: new THREE.Vector3(0, -0.075, 0),
    setGrip(amount) {
      const t = THREE.MathUtils.clamp(amount, 0, 1);
      for (const {bone, open, closed} of joints) bone.quaternion.slerpQuaternions(open, closed, t);
    },
    connectWrist(position) {
      wristDirection.copy(wristEnd).sub(position);
      wrist.position.copy(position).add(wristEnd).multiplyScalar(0.5);
      wrist.scale.set(0.027, wristDirection.length() / 2 + 0.016, 0.028);
      if (wristDirection.lengthSq() > 1e-8) wrist.quaternion.setFromUnitVectors(wristUp, wristDirection.normalize());
    },
    dispose() {
      const materials = new Set([material, crease]);
      root.traverse(object => { if (object.isMesh) for (const m of [].concat(object.material)) materials.add(m); });
      for (const m of materials) m.dispose();
      mesh.geometry.dispose(); mesh.skeleton.dispose();
      root.removeFromParent();
    },
  };
}

// 世界模型沿用原有24骨动画；新增握持手自己带指节骨，不改预加载网格。
export function installGripHands(body, sockets, weaponType, characterScale = 1) {
  const colors = { Right: handColor(body,'Right'), Left: handColor(body,'Left') };
  for (const mesh of body.meshes) {
    const { skinIndex: si, skinWeight: sw } = mesh.geometry.attributes;
    if (!si || !sw) continue;
    const handVertex = (vertex) => {
      let best=0, weight=-1;
      for(let k=0;k<4;k++) if(sw.getComponent(vertex,k)>weight) {weight=sw.getComponent(vertex,k);best=si.getComponent(vertex,k);}
      return /Hand/.test(mesh.skeleton.bones[best]?.name || '');
    };
    const source=mesh.geometry, index=source.index, keep=[];
    const count=index?.count || source.attributes.position.count;
    for(let t=0;t<count;t+=3) {
      const a=index?index.getX(t):t, b=index?index.getX(t+1):t+1, c=index?index.getX(t+2):t+2;
      if(Number(handVertex(a))+Number(handVertex(b))+Number(handVertex(c))<2) keep.push(a,b,c);
    }
    if(keep.length===count) continue;
    const geometry=new THREE.BufferGeometry();
    for(const [name,attribute] of Object.entries(source.attributes)) geometry.setAttribute(name,attribute);
    geometry.morphAttributes=source.morphAttributes;geometry.morphTargetsRelative=source.morphTargetsRelative;
    geometry.setIndex(keep); mesh.geometry=geometry;
  }
  const hands=[];
  for(const side of ['Right','Left']) {
    const bone=body.bones[side+'Hand']; if(!bone || !sockets[side]) continue;
    const grip=buildGripHand(side,colors[side]);
    const units=bone.getWorldScale(new THREE.Vector3()).x / Math.max(1e-6,characterScale);
    grip.root.scale.setScalar(1 / Math.max(1e-6,units));
    bone.add(grip.root);
    grip.side=side; grip.socket=sockets[side].clone();
    grip.orientation=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1,0,0),weaponType==='pistol'?0:-Math.PI/2);
    if(side==='Left' && body.bones.LeftArm && body.bones.LeftForeArm) grip.support = {
      solver:new TwoBoneIK(), goal:new THREE.Vector3(), offset:new THREE.Vector3(),
      upper:new THREE.Quaternion(), lower:new THREE.Quaternion(), handWorld:new THREE.Quaternion(),
    };
    hands.push(grip);
  }
  return hands;
}

const gripOffset=new THREE.Vector3(), gripWrist=new THREE.Vector3(), gripFrame=new THREE.Quaternion();
export function fitWorldGripHands(body, hands, weapon=null, leftWeapon=null) {
  for(const hand of hands) {
    const bone=body.bones[hand.side+'Hand'];
    let supported=false;
    if(hand.support && weapon?.offhandGrip && !leftWeapon) {
      const support=hand.support, arm=body.bones.LeftArm, fore=body.bones.LeftForeArm;
      support.goal.copy(weapon.offhandGrip); weapon.obj.localToWorld(support.goal);
      support.offset.copy(hand.socket); bone.localToWorld(support.offset).sub(bone.getWorldPosition(gripWrist));
      support.goal.sub(support.offset);
      bone.getWorldQuaternion(support.handWorld);
      support.upper.copy(arm.quaternion); support.lower.copy(fore.quaternion);
      supported=support.solver.solve(arm,fore,bone,support.goal)<0.02;
      if(!supported) {arm.quaternion.copy(support.upper);fore.quaternion.copy(support.lower);arm.updateMatrixWorld(true);}
      fore.getWorldQuaternion(bone.quaternion).invert().multiply(support.handWorld); bone.updateMatrixWorld(true);
    }
    const mount=bone.children.find(child=>child.name===hand.side+'WeaponSocket');
    if(supported) {
      weapon.obj.getWorldQuaternion(gripFrame).multiply(hand.orientation);
      bone.getWorldQuaternion(hand.root.quaternion).invert().multiply(gripFrame);
    } else if(mount) hand.root.quaternion.copy(mount.quaternion).multiply(hand.orientation);
    else hand.root.quaternion.setFromUnitVectors(DOWN,gripOffset.copy(hand.socket).normalize());
    hand.root.position.copy(hand.socket).sub(gripOffset.copy(hand.grip).applyQuaternion(hand.root.quaternion).multiplyScalar(hand.root.scale.x));
    hand.root.updateMatrixWorld(true);
    hand.connectWrist(hand.root.worldToLocal(bone.getWorldPosition(gripWrist)));
  }
}
