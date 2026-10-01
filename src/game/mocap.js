// 动捕动画：Meshy 绑定的角色（标准 24 骨）+ 共享动作库 anims.glb。
// 世界身体（第三人称/镜子/对手）用动捕片段混合；第一人称手臂仍用程序化动作（可读性更好）。
import * as THREE from 'three';
import { GLTFLoader } from '../../vendor/GLTFLoader.js';
import * as SkeletonUtils from '../../vendor/SkeletonUtils.js';
import { clamp } from '../engine/util.js';

const loader = new GLTFLoader();
let clipLib = null;      // name -> AnimationClip（已去掉水平根位移）
let clipLibPromise = null;
const hipsY = new Map();   // 片段名 -> {times, ys}
const sourceRest = new Map();
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
      const flatY = /Jump|FlyUp|Dodge/.test(c.name);
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
  }).catch((e) => { console.warn('动作库加载失败', e); clipLib = null; return null; });
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

// 自动估计命中帧：采样右手（踢类用右脚）在片段中的速度峰值
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
    const bone = /Kick|Sweep/.test(n) ? probe.bones.RightFoot : probe.bones.RightHand;
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
  const rest = new Map();
  for (const [name, bone] of Object.entries(bones)) rest.set(name, {
    world: bone.getWorldQuaternion(new THREE.Quaternion()),
    parent: bone.parent.getWorldQuaternion(new THREE.Quaternion()),
  });
  return { model, bones, meshes, rest };
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

// 把蒙皮网格按主导骨骼拆出头部与手臂（第一人称隐藏用）；返回 {head:[], arms:[], body:[]}
export function splitForFirstPerson(body) {
  const out = { head: [], arms: [], body: [] };
  for (const m of [...body.meshes]) {
    const g = m.geometry, si = g.attributes.skinIndex, sw = g.attributes.skinWeight;
    if (!si) { out.body.push(m); continue; }
    const names = m.skeleton.bones.map((b) => b.name);
    const cls = (vi) => {
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
      const ng = g.clone();
      ng.setIndex(lists[k]);
      const nm = new THREE.SkinnedMesh(ng, m.material);
      nm.castShadow = true; nm.frustumCulled = false; nm.name = m.name + '_' + k;
      nm.bind(m.skeleton, m.bindMatrix);
      m.parent.add(nm);
      out[k].push(nm);
    }
    m.removeFromParent();
  }
  body.meshes = [...out.head, ...out.arms, ...out.body];
  return out;
}

// 动捕动画控制器：输入与程序化 Animator 相同的状态描述
export class MocapAnimator {
  constructor(body) {
    this.body = body;
    this.mixer = new THREE.AnimationMixer(body.model);
    this.actions = new Map();
    this.cur = null; this.curName = '';
    this.spine = body.bones.Spine02 || body.bones.Spine01;
    this.hips = body.bones.Hips;
    this.hipRest = this.hips ? this.hips.position.clone() : null;
    this.pitchQ = new THREE.Quaternion();
    this.lastAttackKey = null;
  }
  action(name) {
    let a = this.actions.get(name);
    if (!a) { const c = clipLib && clipLib.get(name); if (!c) return null; a = this.mixer.clipAction(retargetClip(c, this.body.rest)); this.actions.set(name, a); }
    return a;
  }
  // 切换到片段；manual=true 时由调用方设置时间
  play(name, { fade = 0.15, loop = true, manual = false, speed = 1 } = {}) {
    const a = this.action(name); if (!a) return null;
    if (this.curName !== name || (!loop && this._restart)) {
      a.reset();
      a.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
      a.clampWhenFinished = !loop;
      a.enabled = true; a.setEffectiveWeight(1);
      a.play();
      if (this.cur && this.cur !== a) this.cur.crossFadeTo(a, fade, false);
      this.cur = a; this.curName = name;
    }
    a.paused = manual;
    a.timeScale = speed;
    return a;
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
        case 'getup': clip = pickClip(['Stand_Up1', 'Arise']); t01 = clamp(r.t / Math.max(0.2, r.dur), 0, 1); fade = 0.08; break;
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
      for (const [name, action] of this.actions) {
        if (!action.enabled) continue;
        offset += (sampleHip(name, action.time) - refHipY) * action.getEffectiveWeight();
      }
      const k = this.hipRest.y / (refHipY || 1);
      this.hips.position.set(this.hipRest.x, this.hipRest.y + offset * k, this.hipRest.z);
    }
    // 视线俯仰带动上身
    if (this.spine && st.pitch && !r) {
      this.pitchQ.setFromAxisAngle(new THREE.Vector3(1, 0, 0), -st.pitch * 0.6);
      this.spine.quaternion.multiply(this.pitchQ);
    }
  }
}

// 武器挂到 Meshy 骨架手上的角度（绕 Z）：法杖类接近竖直，其余斜向前上
export function weaponTilt(type) { return /staff|holy|broom|tome/.test(type) ? 95 * Math.PI / 180 : 30 * Math.PI / 180; }
