// 音频：全部用 WebAudio 实时合成（无外部音频文件）
// 接口见 ARCHITECTURE.md「音频接口」。AudioContext 未初始化（init 之前）时所有调用静默返回。
//
// 结构：
//   每个声音 = 一个 voice：合成层 → vg(音量) → [PannerNode HRTF] → sfx 总线
//                                 └→ 混响发送（短/长，共享 ConvolverNode）
//   sfx 总线 + music 总线 → master → DynamicsCompressor → destination
// 噪声 buffer、混响 IR、失真曲线按采样率预生成缓存（Float32Array），每个 AudioContext 只拷贝一次成 AudioBuffer。

const MAX_VOICES = 48;          // 同时发声上限，超出丢弃最旧的
const THROTTLE_WIN = 0.04;      // 同名声音 40ms 内
const THROTTLE_MAX = 3;         // 最多触发 3 次
const PAN = { refDistance: 2, rolloffFactor: 1.2, maxDistance: 60 };

const rnd = (a, b) => a + Math.random() * (b - a);
const rv = (x, a = 0.05) => x * (1 + (Math.random() * 2 - 1) * a);
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
const nowSec = () => (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000;

// ---------------------------------------------------------------------------
// 预生成数据（按采样率缓存）
// ---------------------------------------------------------------------------
const DATA = new Map(); // sr -> { key: Float32Array[] }

function noiseArr(sr, sec, kind) {
  const n = Math.floor(sr * sec), k = 4096, m = n + k;
  const a = new Float32Array(m);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, last = 0;
  for (let i = 0; i < m; i++) {
    const w = Math.random() * 2 - 1;
    if (kind === 'white') a[i] = w;
    else if (kind === 'pink') { // Paul Kellet
      b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759;
      b2 = 0.969 * b2 + w * 0.153852; b3 = 0.8665 * b3 + w * 0.3104856;
      b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
      a[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362; b6 = w * 0.115926;
    } else { last = (last + 0.02 * w) / 1.02; a[i] = last; }
  }
  // 去直流 + 归一到 RMS 0.35
  let mean = 0; for (let i = 0; i < m; i++) mean += a[i]; mean /= m;
  let pw = 0; for (let i = 0; i < m; i++) { a[i] -= mean; pw += a[i] * a[i]; }
  const g = 0.35 / Math.sqrt(pw / m);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = a[i] * g;
  // 首尾交叉淡化，循环无缝
  for (let i = 0; i < k; i++) { const x = i / k; out[i] = out[i] * x + a[n + i] * g * (1 - x); }
  return out;
}

function crackleArr(sr, sec) { // 火盆噼啪声（稀疏脉冲）
  const n = Math.floor(sr * sec), d = new Float32Array(n);
  let t = 0.02;
  while (t < sec - 0.05) {
    const len = Math.floor(sr * rnd(0.0008, 0.006)), s = Math.floor(t * sr);
    const amp = Math.pow(Math.random(), 2) * 0.9 + 0.05, pop = Math.random() < 0.3;
    let lp = 0;
    for (let i = 0; i < len && s + i < n; i++) {
      const w = Math.random() * 2 - 1; lp += (pop ? 0.25 : 0.9) * (w - lp);
      d[s + i] += lp * amp * Math.exp(-5 * i / len);
    }
    t += -Math.log(1 - Math.random()) / 22; // 泊松，约 22 次/秒
  }
  return d;
}

function irArr(sr, sec, pre, bright) { // 程序生成的混响 IR（立体声，指数衰减 + 渐暗 + 早期反射）
  const n = Math.floor(sr * sec), out = [];
  for (let ch = 0; ch < 2; ch++) {
    const d = new Float32Array(n); let lp = 0;
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      const a = Math.max(0.03, bright * (1 - 0.85 * t / sec));
      lp += a * ((Math.random() * 2 - 1) - lp);
      d[i] = lp * Math.exp(-6.9 * t / sec) * (t < pre ? t / pre : 1);
    }
    for (let j = 0; j < 10; j++) {
      const idx = Math.floor(sr * (0.004 + Math.random() * 0.07));
      if (idx < n) d[idx] += (Math.random() * 2 - 1) * 0.35 * (1 - j / 10);
    }
    out.push(d);
  }
  return out;
}

const GEN = {
  white: (sr) => [noiseArr(sr, 2, 'white')],
  pink: (sr) => [noiseArr(sr, 2, 'pink')],
  brown: (sr) => [noiseArr(sr, 2, 'brown')],
  crackle: (sr) => [crackleArr(sr, 4)],
  irS: (sr) => irArr(sr, 0.7, 0.004, 0.55),
  irL: (sr) => irArr(sr, 2.6, 0.012, 0.4),
  irM: (sr) => irArr(sr, 5.0, 0.03, 0.3),
};
function data(sr, key) {
  let m = DATA.get(sr);
  if (!m) { m = {}; DATA.set(sr, m); }
  return m[key] || (m[key] = GEN[key](sr));
}

// 安全软削波曲线：输入先乘 0.5，所以曲线索引 x∈[-1,1] 对应真实输入 u=2x
const SAFETY_CURVE = (() => {
  const n = 4097, c = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const u = (i / (n - 1) * 2 - 1) * 2, a = Math.abs(u);
    c[i] = Math.sign(u) * (a < 0.8 ? a : 0.8 + 0.19 * Math.tanh((a - 0.8) / 0.19));
  }
  return c;
})();

const CURVES = new Map();
function curve(k) { // tanh 软失真，峰值归一
  let c = CURVES.get(k);
  if (!c) {
    c = new Float32Array(2048); const tk = Math.tanh(k);
    for (let i = 0; i < 2048; i++) { const x = i / 1023.5 - 1; c[i] = Math.tanh(k * x) / tk; }
    CURVES.set(k, c);
  }
  return c;
}

// ---------------------------------------------------------------------------
// 引擎（每个 AudioContext 一个；实时与离线测试共用）
// ---------------------------------------------------------------------------
const vols = { master: 0.85, sfx: 1, music: 0.7 };
const L = { x: 0, y: 0, z: 0, yaw: 0 };

function G(c, v = 1) { const g = c.createGain(); g.gain.value = v; return g; }

function createEngine(c, dest, opt = {}) {
  const E = { c, bufs: {}, revs: {}, L: opt.L || L };
  E.master = G(c, vols.master);
  if (opt.raw) E.master.connect(dest);
  else {
    const k = c.createDynamicsCompressor();
    // 单个声音基本不压，多个叠加时接近限幅
    k.threshold.value = -6; k.knee.value = 6; k.ratio.value = 8;
    k.attack.value = 0.002; k.release.value = 0.2;
    // 压缩器之后再加安全软削波：|x|<0.8 完全线性，以上平滑趋近 0.99（大量叠加时防止瞬态越过压缩器的起音）
    const pre = G(c, 0.5), clip = c.createWaveShaper(); clip.curve = SAFETY_CURVE; clip.oversample = 'none'; // 过采样的重建滤波会过冲，这里要严格 <1
    E.master.connect(k); k.connect(pre); pre.connect(clip); clip.connect(dest); E.comp = k;
  }
  E.sfx = G(c, vols.sfx); E.sfx.connect(E.master);
  E.mus = G(c, vols.music); E.mus.connect(E.master);
  return E;
}
function getBuf(E, key) {
  let b = E.bufs[key];
  if (!b) {
    const arr = data(E.c.sampleRate, key);
    b = E.c.createBuffer(arr.length, arr[0].length, E.c.sampleRate);
    arr.forEach((a, i) => b.copyToChannel(a, i));
    E.bufs[key] = b;
  }
  return b;
}
function getRev(E, kind) { // 'S' 短 / 'L' 长 / 'M' 音乐
  let r = E.revs[kind];
  if (!r) {
    r = E.c.createConvolver(); r.buffer = getBuf(E, 'ir' + kind);
    r.connect(kind === 'M' ? E.mus : E.sfx);
    E.revs[kind] = r;
  }
  return r;
}

function posOf(p) { return Array.isArray(p) ? p : [p.x || 0, p.y || 0, p.z || 0]; }
function setPannerPos(pn, x, y, z) {
  if (pn.positionX) { pn.positionX.value = x; pn.positionY.value = y; pn.positionZ.value = z; }
  else pn.setPosition(x, y, z);
}
function makePanner(c, p) {
  const pn = c.createPanner();
  pn.panningModel = 'HRTF'; pn.distanceModel = 'inverse';
  pn.refDistance = PAN.refDistance; pn.rolloffFactor = PAN.rolloffFactor; pn.maxDistance = PAN.maxDistance;
  const [x, y, z] = posOf(p); setPannerPos(pn, x, y, z);
  return pn;
}
function distGain(E, p) { // 与 inverse 模型一致，用于缩放混响发送（远处相对更湿）
  const [x, y, z] = posOf(p);
  const d = Math.min(PAN.maxDistance, Math.max(PAN.refDistance, Math.hypot(x - E.L.x, y - E.L.y, z - E.L.z)));
  return PAN.refDistance / (PAN.refDistance + PAN.rolloffFactor * (d - PAN.refDistance));
}
function applyListener(c, x, y, z, yaw) {
  const l = c.listener, fx = Math.sin(yaw), fz = Math.cos(yaw);
  if (l.positionX) {
    l.positionX.value = x; l.positionY.value = y; l.positionZ.value = z;
    l.forwardX.value = fx; l.forwardY.value = 0; l.forwardZ.value = fz;
    l.upX.value = 0; l.upY.value = 1; l.upZ.value = 0;
  } else { l.setPosition(x, y, z); l.setOrientation(fx, 0, fz, 0, 1, 0); }
}

// ---------------------------------------------------------------------------
// 合成积木。S = { c, E, out, t, r(音高倍率), src(循环时收集可停止的源) }
// ---------------------------------------------------------------------------
function track(S, n) { if (S.src) S.src.push(n); return n; }
function noiseSrc(S, kind, t, dur) {
  const n = S.c.createBufferSource();
  n.buffer = getBuf(S.E, kind); n.loop = true;
  n.start(t, Math.random() * 1.8);
  if (dur != null) n.stop(t + dur + 0.05);
  return track(S, n);
}
function osc(S, type, f, t, dur) {
  const o = S.c.createOscillator(); o.type = type; o.frequency.setValueAtTime(f, t);
  o.start(t); if (dur != null) o.stop(t + dur + 0.05);
  return track(S, o);
}
function bq(S, type, f, q = 0.7) {
  const b = S.c.createBiquadFilter(); b.type = type;
  b.frequency.value = Math.min(f, S.c.sampleRate * 0.45); b.Q.value = q; return b;
}
function ramp(p, t, v0, v1, dur, v2, dur2) { // 指数扫频
  p.setValueAtTime(v0, t); p.exponentialRampToValueAtTime(v1, t + dur);
  if (v2) p.exponentialRampToValueAtTime(v2, t + dur + dur2);
}
function envG(S, t, a, peak, d, hold = 0) { // 线性起音 → 保持 → 指数衰减
  const g = S.c.createGain(), p = g.gain;
  p.setValueAtTime(0, t); p.linearRampToValueAtTime(peak, t + a);
  if (hold) p.setValueAtTime(peak, t + a + hold);
  p.exponentialRampToValueAtTime(1e-4, t + a + hold + d);
  p.setValueAtTime(0, t + a + hold + d + 0.001);
  return g;
}
function shaper(S, k) { const w = S.c.createWaveShaper(); w.curve = curve(k); return w; }
// 滤波后噪声的能量补偿（让 vol≈带内 RMS 0.35 的倍数，便于直觉调参）
function ncomp(S, kind, type, f, q) {
  const ny = S.c.sampleRate / 2; let fr;
  if (kind === 'white') fr = type === 'lowpass' ? f / ny : type === 'highpass' ? 1 - f / ny : (f / q) / ny;
  else if (kind === 'pink') {
    const o = Math.log2(Math.max(f, 21) / 20) / 10;
    fr = type === 'lowpass' ? o : type === 'highpass' ? 1 - o : (1.4 / q) / 10;
  } else fr = type === 'lowpass' ? 1 - 20 / Math.max(f, 21) : type === 'highpass' ? 20 / f : 20 * 0.7 / (f * q) + 0.001;
  return Math.min(6, 1 / Math.sqrt(Math.max(0.02, Math.min(1, fr))));
}
function dt(S, o) { return S.t + (o.dt || 0); }

// 风声：带通噪声，指数起落，中心频率扫动
function whoosh(S, o) {
  const t = dt(S, o), r = S.r, dur = o.dur, kind = o.kind || 'white', type = o.type || 'bandpass', q = o.q ?? 1;
  const n = noiseSrc(S, kind, t, dur);
  const f = bq(S, type, o.f0 * r, q), pk = o.peakAt ?? 0.4;
  ramp(f.frequency, t, o.f0 * r, o.f1 * r, dur * pk, o.f2 ? o.f2 * r : 0, dur * (1 - pk));
  const g = S.c.createGain(), vol = o.vol * ncomp(S, kind, type, (o.f0 + o.f1) * 0.5 * r, q);
  g.gain.setValueAtTime(vol * 0.01, t); g.gain.exponentialRampToValueAtTime(vol, t + dur * pk);
  g.gain.exponentialRampToValueAtTime(1e-4, t + dur); g.gain.setValueAtTime(0, t + dur + 0.001);
  n.connect(f); f.connect(g); g.connect(o.to || S.out);
}
// 噪声爆发：滤波 → 包络 → [失真]
function burst(S, o) {
  const t = dt(S, o), r = S.r, kind = o.kind || 'white', type = o.type || 'lowpass', q = o.q ?? 0.7, a = o.a ?? 0.0008;
  const n = noiseSrc(S, kind, t, a + (o.hold || 0) + o.dur);
  const f = bq(S, type, o.f * r, q);
  if (o.f1) ramp(f.frequency, t, o.f * r, o.f1 * r, a + (o.hold || 0) + o.dur);
  // 有失真时：包络峰值 = 驱动量，失真后再乘 vol（输出电平与失真程度解耦）
  const pk = (o.dist ? (o.drive ?? 1.2) : o.vol) * ncomp(S, kind, type, o.f * r, q);
  const g = envG(S, t, a, pk, o.dur, o.hold || 0);
  n.connect(f); f.connect(g);
  if (o.dist) { const w = shaper(S, o.dist), pg = G(S.c, o.vol); g.connect(w); w.connect(pg); pg.connect(o.to || S.out); }
  else g.connect(o.to || S.out);
}
// 冲击：正弦快速下扫（踢鼓式）
function thump(S, o) {
  const t = dt(S, o), r = S.r, dur = o.dur;
  const s = osc(S, o.type || 'sine', o.f0 * r, t, dur + 0.01);
  s.frequency.exponentialRampToValueAtTime(o.f1 * r, t + (o.sweep ?? dur * 0.4));
  const g = envG(S, t, o.a ?? 0.001, o.dist ? (o.drive ?? 1) : o.vol, dur);
  s.connect(g);
  if (o.dist) { const w = shaper(S, o.dist), pg = G(S.c, o.vol); g.connect(w); w.connect(pg); pg.connect(o.to || S.out); }
  else g.connect(o.to || S.out);
}
// 模态合成：若干非谐正弦分音，各自衰减（金属、铃、骨头）
function modal(S, o) {
  const t = dt(S, o), r = S.r, fs = o.freqs;
  for (let i = 0; i < fs.length; i++) {
    const d = Array.isArray(o.decays) ? o.decays[i] : (o.decays ?? 0.3) / (1 + i * 0.4);
    const amp = (o.amps ? o.amps[i] : 1 / (1 + i * 0.8)) * o.vol;
    const f = fs[i] * r * (o.jit ? rv(1, o.jit) : 1);
    if (f > S.c.sampleRate * 0.45) continue;
    const s = osc(S, o.type || 'sine', f, t, (o.a ?? 0.0005) + d);
    const g = envG(S, t, o.a ?? 0.0005, amp, d);
    s.connect(g); g.connect(o.to || S.out);
  }
}
// 音调：振荡器（可多个失谐）→ [滤波] → 包络，可扫频/颤音
function tone(S, o) {
  const t = dt(S, o), r = S.r, a = o.a ?? 0.005, hold = o.hold || 0, dur = o.dur;
  const total = a + hold + dur, g = envG(S, t, a, o.vol, dur, hold);
  let dst = g;
  if (o.lp || o.filter) {
    const fo = o.filter || { type: 'lowpass', f: o.lp, q: 0.7 };
    const f = bq(S, fo.type, fo.f * r, fo.q ?? 0.7);
    if (fo.f1) ramp(f.frequency, t, fo.f * r, fo.f1 * r, fo.sweep ?? total, fo.f2 ? fo.f2 * r : 0, fo.sweep2 ?? 0.1);
    f.connect(g); dst = f;
  }
  let pre = dst;
  if (o.dist) { const w = shaper(S, o.dist); w.connect(dst); pre = w; }
  const dets = o.detune || [0];
  let vib = null;
  if (o.vib) {
    vib = osc(S, 'sine', o.vib[0], t, total);
    const vg = G(S.c, o.vib[1] * o.f * r); vib.connect(vg); vib._g = vg;
  }
  for (const det of dets) {
    const s = osc(S, o.type || 'sine', o.f * r, t, total);
    s.detune.value = det;
    if (o.f1) ramp(s.frequency, t, o.f * r, o.f1 * r, o.sweep ?? total, o.f2 ? o.f2 * r : 0, o.sweep2 ?? 0.1);
    if (vib) vib._g.connect(s.frequency);
    s.connect(pre);
  }
  g.connect(o.to || S.out);
  return g;
}
function grains(n, span, fn, skew = 1) { for (let i = 0; i < n; i++) fn(span * Math.pow(Math.random(), skew), i); }
function metalClick(S, d, vol, fs = [2400, 3900]) { // 机械咔嗒
  burst(S, { dt: d, type: 'highpass', f: 3000, dur: 0.007, vol: vol });
  modal(S, { dt: d, freqs: fs, decays: 0.04, vol: vol * 0.35, jit: 0.04 });
}

// ---------------------------------------------------------------------------
// 声音表：d=名义时长(s)，rs/rl=短/长混响发送量，g=电平微调，fn(S)
// ---------------------------------------------------------------------------
const SFX = {
  // ---- 近战 ----
  swing_light: { d: 0.26, rs: 0.04, fn(S) {
    whoosh(S, { dur: rv(0.2, 0.1), f0: 1300, f1: 3400, f2: 1700, q: 1.3, vol: 0.45, peakAt: 0.35 });
    whoosh(S, { dur: 0.13, f0: 4500, f1: 7000, q: 2, vol: 0.14, peakAt: 0.45 });
  } },
  swing_heavy: { d: 0.58, rs: 0.06, fn(S) {
    whoosh(S, { kind: 'pink', dur: rv(0.52, 0.08), f0: 220, f1: 650, f2: 260, q: 0.9, vol: 0.8, peakAt: 0.45 });
    whoosh(S, { dur: 0.42, f0: 800, f1: 1500, f2: 600, q: 1.6, vol: 0.22, peakAt: 0.5 });
    tone(S, { f: 62, f1: 48, a: 0.22, dur: 0.3, vol: 0.28 });
  } },
  thrust: { d: 0.26, rs: 0.04, fn(S) {
    whoosh(S, { dur: 0.15, f0: 800, f1: 3800, q: 1.5, vol: 0.6, peakAt: 0.75 });
    whoosh(S, { kind: 'pink', dur: 0.12, f0: 300, f1: 900, q: 1, vol: 0.3, peakAt: 0.7 });
    modal(S, { dt: 0.12, freqs: [3300, 5200], decays: 0.05, vol: 0.14, jit: 0.05 });
  } },
  punch: { d: 0.2, fn(S) {
    whoosh(S, { dur: 0.12, f0: 450, f1: 1300, f2: 600, q: 1, vol: 0.6, peakAt: 0.55 });
    thump(S, { dt: 0.07, f0: 150, f1: 80, dur: 0.08, vol: 0.28 });
  } },
  hit_flesh: { d: 0.26, g: 0.85, rs: 0.1, fn(S) {
    thump(S, { f0: rv(180, 0.08), f1: 55, dur: 0.16, sweep: 0.06, vol: 0.5, dist: 1.5 });
    burst(S, { kind: 'pink', type: 'lowpass', f: rv(700, 0.1), dur: 0.07, vol: 0.36 });
    burst(S, { type: 'highpass', f: rv(2800, 0.1), dur: 0.06, vol: 0.6 });
    burst(S, { type: 'bandpass', f: rv(1400, 0.15), q: 2, dur: 0.08, vol: 0.4 });
  } },
  hit_heavy: { d: 0.6, g: 0.85, rs: 0.4, fn(S) {
    thump(S, { f0: 120, f1: 34, dur: 0.45, sweep: 0.15, vol: 0.48, dist: 2.5, drive: 1.3 });
    thump(S, { dt: 0.008, f0: 70, f1: 40, dur: 0.3, vol: 0.25 });
    burst(S, { kind: 'pink', type: 'lowpass', f: 1200, f1: 200, dur: 0.2, vol: 0.4 });
    burst(S, { type: 'highpass', f: 2000, dur: 0.06, vol: 0.3, dist: 3 });
  } },
  hit_metal: { d: 0.5, g: 0.85, rs: 0.15, fn(S) {
    modal(S, { freqs: [587, 1523, 2861, 4410, 6200], decays: [0.35, 0.28, 0.2, 0.14, 0.08], amps: [0.5, 0.4, 0.3, 0.2, 0.12], vol: 0.45, jit: 0.04 });
    burst(S, { type: 'highpass', f: 3000, dur: 0.02, vol: 0.45 });
    thump(S, { f0: 210, f1: 90, dur: 0.07, vol: 0.35 });
  } },
  block: { d: 0.55, g: 0.85, rs: 0.2, fn(S) {
    modal(S, { freqs: [412, 1136, 2078, 3350, 4900], decays: [0.42, 0.3, 0.22, 0.15, 0.1], amps: [0.55, 0.45, 0.3, 0.2, 0.1], vol: 0.42, jit: 0.03 });
    burst(S, { type: 'bandpass', f: 2500, q: 1.5, dur: 0.06, vol: 0.4 });
    thump(S, { f0: 150, f1: 70, dur: 0.1, vol: 0.4 });
  } },
  parry: { d: 1.7, rl: 0.32, fn(S) {
    burst(S, { type: 'highpass', f: 5000, dur: 0.01, vol: 0.3 });
    const b = 1568;
    modal(S, { freqs: [b, b * 1.0045, b * 2.01, b * 2.76, b * 5.4], decays: [1.5, 1.5, 0.9, 0.55, 0.22], amps: [0.4, 0.25, 0.18, 0.12, 0.06], vol: 0.55 });
    modal(S, { dt: 0.015, freqs: [2349], decays: 0.9, vol: 0.1 });
  } },
  guard_break: { d: 0.65, g: 0.9, rs: 0.3, fn(S) {
    modal(S, { freqs: [310, 845, 1590, 2600], decays: 0.3, vol: 0.3, jit: 0.05 });
    thump(S, { f0: 110, f1: 40, dur: 0.3, vol: 0.4, dist: 2 });
    grains(8, 0.16, (d) => burst(S, { dt: d, type: 'bandpass', f: rnd(1200, 3500), q: 3, dur: rnd(0.03, 0.07), vol: rnd(0.08, 0.16), dist: 3 }));
    tone(S, { type: 'square', f: 420, f1: 110, dur: 0.35, vol: 0.12, lp: 1500 });
  } },

  // ---- 身法 ----
  dash: { d: 0.42, fn(S) {
    whoosh(S, { kind: 'pink', dur: rv(0.34, 0.08), f0: 400, f1: 2200, f2: 700, q: 0.8, vol: 0.7, peakAt: 0.3 });
    whoosh(S, { dur: 0.2, f0: 2500, f1: 5000, q: 1, vol: 0.15, peakAt: 0.4 });
  } },
  jump: { d: 0.26, fn(S) {
    whoosh(S, { dur: 0.2, f0: 350, f1: 1100, q: 0.9, vol: 0.3, peakAt: 0.5 });
    burst(S, { type: 'bandpass', f: 3000, q: 1, dur: 0.05, vol: 0.12 });
    burst(S, { type: 'lowpass', f: 1200, dur: 0.04, vol: 0.22 });
  } },
  land: { d: 0.26, fn(S) {
    thump(S, { f0: 95, f1: 45, dur: 0.16, vol: 0.55 });
    burst(S, { kind: 'pink', type: 'lowpass', f: 700, dur: 0.09, vol: 0.45 });
    grains(4, 0.06, (d) => burst(S, { dt: d, type: 'highpass', f: 3500, dur: 0.008, vol: 0.08 }));
  } },
  footstep: { d: 0.16, fn(S) {
    thump(S, { f0: rv(110, 0.15), f1: 60, dur: rv(0.07, 0.2), vol: 0.3 });
    burst(S, { type: 'lowpass', f: rv(1100, 0.3), dur: rv(0.06, 0.3), vol: 0.35 });
    burst(S, { dt: rv(0.025, 0.4), type: 'bandpass', f: rv(2500, 0.3), q: 1.5, dur: 0.03, vol: rv(0.1, 0.5) });
  } },
  launch: { d: 0.52, rs: 0.1, fn(S) {
    thump(S, { f0: 130, f1: 60, dur: 0.12, vol: 0.45 });
    whoosh(S, { kind: 'pink', dur: 0.45, f0: 300, f1: 2600, q: 1.1, vol: 0.55, peakAt: 0.6 });
    tone(S, { type: 'sawtooth', f: 160, f1: 640, a: 0.05, dur: 0.4, vol: 0.1, lp: 1200 });
  } },
  knockdown: { d: 0.46, g: 0.8, rs: 0.2, fn(S) {
    thump(S, { f0: 85, f1: 38, dur: 0.3, vol: 0.6, dist: 1.8 });
    burst(S, { kind: 'pink', type: 'lowpass', f: 500, dur: 0.18, vol: 0.55 });
    thump(S, { dt: 0.14, f0: 70, f1: 40, dur: 0.15, vol: 0.35 });
    burst(S, { dt: 0.14, type: 'lowpass', f: 800, dur: 0.08, vol: 0.2 });
    burst(S, { type: 'bandpass', f: 2000, dur: 0.1, vol: 0.1 });
  } },
  tech: { d: 0.36, rs: 0.1, fn(S) {
    burst(S, { type: 'bandpass', f: 2600, q: 0.8, dur: 0.06, vol: 0.2 });
    burst(S, { dt: 0.04, type: 'bandpass', f: 2200, q: 0.8, dur: 0.05, vol: 0.15 });
    whoosh(S, { dur: 0.15, f0: 600, f1: 1800, q: 1, vol: 0.25, peakAt: 0.5 });
    tone(S, { dt: 0.02, f: 1319, dur: 0.12, vol: 0.14 });
    tone(S, { dt: 0.08, f: 1976, dur: 0.2, vol: 0.14 });
  } },
  getup: { d: 0.42, fn(S) {
    burst(S, { type: 'bandpass', f: 1800, q: 0.8, dur: 0.08, a: 0.01, vol: 0.15 });
    burst(S, { dt: 0.12, type: 'bandpass', f: 2500, q: 0.8, dur: 0.08, a: 0.01, vol: 0.13 });
    whoosh(S, { dt: 0.1, dur: 0.25, f0: 300, f1: 900, q: 0.9, vol: 0.2 });
    burst(S, { dt: 0.22, type: 'lowpass', f: 900, dur: 0.06, vol: 0.28 });
  } },

  // ---- 枪械 ----
  gun_shot: { d: 0.4, rs: 0.3, fn(S) {
    burst(S, { type: 'highpass', f: 1200, dur: 0.08, a: 0.0003, vol: 0.35, dist: 4 });
    thump(S, { f0: 200, f1: 60, dur: 0.09, vol: 0.4 });
    burst(S, { type: 'bandpass', f: 900, q: 0.8, dur: 0.14, vol: 0.5 });
    modal(S, { freqs: [2800, 4200], decays: 0.03, vol: 0.1 });
  } },
  rifle_shot: { d: 0.7, g: 0.9, rl: 0.25, fn(S) {
    burst(S, { type: 'highpass', f: 2500, dur: 0.03, a: 0.0002, vol: 0.4 });
    burst(S, { type: 'highpass', f: 800, dur: 0.14, a: 0.0003, vol: 0.45, dist: 5 });
    thump(S, { f0: 150, f1: 45, dur: 0.15, vol: 0.5 });
    burst(S, { dt: 0.02, kind: 'pink', type: 'lowpass', f: 1500, dur: 0.5, a: 0.005, vol: 0.18 });
  } },
  cannon: { d: 1.8, g: 0.88, rl: 0.4, fn(S) {
    thump(S, { f0: 70, f1: 24, dur: 1.0, sweep: 0.3, vol: 0.5, dist: 3, drive: 1.4 });
    burst(S, { kind: 'pink', type: 'lowpass', f: 1800, f1: 150, dur: 0.8, vol: 0.35 });
    burst(S, { type: 'highpass', f: 1500, dur: 0.08, vol: 0.3, dist: 3 });
    burst(S, { kind: 'brown', type: 'lowpass', f: 200, dur: 1.5, a: 0.05, vol: 0.25 });
  } },
  explosion: { d: 2.3, rl: 0.45, fn(S) {
    burst(S, { kind: 'pink', type: 'lowpass', f: 4000, f1: 180, dur: 1.3, a: 0.003, vol: 0.4, dist: 2, drive: 1.5 });
    thump(S, { f0: 80, f1: 28, dur: 0.8, vol: 0.5 });
    grains(14, 1.2, (d) => burst(S, { dt: d, type: Math.random() < 0.5 ? 'highpass' : 'bandpass', f: rnd(1500, 5000), q: 2, dur: rnd(0.01, 0.03), vol: rnd(0.05, 0.15) }), 2);
    burst(S, { kind: 'brown', type: 'lowpass', f: 150, dur: 2.0, a: 0.1, vol: 0.3 });
  } },
  reload: { d: 0.5, rs: 0.1, fn(S) {
    metalClick(S, 0, 0.35);
    burst(S, { dt: 0.07, type: 'bandpass', f: 1500, f1: 2400, q: 2, dur: 0.12, a: 0.03, vol: 0.18 });
    metalClick(S, 0.28, 0.45, [1700, 2900, 4300]);
    thump(S, { dt: 0.28, f0: 250, f1: 120, dur: 0.04, vol: 0.25 });
    metalClick(S, 0.36, 0.2);
  } },
  shell_drop: { d: 0.5, fn(S) {
    [[0, 1], [0.12, 0.6], [0.21, 0.4], [0.27, 0.25], [0.31, 0.15]].forEach(([d, a]) =>
      modal(S, { dt: d, freqs: [4100, 6300, 8900], decays: [0.12, 0.08, 0.05], vol: 0.14 * a, jit: 0.03 }));
  } },

  // ---- 法术 ----
  magic_cast: { d: 0.95, rl: 0.35, fn(S) {
    const g = S.c.createGain(); g.gain.value = 0.6;
    const lfo = osc(S, 'sine', 9, S.t, 0.9), lg = G(S.c, 0.4); lfo.connect(lg); lg.connect(g.gain);
    g.connect(S.out);
    [440, 554.4, 659.3].forEach((f, i) => tone(S, { type: i ? 'sine' : 'triangle', f: f * 0.85, f1: f * 1.05, sweep: 0.6, a: 0.25, dur: 0.55, vol: 0.12, to: g }));
    burst(S, { type: 'highpass', f: 4000, dur: 0.5, a: 0.3, vol: 0.08 });
    tone(S, { f: 110, a: 0.3, dur: 0.5, vol: 0.15 });
  } },
  magic_bolt: { d: 0.42, rs: 0.15, fn(S) {
    tone(S, { type: 'sawtooth', f: 1200, f1: 250, sweep: 0.25, dur: 0.3, vol: 0.2, filter: { type: 'bandpass', f: 1500, q: 3 } });
    tone(S, { f: 700, f1: 400, dur: 0.25, vol: 0.14, vib: [60, 0.4] });
    whoosh(S, { dur: 0.25, f0: 2000, f1: 600, q: 1.2, vol: 0.3, peakAt: 0.2 });
  } },
  fire: { d: 0.85, rs: 0.1, fn(S) {
    burst(S, { kind: 'pink', type: 'lowpass', f: 400, f1: 2500, dur: 0.7, a: 0.08, vol: 0.55 });
    burst(S, { kind: 'brown', type: 'lowpass', f: 300, dur: 0.6, a: 0.05, vol: 0.35 });
    grains(10, 0.7, (d) => burst(S, { dt: d, type: 'highpass', f: 2500, dur: 0.006, vol: rnd(0.08, 0.2) }));
  } },
  ice: { d: 0.95, rl: 0.3, fn(S) {
    burst(S, { type: 'highpass', f: 3000, dur: 0.02, vol: 0.35 });
    burst(S, { type: 'bandpass', f: 1800, q: 4, dur: 0.05, vol: 0.2 });
    grains(7, 0.6, (d) => modal(S, { dt: d, freqs: [rnd(2500, 5500)], decays: rnd(0.15, 0.3), vol: rnd(0.08, 0.14) }), 1.3);
    burst(S, { type: 'highpass', f: 6000, dur: 0.6, a: 0.05, vol: 0.06 });
  } },
  thunder: { d: 1.7, rl: 0.4, fn(S) {
    burst(S, { type: 'highpass', f: 1800, dur: 0.08, a: 0.0002, vol: 0.5, dist: 6 });
    const t = S.t, o = osc(S, 'sawtooth', 90, t, 0.4);
    for (let k = 0; k < 26; k++) o.frequency.setValueAtTime(rnd(55, 170) * S.r, t + k * 0.015);
    const f = bq(S, 'bandpass', 1200, 0.7), g = envG(S, t, 0.002, 0.25, 0.35);
    o.connect(f); f.connect(g); g.connect(S.out);
    grains(5, 0.25, (d) => burst(S, { dt: d, type: 'highpass', f: 4000, dur: 0.015, vol: 0.2 }));
    burst(S, { dt: 0.05, kind: 'brown', type: 'lowpass', f: 180, dur: 1.4, a: 0.1, vol: 0.6 });
  } },
  dark: { d: 1.15, rl: 0.3, fn(S) {
    tone(S, { type: 'sawtooth', f: 55, detune: [0, 25, 702], a: 0.35, hold: 0.1, dur: 0.5, vol: 0.14, filter: { type: 'lowpass', f: 200, f1: 900, sweep: 0.45, f2: 200, sweep2: 0.5 } });
    burst(S, { kind: 'pink', type: 'bandpass', f: 900, q: 5, a: 0.3, dur: 0.6, vol: 0.18 });
    burst(S, { kind: 'pink', type: 'bandpass', f: 2400, q: 6, a: 0.35, dur: 0.5, vol: 0.12 });
    tone(S, { f: 330, f1: 165, a: 0.2, dur: 0.7, vol: 0.08, vib: [5, 0.02] });
  } },
  holy: { d: 1.9, rl: 0.5, fn(S) {
    modal(S, { freqs: [880, 1108.7, 1318.5, 1760], decays: [1.6, 1.4, 1.3, 1.0], amps: [1, 1, 1, 0.8], vol: 0.12, a: 0.02 });
    tone(S, { type: 'sawtooth', f: 440, detune: [-8, 8], a: 0.2, dur: 1.0, vol: 0.05, lp: 1800 });
    tone(S, { type: 'sawtooth', f: 554.4, detune: [-8, 8], a: 0.2, dur: 1.0, vol: 0.04, lp: 1800 });
    tone(S, { type: 'sawtooth', f: 659.3, detune: [-8, 8], a: 0.2, dur: 1.0, vol: 0.04, lp: 1800 });
    burst(S, { type: 'highpass', f: 7000, dur: 0.8, a: 0.3, vol: 0.04 });
  } },
  heal: { d: 1.2, rl: 0.4, fn(S) {
    [72, 76, 79, 84, 88].forEach((m, i) => {
      tone(S, { dt: i * 0.07, f: mtof(m), dur: 0.5, vol: 0.11 });
      tone(S, { dt: i * 0.07, f: mtof(m) * 2, dur: 0.2, vol: 0.03 });
    });
    tone(S, { f: 523.3, a: 0.2, dur: 0.6, vol: 0.08 });
    burst(S, { type: 'highpass', f: 6000, a: 0.2, dur: 0.5, vol: 0.04 });
  } },
  summon: { d: 1.5, rl: 0.4, fn(S) {
    tone(S, { type: 'sawtooth', f: 70, f1: 140, sweep: 0.9, detune: [-10, 10], a: 0.6, dur: 0.5, vol: 0.18, filter: { type: 'lowpass', f: 200, f1: 1500, sweep: 0.9 } });
    [74, 77, 79, 81, 84, 86].forEach((m, i) => tone(S, { dt: 0.1 + i * 0.11, f: mtof(m), dur: 0.35, vol: 0.06 }));
    thump(S, { dt: 0.9, f0: 90, f1: 40, dur: 0.4, vol: 0.55 });
    burst(S, { dt: 0.9, kind: 'pink', type: 'lowpass', f: 600, dur: 0.25, vol: 0.3 });
  } },
  shadow_step: { d: 0.45, rs: 0.2, fn(S) {
    const t = S.t, n = noiseSrc(S, 'white', t, 0.3), f = bq(S, 'bandpass', 3000 * S.r, 1.2);
    ramp(f.frequency, t, 3000 * S.r, 800 * S.r, 0.24);
    const g = S.c.createGain(), v = 0.45 * ncomp(S, 'white', 'bandpass', 1800, 1.2);
    g.gain.setValueAtTime(v * 0.01, t); g.gain.exponentialRampToValueAtTime(v, t + 0.22);
    g.gain.linearRampToValueAtTime(0, t + 0.245);
    n.connect(f); f.connect(g); g.connect(S.out);
    tone(S, { f: 1400, f1: 180, sweep: 0.25, a: 0.02, dur: 0.24, vol: 0.14, lp: 3000 });
    tone(S, { dt: 0.22, f: 90, dur: 0.2, vol: 0.18 });
  } },

  // ---- 千机伞 ----
  form_switch: { d: 0.55, rs: 0.1, fn(S) {
    [0, 0.045, 0.13].forEach((d) => metalClick(S, d, 0.35, [1900 * rv(1, 0.05), 3200, 5100]));
    tone(S, { dt: 0.05, type: 'square', f: 700, f1: 1500, dur: 0.12, vol: 0.05, lp: 2500 });
    whoosh(S, { dt: 0.12, dur: 0.18, f0: 600, f1: 2000, q: 1, vol: 0.25, peakAt: 0.5 });
    thump(S, { dt: 0.3, f0: 180, f1: 90, dur: 0.06, vol: 0.35 });
    burst(S, { dt: 0.3, type: 'highpass', f: 1800, dur: 0.012, vol: 0.45 });
    modal(S, { dt: 0.3, freqs: [1200, 2650, 4100], decays: 0.12, vol: 0.18 });
  } },
  umbrella_open: { d: 0.32, fn(S) {
    burst(S, { kind: 'pink', type: 'bandpass', f: 500, f1: 180, q: 0.9, dur: 0.16, a: 0.004, vol: 0.7 });
    thump(S, { f0: 120, f1: 60, dur: 0.12, vol: 0.4 });
    burst(S, { dt: 0.05, type: 'bandpass', f: 1500, dur: 0.05, vol: 0.15 });
    modal(S, { freqs: [3000, 4500], decays: 0.03, vol: 0.05 });
  } },
  shield_up: { d: 0.5, g: 0.9, rs: 0.2, fn(S) {
    modal(S, { freqs: [360, 980, 1800, 2900], decays: [0.35, 0.25, 0.15, 0.1], vol: 0.3, jit: 0.03 });
    thump(S, { f0: 140, f1: 70, dur: 0.1, vol: 0.35 });
    burst(S, { dt: 0.01, kind: 'pink', type: 'bandpass', f: 400, dur: 0.1, vol: 0.35 });
    burst(S, { type: 'highpass', f: 2500, dur: 0.01, vol: 0.3 });
  } },

  // ---- Boss / 怪物 ----
  boss_roar: { d: 1.9, rl: 0.3, fn(S) {
    const c = S.c, t = S.t, r = S.r;
    const env = envG(S, t, 0.25, 0.5, 0.6, 0.7), mix = G(c, 0.4), ws = shaper(S, 4);
    const am = osc(S, 'sine', 28, t, 1.6), amg = G(c, 0.35); am.connect(amg); amg.connect(mix.gain);
    const vib = osc(S, 'sine', 6, t, 1.6), vibg = G(c, 3 * r); vib.connect(vibg);
    [['sawtooth', 62], ['sawtooth', 63.5], ['square', 93]].forEach(([ty, f]) => {
      const o = osc(S, ty, f * r, t, 1.6);
      o.frequency.linearRampToValueAtTime(f * 1.2 * r, t + 0.4); o.frequency.linearRampToValueAtTime(f * 0.88 * r, t + 1.55);
      vibg.connect(o.frequency); o.connect(mix);
    });
    mix.connect(ws);
    const f1 = bq(S, 'bandpass', 650 * r, 3), f2 = bq(S, 'bandpass', 1100 * r, 4), f3 = bq(S, 'lowpass', 400 * r, 0.7);
    ramp(f1.frequency, t, 500 * r, 750 * r, 0.5, 450 * r, 1.0);
    const g1 = G(c, 1.6), g2 = G(c, 0.9), g3 = G(c, 0.6);
    ws.connect(f1); ws.connect(f2); ws.connect(f3); f1.connect(g1); f2.connect(g2); f3.connect(g3);
    g1.connect(env); g2.connect(env); g3.connect(env); env.connect(S.out);
    burst(S, { kind: 'pink', type: 'bandpass', f: 900, q: 1, a: 0.25, hold: 0.7, dur: 0.6, vol: 0.2 });
  } },
  boss_warn: { d: 1.1, rs: 0.1, fn(S) {
    const g = G(S.c, 0.6), lfo = osc(S, 'square', 14, S.t, 1.0), lg = G(S.c, 0.4);
    lfo.connect(lg); lg.connect(g.gain); g.connect(S.out);
    tone(S, { type: 'square', f: 520, f1: 1560, sweep: 0.9, detune: [0, 17], a: 0.02, hold: 0.7, dur: 0.2, vol: 0.13, filter: { type: 'bandpass', f: 1600, q: 1 }, to: g });
    tone(S, { f: 1040, f1: 3120, sweep: 0.9, a: 0.02, hold: 0.7, dur: 0.2, vol: 0.1, to: g });
  } },
  boss_slam: { d: 1.8, rl: 0.35, fn(S) {
    thump(S, { f0: 60, f1: 22, dur: 1.0, sweep: 0.25, vol: 0.55, dist: 3, drive: 1.4 });
    burst(S, { kind: 'pink', type: 'lowpass', f: 2500, f1: 200, dur: 0.5, vol: 0.35 });
    grains(10, 0.8, (d) => burst(S, { dt: 0.02 + d, type: 'bandpass', f: rnd(800, 3000), q: 2, dur: rnd(0.02, 0.05), vol: rnd(0.05, 0.15) }), 1.8);
    burst(S, { kind: 'brown', type: 'lowpass', f: 120, dur: 1.5, a: 0.05, vol: 0.3 });
  } },
  mob_hit: { d: 0.16, fn(S) {
    thump(S, { f0: 240, f1: 100, dur: 0.08, vol: 0.45 });
    burst(S, { type: 'bandpass', f: 1300, q: 1.5, dur: 0.05, vol: 0.35 });
    burst(S, { type: 'highpass', f: 3500, dur: 0.012, vol: 0.15 });
  } },
  mob_die: { d: 0.8, rs: 0.15, fn(S) {
    tone(S, { type: 'sawtooth', f: 380, f1: 70, sweep: 0.55, dur: 0.55, vol: 0.14, filter: { type: 'lowpass', f: 1400, f1: 300, sweep: 0.55 }, vib: [18, 0.06] });
    burst(S, { kind: 'pink', type: 'lowpass', f: 1500, f1: 300, a: 0.02, dur: 0.3, vol: 0.3 });
    thump(S, { dt: 0.4, f0: 110, f1: 50, dur: 0.15, vol: 0.4 });
  } },
  bone_rattle: { d: 0.55, fn(S) {
    grains(12, 0.45, (d) => {
      modal(S, { dt: d, freqs: [rnd(700, 1800)], decays: rnd(0.02, 0.04), vol: 0.12 });
      burst(S, { dt: d, type: 'bandpass', f: rnd(2000, 4000), q: 5, dur: 0.01, vol: 0.1 });
    });
  } },

  // ---- 界面 ----
  ui_hover: { d: 0.06, fn(S) { tone(S, { f: 2200, a: 0.001, dur: 0.05, vol: 0.12 }); } },
  ui_click: { d: 0.09, fn(S) {
    tone(S, { f: 1600, f1: 900, sweep: 0.03, a: 0.001, dur: 0.05, vol: 0.2 });
    burst(S, { type: 'highpass', f: 4000, dur: 0.005, vol: 0.1 });
  } },
  ui_confirm: { d: 0.32, rs: 0.1, fn(S) {
    tone(S, { type: 'triangle', f: 880, dur: 0.12, vol: 0.18 });
    tone(S, { dt: 0.07, type: 'triangle', f: 1318.5, dur: 0.2, vol: 0.18 });
    tone(S, { dt: 0.07, f: 2637, dur: 0.12, vol: 0.04 });
  } },
  ui_back: { d: 0.26, fn(S) {
    tone(S, { type: 'triangle', f: 784, dur: 0.1, vol: 0.16 });
    tone(S, { dt: 0.06, type: 'triangle', f: 523.3, dur: 0.16, vol: 0.16 });
  } },
  countdown: { d: 0.22, fn(S) {
    tone(S, { type: 'square', f: 880, a: 0.002, hold: 0.08, dur: 0.08, vol: 0.08, lp: 3000 });
    tone(S, { f: 880, a: 0.002, hold: 0.08, dur: 0.08, vol: 0.2 });
  } },
  round_start: { d: 2.6, rl: 0.5, fn(S) {
    const b = 110;
    modal(S, { freqs: [b, b * 1.004, b * 1.52, b * 2.03, b * 2.74, b * 3.37, b * 4.4], decays: [2.4, 2.4, 1.8, 1.4, 1.0, 0.8, 0.6], amps: [0.5, 0.35, 0.35, 0.3, 0.2, 0.15, 0.1], vol: 0.45, a: 0.004 });
    burst(S, { kind: 'pink', type: 'lowpass', f: 800, dur: 0.06, vol: 0.3 });
    [146.8, 220, 293.7].forEach((f) => tone(S, { dt: 0.05, type: 'sawtooth', f, detune: [-6, 6], a: 0.15, hold: 0.5, dur: 0.8, vol: 0.07, filter: { type: 'lowpass', f: 300, f1: 1800, sweep: 0.25, f2: 700, sweep2: 1.0 } }));
  } },
  victory: { d: 1.7, rl: 0.35, fn(S) {
    [72, 76, 79].forEach((m, i) => tone(S, { dt: i * 0.12, type: 'sawtooth', f: mtof(m), detune: [-5, 5], dur: 0.15, vol: 0.08, lp: 2500 }));
    [72, 76, 79, 84].forEach((m) => tone(S, { dt: 0.36, type: 'sawtooth', f: mtof(m), detune: [-6, 6], a: 0.02, hold: 0.45, dur: 0.6, vol: 0.05, lp: 2800 }));
    modal(S, { dt: 0.36, freqs: [mtof(96), mtof(100)], decays: 0.8, vol: 0.05 });
  } },
  defeat: { d: 2.0, rl: 0.35, fn(S) {
    [67, 63, 60].forEach((m, i) => {
      tone(S, { dt: i * 0.25, type: 'triangle', f: mtof(m), dur: 0.35, vol: 0.12 });
      tone(S, { dt: i * 0.25, type: 'sawtooth', f: mtof(m), dur: 0.3, vol: 0.04, lp: 1200 });
    });
    [48, 51, 55].forEach((m) => tone(S, { dt: 0.75, type: 'sawtooth', f: mtof(m), detune: [-5, 5], a: 0.05, dur: 1.0, vol: 0.07, lp: 800 }));
  } },
  levelup: { d: 1.3, rl: 0.4, fn(S) {
    [72, 76, 79, 84, 88, 91].forEach((m, i) => {
      tone(S, { dt: i * 0.05, f: mtof(m), dur: 0.3, vol: 0.1 });
      tone(S, { dt: i * 0.05, type: 'triangle', f: mtof(m), dur: 0.15, vol: 0.04 });
    });
    [84, 88, 91].forEach((m) => tone(S, { dt: 0.3, f: mtof(m), a: 0.01, dur: 0.8, vol: 0.06 }));
    burst(S, { type: 'highpass', f: 6000, a: 0.2, dur: 0.6, vol: 0.05 });
  } },
  combo: { d: 0.22, rs: 0.1, fn(S) {
    tone(S, { f: 1046.5, a: 0.001, dur: 0.15, vol: 0.2 });
    tone(S, { f: 2093, a: 0.001, dur: 0.08, vol: 0.08 });
    tone(S, { type: 'triangle', f: 3140, a: 0.001, dur: 0.02, vol: 0.05 });
  } },
  skill_ready: { d: 0.42, rs: 0.1, fn(S) {
    tone(S, { f: 1568, a: 0.003, dur: 0.25, vol: 0.1 });
    tone(S, { dt: 0.05, f: 2349, a: 0.003, dur: 0.3, vol: 0.09 });
  } },
  no_mana: { d: 0.26, fn(S) {
    [0, 0.1].forEach((d) => {
      tone(S, { dt: d, type: 'square', f: 110, a: 0.003, hold: 0.05, dur: 0.03, vol: 0.12, lp: 600 });
      tone(S, { dt: d, type: 'sawtooth', f: 116, a: 0.003, hold: 0.05, dur: 0.03, vol: 0.06, lp: 600 });
    });
  } },
};

// ---- 循环声（fn 里的源都不设 stop，由 handle.stop 统一停止）----
const LOOPS = {
  fire_loop: { rs: 0.1, fn(S) {
    const c = S.c, t = S.t;
    const b = noiseSrc(S, 'brown', t, null), bf = bq(S, 'lowpass', 500, 0.7), bg = G(c, 0.3);
    b.connect(bf); bf.connect(bg); bg.connect(S.out);
    const k = track(S, c.createBufferSource()); k.buffer = getBuf(S.E, 'crackle'); k.loop = true; k.start(t, Math.random() * 3);
    const kf = bq(S, 'highpass', 1200, 0.7), kg = G(c, 0.5); k.connect(kf); kf.connect(kg); kg.connect(S.out);
    const p = noiseSrc(S, 'pink', t, null), pf = bq(S, 'bandpass', 1200, 0.6), pg = G(c, 0.12);
    const lfo = osc(S, 'sine', 0.3, t, null), lg = G(c, 0.07); lfo.connect(lg); lg.connect(pg.gain);
    p.connect(pf); pf.connect(pg); pg.connect(S.out);
  } },
  wind_loop: { fn(S) {
    const c = S.c, t = S.t;
    const p = noiseSrc(S, 'pink', t, null), f = bq(S, 'bandpass', 600, 0.8), g = G(c, 0.6);
    const l1 = osc(S, 'sine', 0.07, t, null), l1g = G(c, 300), l2 = osc(S, 'sine', 0.19, t, null), l2g = G(c, 150);
    l1.connect(l1g); l1g.connect(f.frequency); l2.connect(l2g); l2g.connect(f.frequency);
    const l3 = osc(S, 'sine', 0.11, t, null), l3g = G(c, 0.3); l3.connect(l3g); l3g.connect(g.gain);
    p.connect(f); f.connect(g); g.connect(S.out);
    const w = noiseSrc(S, 'white', t, null), wf = bq(S, 'bandpass', 1800, 8), wg = G(c, 0.25);
    const l4 = osc(S, 'sine', 0.13, t, null), l4g = G(c, 500); l4.connect(l4g); l4g.connect(wf.frequency);
    w.connect(wf); wf.connect(wg); wg.connect(S.out);
  } },
  charge_loop: { rs: 0.1, fn(S) {
    const c = S.c, t = S.t, r = S.r;
    const f = bq(S, 'lowpass', 300, 2); ramp(f.frequency, t, 300, 2500, 1.5);
    const g = G(c, 0.14), trem = osc(S, 'sine', 7, t, null), tg = G(c, 0.05);
    ramp(trem.frequency, t, 7, 16, 1.5); trem.connect(tg); tg.connect(g.gain);
    [['sawtooth', 110, 0], ['sawtooth', 110, 11], ['sine', 220, 0]].forEach(([ty, fr, det]) => {
      const o = osc(S, ty, fr * r, t, null); o.detune.value = det;
      o.frequency.exponentialRampToValueAtTime(fr * 1.5 * r, t + 1.5); o.connect(f);
    });
    f.connect(g); g.connect(S.out);
    const n = noiseSrc(S, 'white', t, null), nf = bq(S, 'highpass', 5000, 0.7), ng = G(c, 0);
    ng.gain.setValueAtTime(0, t); ng.gain.linearRampToValueAtTime(0.06, t + 1.5);
    n.connect(nf); nf.connect(ng); ng.connect(S.out);
  } },
};

// ---------------------------------------------------------------------------
// 发声
// ---------------------------------------------------------------------------
function startVoice(E, def, o, isLoop, at) {
  const c = E.c, t = at ?? c.currentTime + 0.005;
  const vg = G(c, (o.vol ?? 1) * (def.g ?? 1)); // def.g：每个声音的电平微调
  let pan = null, send = 1;
  if (o.pos) { pan = makePanner(c, o.pos); vg.connect(pan); pan.connect(E.sfx); send = Math.sqrt(distGain(E, o.pos)); }
  else vg.connect(E.sfx);
  const sends = [];
  if (def.rs) { const s = G(c, def.rs * send); vg.connect(s); s.connect(getRev(E, 'S')); sends.push(s); }
  if (def.rl) { const s = G(c, def.rl * send); vg.connect(s); s.connect(getRev(E, 'L')); sends.push(s); }
  // 小幅随机音高/音色（±5%）
  const r = Math.max(0.05, (o.rate || 1) * rv(1, 0.05));
  const S = { c, E, out: vg, t, r, src: isLoop ? [] : null };
  def.fn(S);
  return { vg, pan, sends, S, t, end: t + (def.d || 0) };
}
function killVoice(v, fade = 0.02) {
  if (v.dead) return; v.dead = true;
  try {
    const t = v.vg.context.currentTime, p = v.vg.gain;
    p.cancelScheduledValues(t); p.setValueAtTime(p.value, t); p.linearRampToValueAtTime(0, t + fade);
  } catch (e) { /* ignore */ }
  setTimeout(() => disconnectVoice(v), (fade + 0.05) * 1000);
}
function disconnectVoice(v) {
  try { v.vg.disconnect(); } catch (e) { /* ignore */ }
  try { if (v.pan) v.pan.disconnect(); } catch (e) { /* ignore */ }
  for (const s of v.sends) try { s.disconnect(); } catch (e) { /* ignore */ }
}

// ---------------------------------------------------------------------------
// 菜单音乐（生成式：D 小调 i–VI–III–VII 垫音 + 五声旋律 + 定音鼓式低音，大混响）
// ---------------------------------------------------------------------------
const BEAT = 0.75, CH = BEAT * 8;
const PROG = [[50, 57, 62, 65, 69], [46, 53, 58, 62, 65], [41, 57, 60, 65, 69], [48, 55, 60, 64, 67]]; // Dm Bb F C
const PENTA = [62, 65, 67, 69, 72, 74, 77, 79, 81];

function createMusic(E, t0) {
  const c = E.c, out = c.createGain();
  out.gain.setValueAtTime(0, t0); out.gain.linearRampToValueAtTime(1, t0 + 4);
  out.connect(E.mus);
  const wet = G(c, 0.9); out.connect(wet); wet.connect(getRev(E, 'M'));
  return { E, out, t0, nextChord: t0 + 0.05, ci: 0, nextBeat: t0 + 0.05 + BEAT * 2, mi: 4, timer: 0 };
}
function schedMusic(st, until) {
  const S = { c: st.E.c, E: st.E, out: st.out, t: 0, r: 1, src: null };
  while (st.nextChord < until) { chordEvent(S, st.nextChord, st.ci); st.ci++; st.nextChord += CH; }
  while (st.nextBeat < until) {
    const tt = st.nextBeat, rel = tt - st.t0, ci = Math.floor(rel / CH), beatIn = Math.floor((rel % CH) / BEAT + 1e-6);
    const chord = PROG[((ci % 4) + 4) % 4];
    if (beatIn < 6 && Math.random() < 0.6) {
      st.mi = Math.max(0, Math.min(PENTA.length - 1, st.mi + [-2, -1, -1, 1, 1, 2][(Math.random() * 6) | 0]));
      let m = PENTA[st.mi];
      if (beatIn === 0) { // 强拍落和弦音
        const tones = chord.slice(2).map((x) => x + 12).filter((x) => x >= 62 && x <= 81);
        if (tones.length) m = tones.reduce((a, b) => (Math.abs(b - m) < Math.abs(a - m) ? b : a));
      }
      bell(S, tt, mtof(m));
      if (Math.random() < 0.15) bell(S, tt + BEAT * 0.5, mtof(PENTA[Math.max(0, st.mi - 1)]), 0.6);
    }
    st.nextBeat += BEAT * (Math.random() < 0.2 ? 2 : 1);
  }
}
function bell(S, t, f, v = 1) {
  S.t = t;
  tone(S, { f, a: 0.006, dur: 2.2, vol: 0.09 * v });
  tone(S, { f: f * 2, a: 0.004, dur: 0.8, vol: 0.022 * v });
  tone(S, { f: f * 3.01, a: 0.002, dur: 0.3, vol: 0.01 * v });
  tone(S, { type: 'triangle', f: f / 2, a: 0.01, dur: 1.0, vol: 0.018 * v });
}
function chordEvent(S, t, i) {
  const c = S.c, chord = PROG[i % 4];
  S.t = t;
  // 垫音：失谐锯齿波 → 缓慢开合的低通
  const f = bq(S, 'lowpass', 400, 0.8);
  f.frequency.setValueAtTime(400, t); f.frequency.linearRampToValueAtTime(1300, t + CH * 0.5); f.frequency.linearRampToValueAtTime(600, t + CH + 2);
  const g = envG(S, t, 2.0, 1, 3.0, CH - 1.6);
  f.connect(g); g.connect(S.out);
  for (const m of chord.slice(1)) for (const det of [-7, 7]) {
    const o = osc(S, 'sawtooth', mtof(m), t, CH + 3.5); o.detune.value = det + rnd(-2, 2);
    const og = G(c, 0.03); o.connect(og); og.connect(f);
  }
  tone(S, { f: mtof(chord[4] + 12), a: 2, hold: CH - 2, dur: 2.5, vol: 0.012, vib: [5, 0.004] });
  // 低音
  tone(S, { f: mtof(chord[0] - 12), a: 0.8, hold: CH - 1, dur: 2.0, vol: 0.08 });
  tone(S, { type: 'triangle', f: mtof(chord[0]), a: 0.8, hold: CH - 1, dur: 2.0, vol: 0.05 });
  // 定音鼓式低音冲击
  const big = i % 4 === 0;
  thump(S, { f0: 62, f1: 45, dur: big ? 2.2 : 1.4, sweep: 0.4, vol: big ? 0.24 : 0.14 });
  burst(S, { kind: 'brown', type: 'lowpass', f: 180, dur: big ? 1.0 : 0.5, a: 0.005, vol: big ? 0.18 : 0.1 });
  if (big) thump(S, { dt: BEAT * 0.5, f0: 62, f1: 45, dur: 0.9, vol: 0.12 });
  // 奇数和弦加铜管式渐强
  if (i % 2 === 1) for (const m of [chord[1], chord[2], chord[1] + 7]) {
    tone(S, { dt: BEAT * 2, type: 'sawtooth', f: mtof(m), detune: [-5, 5], a: 1.5, hold: 0.5, dur: 2.5, vol: 0.025,
      filter: { type: 'lowpass', f: 300, f1: 1600, sweep: 1.8, f2: 400, sweep2: 2.5 } });
  }
}

// ---------------------------------------------------------------------------
// 对外接口
// ---------------------------------------------------------------------------
let ctx = null, E = null, musicInst = null;
const voices = [];
const recent = new Map();
const NOOP_HANDLE = Object.freeze({ stop() {}, setPos() {}, setVol() {} });

export const audio = {
  init() {
    try {
      if (!ctx) {
        const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
        if (!AC) return;
        ctx = new AC({ latencyHint: 'interactive' });
        E = createEngine(ctx, ctx.destination);
        applyListener(ctx, L.x, L.y, L.z, L.yaw);
        // 预热常用缓存，避免首次发声卡顿
        getBuf(E, 'white'); getBuf(E, 'pink'); getBuf(E, 'brown'); getRev(E, 'S'); getRev(E, 'L');
      }
      if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    } catch (e) { console.warn('[audio] init 失败', e); }
  },

  setListener(x, y, z, yaw) {
    if (!Number.isFinite(x + y + z + yaw)) return;
    L.x = x; L.y = y; L.z = z; L.yaw = yaw;
    if (ctx) applyListener(ctx, x, y, z, yaw);
  },

  play(name, o = {}) {
    if (!ctx) return;
    const def = SFX[name];
    if (!def) return;
    const t = nowSec();
    let arr = recent.get(name);
    if (!arr) recent.set(name, (arr = []));
    while (arr.length && t - arr[0] > THROTTLE_WIN) arr.shift();
    if (arr.length >= THROTTLE_MAX) return;
    arr.push(t);
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    while (voices.length >= MAX_VOICES) killVoice(voices.shift());
    let v;
    try { v = startVoice(E, def, o || {}, false); } catch (e) { console.warn('[audio] play', name, e); return; }
    voices.push(v);
    setTimeout(() => {
      const i = voices.indexOf(v);
      if (i >= 0) voices.splice(i, 1);
      if (!v.dead) { v.dead = true; disconnectVoice(v); }
    }, (def.d + 0.25) * 1000);
  },

  loop(name, o = {}) {
    if (!ctx) return NOOP_HANDLE;
    const def = LOOPS[name];
    if (!def) return NOOP_HANDLE;
    const vol = o.vol ?? 1;
    const v = startVoice(E, def, { ...o, vol: 0 }, true);
    const p = v.vg.gain; p.setValueAtTime(0, v.t); p.linearRampToValueAtTime(vol, v.t + 0.3);
    let done = false;
    return {
      stop() {
        if (done) return; done = true;
        const t = ctx.currentTime;
        p.cancelScheduledValues(t); p.setValueAtTime(p.value, t); p.linearRampToValueAtTime(0, t + 0.35);
        for (const s of v.S.src) try { s.stop(t + 0.4); } catch (e) { /* ignore */ }
        setTimeout(() => disconnectVoice(v), 600);
      },
      setPos(x, y, z) {
        if (done) return;
        if (!v.pan) { v.pan = makePanner(ctx, [x, y, z]); v.vg.disconnect(E.sfx); v.vg.connect(v.pan); v.pan.connect(E.sfx); }
        else setPannerPos(v.pan, x, y, z);
      },
      setVol(x) {
        if (done) return;
        const t = ctx.currentTime; p.cancelScheduledValues(t); p.setTargetAtTime(x, t, 0.05);
      },
    };
  },

  music(on) {
    if (!ctx) return;
    if (on) {
      if (musicInst) return;
      if (ctx.state === 'suspended') ctx.resume().catch(() => {});
      const st = createMusic(E, ctx.currentTime + 0.05);
      schedMusic(st, ctx.currentTime + 3);
      st.timer = setInterval(() => schedMusic(st, ctx.currentTime + 3), 400);
      musicInst = st;
    } else if (musicInst) {
      const st = musicInst; musicInst = null;
      clearInterval(st.timer);
      const t = ctx.currentTime, p = st.out.gain;
      p.cancelScheduledValues(t); p.setValueAtTime(p.value, t); p.linearRampToValueAtTime(0, t + 2.5);
      setTimeout(() => { try { st.out.disconnect(); } catch (e) { /* ignore */ } }, 3200);
    }
  },

  setVolume(master, sfx, music) {
    if (master != null) vols.master = master;
    if (sfx != null) vols.sfx = sfx;
    if (music != null) vols.music = music;
    if (!ctx) return;
    const t = ctx.currentTime;
    E.master.gain.setTargetAtTime(vols.master, t, 0.03);
    E.sfx.gain.setTargetAtTime(vols.sfx, t, 0.03);
    E.mus.gain.setTargetAtTime(vols.music, t, 0.03);
  },

  // ---- 测试钩子（游戏代码不要用）----
  _names: () => Object.keys(SFX),
  _loopNames: () => Object.keys(LOOPS),
  _stats: () => ({ ctx: ctx ? ctx.state : null, voices: voices.length, music: !!musicInst, maxVoices: MAX_VOICES }),
  // 离线渲染一个声音（或循环声：渲染 opts.hold 秒后停止），返回 Promise<AudioBuffer>
  // opts: { pos, rate, vol, raw(不过压缩器), sampleRate, seconds, hold }
  // name 可为数组：同一时刻叠加多个声音（混战压力测试）
  _renderOffline(name, opts = {}) {
    const list = Array.isArray(name) ? name : [name];
    const isLoop = list.length === 1 && !!LOOPS[name], def = SFX[list[0]] || LOOPS[list[0]];
    if (!def || list.some((n) => !SFX[n] && !isLoop)) return Promise.reject(new Error('unknown sound ' + name));
    const sr = opts.sampleRate || 44100;
    const hold = opts.hold ?? 1.5;
    let sec = opts.seconds;
    if (sec == null) {
      sec = 0;
      for (const n of list) { const d = SFX[n] || LOOPS[n]; sec = Math.max(sec, (isLoop ? hold + 0.5 : d.d) + (d.rl ? 2.8 : d.rs ? 0.9 : 0.3)); }
    }
    // 预留 0.3s：Chrome 的压缩器在渲染开头有一段增益爬升，声音放在后面才代表实时情况
    const PRE = 0.3;
    const OAC = globalThis.OfflineAudioContext || globalThis.webkitOfflineAudioContext;
    const oc = new OAC(2, Math.ceil(sr * (sec + PRE)), sr);
    const lis = { x: 0, y: 0, z: 0, yaw: 0 };
    applyListener(oc, 0, 0, 0, 0);
    const e = createEngine(oc, oc.destination, { raw: !!opts.raw, L: lis });
    const v = startVoice(e, def, opts, isLoop, PRE);
    for (const n of list.slice(1)) startVoice(e, SFX[n], opts, false, PRE);
    if (isLoop) {
      const p = v.vg.gain, vol = opts.vol ?? 1;
      p.setValueAtTime(0, v.t); p.linearRampToValueAtTime(vol, v.t + 0.3);
      p.setValueAtTime(vol, v.t + hold); p.linearRampToValueAtTime(0, v.t + hold + 0.35);
      for (const s of v.S.src) s.stop(v.t + hold + 0.4);
    }
    return oc.startRendering();
  },
  _renderMusic(seconds = 14, opts = {}) {
    const sr = opts.sampleRate || 44100;
    const OAC = globalThis.OfflineAudioContext || globalThis.webkitOfflineAudioContext;
    const oc = new OAC(2, Math.ceil(sr * seconds), sr);
    const e = createEngine(oc, oc.destination, { raw: !!opts.raw, L: { x: 0, y: 0, z: 0, yaw: 0 } });
    const st = createMusic(e, 0.3);
    schedMusic(st, seconds - 0.5);
    return oc.startRendering();
  },
};

export default audio;
