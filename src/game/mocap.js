// 动捕动画：Meshy 绑定的角色（标准 24 骨）+ 共享动作库 anims.glb。
// 世界身体（第三人称/镜子/对手）用动捕片段混合；第一人称手臂仍用程序化动作（可读性更好）。
import * as THREE from 'three';
import { GLTFLoader } from '../../vendor/GLTFLoader.js';
import * as SkeletonUtils from '../../vendor/SkeletonUtils.js';
import { clamp } from '../engine/util.js';
import { repairClothWeights } from './cloth.js';
import { repairAttachmentWeights } from './attachment.js';
import { calibrateRig } from './rig-calibration.js';
import { GroundReactionSupport, reactionGroundOffset } from './ground-contact.js';
import { repairClericWeights } from './cleric-weights.js';
import { repairSleeveWeights } from './sleeve.js';
import { repairRobeWeights } from './robe.js';
import { repairSkirtWeights } from './skirt.js';
import { protectBerserkerLimbs } from './berserker-limbs.js';

const loader = new GLTFLoader();
let clipLib = null;      // name -> AnimationClip（已去掉水平根位移）
let clipLibPromise = null;
const hipsY = new Map();   // 片段名 -> {times, ys}
const sourceRest = new Map();
const bodyClipCaches = new WeakMap();
const pitchAxis = new THREE.Vector3(1, 0, 0);
let refHipY = 1;           // 购买动作所用模型的站立髋高（片段单位）
function sampleHip(name, t) {
  const h = hipsY.get(name); if (!h) return refHipY;
  const T = h.times; if (t <= T[0]) return h.ys[0];
  for (let k = 1; k < T.length; k++) if (T[k] >= t) { const u = (t - T[k - 1]) / (T[k] - T[k - 1]); return h.ys[k - 1] + (h.ys[k] - h.ys[k - 1]) * u; }
  return h.ys[h.ys.length - 1];
}

export function loadClipLibrary(url = 'assets/anim/anims.glb') {
  if (clipLibPromise) return clipLibPromise;
  clipLibPromise = loader.loadAsync(url).then((g) => {
    g.scene.updateMatrixWorld(true);
    g.scene.traverse((o) => {
      if (o.name && o.parent) sourceRest.set(o.name, {
        world: o.getWorldQuaternion(new THREE.Quaternion()),
        parent: o.parent.getWorldQuaternion(new THREE.Quaternion()),
      });
    });
    clipLib = new Map();
    for (const c of g.animations) {
      // 髋骨位移从片段里拿出来单独保存：只用竖直方向的“相对变化”，再按各模型比例叠加（不同模型骨架单位不同）
      // 跳跃/浮空的高度由战斗物理控制；地面闪避仍需要片段中的下蹲与翻滚高度。
      const flatY = /Jump|FlyUp/.test(c.name);
      const i = c.tracks.findIndex((t) => t.name.startsWith('Hips') && t.name.endsWith('.position'));
      if (i >= 0) {
        const t = c.tracks[i];
        const ys = new Float32Array(t.times.length);
        for (let k = 0; k < ys.length; k++) ys[k] = flatY ? t.values[1] : t.values[k * 3 + 1];
        hipsY.set(c.name, { times: t.times, ys });
        c.tracks.splice(i, 1);
      }
      clipLib.set(c.name, c);
    }
    const ref = hipsY.get('Idle') || hipsY.get('Combat_Stance');
    refHipY = ref ? ref.ys[0] : 1;
    return clipLib;
  }).catch((e) => { console.warn('动作库加载失败', e); clipLib = null; clipLibPromise = null; return null; });
  return clipLibPromise;
}
export function hasClips() { return !!clipLib && clipLib.size > 0; }

// 程序化片段名 → 动捕片段（按优先级取第一个存在的）
const ATTACK_MAP = {
  slash1: ['Right_Hand_Sword_Slash', 'Attack'], slash2: ['Left_Slash', 'Attack'], slash3: ['Charged_Slash', 'Heavy_Hammer_Swing'],
  upslash: ['Charged_Upward_Slash'], thrust: ['Thrust_Slash'], dashslash: ['Right_Hand_Sword_Slash'], jumpslam: ['Charged_Axe_Chop', 'Charged_Ground_Slam'],
  spin: ['Double_Blade_Spin', 'Axe_Spin_Attack'], punchR: ['Right_Jab_from_Guard'], punchL: ['Left_Jab_from_Guard'], uppercut: ['Right_Uppercut_from_Guard'],
  kick: ['Roundhouse_Kick', 'Spartan_Kick'], spinkick: ['Lunge_Spin_Kick'], palm: ['Punch_Forward_with_Both_Fists'], grab: ['Shield_Push_Left', 'Elbow_Strike'],
  spearThrust: ['Thrust_Slash'], spearUp: ['Charged_Upward_Slash'], spearSpin: ['Reaping_Swing', 'Axe_Spin_Attack'], spearSlam: ['Charged_Axe_Chop'],
  shoot: ['Cowboy_Quick_Draw_Shooting'], shoot2: ['Walk_Forward_While_Shooting', 'Cowboy_Quick_Draw_Shooting'], shootUp: ['Cowboy_Quick_Draw_Shooting'], cannon: ['Walk_Forward_While_Shooting'],
  cast: ['Charged_Spell_Cast_1', 'mage_soell_cast'], castUp: ['mage_soell_cast', 'Charged_Spell_Cast'], throw: ['Crouch_Pull_and_Throw'], heal: ['mage_soell_cast_2', 'mage_soell_cast'],
  stomp: ['Leg_Sweep', 'Spartan_Kick'],
};
// 射击类：固定在瞄准姿势（片段时间比例），不做时间扭曲
const AIM_POSE = { Cowboy_Quick_Draw_Shooting: 0.5, Walk_Forward_While_Shooting: 0.4 };
// 各片段的“命中时刻”占片段时长的比例（粗估，未列出默认 0.42）
const IMPACT = { Right_Hand_Sword_Slash: 0.38, Left_Slash: 0.4, Thrust_Slash: 0.42, Charged_Upward_Slash: 0.55, Charged_Slash: 0.55, Heavy_Hammer_Swing: 0.5,
  Charged_Axe_Chop: 0.55, Double_Blade_Spin: 0.35, Axe_Spin_Attack: 0.4, Right_Jab_from_Guard: 0.35, Left_Jab_from_Guard: 0.35, Right_Uppercut_from_Guard: 0.45,
  Roundhouse_Kick: 0.45, Lunge_Spin_Kick: 0.5, Punch_Forward_with_Both_Fists: 0.45, Reaping_Swing: 0.45, Side_Shot: 0.35, Cowboy_Quick_Draw_Shooting: 0.3,
  mage_soell_cast: 0.5, Charged_Spell_Cast: 0.6, Crouch_Pull_and_Throw: 0.55, Spartan_Kick: 0.4, Shield_Push_Left: 0.4, Elbow_Strike: 0.4, Leg_Sweep: 0.4 };

// 自动估计命中帧：采样攻击侧的手（踢类用右脚）在片段中的速度峰值
const autoImpact = new Map();
let probe = null;
export function analyzeImpacts(riggedScene) {
  if (probe || !clipLib) return;
  probe = createMocapBody(riggedScene);
  const mixer = new THREE.AnimationMixer(probe.model);
  const names = new Set(Object.values(ATTACK_MAP).flat());
  const p0 = new THREE.Vector3(), p1 = new THREE.Vector3();
  for (const n of names) {
    const c = clipLib.get(n); if (!c) continue;
    const bone = /Kick|Sweep/.test(n) ? probe.bones.RightFoot : /^Left_Jab_/.test(n) ? probe.bones.LeftHand : probe.bones.RightHand;
    if (!bone) continue;
    const a = mixer.clipAction(retargetClip(c, probe.rest)); a.play(); a.paused = true;
    const N = 48; let best = 0.42, bs = -1;
    for (let i = 0; i <= N; i++) {
      a.time = (i / N) * c.duration; mixer.update(0); probe.model.updateMatrixWorld(true);
      bone.getWorldPosition(p1);
      if (i > 0) { const f = i / N; const sp = p1.distanceTo(p0); if (f > 0.12 && f < 0.85 && sp > bs) { bs = sp; best = f; } }
      p0.copy(p1);
    }
    a.stop();
    autoImpact.set(n, best);
  }
}

function pickClip(names) { for (const n of names) if (clipLib && clipLib.has(n)) return n; return null; }

// Stand_Up1 的 8.3s 原片段含很长的趴卧等待。保留转身、撑起和收势，
// 将真正的髋部上升分配到反应时长的 60%，战斗反应计时仍由调用方控制。
const GETUP_SOURCE_DURATION = 8.3;
const GETUP_PHASE_KNOTS = [0, 0.30, 0.90, 1];
const GETUP_TIME_KNOTS = [1.2, 4.4666667, 5.9666667, 7.0];
export function getupClipPhase(name, phase, duration) {
  phase = clamp(phase, 0, 1);
  // 换动作库或使用 Arise 时不能沿用针对 Stand_Up1 认证的时间窗。
  if (name !== 'Stand_Up1' || !Number.isFinite(duration) || Math.abs(duration - GETUP_SOURCE_DURATION) > 1e-5) return phase;
  for (let i = 1; i < GETUP_PHASE_KNOTS.length; i++) {
    if (phase <= GETUP_PHASE_KNOTS[i]) {
      const t = (phase - GETUP_PHASE_KNOTS[i - 1]) / (GETUP_PHASE_KNOTS[i] - GETUP_PHASE_KNOTS[i - 1]);
      return (GETUP_TIME_KNOTS[i - 1] + (GETUP_TIME_KNOTS[i] - GETUP_TIME_KNOTS[i - 1]) * t) / duration;
    }
  }
  return phase;
}

// 从 Meshy 绑定模型创建身体实例
export function createMocapBody(riggedScene) {
  const model = SkeletonUtils.clone(riggedScene);
  const bones = {};
  const meshes = [];
  model.traverse((o) => {
    if (o.isBone) bones[o.name] = o;
    if (o.isSkinnedMesh) { o.castShadow = true; o.frustumCulled = false; meshes.push(o); }
  });
  model.updateMatrixWorld(true);
  const body = { model, bones, meshes, sockets: new Map() };
  calibrateRig(body, riggedScene.userData.gloryClass);
  const rest = new Map();
  for (const [name, bone] of Object.entries(bones)) rest.set(name, {
    world: bone.getWorldQuaternion(new THREE.Quaternion()),
    parent: bone.parent.getWorldQuaternion(new THREE.Quaternion()),
  });
  // 同一模板、同一绑定坐标轴的实例共享只读动作数据；mixer/action 仍各自独立。
  // 模板若被外部旋转后再克隆，绑定坐标轴签名改变，不能沿用原缓存。
  const frameKey = [...rest].map(([name, r]) => name + ':' + [...r.world.toArray(), ...r.parent.toArray()].join(',')).join(';');
  let cache = bodyClipCaches.get(riggedScene);
  if (!cache || cache.frameKey !== frameKey) {
    cache = { frameKey, clips: new WeakMap() };
    bodyClipCaches.set(riggedScene, cache);
  }
  body.rest = rest; body.retargetedClips = cache.clips;
  protectBerserkerLimbs(body, riggedScene.userData.gloryClass);
  repairClothWeights(body, riggedScene.userData.gloryClass);
  repairAttachmentWeights(body, riggedScene.userData.gloryClass);
  repairClericWeights(body, riggedScene.userData.gloryClass);
  repairSleeveWeights(body, riggedScene.userData.gloryClass);
  repairRobeWeights(body, riggedScene.userData.gloryClass);
  repairSkirtWeights(body, riggedScene.userData.gloryClass);
  return body;
}

// 从绑定姿态中受手骨影响的顶点估计握持中心，避免武器插在手腕上。
export function handSocket(body, side) {
  if (body.sockets.has(side)) return body.sockets.get(side).clone();
  const hand = body.bones[side + 'Hand'];
  if (!hand) return null;
  body.model.updateMatrixWorld(true);
  const center = new THREE.Vector3(), vertex = new THREE.Vector3();
  let total = 0;
  for (const mesh of body.meshes) {
    const index = mesh.skeleton.bones.indexOf(hand);
    const si = mesh.geometry.attributes.skinIndex, sw = mesh.geometry.attributes.skinWeight;
    if (index < 0 || !si || !sw) continue;
    mesh.skeleton.update();
    for (let i = 0; i < si.count; i++) {
      let weight = 0;
      for (let k = 0; k < 4; k++) if (si.getComponent(i, k) === index) weight += sw.getComponent(i, k);
      if (weight < 0.5) continue;
      mesh.getVertexPosition(i, vertex).applyMatrix4(mesh.matrixWorld);
      center.addScaledVector(vertex, weight); total += weight;
    }
  }
  if (total) hand.worldToLocal(center.divideScalar(total));
  body.sockets.set(side, center.clone());
  return center;
}

export function mountMocapWeapon(body, side, object, tilt, characterScale = 1) {
  const hand = body.bones[side + 'Hand'];
  if (!hand || !object) return null;
  const mount = new THREE.Group();
  mount.name = side + 'WeaponSocket';
  mount.position.copy(handSocket(body, side));
  mount.rotation.set(-Math.PI / 2, 0, tilt);
  const scale = hand.getWorldScale(new THREE.Vector3()).x / Math.max(1e-6, characterScale);
  mount.scale.setScalar(1 / Math.max(1e-6, scale));
  hand.add(mount); mount.add(object);
  object.position.set(0, 0, 0); object.rotation.set(0, 0, 0);
  return mount;
}

// 将源动作映射到目标骨骼的绑定坐标轴，保留目标骨长。
// 同名骨骼并不保证局部朝向一致，直接套旋转会扭曲髋骨和四肢。
export function retargetClip(clip, rest) {
  const tracks = clip.tracks.map((track) => {
    if (!track.name.endsWith('.quaternion')) return track.clone();
    const name = track.name.slice(0, -'.quaternion'.length);
    const src = sourceRest.get(name), dst = rest.get(name);
    if (!src || !dst) return track.clone();
    const left = dst.parent.clone().invert().multiply(src.parent);
    const right = src.world.clone().invert().multiply(dst.world);
    const mapped = track.clone(), q = new THREE.Quaternion();
    for (let i = 0; i < mapped.values.length; i += 4) {
      q.fromArray(track.values, i).premultiply(left).multiply(right).normalize();
      q.toArray(mapped.values, i);
    }
    return mapped;
  });
  return new THREE.AnimationClip(clip.name, clip.duration, tracks, clip.blendMode);
}

// 分区仍使用完整原顶点编号；仅传递服饰修复已认证的只读逐点数据。
const splitReadonlyMetadata = [
  'clothProtectedLimbMask', 'clothStrength', 'attachmentStrength', 'attachmentComponent',
  'firstPersonHeadMask', 'clericWeightMask', 'sleeveStrength', 'sleeveComponent',
  'robeStrength', 'skirtStrength',
];

// 把蒙皮网格按主导骨骼拆出头部与手臂（第一人称隐藏用）；返回 {head:[], arms:[], body:[]}
export function splitForFirstPerson(body) {
  const out = { head: [], arms: [], body: [] };
  for (const m of [...body.meshes]) {
    const g = m.geometry, si = g.attributes.skinIndex, sw = g.attributes.skinWeight;
    if (!si) { out.body.push(m); continue; }
    const names = m.skeleton.bones.map((b) => b.name);
    const cls = (vi) => {
      if (m.userData.firstPersonHeadMask?.[vi]) return 'head';
      let best = 0, bw = -1; for (let k = 0; k < 4; k++) { const w = sw.getComponent(vi, k); if (w > bw) { bw = w; best = si.getComponent(vi, k); } }
      const n = names[best] || '';
      if (/head|neck/i.test(n)) return 'head';
      if (/Arm|Hand|Shoulder/.test(n)) return 'arms';
      return 'body';
    };
    const idx = g.index ? g.index.array : null;
    const triCount = idx ? idx.length / 3 : g.attributes.position.count / 3;
    const lists = { head: [], arms: [], body: [] };
    for (let t = 0; t < triCount; t++) {
      const a = idx ? idx[t * 3] : t * 3, b = idx ? idx[t * 3 + 1] : t * 3 + 1, c = idx ? idx[t * 3 + 2] : t * 3 + 2;
      const ca = cls(a), cb = cls(b), cc = cls(c);
      const k = ca === cb || ca === cc ? ca : cb === cc ? cb : 'body';
      lists[k].push(a, b, c);
    }
    for (const k of ['head', 'arms', 'body']) {
      if (!lists[k].length) continue;
      // 分区只改变索引；顶点、UV 和蒙皮属性保持只读共享，避免复制三份精模。
      const ng = new THREE.BufferGeometry();
      for (const [name, attribute] of Object.entries(g.attributes)) ng.setAttribute(name, attribute);
      ng.morphAttributes = g.morphAttributes;
      ng.morphTargetsRelative = g.morphTargetsRelative;
      ng.setIndex(lists[k]);
      const nm = new THREE.SkinnedMesh(ng, m.material);
      // Fighter在拆分后创建接地检测；不能把衣料排除标记留在已移除的原网格上。
      for (const key of splitReadonlyMetadata) {
        const value = m.userData[key];
        if (ArrayBuffer.isView(value) && value.length === g.attributes.position.count) nm.userData[key] = value;
      }
      nm.castShadow = true; nm.frustumCulled = false; nm.name = m.name + '_' + k;
      nm.position.copy(m.position); nm.quaternion.copy(m.quaternion); nm.scale.copy(m.scale);
      nm.bindMode = m.bindMode;
      nm.bind(m.skeleton, m.bindMatrix);
      if (m.morphTargetInfluences) nm.morphTargetInfluences = m.morphTargetInfluences.slice();
      m.parent.add(nm);
      out[k].push(nm);
    }
    m.removeFromParent();
  }
  body.meshes = [...out.head, ...out.arms, ...out.body];
  return out;
}

// 权重与 mixer 使用同一时间步，兼容工具直接调用 play() 后推进 mixer。
class BlendMixer extends THREE.AnimationMixer {
  constructor(root, blend) { super(root); this.blend = blend; }
  update(dt) { this.blend(dt); return super.update(dt); }
}

// 髋高比例不能兼容所有腿长。用实际脚底蒙皮顶点的少量代表点，修正地面动作的悬空/穿地。
class GroundFeet {
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
        const indices = new Set(mesh.skeleton.bones.map((b, i) => b.name.startsWith(side) && /Foot|Toe/.test(b.name) ? i : -1).filter(i => i >= 0));
        if (!indices.size) continue;
        const candidates = []; let floor = Infinity;
        for (let i = 0; i < position.count; i++) {
          if (mesh.userData.skirtStrength?.[i] > 0) continue;
          let weight = 0;
          for (let k = 0; k < 4; k++) if (indices.has(skinIndex.getComponent(i, k))) weight += skinWeight.getComponent(i, k);
          if (weight < 0.5) continue;
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

const HYBRID_STANCES = new Set(['pistol', 'cannon', 'umbrella_gun', 'staff', 'holy', 'broom', 'tome', 'fist', 'greatsword', 'spear']);

// 闲置/移动及枪械瞄准时使用职业握持姿势，动捕仍负责下盘；近战/受击回到完整动捕。
// 程序化 rig 在创建时保持绑定姿态，左右手的坐标轴差异只测量一次。
class StanceArms {
  constructor(body, rig) {
    this.rig = rig; this.weight = 0;
    this.spine = body.bones.Spine02 || body.bones.Spine01;
    this.chestRest = rig.bones.chest.getWorldQuaternion(new THREE.Quaternion());
    this.spineRest = this.spine.getWorldQuaternion(new THREE.Quaternion());
    this.chains = [];
    for (const [side, suffix] of [['Right', 'R'], ['Left', 'L']]) {
      const P = rig.bones;
      const hand = body.bones[side + 'Hand'];
      const mount = hand.children.find(o => o.name === side + 'WeaponSocket');
      this.chains.push({
        arm: body.bones[side + 'Arm'], fore: body.bones[side + 'ForeArm'], hand,
        sh: P['sh' + suffix], el: P['el' + suffix], ha: P['ha' + suffix], grip: P['grip' + suffix],
        handFrame: P['ha' + suffix].getWorldQuaternion(new THREE.Quaternion()).invert().multiply(hand.getWorldQuaternion(new THREE.Quaternion())),
        mount, mountRest: mount ? mount.quaternion.clone() : null,
      });
    }
    this.v1 = new THREE.Vector3(); this.v2 = new THREE.Vector3(); this.v3 = new THREE.Vector3(); this.v4 = new THREE.Vector3();
    this.q1 = new THREE.Quaternion(); this.q2 = new THREE.Quaternion(); this.q3 = new THREE.Quaternion();
  }
  swing(bone, child, from, to, weight) {
    const { v1, v2, v3, v4, q1, q2, q3 } = this;
    child.getWorldPosition(v1).sub(bone.getWorldPosition(v2)).normalize();
    to.getWorldPosition(v3).sub(from.getWorldPosition(v4)).normalize();
    q1.setFromUnitVectors(v1, v3);
    bone.getWorldQuaternion(q2).premultiply(q1);
    bone.parent.getWorldQuaternion(q3).invert();
    bone.quaternion.slerp(q3.multiply(q2), weight);
    bone.updateMatrixWorld(true);
  }
  update(dt, st) {
    const shooting = /^(pistol|cannon|umbrella_gun)$/.test(st.stance || '') && /^(shoot|shoot2|shootUp|cannon)$/.test(st.action?.clip || '');
    const active = HYBRID_STANCES.has(st.stance) && (shooting || (st.onGround && !st.action)) && !st.react && !st.dash && !st.guard;
    this.weight += ((active ? 1 : 0) - this.weight) * (1 - Math.exp(-20 * Math.max(0, dt)));
    if (this.weight < 1e-5) this.weight = 0;
    if (this.weight > 1 - 1e-5) this.weight = 1;
    const w = this.weight, { v1, v2, v3, v4, q1, q2, q3 } = this;
    if (w) {
      this.rig.root.updateMatrixWorld(true);
      this.rig.bones.chest.getWorldQuaternion(q1).multiply(q2.copy(this.chestRest).invert()).multiply(this.spineRest);
      this.spine.parent.getWorldQuaternion(q2).invert();
      this.spine.quaternion.slerp(q2.multiply(q1), w);
      this.spine.updateMatrixWorld(true);
    }
    for (const chain of this.chains) {
      const { arm, fore, hand, sh, el, ha, grip, handFrame, mount, mountRest } = chain;
      if (w) {
        this.swing(arm, fore, sh, el, w); this.swing(fore, hand, el, ha, w);
        ha.getWorldQuaternion(q1).multiply(handFrame);
        hand.parent.getWorldQuaternion(q2).invert();
        hand.quaternion.slerp(q2.multiply(q1), w);
        hand.updateMatrixWorld(true);
      }
      if (!mount) continue;
      mount.quaternion.copy(mountRest);
      if (w) {
        grip.getWorldQuaternion(q1);
        if (st.stance === 'pistol') {
          // 两把枪共用角色的前向，保留俯仰，避免左右枪管在水平方向发散。
          v1.set(0, 1, 0).applyQuaternion(q1);
          this.rig.root.getWorldQuaternion(q2);
          v2.set(0, 0, 1).applyQuaternion(q2); v3.set(0, 1, 0).applyQuaternion(q2);
          v4.copy(v1).addScaledVector(v3, -v1.dot(v3)).normalize();
          v2.addScaledVector(v3, -v2.dot(v3)).normalize();
          q2.setFromUnitVectors(v4, v2); q1.premultiply(q2);
        }
        hand.getWorldQuaternion(q2).invert();
        mount.quaternion.slerp(q2.multiply(q1), w);
      }
      mount.updateMatrixWorld(true);
    }
  }
}

// 动捕动画控制器：输入与程序化 Animator 相同的状态描述
export class MocapAnimator {
  constructor(body, proceduralRig = null) {
    this.body = body;
    if (proceduralRig) proceduralRig.root.updateMatrixWorld(true);
    this.mixer = new BlendMixer(body.model, dt => this.updateBlend(dt));
    this.actions = new Map();
    this.cur = null; this.curName = '';
    this.spine = body.bones.Spine02 || body.bones.Spine01;
    this.hips = body.bones.Hips;
    this.hipRest = this.hips ? this.hips.position.clone() : null;
    this.pitchQ = new THREE.Quaternion();
    this.lastAttackKey = null;
    this.blend = null;
    this.stanceArms = proceduralRig && this.spine && ['RightArm', 'RightForeArm', 'RightHand', 'LeftArm', 'LeftForeArm', 'LeftHand'].every(n => body.bones[n])
      ? new StanceArms(body, proceduralRig) : null;
    this.groundFeet = this.hips ? new GroundFeet(body) : null;
  }
  action(name) {
    let a = this.actions.get(name);
    if (!a) {
      const c = clipLib && clipLib.get(name); if (!c) return null;
      let mapped = this.body.retargetedClips.get(c);
      if (!mapped) { mapped = retargetClip(c, this.body.rest); this.body.retargetedClips.set(c, mapped); }
      a = this.mixer.clipAction(mapped); this.actions.set(name, a);
    }
    return a;
  }
  // 切换到片段；manual=true 时由调用方设置时间
  play(name, { fade = 0.15, loop = true, manual = false, speed = 1 } = {}) {
    const a = this.action(name); if (!a) return null;
    if (this.curName !== name || (!loop && this._restart)) {
      // 从当前完整混合姿态继续过渡。crossFadeTo 会把被打断的淡入动作
      // 重新当成满权重，并留下更早的淡出动作，连段/受击时会跳变。
      const weights = new Map();
      for (const action of this.actions.values()) {
        if (action.isScheduled() && action.enabled) weights.set(action, action.getEffectiveWeight());
      }
      const resume = weights.get(a) > 0;
      if (!resume || this._restart) a.reset();
      a.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
      a.clampWhenFinished = !loop;
      a.enabled = true; a.setEffectiveWeight(weights.size ? weights.get(a) || 0 : 1);
      a.play();
      this.blend = weights.size ? { weights, t: 0, duration: Math.max(0, fade) } : null;
      this.cur = a; this.curName = name;
      if (this.blend && !this.blend.duration) this.updateBlend(0);
    }
    a.paused = manual;
    a.timeScale = speed;
    return a;
  }

  updateBlend(dt) {
    if (!this.blend) return;
    const blend = this.blend;
    blend.t += Math.max(0, dt);
    const t = blend.duration ? Math.min(1, blend.t / blend.duration) : 1;
    for (const action of this.actions.values()) {
      if (!action.isScheduled()) continue;
      const from = blend.weights.get(action) || 0;
      action.setEffectiveWeight(from * (1 - t) + (action === this.cur ? t : 0));
      if (t === 1 && action !== this.cur) action.stop();
    }
    if (t === 1) this.blend = null;
  }

  update(dt, st) {
    const r = st.react, a = st.action;
    let clip = null, t01 = null, fade = 0.15, loop = true, speed = 1;
    if (r) {
      switch (r.type) {
        case 'hit': clip = pickClip(r.back < -0.3 ? ['Hit_Reaction_to_Waist', 'Hit_Reaction'] : Math.abs(r.side || 0) > 0.5 ? ['Face_Punch_Reaction', 'Hit_Reaction'] : ['Hit_Reaction', 'Face_Punch_Reaction']);
          t01 = clamp(r.t / Math.max(0.2, r.dur), 0, 1) * 0.8; fade = 0.06; break;
        case 'stun': clip = pickClip(['Hit_Reaction_to_Waist', 'Hit_Reaction']); t01 = 0.35 + 0.05 * Math.sin(r.t * 6); break;
        case 'air': clip = pickClip(['BeHit_FlyUp']); t01 = clamp(r.t / 0.9, 0, 0.62); fade = 0.08; break;
        case 'down': clip = pickClip(['Knock_Down', 'BeHit_FlyUp']); t01 = clamp(0.72 + r.t * 0.3, 0, 0.98); fade = 0.12; break;
        case 'getup': clip = pickClip(['Stand_Up1', 'Arise']);
          t01 = getupClipPhase(clip, r.t / Math.max(0.2, r.dur), clipLib?.get(clip)?.duration); fade = 0.08; break;
        case 'tech': clip = pickClip(['Roll_Dodge', 'Stand_Dodge']); t01 = clamp(r.t / Math.max(0.2, r.dur), 0, 1); fade = 0.05; break;
        case 'dead': clip = pickClip(r.back < -0.3 ? ['Shot_in_the_Back_and_Fall', 'dying_backwards'] : ['dying_backwards', 'Dead', 'Knock_Down']); t01 = clamp(r.t / 1.4, 0, 0.99); fade = 0.1; break;
        case 'cheer': clip = pickClip(/fist|great|brick|boss|hammer/.test(st.stance || '') ? ['Chest_Pound_Taunt', 'Victory_Cheer'] : ['Victory_Cheer', 'Sword_Shout']); loop = true; break;
      }
    } else if (a) {
      const names = ATTACK_MAP[a.clip] || ['Attack'];
      clip = pickClip(names);
      if (clip) {
        // 时间扭曲：蓄力阶段走到命中帧前，生效阶段越过命中帧，收招走完剩余
        const imp = autoImpact.get(clip) ?? IMPACT[clip] ?? 0.42;
        if (AIM_POSE[clip] !== undefined) t01 = AIM_POSE[clip] + (a.stage === 'active' ? 0.01 * Math.sin(a.t * 20) : 0);
        else if (a.stage === 'wind') t01 = imp * 0.85 * clamp(a.t, 0, 1);
        else if (a.stage === 'active') t01 = imp * 0.85 + imp * 0.25 * clamp(a.t, 0, 1);
        else t01 = imp * 1.1 + (1 - imp * 1.1) * clamp(a.t, 0, 1) * 0.95;
        fade = 0.08;
        // 同一片段连续两次（如连段）时重新开始
        const key = a.key;
        if (key !== this.lastAttackKey) { this._restart = true; this.lastAttackKey = key; }
      }
    } else if (st.guard) {
      clip = pickClip(['Block1', 'Sword_Parry']); t01 = 0.45; fade = 0.1;
    } else if (st.dash) {
      clip = pickClip(['Stand_Dodge', 'Roll_Dodge']); t01 = clamp(st.dashT, 0, 1) * 0.9; fade = 0.05;
    } else if (!st.onGround) {
      clip = pickClip(['Basic_Jump', 'Jump_Run']); t01 = clamp(0.45 - st.vy * 0.03, 0.25, 0.8); fade = 0.12;
    } else {
      // 移动混合：按速度与方向选片段
      const spd = st.speed || 0, fwd = st.fwd ?? 1, side = st.side || 0;
      if (spd < 0.6) clip = pickClip([st.calm ? 'Idle' : 'Combat_Stance', 'Idle']);
      else if (fwd < -0.4) { clip = pickClip(spd > 3 ? [side > 0.3 ? 'BackRight_Run' : side < -0.3 ? 'BackLeft_run' : 'Walk_Fight_Back', 'Walk_Fight_Back'] : ['Walk_Fight_Back']); speed = clamp(spd / 3, 0.6, 1.6); }
      else if (Math.abs(side) > 0.55 && fwd < 0.5) { clip = pickClip([side > 0 ? 'ForwardRight_Run_Fight' : 'ForwardLeft_Run_Fight']); speed = clamp(spd / 5, 0.6, 1.5); }
      else if (spd > 6.5) { clip = pickClip(['RunFast', 'Run_02']); speed = clamp(spd / 7.5, 0.8, 1.4); }
      else if (spd > 2.5) { clip = pickClip(['Run_02', 'RunFast']); speed = clamp(spd / 5.6, 0.7, 1.4); }
      else { clip = pickClip(['Walk_Fight_Forward', 'Run_02']); speed = clamp(spd / 2, 0.6, 1.4); }
    }
    if (!clip) clip = pickClip(['Combat_Stance', 'Idle']);
    if (!clip) return;
    const manual = t01 !== null;
    const act = this.play(clip, { fade, loop: !manual && loop, manual, speed });
    this._restart = false;
    if (manual && act) act.time = t01 * act.getClip().duration;
    this.mixer.update(dt); // 手动控制时间的片段已暂停，只推进交叉淡入
    // 髋骨高度：静止高度 + 片段中的相对起伏（按两套骨架站立髋高之比缩放）
    if (this.hips && this.hipRest && this.cur) {
      // 与旋转使用同一套交叉淡入权重，避免切换动作时身体瞬间上下跳。
      let offset = 0;
      for (const action of this.actions.values()) {
        if (!action.isScheduled() || !action.enabled) continue;
        const weight = action.getEffectiveWeight(); if (!weight) continue;
        offset += (sampleHip(action.getClip().name, action.time) - refHipY) * weight;
      }
      const k = this.hipRest.y / (refHipY || 1);
      this.hips.position.set(this.hipRest.x, this.hipRest.y + offset * k, this.hipRest.z);
    }
    if (this.groundFeet) this.groundFeet.update(dt, st);
    // 视线俯仰带动上身
    if (this.spine && st.pitch && !r) {
      this.pitchQ.setFromAxisAngle(pitchAxis, -st.pitch * 0.6);
      this.spine.quaternion.multiply(this.pitchQ);
    }
    if (this.stanceArms) this.stanceArms.update(dt, st);
  }
}

// 武器挂到 Meshy 骨架手上的角度（绕 Z）：法杖类接近竖直，其余斜向前上
export function weaponTilt(type) { return /staff|holy|broom|tome/.test(type) ? 95 * Math.PI / 180 : 30 * Math.PI / 180; }
