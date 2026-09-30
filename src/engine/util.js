// 通用数学与小工具
export const TAU = Math.PI * 2;
export const DEG = Math.PI / 180;

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth = (t) => t * t * (3 - 2 * t);
export const easeOut = (t) => 1 - (1 - t) * (1 - t);
export const easeIn = (t) => t * t;
export const rand = (a = 0, b = 1) => a + Math.random() * (b - a);
export const pick = (arr) => arr[(Math.random() * arr.length) | 0];

// 把角度规整到 (-PI, PI]
export function wrapAngle(a) {
  a = (a + Math.PI) % TAU;
  if (a < 0) a += TAU;
  return a - Math.PI;
}
export function angleTo(fromX, fromZ, toX, toZ) {
  return Math.atan2(toX - fromX, toZ - fromZ); // 与 yaw 约定一致：前方 (sin, cos)
}
export function turnToward(cur, target, maxStep) {
  const d = wrapAngle(target - cur);
  if (Math.abs(d) <= maxStep) return target;
  return cur + Math.sign(d) * maxStep;
}
export function dist2D(a, b) {
  const dx = a.x - b.x, dz = a.z - b.z;
  return Math.sqrt(dx * dx + dz * dz);
}

// 线段与 AABB 相交（slab）；返回进入参数 t∈[0,1] 或 -1
export function segAABB(p0, p1, min, max) {
  let t0 = 0, t1 = 1;
  const d = [p1.x - p0.x, p1.y - p0.y, p1.z - p0.z];
  const o = [p0.x, p0.y, p0.z];
  for (let i = 0; i < 3; i++) {
    if (Math.abs(d[i]) < 1e-9) {
      if (o[i] < min[i] || o[i] > max[i]) return -1;
    } else {
      let ta = (min[i] - o[i]) / d[i];
      let tb = (max[i] - o[i]) / d[i];
      if (ta > tb) { const tmp = ta; ta = tb; tb = tmp; }
      if (ta > t0) t0 = ta;
      if (tb < t1) t1 = tb;
      if (t0 > t1) return -1;
    }
  }
  return t0;
}

// 点到竖直线段（胶囊轴）的距离
export function distPointToVSeg(px, py, pz, cx, y0, y1, cz) {
  const y = clamp(py, y0, y1);
  const dx = px - cx, dy = py - y, dz = pz - cz;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

export function fmtTime(sec) {
  sec = Math.max(0, Math.ceil(sec));
  const m = (sec / 60) | 0, s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

// 本地存储（失败时静默）
export const store = {
  get(key, def) {
    try { const v = localStorage.getItem('glory.' + key); return v == null ? def : JSON.parse(v); } catch { return def; }
  },
  set(key, val) {
    try { localStorage.setItem('glory.' + key, JSON.stringify(val)); } catch { /* ignore */ }
  },
};

let _uid = 1;
export const uid = () => _uid++;
