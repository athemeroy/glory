// 程序化动画：站姿 + 移动循环 + 技能动作片段 + 受击反应，逐骨骼平滑混合。
import { clamp, lerp, smooth, easeOut, DEG } from '../engine/util.js';

const BONES = ['hips', 'spine', 'chest', 'neck', 'head', 'shL', 'elL', 'haL', 'shR', 'elR', 'haR', 'thL', 'knL', 'ftL', 'thR', 'knR', 'ftR', 'skL', 'skR', 'skB', 'gripR', 'gripL'];
const BODY_KEYS = ['bodyY', 'bodyRX', 'bodyRZ', 'bodyRY', 'bodyZ'];

// ---------- 站姿（上半身），单位：度 ----------
// 肩关节欧拉顺序 YXZ：x 前抬（负值向前上抬），y 水平摆（正值向身体左侧），z 外展。
// 握点 gripR/gripL：x=g 时武器仰角 φ = 90 - (g + 肩x + 肘x)。g≈180 表示武器顺着前臂延伸。
export const STANCES = {
  none: { shL: [-8, 0, 8], elL: [-25, 0, 0], shR: [-8, 0, -8], elR: [-25, 0, 0] },
  sword: { chest: [0, -10, 0], shR: [-55, 12, 0], elR: [-55, 0, 0], gripR: [165, 0, 0], shL: [-45, -15, 0], elL: [-75, 0, 0] },
  greatsword: { chest: [0, -15, 0], shR: [-45, 20, 0], elR: [-55, 0, 0], gripR: [160, 0, 0], shL: [-55, -5, 0], elL: [-55, 0, 0] },
  spear: { chest: [0, -12, 0], shR: [-42, 16, 0], elR: [-58, 0, 0], gripR: [178, 0, 0], shL: [-82, -20, 0], elL: [-22, 0, 0] },
  fist: { chest: [0, -5, 0], shL: [-42, -16, 0], elL: [-92, 0, 0], shR: [-40, 16, 0], elR: [-95, 0, 0] },
  umbrella_sword: { chest: [0, -10, 0], shR: [-55, 12, 0], elR: [-55, 0, 0], gripR: [165, 0, 0], shL: [-35, -10, 0], elL: [-60, 0, 0] },
  umbrella_spear: { chest: [0, -12, 0], shR: [-42, 16, 0], elR: [-58, 0, 0], gripR: [178, 0, 0], shL: [-82, -20, 0], elL: [-22, 0, 0] },
  umbrella_gun: { chest: [0, -6, 0], shR: [-52, 12, 0], elR: [-70, 0, 0], gripR: [212, 0, 0], shL: [-80, -18, 0], elL: [-22, 0, 0] },
  umbrella_shield: { chest: [0, 0, 0], shR: [-72, 22, 0], elR: [-28, 0, 0], gripR: [185, 0, 0], shL: [-40, -10, 0], elL: [-70, 0, 0] },
  pistol: { shR: [-68, 12, 0], elR: [-25, 0, 0], gripR: [183, 0, 0], shL: [-68, -12, 0], elL: [-25, 0, 0], gripL: [183, 0, 0] },
  cannon: { chest: [0, -8, 0], shR: [-22, 8, 0], elR: [-88, 0, 0], gripR: [200, 0, 0], shL: [-62, -28, 0], elL: [-48, 0, 0] },
  staff: { shR: [-45, 12, 0], elR: [-50, 0, 0], gripR: [115, 0, 0], shL: [-40, -12, 0], elL: [-70, 0, 0] },
  broom: { shR: [-45, 12, 0], elR: [-50, 0, 0], gripR: [115, 0, 0], shL: [-40, -12, 0], elL: [-70, 0, 0] },
  dagger: { chest: [0, -5, 0], shR: [-45, 15, 0], elR: [-85, 0, 0], gripR: [150, 0, 0], shL: [-45, -15, 0], elL: [-85, 0, 0], gripL: [150, 0, 0] },
  holy: { shR: [-45, 12, 0], elR: [-50, 0, 0], gripR: [115, 0, 0], shL: [-40, -12, 0], elL: [-70, 0, 0] },
  tome: { shR: [-45, 12, 0], elR: [-50, 0, 0], gripR: [125, 0, 0], shL: [-60, -18, 0], elL: [-70, 0, 0], gripL: [20, 0, 0] },
  knight: { shR: [-55, 12, 0], elR: [-55, 0, 0], gripR: [165, 0, 0], shL: [-60, -10, 0], elL: [-60, 0, 0], gripL: [90, 0, 0] },
};

// ---------- 技能动作片段：wind（蓄力末）/ strike（生效末），可选 mid ----------
export const CLIPS = {
  // 剑（右手）
  slash1: { wind: { chest: [0, 35, 0], shR: [-95, -75, 0], elR: [-20, 0, 0], gripR: [190, 0, 0] }, strike: { chest: [0, -40, 0], shR: [-90, 65, 0], elR: [-10, 0, 0], gripR: [180, 0, 0] } },
  slash2: { wind: { chest: [0, -35, 0], shR: [-90, 55, 0], elR: [-70, 0, 0], gripR: [240, 0, 0] }, strike: { chest: [0, 35, 0], shR: [-95, -75, 0], elR: [-10, 0, 0], gripR: [185, 0, 0] } },
  slash3: { wind: { chest: [-10, 0, 0], shR: [-165, 10, 0], elR: [-40, 0, 0], gripR: [175, 0, 0] }, strike: { chest: [25, 0, 0], shR: [-60, 5, 0], elR: [-10, 0, 0], gripR: [185, 0, 0] } },
  upslash: { wind: { chest: [15, 20, 0], shR: [-15, -25, 0], elR: [-10, 0, 0], gripR: [165, 0, 0], knL: [30, 0, 0], knR: [30, 0, 0] }, strike: { chest: [-18, -10, 0], shR: [-160, 10, 0], elR: [-10, 0, 0], gripR: [160, 0, 0] } },
  thrust: { wind: { chest: [0, 25, 0], shR: [-40, -25, 0], elR: [-110, 0, 0], gripR: [240, 0, 0] }, strike: { chest: [8, -20, 0], shR: [-88, 8, 0], elR: [-3, 0, 0], gripR: [181, 0, 0], shL: [-20, 0, 30] } },
  dashslash: { wind: { chest: [15, 45, 0], shR: [-80, -90, 0], elR: [-30, 0, 0], gripR: [195, 0, 0] }, strike: { chest: [10, -45, 0], shR: [-88, 75, 0], elR: [-5, 0, 0], gripR: [180, 0, 0] } },
  jumpslam: { wind: { chest: [-20, 0, 0], shR: [-170, 5, 0], elR: [-40, 0, 0], shL: [-170, -5, 0], elL: [-40, 0, 0], gripR: [175, 0, 0] }, strike: { chest: [35, 0, 0], shR: [-50, 5, 0], elR: [-5, 0, 0], shL: [-50, -5, 0], elL: [-5, 0, 0], gripR: [185, 0, 0], knL: [40, 0, 0], knR: [40, 0, 0] } },
  spin: { wind: { chest: [0, 50, 0], shR: [-90, -80, 0], elR: [-15, 0, 0], gripR: [185, 0, 0] }, strike: { chest: [0, -40, 0], shR: [-90, 70, 0], elR: [-10, 0, 0], gripR: [185, 0, 0] }, spin: 360 },
  // 拳
  punchR: { wind: { chest: [0, 25, 0], shR: [-35, 5, 0], elR: [-120, 0, 0] }, strike: { chest: [5, -30, 0], shR: [-86, 14, 0], elR: [-5, 0, 0], shL: [-45, -16, 0], elL: [-100, 0, 0] } },
  punchL: { wind: { chest: [0, -25, 0], shL: [-35, -5, 0], elL: [-120, 0, 0] }, strike: { chest: [5, 30, 0], shL: [-86, -14, 0], elL: [-5, 0, 0], shR: [-45, 16, 0], elR: [-100, 0, 0] } },
  uppercut: { wind: { chest: [20, 30, 0], shR: [-20, 0, 0], elR: [-100, 0, 0], knL: [35, 0, 0], knR: [35, 0, 0], thL: [-25, 0, 0], thR: [-25, 0, 0] }, strike: { chest: [-20, -20, 0], shR: [-160, 10, 0], elR: [-40, 0, 0] } },
  kick: { wind: { chest: [-10, 20, 0], thR: [-20, 0, -20], knR: [100, 0, 0], shL: [-40, -16, 0], elL: [-100, 0, 0] }, strike: { chest: [-20, -30, 0], thR: [-95, 0, -35], knR: [5, 0, 0], shL: [-30, 30, 30], shR: [-30, -30, -30], elL: [-40, 0, 0], elR: [-40, 0, 0] } },
  spinkick: { wind: { chest: [-10, 40, 0], thR: [-30, 0, -20], knR: [80, 0, 0] }, strike: { chest: [-25, -30, 0], thR: [-90, 0, -60], knR: [0, 0, 0], shL: [-30, 60, 40], shR: [-30, -60, -40] }, spin: 360 },
  palm: { wind: { chest: [-5, 0, 0], shL: [-35, -10, 0], elL: [-120, 0, 0], haL: [-60, 0, 0] }, strike: { chest: [15, 20, 0], shL: [-90, -8, 0], elL: [-5, 0, 0], haL: [-80, 0, 0], thL: [-30, 0, 0], knL: [40, 0, 0] } },
  grab: { wind: { shL: [-60, -30, 0], elL: [-60, 0, 0], shR: [-60, 30, 0], elR: [-60, 0, 0] }, strike: { chest: [10, 0, 0], shL: [-85, -5, 0], elL: [-30, 0, 0], shR: [-85, 5, 0], elR: [-30, 0, 0] } },
  // 矛（双手）
  spearThrust: { wind: { chest: [0, 30, 0], shR: [-15, -10, 0], elR: [-40, 0, 0], gripR: [145, 0, 0], shL: [-50, -10, 0], elL: [-40, 0, 0] }, strike: { chest: [10, -15, 0], shR: [-80, 15, 0], elR: [-10, 0, 0], gripR: [180, 0, 0], shL: [-90, -5, 0], elL: [0, 0, 0] } },
  spearUp: { wind: { chest: [18, 10, 0], shR: [-10, -5, 0], elR: [-20, 0, 0], gripR: [150, 0, 0], shL: [-40, -10, 0], elL: [-20, 0, 0], knL: [35, 0, 0], knR: [35, 0, 0] }, strike: { chest: [-22, -10, 0], shR: [-160, 5, 0], elR: [-15, 0, 0], gripR: [185, 0, 0], shL: [-150, -5, 0], elL: [-20, 0, 0] } },
  spearSpin: { wind: { chest: [0, 55, 0], shR: [-90, -80, 0], elR: [-20, 0, 0], gripR: [190, 0, 0], shL: [-90, -60, 0], elL: [-40, 0, 0] }, strike: { chest: [0, -40, 0], shR: [-90, 70, 0], elR: [-15, 0, 0], gripR: [190, 0, 0], shL: [-90, 80, 0], elL: [-30, 0, 0] }, spin: 360 },
  spearSlam: { wind: { chest: [-25, 0, 0], shR: [-175, 0, 0], elR: [-20, 0, 0], gripR: [175, 0, 0], shL: [-165, 0, 0], elL: [-20, 0, 0] }, strike: { chest: [40, 0, 0], shR: [-55, 5, 0], elR: [-5, 0, 0], gripR: [180, 0, 0], shL: [-60, -5, 0], elL: [0, 0, 0], knL: [45, 0, 0], knR: [45, 0, 0] } },
  // 枪
  shoot: { wind: { shR: [-86, 6, 0], elR: [-6, 0, 0], gripR: [182, 0, 0] }, strike: { shR: [-100, 6, 0], elR: [-14, 0, 0], gripR: [196, 0, 0] } },
  shoot2: { wind: { shR: [-86, 8, 0], elR: [-6, 0, 0], gripR: [182, 0, 0], shL: [-86, -8, 0], elL: [-6, 0, 0], gripL: [182, 0, 0] }, strike: { shR: [-98, 8, 0], elR: [-14, 0, 0], gripR: [194, 0, 0], shL: [-98, -8, 0], elL: [-14, 0, 0], gripL: [194, 0, 0] } },
  shootUp: { wind: { chest: [12, 0, 0], shR: [-60, 6, 0], elR: [-10, 0, 0], gripR: [180, 0, 0] }, strike: { chest: [-10, 0, 0], shR: [-130, 6, 0], elR: [-5, 0, 0], gripR: [180, 0, 0] } },
  cannon: { wind: { chest: [0, -10, 0], shR: [-26, 8, 0], elR: [-88, 0, 0], gripR: [202, 0, 0] }, strike: { chest: [-10, -8, 0], shR: [-18, 8, 0], elR: [-80, 0, 0], gripR: [196, 0, 0] } },
  // 法术
  cast: { wind: { chest: [-10, 10, 0], shR: [-60, -20, 0], elR: [-90, 0, 0], gripR: [150, 0, 0], shL: [-60, 20, 0], elL: [-90, 0, 0] }, strike: { chest: [10, -5, 0], shR: [-92, 12, 0], elR: [-6, 0, 0], gripR: [145, 0, 0], shL: [-92, -12, 0], elL: [-6, 0, 0], haL: [-60, 0, 0] } },
  castUp: { wind: { chest: [-10, 0, 0], shR: [-100, -20, 0], elR: [-40, 0, 0], shL: [-100, 20, 0], elL: [-40, 0, 0] }, strike: { chest: [-18, 0, 0], shR: [-170, 5, 0], elR: [-5, 0, 0], gripR: [175, 0, 0], shL: [-170, -5, 0], elL: [-5, 0, 0] } },
  throw: { wind: { chest: [0, 30, 0], shR: [-165, -30, 0], elR: [-90, 0, 0] }, strike: { chest: [15, -25, 0], shR: [-85, 10, 0], elR: [-10, 0, 0] } },
  heal: { wind: { shL: [-80, -20, 0], elL: [-60, 0, 0], shR: [-60, 20, 0], elR: [-60, 0, 0] }, strike: { shL: [-130, -10, 0], elL: [-20, 0, 0], shR: [-70, 20, 0], elR: [-40, 0, 0] } },
  stomp: { wind: { thR: [-80, 0, 0], knR: [90, 0, 0], chest: [-10, 0, 0] }, strike: { thR: [-20, 0, 0], knR: [10, 0, 0], chest: [20, 0, 0] } },
};

// 出招时的通用下盘（弓步）：前腿迈出屈膝，后腿蹬直，重心下沉，胯部扭转
const LUNGE = { thL: [-38, 0, 8], knL: [42, 0, 0], ftL: [-6, 0, 0], thR: [24, 0, -6], knR: [18, 0, 0], ftR: [10, 0, 0], hips: [0, -14, 0], spine: [8, 0, 0], bodyY: -0.09 };
const LUNGE_SKIP = new Set(['kick', 'spinkick', 'stomp', 'jumpslam', 'spearSlam', 'uppercut', 'spearUp', 'upslash', 'castUp', 'heal']);

// 格挡姿势（按站姿类别）
const GUARDS = {
  sword: { chest: [0, -10, 0], shR: [-75, 25, 0], elR: [-70, 0, 0], gripR: [160, 0, -90], shL: [-45, -15, 0], elL: [-85, 0, 0] },
  fist: { chest: [10, 0, 0], shL: [-55, -22, 0], elL: [-128, 0, 0], shR: [-55, 22, 0], elR: [-128, 0, 0] },
  spear: { chest: [0, 0, 0], shR: [-62, 12, 0], elR: [-62, 0, 0], gripR: [160, 0, -90], shL: [-62, -32, 0], elL: [-42, 0, 0] },
  shield: { chest: [0, 0, 0], shR: [-80, 16, 0], elR: [-20, 0, 0], gripR: [190, 0, 0], shL: [-40, -10, 0], elL: [-70, 0, 0] },
  knight: { shL: [-80, -10, 0], elL: [-60, 0, 0], gripL: [90, 0, 0], shR: [-55, 12, 0], elR: [-55, 0, 0], gripR: [165, 0, 0] },
  magic: { shL: [-85, -10, 0], elL: [-20, 0, 0], haL: [-70, 0, 0], shR: [-55, 12, 0], elR: [-55, 0, 0] },
};

export class Animator {
  constructor(rig) {
    this.rig = rig;
    this.cur = {};
    for (const b of BONES) this.cur[b] = [0, 0, 0];
    this.cur.gripR[0] = 90; this.cur.gripL[0] = 90;
    this.body = { bodyY: 0, bodyRX: 0, bodyRZ: 0, bodyRY: 0, bodyZ: 0 };
    this.phase = 0; // 跑步相位
    this.breath = Math.random() * 10;
    this.spinOffset = 0;
  }

  // st: { speed, fwd, side, onGround, vy, stance, action:{clip, stage:'wind'|'active'|'recover', t}, react:{type, t, dur}, pitch, guard, time }
  update(dt, st) {
    const T = {}; for (const b of BONES) T[b] = [0, 0, 0];
    T.gripR[0] = 90; T.gripL[0] = 90; // 握点默认：武器指向手掌前方
    const B = { bodyY: 0, bodyRX: 0, bodyRZ: 0, bodyRY: 0, bodyZ: 0 };
    const set = (pose, w = 1) => {
      if (!pose) return;
      for (const k in pose) {
        const v = pose[k];
        if (k in B) { B[k] = lerp(B[k], v, w); continue; }
        const t = T[k]; if (!t) continue;
        t[0] = lerp(t[0], v[0], w); t[1] = lerp(t[1], v[1], w); t[2] = lerp(t[2], v[2], w);
      }
    };
    this.breath += dt;

    // ---- 下半身：移动循环 ----
    const spd = st.speed || 0;
    const run = clamp(spd / 6, 0, 1.3);
    if (st.onGround) {
      this.phase += dt * (4 + spd * 1.45);
      const p = this.phase;
      const fwd = st.fwd ?? 1, side = st.side ?? 0;
      const amp = 38 * run;
      const dir = fwd >= -0.2 ? 1 : -1;
      const sw = Math.sin(p) * amp * dir;
      T.thL[0] = -sw - 8 + side * 0; T.thR[0] = sw - 8;
      T.knL[0] = 12 + Math.max(0, Math.cos(p)) * 55 * run;
      T.knR[0] = 12 + Math.max(0, -Math.cos(p)) * 55 * run;
      T.ftL[0] = -4; T.ftR[0] = -4;
      T.thL[2] = 4 + side * 12 * Math.sin(p); T.thR[2] = -4 + side * 12 * Math.sin(p);
      B.bodyY = -0.035 - Math.abs(Math.sin(p)) * 0.045 * run;
      // 胯部随步伐扭转，胸口反向扭转；奔跑时前倾；横移时身体向移动方向侧倾
      T.hips[1] = Math.sin(p) * 10 * run;
      T.chest[1] = -Math.sin(p) * 7 * run;
      T.hips[2] = -Math.cos(p) * 3 * run;
      T.spine[0] = (6 + 6 * Math.max(0, fwd)) * run;
      T.spine[2] = -side * 6 * run;
      T.ftL[0] = -4 + Math.max(0, Math.sin(p)) * 25 * run; T.ftR[0] = -4 + Math.max(0, -Math.sin(p)) * 25 * run;
      if (run < 0.1) { // 战斗站姿：双脚错开，重心轻微左右移动、呼吸
        const sway = Math.sin(this.breath * 0.9);
        T.thL[0] = -14; T.thR[0] = 6; T.knL[0] = 16 + sway * 3; T.knR[0] = 14 - sway * 3; T.thL[2] = 6; T.thR[2] = -6;
        T.chest[0] = Math.sin(this.breath * 1.8) * 1.5;
        T.hips[2] = sway * 1.5; T.hips[1] = -8;
        B.bodyY = -0.035 + Math.sin(this.breath * 1.8) * 0.004;
      }
    } else {
      // 空中：收腿
      const up = clamp((st.vy || 0) / 6, -1, 1);
      T.thL[0] = -40 + up * 10; T.thR[0] = -15; T.knL[0] = 70; T.knR[0] = 45;
    }
    // 衣摆跟随大腿
    T.skL[0] = Math.min(0, T.thL[0]) * 0.7 - 4; T.skR[0] = Math.min(0, T.thR[0]) * 0.7 - 4;
    T.skB[0] = 6 + Math.max(0, Math.max(T.thL[0], T.thR[0])) * 0.6 + run * 18;

    // ---- 上半身：站姿 ----
    const stance = STANCES[st.stance] || STANCES.none;
    // 空手时手臂随跑动摆动
    if (st.stance === 'none') {
      const p = this.phase;
      T.shL[0] = Math.sin(p) * 35 * run - 8; T.shR[0] = -Math.sin(p) * 35 * run - 8;
      T.elL[0] = -25 - run * 40; T.elR[0] = -25 - run * 40;
      T.shL[2] = 8; T.shR[2] = -8;
    } else {
      set(stance);
      // 跑动时武器轻微晃动
      const bob = Math.sin(this.phase * 2) * 3 * run;
      T.shR[0] += bob; T.shL[0] -= bob;
    }
    if (st.guard) set(GUARDS[st.guardKind] || GUARDS.sword);

    // ---- 技能动作 ----
    let spin = 0;
    const a = st.action;
    if (a && CLIPS[a.clip]) {
      const c = CLIPS[a.clip];
      if (a.stage === 'wind') {
        // 蓄力：先快后慢，末段有轻微“憋劲”颤动
        const t = clamp(a.t, 0, 1);
        set(c.wind, easeOut(Math.min(1, t * 1.25)));
      } else if (a.stage === 'active') {
        const t = clamp(a.t, 0, 1);
        // 出手：爆发式加速并带 8% 过冲
        const k = t < 0.7 ? easeOut(t / 0.7) * 1.08 : 1.08 - 0.08 * smooth((t - 0.7) / 0.3);
        if (c.mid) { if (t < 0.5) { set(c.wind); set(c.mid, smooth(t * 2)); } else { set(c.mid); set(c.strike, smooth(t * 2 - 1)); } }
        else { set(c.wind); set(c.strike, k); }
        if (c.spin) spin = c.spin * easeOut(t);
      } else if (a.stage === 'recover') {
        // 收招：先定格一小段再缓慢回到站姿
        const t = clamp(a.t, 0, 1);
        set(c.strike, 1 - smooth(Math.max(0, (t - 0.15) / 0.85)));
        if (c.spin) spin = c.spin;
      }
    }
    if (spin) this.spinOffset = spin; else this.spinOffset = 0;
    // 下盘弓步（地面、非自带腿部动作的片段）
    if (a && CLIPS[a.clip] && st.onGround && !LUNGE_SKIP.has(a.clip) && !st.react) {
      const w = a.stage === 'wind' ? 0.55 * clamp(a.t, 0, 1) + 0.25 : a.stage === 'active' ? 0.8 + 0.2 * clamp(a.t, 0, 1) : 1 - smooth(clamp(a.t, 0, 1)) * 0.85;
      set(LUNGE, w * (st.speed > 2 ? 0.5 : 1));
    }
    // 上挑类：下蹲后起身
    if (a && (a.clip === 'upslash' || a.clip === 'spearUp' || a.clip === 'uppercut') && st.onGround && !st.react) {
      const w = a.stage === 'wind' ? clamp(a.t, 0, 1) : a.stage === 'active' ? 1 - clamp(a.t, 0, 1) : 0;
      set({ thL: [-30, 0, 8], knL: [55, 0, 0], thR: [-5, 0, -6], knR: [45, 0, 0], bodyY: -0.16 }, w);
    }

    // ---- 受击反应 ----
    const r = st.react;
    let rate = a && a.stage === 'active' ? 38 : a && a.stage === 'wind' ? 28 : 22;
    if (r) {
      switch (r.type) {
        case 'hit': {
          // 前 20% 时间快速弹到最大受击姿势，然后缓慢恢复；方向：正面挨打后仰，背后挨打前扑，侧面挨打侧扭
          const u = clamp(r.t / Math.max(0.1, r.dur), 0, 1);
          const k = u < 0.2 ? u / 0.2 : 1 - smooth((u - 0.2) / 0.8);
          const back = r.back ?? 1, side = r.side || 0;
          set({ spine: [-10 * back, side * 12, side * 8], chest: [-18 * back, side * 28, side * 10], head: [-18 * back, -side * 15, 0], neck: [-6 * back, 0, 0],
            shL: [-25, 0, 30 + side * 10], shR: [-25, 0, -30 + side * 10], elL: [-40, 0, 0], elR: [-40, 0, 0], knL: [25, 0, 0], knR: [20, 0, 0], bodyY: -0.05 }, 0.25 + 0.75 * k);
          rate = 34;
          break;
        }
        case 'air': {
          const k = clamp(r.t / 0.5, 0, 1);
          set({ bodyRX: -55 * k, chest: [-15, 0, 0], head: [-10, 0, 0], shL: [-60, 0, 60], shR: [-60, 0, -60], elL: [-40, 0, 0], elR: [-40, 0, 0], thL: [-50, 0, 10], thR: [-20, 0, -10], knL: [60, 0, 0], knR: [40, 0, 0] });
          B.bodyY += 0.3 * k; B.bodyZ = 0.4 * k;
          rate = 14;
          break;
        }
        case 'down': {
          set({ bodyRX: -90, bodyY: 0.14, bodyZ: 0.9, chest: [0, 0, 0], head: [10, 0, 0], shL: [-10, 0, 50], shR: [-10, 0, -50], elL: [-20, 0, 0], elR: [-20, 0, 0], thL: [-10, 0, 8], thR: [-25, 0, -8], knL: [15, 0, 0], knR: [40, 0, 0], neck: [15, 0, 0] });
          rate = 18;
          break;
        }
        case 'getup': {
          const k = clamp(r.t / Math.max(0.1, r.dur), 0, 1);
          set({ bodyRX: -90 * (1 - k), bodyY: 0.14 * (1 - k), bodyZ: 0.9 * (1 - k), thL: [-70 * (1 - k), 0, 0], knL: [100 * (1 - k), 0, 0], knR: [60 * (1 - k), 0, 0] });
          rate = 16;
          break;
        }
        case 'tech': { // 受身翻滚
          const k = clamp(r.t / Math.max(0.1, r.dur), 0, 1);
          set({ bodyRX: 360 * k, bodyY: 0.2 * Math.sin(k * Math.PI), thL: [-80, 0, 0], thR: [-80, 0, 0], knL: [110, 0, 0], knR: [110, 0, 0], chest: [30, 0, 0] }, Math.sin(k * Math.PI));
          rate = 40;
          break;
        }
        case 'stun': {
          const w = Math.sin(this.breath * 7) * 12;
          set({ head: [10, w, w * 0.5], chest: [10, 0, w * 0.4], shL: [-5, 0, 10], shR: [-5, 0, -10], elL: [-10, 0, 0], elR: [-10, 0, 0] });
          break;
        }
        case 'dead': {
          set({ bodyRX: -90, bodyY: 0.14, bodyZ: 0.9, head: [20, 30, 0], shL: [-5, 0, 70], shR: [-5, 0, -70], thL: [-5, 0, 10], thR: [-5, 0, -10] });
          rate = 10;
          break;
        }
        case 'cheer': {
          const w = Math.sin(this.breath * 6) * 10;
          set({ shR: [-175, 0, -15 + w], elR: [-10, 0, 0], chest: [-8, 0, 0], head: [-10, 0, 0] });
          break;
        }
      }
    }

    // ---- 视线俯仰带动上身（第一人称时手臂与武器随视线）----
    const pitch = st.pitch || 0; // 正值抬头
    const lying = r && (r.type === 'down' || r.type === 'dead' || r.type === 'air' || r.type === 'getup' || r.type === 'tech');
    if (!lying) {
      const pd = -pitch / DEG;
      T.spine[0] += pd * 0.25;
      T.chest[0] += pd * 0.45;
      T.head[0] += pd * 0.3;
    }

    // ---- 平滑写入骨骼 ----
    const k = 1 - Math.exp(-rate * dt);
    const bones = this.rig.bones;
    for (const b of BONES) {
      const c = this.cur[b], t = T[b];
      c[0] += (t[0] - c[0]) * k; c[1] += (t[1] - c[1]) * k; c[2] += (t[2] - c[2]) * k;
      const o = bones[b]; if (!o) continue;
      o.rotation.set(c[0] * DEG, c[1] * DEG, c[2] * DEG);
    }
    for (const kk of BODY_KEYS) this.body[kk] += (B[kk] - this.body[kk]) * k;
    const body = bones.body;
    body.position.y = this.body.bodyY;
    body.position.z = this.body.bodyZ;
    body.rotation.set(this.body.bodyRX * DEG, (this.body.bodyRY + this.spinOffset) * DEG, this.body.bodyRZ * DEG);
  }
}
