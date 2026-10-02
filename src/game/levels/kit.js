// 关卡搭建工具箱：材质、按材质合并的几何桶、碰撞盒、天空、远山、火焰/光晕、光束、粒子、旗帜。
// 所有关卡共用。几何先按世界坐标投影 UV（纹理密度统一），最后每种材质合并成一个网格，控制 draw call。
import * as THREE from 'three';
import { mergeGeometries } from '../../../vendor/BufferGeometryUtils.js';

export const PAL = {
  deep: 0x202731, stone: 0xc9c6be, cloth: 0xe7e2d7, bronze: 0xa98954, teal: 0x4d9d9a, danger: 0xcf624b,
};
export const TAU = Math.PI * 2;
export const lerp = (a, b, t) => a + (b - a) * t;
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export function rng(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash3(x, y, z) {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(z, 1274126177)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967295;
}
export function noise3(x, y, z) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = x - xi, yf = y - yi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf), w = zf * zf * (3 - 2 * zf);
  const c = (a, b, d) => hash3(xi + a, yi + b, zi + d);
  const x00 = lerp(c(0, 0, 0), c(1, 0, 0), u), x10 = lerp(c(0, 1, 0), c(1, 1, 0), u);
  const x01 = lerp(c(0, 0, 1), c(1, 0, 1), u), x11 = lerp(c(0, 1, 1), c(1, 1, 1), u);
  return lerp(lerp(x00, x10, v), lerp(x01, x11, v), w);
}
export function fbm3(x, y, z, oct = 4) {
  let s = 0, a = 0.5, f = 1;
  for (let i = 0; i < oct; i++) { s += a * noise3(x * f, y * f, z * f); f *= 2.03; a *= 0.5; }
  return s;
}

const GLSL_NOISE = /* glsl */`
float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
  return mix(mix(hash12(i), hash12(i+vec2(1.,0.)), f.x), mix(hash12(i+vec2(0.,1.)), hash12(i+vec2(1.,1.)), f.x), f.y); }
float fbm2(vec2 p){ float v = 0.0, a = 0.5; for (int i = 0; i < 5; i++){ v += a*vnoise(p); p = p*2.03 + vec2(1.7, 9.2); a *= 0.5; } return v; }
`;

const _m4 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _eul = new THREE.Euler(), _v = new THREE.Vector3(), _s = new THREE.Vector3();
const KEEP_ATTRS = ['position', 'normal', 'uv', 'color'];

function worldUV(g, tile, off, swap) {
  const p = g.attributes.position, n = g.attributes.normal;
  const uv = new Float32Array(p.count * 2);
  const inv = 1 / tile;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i)), az = Math.abs(n.getZ(i));
    let u, v;
    if (ay >= ax && ay >= az) { u = x; v = z; }
    else if (ax >= az) { u = z; v = y; }
    else { u = x; v = y; }
    if (swap) { const t = u; u = v; v = t; }
    uv[i * 2] = u * inv + off[0];
    uv[i * 2 + 1] = v * inv + off[1];
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}

function matrixFrom(o) {
  if (o.matrix) return o.matrix;
  const p = o.pos || [0, 0, 0];
  const r = o.rot || [0, o.rotY || 0, 0];
  const s = o.scale === undefined ? [1, 1, 1] : (typeof o.scale === 'number' ? [o.scale, o.scale, o.scale] : o.scale);
  _eul.set(r[0], r[1], r[2], o.order || 'YXZ');
  _q.setFromEuler(_eul);
  return _m4.compose(_v.set(p[0], p[1], p[2]), _q, _s.set(s[0], s[1], s[2])).clone();
}

// ---------- 画布贴图 ----------
export function canvasTex(w, h, draw, opts = {}) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  draw(g, w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = opts.srgb === false ? THREE.NoColorSpace : THREE.SRGBColorSpace;
  t.anisotropy = 4;
  if (opts.repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; }
  return t;
}

// 程序化灰泥贴图（可平铺）：柔和的斑驳 + 细颗粒
export function plasterTex(base = '#efe9df', seed = 7) {
  const R = rng(seed);
  const t = canvasTex(512, 512, (g, W, H) => {
    g.fillStyle = base; g.fillRect(0, 0, W, H);
    for (let i = 0; i < 420; i++) {
      const x = R() * W, y = R() * H, r = 10 + R() * 45, dark = R() < 0.55;
      for (const ox of [-W, 0, W]) for (const oy of [-H, 0, H]) {
        const grd = g.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, r);
        grd.addColorStop(0, dark ? 'rgba(120,105,85,0.035)' : 'rgba(255,255,250,0.05)');
        grd.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = grd; g.fillRect(x + ox - r, y + oy - r, r * 2, r * 2);
      }
    }
    const img = g.getImageData(0, 0, W, H), d = img.data;
    for (let i = 0; i < d.length; i += 4) { const n = (R() - 0.5) * 10; d[i] += n; d[i + 1] += n; d[i + 2] += n; }
    g.putImageData(img, 0, 0);
  }, { repeat: true });
  return t;
}

export class Kit {
  constructor(ctx, id, name) {
    this.ctx = ctx;
    this.id = id; this.name = name;
    this.low = ctx.quality === 'low';
    this.group = new THREE.Group();
    this.group.name = 'level-' + id;
    this.colliders = [];
    this.mats = new Map();
    this.buckets = new Map();
    this.disposables = [];
    this.updaters = [];
    this.uTime = { value: 0 };
    this.flames = [];
    this.glows = [];
    this.banners = [];
    this.pointCount = 0;
    this.mirrors = [];
    this.sunLight = null;
    this.envRT = null;
    this.noEnv = new Set();
  }

  // ---------- 材质 ----------
  // o: tex, tile(世界米/一次重复), color, roughness, metalness, bump, emissive, emissiveIntensity, env, vertexColors, flat, side
  mat(key, o = {}) {
    if (this.mats.has(key)) return this.mats.get(key).mat;
    const p = {
      color: new THREE.Color(o.color ?? 0xffffff),
      roughness: o.roughness ?? 0.85,
      metalness: o.metalness ?? 0,
    };
    if (o.tex) {
      let t = this.ctx.tex(o.tex);
      if (t && (t.repeat.x !== 1 || t.repeat.y !== 1 || t.offset.x !== 0 || t.offset.y !== 0)) {
        t = t.clone();
        t.repeat.set(1, 1); t.offset.set(0, 0);
        t.wrapS = t.wrapT = THREE.RepeatWrapping;
        t.needsUpdate = true;
        this.disposables.push(t);
      }
      if (t) {
        p.map = t;
        if (o.bump) { p.bumpMap = t; p.bumpScale = o.bump; }
      }
    }
    if (o.map) { p.map = o.map; if (o.bump) { p.bumpMap = o.map; p.bumpScale = o.bump; } }
    if (o.emissive !== undefined) { p.emissive = new THREE.Color(o.emissive); p.emissiveIntensity = o.emissiveIntensity ?? 1; }
    if (o.emissiveMap) p.emissiveMap = o.emissiveMap;
    if (o.vertexColors) p.vertexColors = true;
    if (o.flat) p.flatShading = true;
    if (o.side) p.side = o.side;
    if (o.fog === false) p.fog = false;
    const m = new THREE.MeshStandardMaterial(p);
    m.name = key;
    m.userData.envScale = o.env ?? 1;
    if (o.noEnv) this.noEnv.add(m);
    this.mats.set(key, { mat: m, tile: o.tile ?? 2, vc: !!o.vertexColors, uvOff: o.uvOff || [0, 0] });
    this.disposables.push(m);
    return m;
  }

  // ---------- 几何 ----------
  // o: pos/rot/rotY/scale/matrix, uv:'world'|'keep', uvScale:[u,v], swap, cast, receive, collide(tag|true)
  add(key, geo, o = {}) {
    const info = this.mats.get(key);
    if (!info) throw new Error('level kit: unknown material ' + key);
    if (this.ctx.debugSkip && this.ctx.debugSkip.includes(key)) { geo.dispose(); return geo; }
    let g = geo;
    if (o.matrix || o.pos || o.rot || o.rotY || o.scale !== undefined) g.applyMatrix4(matrixFrom(o));
    // 硬边小面：拆成非索引并按面算法线（不用 flatShading，避免远处亚像素三角形在环境图烘焙里产生 NaN）
    if (o.facet) { if (g.index) { const ng = g.toNonIndexed(); g.dispose(); g = ng; } g.deleteAttribute('normal'); g.computeVertexNormals(); }
    for (const name of Object.keys(g.attributes)) if (!KEEP_ATTRS.includes(name)) g.deleteAttribute(name);
    g.morphAttributes = {};
    if (!g.attributes.normal) g.computeVertexNormals();
    if ((o.uv ?? 'world') === 'world') worldUV(g, o.tile ?? info.tile, o.uvOff || info.uvOff, o.swap);
    else if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    else if (o.uvScale) {
      const uv = g.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * o.uvScale[0], uv.getY(i) * o.uvScale[1]);
    }
    if (info.vc) {
      if (!g.attributes.color) {
        const c = new Float32Array(g.attributes.position.count * 3).fill(1);
        g.setAttribute('color', new THREE.BufferAttribute(c, 3));
      }
    } else if (g.attributes.color) g.deleteAttribute('color');
    const cast = o.cast ?? true, recv = o.receive ?? true;
    const bk = key + '|' + (cast ? 'c' : '-') + (recv ? 'r' : '-');
    let b = this.buckets.get(bk);
    if (!b) { b = { key, cast, recv, geos: [] }; this.buckets.set(bk, b); }
    b.geos.push(g);
    if (o.collide) {
      g.computeBoundingBox();
      const bb = g.boundingBox;
      this.collider([bb.min.x, bb.min.y, bb.min.z], [bb.max.x, bb.max.y, bb.max.z], o.collide === true ? 'wall' : o.collide);
    }
    return g;
  }

  // 中心+尺寸的盒子
  box(key, c, s, o = {}) {
    return this.add(key, new THREE.BoxGeometry(s[0], s[1], s[2]), { ...o, pos: c });
  }
  // 最小/最大角的盒子（不旋转）
  slab(key, min, max, o = {}) {
    const s = [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
    const c = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
    return this.box(key, c, s, o);
  }
  // 实体盒：视觉 + 碰撞
  solid(key, min, max, tag = 'wall', o = {}) {
    this.slab(key, min, max, o);
    this.collider(min, max, tag);
  }
  // 圆柱：底面在 y
  cyl(key, p, rt, rb, h, seg = 12, o = {}) {
    const g = new THREE.CylinderGeometry(rt, rb, h, seg, o.hseg || 1, !!o.open);
    return this.add(key, g, { ...o, pos: [p[0], p[1] + h / 2, p[2]] });
  }

  collider(min, max, tag = 'wall') {
    const c = { min: [...min], max: [...max], tag };
    this.colliders.push(c);
    return c;
  }

  // 沿折线放碰撞盒（斜线分段近似）；points: [[x,z],...]
  polyColliders(points, closed, thick, y0, y1, step = 1.2, tag = 'wall') {
    const n = points.length, segs = closed ? n : n - 1;
    for (let i = 0; i < segs; i++) {
      const a = points[i], b = points[(i + 1) % n];
      const dx = b[0] - a[0], dz = b[1] - a[1];
      const len = Math.hypot(dx, dz);
      const axis = Math.abs(dx) < 1e-3 || Math.abs(dz) < 1e-3;
      const k = axis ? 1 : Math.max(1, Math.ceil(len / step));
      const h = thick / 2;
      for (let j = 0; j < k; j++) {
        const x0 = a[0] + dx * j / k, z0 = a[1] + dz * j / k;
        const x1 = a[0] + dx * (j + 1) / k, z1 = a[1] + dz * (j + 1) / k;
        this.collider([Math.min(x0, x1) - h, y0, Math.min(z0, z1) - h], [Math.max(x0, x1) + h, y1, Math.max(z0, z1) + h], tag);
      }
    }
  }

  // 台阶：从 (x,z) 起沿 dir 方向上升；每级为实心盒，碰撞同视觉
  stairs(key, o) {
    const { x, z, dir, width, height, steps, depth, y0 = 0, tag = 'platform' } = o;
    for (let i = 1; i <= steps; i++) {
      const h = y0 + height * i / steps;
      const a = (i - 1) * depth, b = i * depth;
      let min, max;
      const hw = width / 2;
      if (dir === 'x+') { min = [x + a, 0, z - hw]; max = [x + b, h, z + hw]; }
      else if (dir === 'x-') { min = [x - b, 0, z - hw]; max = [x - a, h, z + hw]; }
      else if (dir === 'z+') { min = [x - hw, 0, z + a]; max = [x + hw, h, z + b]; }
      else { min = [x - hw, 0, z - b]; max = [x + hw, h, z - a]; }
      this.solid(key, min, max, tag);
    }
  }

  // ---------- 光 ----------
  hemi(sky, ground, intensity) {
    const h = new THREE.HemisphereLight(sky, ground, intensity);
    this.group.add(h);
    return h;
  }
  sun(o) {
    const L = new THREE.DirectionalLight(o.color ?? 0xffffff, o.intensity ?? 3);
    const d = new THREE.Vector3(...o.dir).normalize();
    const c = new THREE.Vector3(...(o.center || [0, 0, 0]));
    const dist = o.dist ?? 60;
    L.position.copy(c).addScaledVector(d, dist);
    L.target.position.copy(c);
    L.castShadow = true;
    const ms = this.low ? 1024 : 2048;
    L.shadow.mapSize.set(ms, ms);
    const e = o.extent ?? 25, sc = L.shadow.camera;
    sc.left = -e; sc.right = e; sc.top = e; sc.bottom = -e; sc.near = 1; sc.far = dist * 2 + e;
    sc.updateProjectionMatrix();
    L.shadow.bias = o.bias ?? -0.0004;
    L.shadow.normalBias = o.normalBias ?? 0.035;
    L.name = 'sun';
    this.group.add(L, L.target);
    // Shadow targets are created lazily by the renderer. Removing the light
    // does not free them; ownership belongs to this level, just like its meshes.
    this.disposables.push(L.shadow);
    this.sunLight = L;
    this.sunDir = d;
    return L;
  }
  point(color, intensity, distance, p, o = {}) {
    if (this.pointCount >= 6) return null;
    if (this.ctx.debugSkip && this.ctx.debugSkip.includes('points')) return null;
    this.pointCount++;
    const L = new THREE.PointLight(color, intensity, distance, o.decay ?? 2);
    L.position.set(p[0], p[1], p[2]);
    this.group.add(L);
    if (o.flicker) {
      const base = intensity, seed = Math.random() * 10;
      this.updaters.push((dt, t) => { L.intensity = base * (0.86 + 0.1 * Math.sin(t * 11 + seed) + 0.06 * Math.sin(t * 23.7 + seed * 2)); });
    }
    return L;
  }

  // ---------- 天空 ----------
  sky(o) {
    const col = (c) => new THREE.Color(c);
    const uniforms = {
      uTop: { value: col(o.top) }, uHorizon: { value: col(o.horizon) }, uBottom: { value: col(o.bottom ?? o.horizon) },
      uSunDir: { value: new THREE.Vector3(...(o.sunDir || [0.3, 0.6, 0.2])).normalize() },
      uSunColor: { value: col(o.sunColor ?? 0xfff2dd) }, uSunDisk: { value: o.sunDisk ?? 1 },
      uCloud: { value: o.clouds ?? 0.45 }, uCloudColor: { value: col(o.cloudColor ?? 0xffffff) },
      uCloudShade: { value: col(o.cloudShade ?? 0xb7c3d2) }, uTime: this.uTime,
    };
    const mat = new THREE.ShaderMaterial({
      uniforms, side: THREE.BackSide, depthWrite: false, fog: false,
      vertexShader: /* glsl */`
        varying vec3 vDir;
        void main(){ vDir = position; vec4 p = projectionMatrix * vec4(mat3(viewMatrix) * position, 1.0); gl_Position = p.xyww; }`,
      fragmentShader: /* glsl */`
        uniform vec3 uTop, uHorizon, uBottom, uSunDir, uSunColor, uCloudColor, uCloudShade;
        uniform float uTime, uCloud, uSunDisk;
        varying vec3 vDir;
        ${GLSL_NOISE}
        void main(){
          vec3 d = normalize(vDir); float h = d.y;
          vec3 col = h > 0.0 ? mix(uHorizon, uTop, pow(clamp(h, 0.0, 1.0), 0.6)) : mix(uHorizon, uBottom, pow(clamp(-h * 3.0, 0.0, 1.0), 0.7));
          float s = max(dot(d, uSunDir), 0.0);
          col += uSunColor * (pow(s, 1200.0) * 8.0 * uSunDisk + pow(s, 24.0) * 0.28 + pow(s, 4.0) * 0.07);
          if (uCloud > 0.0 && h > -0.02) {
            vec2 uv = d.xz / (max(h, 0.0) + 0.1) * 0.9 + vec2(uTime * 0.006, uTime * 0.002);
            float n = fbm2(uv);
            float c = smoothstep(1.0 - uCloud, 1.0 - uCloud + 0.32, n) * smoothstep(-0.02, 0.2, h);
            float lit = clamp(fbm2(uv * 1.7 + 4.0) * 1.2 - 0.1, 0.0, 1.0);
            vec3 cc = mix(uCloudShade, uCloudColor, lit) + uSunColor * pow(s, 8.0) * 0.35;
            col = mix(col, cc, c * 0.9);
          }
          col = mix(col, uHorizon, exp(-abs(h) * 18.0) * 0.55);
          gl_FragColor = vec4(col, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), mat);
    mesh.frustumCulled = false;
    mesh.renderOrder = -1000;
    mesh.name = 'sky';
    this.group.add(mesh);
    this.disposables.push(mesh.geometry, mat);
    this.skyMat = mat;
    return mesh;
  }

  // ---------- 远景山体（顶点色、平直着色） ----------
  // o: seed,count,rMin,rMax,hMin,hMax,base(底部y),aspect[min,max],colTop,colMid,colBase,snow(0-1 起雪高度比例),arc:[a0,a1],center:[x,z],key
  mountains(o) {
    const key = o.key || 'mountain';
    if (!this.mats.has(key)) this.mat(key, { vertexColors: true, roughness: 1, env: 0.3 });
    const R = rng(o.seed ?? 11);
    const cTop = new THREE.Color(o.colTop ?? 0x5d7a5a), cMid = new THREE.Color(o.colMid ?? 0x7d8a8c), cBase = new THREE.Color(o.colBase ?? 0xa9b8c4);
    const snowC = new THREE.Color(0xf2f6fb);
    const tmp = new THREE.Color();
    const cx = o.center ? o.center[0] : 0, cz = o.center ? o.center[1] : 0;
    const count = this.low ? Math.ceil(o.count * 0.6) : o.count;
    for (let i = 0; i < count; i++) {
      const a0 = o.arc ? o.arc[0] : 0, a1 = o.arc ? o.arc[1] : TAU;
      const ang = lerp(a0, a1, (i + R() * 0.8) / count);
      const r = lerp(o.rMin, o.rMax, R());
      const h = lerp(o.hMin, o.hMax, R());
      const asp = o.aspect || [0.25, 0.45];
      const rb = h * lerp(asp[0], asp[1], R());
      const g = new THREE.CylinderGeometry(rb * lerp(0.12, 0.3, R()), rb, h, o.seg || 11, o.hseg || 9, true);
      const pos = g.attributes.position;
      const seed = R() * 100;
      const lean = [(R() - 0.5) * 0.25 * h, (R() - 0.5) * 0.25 * h];
      const cols = new Float32Array(pos.count * 3);
      for (let k = 0; k < pos.count; k++) {
        let x = pos.getX(k), y = pos.getY(k), z = pos.getZ(k);
        const t = y / h + 0.5;
        const nn = fbm3(x * 0.08 + seed, y * 0.05, z * 0.08, 4);
        const sc = 0.6 + nn * 0.9;
        x *= sc; z *= sc;
        x += lean[0] * t * t; z += lean[1] * t * t;
        y += (nn - 0.5) * h * 0.08;
        if (t > 0.97) y -= h * 0.04 * noise3(x, z, seed);
        pos.setXYZ(k, x, y, z);
        if (t > 0.72) tmp.copy(cMid).lerp(cTop, (t - 0.72) / 0.28);
        else tmp.copy(cBase).lerp(cMid, t / 0.72);
        if (o.snow !== undefined && t > o.snow + (nn - 0.5) * 0.25) tmp.lerp(snowC, 0.85);
        tmp.multiplyScalar(0.85 + nn * 0.3);
        cols[k * 3] = tmp.r; cols[k * 3 + 1] = tmp.g; cols[k * 3 + 2] = tmp.b;
      }
      g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
      g.computeVertexNormals();
      this.add(key, g, { pos: [cx + Math.cos(ang) * r, (o.base ?? -40) + h / 2, cz + Math.sin(ang) * r], rotY: R() * TAU, uv: 'keep', cast: false, receive: false, facet: true });
    }
  }

  // 倒锥形的浮岛/崖体（顶点色：顶部苔绿、下部灰褐）
  rockMass(key, p, rTop, depth, o = {}) {
    const R = rng(o.seed ?? 5);
    const g = new THREE.CylinderGeometry(rTop, rTop * (o.tip ?? 0.12), depth, o.seg || 14, 7, false);
    const pos = g.attributes.position; const seed = R() * 50;
    const cols = new Float32Array(pos.count * 3);
    const cTop = new THREE.Color(o.colTop ?? 0x7d8a63), cHi = new THREE.Color(o.colHi ?? 0xb3aa9a), cLo = new THREE.Color(o.colLo ?? 0x7b7469), tmp = new THREE.Color();
    for (let k = 0; k < pos.count; k++) {
      let x = pos.getX(k), y = pos.getY(k), z = pos.getZ(k);
      const t = y / depth + 0.5;
      const n = fbm3(x * 0.15 + seed, y * 0.1, z * 0.15, 3);
      if (t < 0.999) {
        const s = 0.75 + n * 0.55;
        x *= s; z *= s; y += (n - 0.5) * depth * 0.15 * (1 - t);
      }
      pos.setXYZ(k, x, y, z);
      tmp.copy(cLo).lerp(cHi, Math.pow(clamp(t, 0, 1), 0.7));
      if (t > 0.9 + (n - 0.5) * 0.1) tmp.lerp(cTop, 0.75);
      tmp.multiplyScalar(0.8 + n * 0.4);
      cols[k * 3] = tmp.r; cols[k * 3 + 1] = tmp.g; cols[k * 3 + 2] = tmp.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    g.computeVertexNormals();
    return this.add(key, g, { pos: [p[0], p[1] - depth / 2, p[2]], rotY: o.rotY || 0, cast: false, receive: o.receive ?? true, tile: o.tile, facet: true });
  }

  // 松树：略斜的树干 + 若干扁平的针叶“云片”（迎客松式）
  pine(key, keyTrunk, p, h, R) {
    const lean = (R() - 0.5) * 0.25, dir = R() * TAU;
    const tx = Math.cos(dir) * Math.sin(lean) * h * 0.8, tz = Math.sin(dir) * Math.sin(lean) * h * 0.8;
    const g = new THREE.CylinderGeometry(h * 0.025, h * 0.05, h * 0.85, 6, 1);
    g.translate(0, h * 0.425, 0);
    const pp = g.attributes.position;
    for (let i = 0; i < pp.count; i++) { const t = pp.getY(i) / (h * 0.85); pp.setX(i, pp.getX(i) + tx * t); pp.setZ(i, pp.getZ(i) + tz * t); }
    g.computeVertexNormals();
    this.add(keyTrunk, g, { pos: p, swap: true });
    const pads = 4 + Math.floor(R() * 2);
    for (let i = 0; i < pads; i++) {
      const t = 0.45 + 0.55 * i / (pads - 1);
      const side = i === pads - 1 ? 0 : (0.5 + R() * 0.6) * (1 - t * 0.6);
      const a = R() * TAU;
      const r = h * (0.32 - t * 0.14) * (0.8 + R() * 0.4);
      const s = new THREE.SphereGeometry(1, 7, 4);
      this.add(key, s, {
        pos: [p[0] + tx * t + Math.cos(a) * side * r, p[1] + h * 0.85 * t, p[2] + tz * t + Math.sin(a) * side * r],
        rot: [0, R() * 3, 0], scale: [r, r * 0.32, r * (0.7 + R() * 0.3)], uv: 'keep', facet: true,
      });
    }
  }

  // ---------- 火焰/光晕（公告板，合并成一个网格） ----------
  flame(p, size = 1, kind = 'fire') { this.flames.push({ p, size, kind, seed: Math.random() * 100 }); }
  glow(p, size, color, strength = 1) { this.glows.push({ p, size, color: new THREE.Color(color), strength }); }

  _buildFlames() {
    if (!this.flames.length) return;
    const n = this.flames.length;
    const pos = new Float32Array(n * 12), off = new Float32Array(n * 8), uv = new Float32Array(n * 8), seed = new Float32Array(n * 4), kind = new Float32Array(n * 4);
    const idx = [];
    const corners = [[0, 0], [1, 0], [1, 1], [0, 1]];
    this.flames.forEach((f, i) => {
      for (let k = 0; k < 4; k++) {
        const j = i * 4 + k;
        pos.set(f.p, j * 3);
        const c = corners[k];
        off[j * 2] = (c[0] - 0.5) * 0.7 * f.size; off[j * 2 + 1] = (c[1] - 0.08) * 1.25 * f.size;
        uv[j * 2] = c[0]; uv[j * 2 + 1] = c[1];
        seed[j] = f.seed; kind[j] = f.kind === 'blue' ? 1 : 0;
      }
      const b = i * 4; idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aOff', new THREE.BufferAttribute(off, 2));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    g.setAttribute('aKind', new THREE.BufferAttribute(kind, 1));
    g.setIndex(idx);
    const m = new THREE.ShaderMaterial({
      uniforms: { uTime: this.uTime },
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: /* glsl */`
        attribute vec2 aOff; attribute float aSeed; attribute float aKind;
        uniform float uTime; varying vec2 vUv; varying float vSeed; varying float vKind;
        void main(){ vUv = uv; vSeed = aSeed; vKind = aKind;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          float fl = 1.0 + 0.1 * sin(uTime * 13.0 + aSeed * 7.0) + 0.07 * sin(uTime * 23.0 + aSeed * 3.0);
          mv.xy += vec2(aOff.x * (2.0 - fl) , aOff.y * fl);
          gl_Position = projectionMatrix * mv; }`,
      fragmentShader: /* glsl */`
        uniform float uTime; varying vec2 vUv; varying float vSeed; varying float vKind;
        ${GLSL_NOISE}
        void main(){
          float y = vUv.y;
          float n = fbm2(vec2(vUv.x * 3.0 + vSeed, y * 2.4 - uTime * 2.6));
          float x = (vUv.x - 0.5) * 2.0 + (n - 0.5) * 0.7 * y;
          float w = (1.0 - pow(y, 1.3)) * (0.5 + 0.5 * smoothstep(0.0, 0.3, y));
          float shape = 1.0 - smoothstep(w * 0.45, w, abs(x));
          shape *= smoothstep(0.0, 0.08, y) * (1.0 - smoothstep(0.5, 1.0, y + (n - 0.5) * 0.6));
          float core = shape * (1.0 - smoothstep(0.0, 0.5, abs(x) / max(w, 0.01))) * (1.0 - y);
          vec3 a = mix(vec3(1.0, 0.22, 0.03), vec3(0.05, 0.35, 1.0), vKind);
          vec3 b = mix(vec3(1.0, 0.62, 0.16), vec3(0.3, 0.8, 1.0), vKind);
          vec3 col = mix(a, b, shape) + vec3(1.0, 0.95, 0.8) * core * 1.2;
          gl_FragColor = vec4(col * shape * 1.6, shape);
          #include <colorspace_fragment>
        }`,
    });
    const mesh = new THREE.Mesh(g, m);
    mesh.frustumCulled = false; mesh.renderOrder = 10; mesh.name = 'flames';
    this.group.add(mesh);
    this.disposables.push(g, m);
  }

  _buildGlows() {
    if (!this.glows.length) return;
    const n = this.glows.length;
    const pos = new Float32Array(n * 12), off = new Float32Array(n * 8), col = new Float32Array(n * 16);
    const idx = [];
    const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
    this.glows.forEach((f, i) => {
      for (let k = 0; k < 4; k++) {
        const j = i * 4 + k;
        pos.set(f.p, j * 3);
        off[j * 2] = corners[k][0] * f.size; off[j * 2 + 1] = corners[k][1] * f.size;
        col[j * 4] = f.color.r; col[j * 4 + 1] = f.color.g; col[j * 4 + 2] = f.color.b; col[j * 4 + 3] = f.strength;
      }
      const b = i * 4; idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aOff', new THREE.BufferAttribute(off, 2));
    g.setAttribute('aCol', new THREE.BufferAttribute(col, 4));
    g.setIndex(idx);
    const m = new THREE.ShaderMaterial({
      uniforms: { uTime: this.uTime },
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: /* glsl */`
        attribute vec2 aOff; attribute vec4 aCol; varying vec2 vO; varying vec4 vC; uniform float uTime;
        void main(){ vO = sign(aOff); vC = aCol;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          mv.xy += aOff; mv.z += length(aOff) * 0.5;
          gl_Position = projectionMatrix * mv; }`,
      fragmentShader: /* glsl */`
        varying vec2 vO; varying vec4 vC;
        void main(){ float d = length(vO); float a = pow(max(1.0 - d, 0.0), 2.2) * vC.a;
          gl_FragColor = vec4(vC.rgb * a, a);
          #include <colorspace_fragment>
        }`,
    });
    const mesh = new THREE.Mesh(g, m);
    mesh.frustumCulled = false; mesh.renderOrder = 11; mesh.name = 'glows';
    this.group.add(mesh);
    this.disposables.push(g, m);
  }

  // ---------- 体积光束：从窗口四角沿光线方向延伸到地面 ----------
  beams(list, color = 0xfff0d0, intensity = 0.12) {
    const d = this.sunDir.clone().negate();
    const pos = [], uv = [], idx = [];
    for (const corners of list) {
      const far = corners.map(c => { const t = c[1] / -d.y; return [c[0] + d.x * t, 0.02, c[2] + d.z * t]; });
      for (let i = 0; i < 4; i++) {
        const a = corners[i], b = corners[(i + 1) % 4], fa = far[i], fb = far[(i + 1) % 4];
        const base = pos.length / 3;
        pos.push(...a, ...b, ...fb, ...fa);
        uv.push(0, 0, 1, 0, 1, 1, 0, 1);
        idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    const m = new THREE.ShaderMaterial({
      uniforms: { uTime: this.uTime, uColor: { value: new THREE.Color(color) }, uI: { value: intensity } },
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      vertexShader: /* glsl */`
        varying vec2 vUv; varying vec3 vW;
        void main(){ vUv = uv; vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
      fragmentShader: /* glsl */`
        uniform vec3 uColor; uniform float uI; uniform float uTime; varying vec2 vUv; varying vec3 vW;
        void main(){
          float edge = smoothstep(0.0, 0.3, vUv.x) * smoothstep(1.0, 0.7, vUv.x);
          float along = pow(1.0 - vUv.y, 1.3) * smoothstep(0.0, 0.08, vUv.y);
          float shimmer = 0.8 + 0.2 * sin(uTime * 0.6 + vW.x * 1.7 + vW.z * 1.1 + vW.y * 0.8);
          float a = edge * along * shimmer * uI;
          gl_FragColor = vec4(uColor * a, a);
          #include <colorspace_fragment>
        }`,
    });
    const mesh = new THREE.Mesh(g, m);
    mesh.renderOrder = 12; mesh.name = 'lightbeams';
    this.group.add(mesh);
    this.disposables.push(g, m);
    return mesh;
  }

  // ---------- 粒子（灰尘/雪） ----------
  particles(o) {
    const n = this.low ? Math.floor(o.count * 0.4) : o.count;
    const R = rng(o.seed ?? 3);
    const pos = new Float32Array(n * 3), seed = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      pos[i * 3] = lerp(o.min[0], o.max[0], R());
      pos[i * 3 + 1] = lerp(o.min[1], o.max[1], R());
      pos[i * 3 + 2] = lerp(o.min[2], o.max[2], R());
      seed[i] = R();
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    const uPixel = { value: 500 };
    const m = new THREE.ShaderMaterial({
      uniforms: {
        uTime: this.uTime, uPixel, uSize: { value: o.size ?? 0.05 }, uFall: { value: o.fall ?? 0.5 },
        uMin: { value: new THREE.Vector3(...o.min) }, uSizeBox: { value: new THREE.Vector3(o.max[0] - o.min[0], o.max[1] - o.min[1], o.max[2] - o.min[2]) },
        uColor: { value: new THREE.Color(o.color ?? 0xffffff) }, uOpacity: { value: o.opacity ?? 0.8 }, uSway: { value: o.sway ?? 0.4 },
      },
      transparent: true, depthWrite: false, blending: o.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      vertexShader: /* glsl */`
        uniform float uTime, uPixel, uSize, uFall, uSway; uniform vec3 uMin, uSizeBox;
        attribute float aSeed; varying float vA;
        void main(){
          vec3 p = position;
          float yy = mod(p.y - uMin.y - uTime * uFall * (0.6 + 0.8 * aSeed), uSizeBox.y);
          p.y = uMin.y + yy;
          p.x += sin(uTime * 0.7 + aSeed * 40.0) * uSway; p.z += cos(uTime * 0.55 + aSeed * 23.0) * uSway;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = clamp(uSize * (0.6 + aSeed * 0.8) * uPixel / -mv.z, 0.0, 24.0);
          vA = smoothstep(0.0, 0.08, yy / uSizeBox.y) * smoothstep(1.0, 0.85, yy / uSizeBox.y) * smoothstep(0.3, 1.5, -mv.z);
        }`,
      fragmentShader: /* glsl */`
        uniform vec3 uColor; uniform float uOpacity; varying float vA;
        void main(){ float d = length(gl_PointCoord - 0.5); float a = smoothstep(0.5, 0.15, d) * vA * uOpacity;
          gl_FragColor = vec4(uColor, a);
          #include <colorspace_fragment>
        }`,
    });
    const pts = new THREE.Points(g, m);
    pts.frustumCulled = false; pts.renderOrder = 13; pts.name = o.name || 'particles';
    this.group.add(pts);
    this.disposables.push(g, m);
    const r = this.ctx.renderer, vs = new THREE.Vector2();
    this.updaters.push(() => { if (r) { r.getDrawingBufferSize(vs); uPixel.value = vs.y / 1.4; } });
    return pts;
  }

  // ---------- 旗帜（画布贴图 + 顶点摆动） ----------
  // variants: [{bg, trim, emblem}] ; 旗帜 p 为顶边中点
  bannerTex(variants) {
    const cloth = this.ctx.tex('cloth');
    const W = 128, H = 384;
    return canvasTex(W * variants.length, H, (g) => {
      variants.forEach((v, i) => {
        const x0 = i * W;
        g.save();
        g.beginPath();
        g.moveTo(x0, 0); g.lineTo(x0 + W, 0); g.lineTo(x0 + W, H * 0.86); g.lineTo(x0 + W / 2, H); g.lineTo(x0, H * 0.86); g.closePath();
        g.clip();
        const grd = g.createLinearGradient(0, 0, 0, H);
        grd.addColorStop(0, v.bg); grd.addColorStop(1, v.bg2 || v.bg);
        g.fillStyle = grd; g.fillRect(x0, 0, W, H);
        if (cloth && cloth.image && cloth.image.width) {
          g.globalCompositeOperation = 'multiply'; g.globalAlpha = 0.55;
          g.drawImage(cloth.image, x0, 0, W, H);
          g.globalCompositeOperation = 'source-over'; g.globalAlpha = 1;
        }
        g.strokeStyle = v.trim; g.lineWidth = 6;
        g.beginPath(); g.moveTo(x0 + 10, 8); g.lineTo(x0 + 10, H * 0.84); g.lineTo(x0 + W / 2, H * 0.965); g.lineTo(x0 + W - 10, H * 0.84); g.lineTo(x0 + W - 10, 8); g.stroke();
        g.fillStyle = v.trim; g.fillRect(x0, 0, W, 22);
        // 纹章：菱形 + 剑形
        const cx = x0 + W / 2, cy = H * 0.4;
        g.lineWidth = 5; g.strokeStyle = v.emblem || v.trim;
        g.beginPath(); g.moveTo(cx, cy - 58); g.lineTo(cx + 40, cy); g.lineTo(cx, cy + 58); g.lineTo(cx - 40, cy); g.closePath(); g.stroke();
        g.fillStyle = v.emblem || v.trim;
        g.beginPath(); g.moveTo(cx, cy - 44); g.lineTo(cx + 7, cy + 18); g.lineTo(cx, cy + 34); g.lineTo(cx - 7, cy + 18); g.closePath(); g.fill();
        g.fillRect(cx - 22, cy + 14, 44, 5);
        g.beginPath(); g.arc(cx, cy + 90, 9, 0, TAU); g.fill();
        g.restore();
      });
    });
  }
  banner(p, rotY, w, h, variant = 0) { this.banners.push({ p, rotY, w, h, variant }); }

  _buildBanners() {
    if (!this.banners.length || !this.bannerVariants) return;
    if (this.ctx.debugSkip && this.ctx.debugSkip.includes('banners')) return;
    const tex = this.bannerTex(this.bannerVariants);
    const NV = this.bannerVariants.length;
    const geos = this.banners.map(b => {
      const g = new THREE.PlaneGeometry(b.w, b.h, 1, 8);
      g.translate(0, -b.h / 2, 0);
      const uv = g.attributes.uv;
      const sway = new Float32Array(uv.count);
      for (let i = 0; i < uv.count; i++) { uv.setX(i, (b.variant + uv.getX(i)) / NV); const t = 1 - uv.getY(i); sway[i] = t * t * b.h * 0.12; }
      g.setAttribute('aSway', new THREE.BufferAttribute(sway, 1));
      g.applyMatrix4(matrixFrom({ pos: b.p, rotY: b.rotY }));
      return g;
    });
    const g = mergeGeometries(geos, false);
    geos.forEach(x => x.dispose());
    const m = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.92, side: THREE.DoubleSide, alphaTest: 0.5 });
    const uTime = this.uTime;
    m.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = uTime;
      sh.vertexShader = 'uniform float uTime;\nattribute float aSway;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
        float ph = uTime * 1.6 + position.x * 0.45 + position.z * 0.35;
        transformed += objectNormal * aSway * (sin(ph) * 0.55 + sin(ph * 2.3 + position.y * 1.7) * 0.25);`);
    };
    const mesh = new THREE.Mesh(g, m);
    mesh.castShadow = true; mesh.receiveShadow = true; mesh.name = 'banners';
    this.group.add(mesh);
    this.disposables.push(g, m, tex);
  }

  // ---------- 收尾 ----------
  finish() {
    for (const b of this.buckets.values()) {
      let geos = b.geos;
      if (geos.some(g => !g.index)) geos = geos.map(g => (g.index ? g.toNonIndexed() : g));
      const merged = mergeGeometries(geos, false);
      if (!merged) { console.warn('level kit: merge failed for', b.key); continue; }
      b.geos.forEach(g => g.dispose());
      merged.computeBoundingSphere();
      const mesh = new THREE.Mesh(merged, this.mats.get(b.key).mat);
      mesh.castShadow = b.cast; mesh.receiveShadow = b.recv; mesh.name = b.key;
      mesh.matrixAutoUpdate = false;
      this.group.add(mesh);
      this.disposables.push(merged);
    }
    this.buckets.clear();
    this._buildFlames();
    this._buildGlows();
    this._buildBanners();
  }

  // 用关卡自身在某点烘一张 PMREM 环境图，给金属/石材一点环境反射。
  // 烘完读回一小块像素检查 NaN/Inf：坏了就换偏移重烘一次，再不行只用天空烘，最后放弃（材质无 envMap 也能正常显示）。
  bakeEnv(p, background, intensity = 1) {
    const r = this.ctx.renderer;
    if (!r || !r.isWebGLRenderer || this.ctx.noEnv) return;
    let pm = null;
    const parent = this.group.parent;
    const hidden = [];
    const valid = (rt) => {
      try {
        const w = Math.min(48, rt.width), h = Math.min(48, rt.height);
        const half = rt.texture.type === THREE.HalfFloatType;
        const buf = half ? new Uint16Array(w * h * 4) : (rt.texture.type === THREE.FloatType ? new Float32Array(w * h * 4) : null);
        if (!buf) return true;
        r.readRenderTargetPixels(rt, 0, 0, w, h, buf);
        let sum = 0;
        for (let i = 0; i < buf.length; i++) {
          if (half) { if ((buf[i] & 0x7c00) === 0x7c00) return false; sum += buf[i] & 0x7fff; }
          else { if (!Number.isFinite(buf[i])) return false; sum += Math.abs(buf[i]); }
        }
        return sum > 0;
      } catch (e) { return true; }
    };
    try {
      pm = new THREE.PMREMGenerator(r);
      const sc = new THREE.Scene();
      sc.background = background;
      sc.add(this.group);
      this.group.traverse(o => { if (o.isReflector || o.isPoints || (o.material && o.material.blending === THREE.AdditiveBlending)) { if (o.visible) { hidden.push(o); o.visible = false; } } });
      this.group.updateMatrixWorld(true);
      // 相机位置加一个小的无理偏移：正对扇形网格中心顶点时，凹凸贴图的导数会在环境图里产生 NaN（整张环境图变黑）
      const offs = [[0.1371, 0.0713, 0.0927], [-0.3119, 0.1537, 0.2473]];
      let rt = null;
      for (const o of offs) {
        rt = pm.fromScene(sc, 0.02, 0.1, 800, { position: new THREE.Vector3(p[0] + o[0], p[1] + o[1], p[2] + o[2]) });
        if (valid(rt)) break;
        console.warn('level kit: env bake invalid, retrying');
        rt.dispose(); rt = null;
      }
      sc.remove(this.group);
      if (!rt && this.skyMat) {
        const skyOnly = new THREE.Scene();
        skyOnly.background = background;
        const m = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), this.skyMat);
        m.frustumCulled = false;
        skyOnly.add(m);
        rt = pm.fromScene(skyOnly, 0.04, 0.1, 800);
        m.geometry.dispose();
        if (!valid(rt)) { rt.dispose(); rt = null; }
      }
      if (rt) {
        this.envRT = rt;
        for (const { mat } of this.mats.values()) {
          if (this.noEnv.has(mat)) continue;
          mat.envMap = rt.texture;
          mat.envMapIntensity = intensity * (mat.userData.envScale ?? 1);
          mat.needsUpdate = true;
        }
      } else console.warn('level kit: env bake disabled');
    } catch (e) { console.warn('level kit: env bake failed', e); }
    finally {
      hidden.forEach(o => (o.visible = true));
      if (this.group.parent && this.group.parent !== parent) this.group.parent.remove(this.group);
      if (parent && this.group.parent !== parent) parent.add(this.group);
      if (pm) pm.dispose();
    }
  }

  result(extra) {
    const kit = this;
    const updaters = this.updaters;
    return {
      id: this.id, name: this.name, group: this.group, colliders: this.colliders,
      sun: this.sunLight, mirrors: this.mirrors,
      environment: this.envRT ? this.envRT.texture : null,
      update(dt, t) { kit.uTime.value = t; for (const u of updaters) u(dt, t); },
      dispose() {
        for (const m of kit.mirrors) { m.dispose && m.dispose(); }
        for (const d of kit.disposables) d.dispose && d.dispose();
        if (kit.envRT) kit.envRT.dispose();
        kit.group.removeFromParent();
        kit.group.clear();
      },
      ...extra,
    };
  }
}
