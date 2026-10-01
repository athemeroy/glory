// 程序化人形角色：骨骼层级 + 衣装 + 发型。镜子、第一人称低头与他人视角共用同一个身体。
import * as THREE from 'three';

const matCache = new Map();
// 共享缓存按对象记录；material.clone() 不会继承所有权，实例材质可以正常释放。
const sharedResources = new WeakSet();
export function markSharedResource(resource) { sharedResources.add(resource); return resource; }
export function mat(color, opts = {}) {
  const key = color + JSON.stringify(opts);
  let m = matCache.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({
      color: new THREE.Color(color),
      roughness: opts.rough ?? 0.72,
      metalness: opts.metal ?? 0.0,
      emissive: opts.emissive ? new THREE.Color(opts.emissive) : new THREE.Color(0x000000),
      emissiveIntensity: opts.ei ?? 1,
      side: opts.side ?? THREE.FrontSide,
      transparent: !!opts.transparent,
      opacity: opts.opacity ?? 1,
      flatShading: !!opts.flat,
    });
    matCache.set(key, m);
    sharedResources.add(m);
  }
  return m;
}

// 两端半径不同的胶囊（从 y=0 向下延伸 len）
const geoCache = new Map();
export function taper(len, rTop, rBot, radial = 10) {
  const key = `t${len.toFixed(3)}_${rTop.toFixed(3)}_${rBot.toFixed(3)}_${radial}`;
  if (geoCache.has(key)) return geoCache.get(key);
  const pts = [];
  const n = 5;
  for (let i = 0; i <= n; i++) {
    const a = -Math.PI / 2 + (i / n) * (Math.PI / 2);
    pts.push(new THREE.Vector2(Math.max(0.0001, rBot * Math.cos(a)), -len + rBot * Math.sin(a)));
  }
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * (Math.PI / 2);
    pts.push(new THREE.Vector2(Math.max(0.0001, rTop * Math.cos(a)), rTop * Math.sin(a)));
  }
  const g = new THREE.LatheGeometry(pts, radial);
  geoCache.set(key, g);
  sharedResources.add(g);
  return g;
}

// 按 [半径, 高度] 轮廓旋转成体，再压扁成椭圆截面
function lathe(profile, sx = 1, sz = 1, radial = 14, thetaStart = 0, thetaLen = Math.PI * 2) {
  const g = new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(r, y)), radial, thetaStart, thetaLen);
  g.scale(sx, 1, sz);
  return g;
}

function mesh(geo, material, parent, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geo, material);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = false;
  if (parent) parent.add(m);
  return m;
}

function bone(name, parent, x, y, z) {
  const b = new THREE.Group();
  b.name = name;
  b.position.set(x, y, z);
  parent.add(b);
  return b;
}

export const DEFAULT_LOOK = {
  sex: 'm', skin: '#efd2bb', hair: { style: 'spiky', color: '#1d1f26' }, eyes: '#2a3140',
  top: { style: 'coat', color: '#e7e2d7', trim: '#a98954', inner: '#2b3038' },
  pants: '#2b2f37', boots: '#3a2c24', gloves: '#2a2622', scarf: null, sash: '#4d9d9a',
  shoulder: 'light', accent: '#4d9d9a', build: 1,
};

// 构建角色。返回 rig：{ root, body, bones, headParts, parts, look, height, eyeHeight, sockets }
export function buildCharacter(lookIn = {}) {
  const look = { ...DEFAULT_LOOK, ...lookIn, hair: { ...DEFAULT_LOOK.hair, ...(lookIn.hair || {}) }, top: { ...DEFAULT_LOOK.top, ...(lookIn.top || {}) } };
  const f = look.sex === 'f';
  const W = (look.build || 1) * (f ? 0.9 : 1);
  const skin = mat(look.skin, { rough: 0.6 });
  const topM = mat(look.top.color, { rough: 0.8 });
  const trimM = mat(look.top.trim, { rough: 0.45, metal: 0.55 });
  const innerM = mat(look.top.inner || '#2b3038', { rough: 0.85 });
  const pantsM = mat(look.pants, { rough: 0.85 });
  const bootsM = mat(look.boots, { rough: 0.55, metal: 0.05 });
  const glovesM = mat(look.gloves, { rough: 0.6 });
  const hairM = mat(look.hair.color, { rough: 0.55 });
  const accentM = mat(look.accent, { rough: 0.4, emissive: look.accent, ei: 0.25 });

  const root = new THREE.Group(); root.name = 'charRoot';
  const body = bone('body', root, 0, 0, 0);
  const hips = bone('hips', body, 0, 0.95, 0);
  const spine = bone('spine', hips, 0, 0.12, 0);
  const chest = bone('chest', spine, 0, 0.2, 0);
  const neck = bone('neck', chest, 0, 0.2, 0);
  const head = bone('head', neck, 0, 0.05, 0);
  const shX = 0.19 * W;
  const shL = bone('shL', chest, shX, 0.17, 0);
  const elL = bone('elL', shL, 0, -0.29, 0);
  const haL = bone('haL', elL, 0, -0.26, 0);
  const shR = bone('shR', chest, -shX, 0.17, 0);
  shL.rotation.order = 'YXZ'; shR.rotation.order = 'YXZ'; // 先外展，再前抬，最后水平摆动
  const neckOrder = 'YXZ'; neck.rotation.order = neckOrder; head.rotation.order = neckOrder;
  const elR = bone('elR', shR, 0, -0.29, 0);
  const haR = bone('haR', elR, 0, -0.26, 0);
  const hx = (f ? 0.105 : 0.1) * W;
  const thL = bone('thL', hips, hx, -0.04, 0);
  const knL = bone('knL', thL, 0, -0.45, 0);
  const ftL = bone('ftL', knL, 0, -0.43, 0);
  const thR = bone('thR', hips, -hx, -0.04, 0);
  const knR = bone('knR', thR, 0, -0.45, 0);
  const ftR = bone('ftR', knR, 0, -0.43, 0);
  // 衣摆骨（动画里随腿摆动）
  const skL = bone('skL', hips, 0.09 * W, 0.0, 0.02);
  const skR = bone('skR', hips, -0.09 * W, 0.0, 0.02);
  const skB = bone('skB', hips, 0, 0.02, -0.06);

  const parts = [];
  const add = (m) => { parts.push(m); return m; };

  // ---- 躯干 ----
  const torsoProfile = f
    ? [[0.001, -0.02], [0.13, -0.01], [0.145, 0.06], [0.12, 0.16], [0.118, 0.22], [0.14, 0.3], [0.15, 0.38], [0.12, 0.44], [0.06, 0.47], [0.001, 0.475]]
    : [[0.001, -0.02], [0.125, -0.01], [0.135, 0.07], [0.13, 0.16], [0.14, 0.24], [0.165, 0.33], [0.17, 0.4], [0.13, 0.46], [0.06, 0.48], [0.001, 0.485]];
  // 内衬躯干（hips 局部，从腰到颈根）
  add(mesh(lathe(torsoProfile, W, 0.68, 16), innerM, hips, 0, 0.02, 0));
  // 骨盆
  add(mesh(lathe([[0.001, -0.12], [0.1, -0.11], [0.14, -0.05], [0.145, 0.02], [0.13, 0.08], [0.001, 0.09]], W * (f ? 1.08 : 1), 0.72, 14), pantsM, hips, 0, 0, 0));
  // 腰带
  const belt = add(mesh(new THREE.TorusGeometry(0.135, 0.022, 6, 20), mat('#3b2f25', { rough: 0.5 }), hips, 0, 0.05, 0));
  belt.rotation.x = Math.PI / 2; belt.scale.set(W * 1.02, 0.72, 1);
  add(mesh(new THREE.BoxGeometry(0.06, 0.05, 0.02), trimM, hips, 0, 0.05, 0.1));

  // 外衣（按样式）
  const st = look.top.style;
  if (st === 'coat' || st === 'jacket' || st === 'robe' || st === 'vest') {
    const outerProfile = torsoProfile.map(([r, y]) => [r * 1.08 + 0.004, y]);
    // 前襟敞开：只转 330°
    const outer = add(mesh(lathe(outerProfile.slice(1, -1), W, 0.7, 18, Math.PI * 0.08, Math.PI * 1.84), topM, spine, 0, -0.1, 0));
    outer.material = mat(look.top.color, { rough: 0.8, side: THREE.DoubleSide });
    // 领子
    const collar = add(mesh(new THREE.CylinderGeometry(0.075, 0.095, 0.08, 14, 1, true, Math.PI * 0.2, Math.PI * 1.6), mat(look.top.color, { rough: 0.8, side: THREE.DoubleSide }), chest, 0, 0.22, -0.005));
    collar.userData.fpHide = true;
    collar.scale.set(W, 1, 0.9);
    // 前襟饰边
    for (const s of [-1, 1]) {
      const tr = add(mesh(new THREE.BoxGeometry(0.018, 0.4, 0.012), trimM, spine, s * 0.045 * W, 0.12, 0.118));
      tr.rotation.z = s * 0.1;
    }
    if (st === 'coat' || st === 'robe') {
      const len = st === 'robe' ? 0.78 : 0.52;
      const skirtGeo = (w) => { const g = new THREE.BoxGeometry(w, len, 0.02); g.translate(0, -len / 2, 0); return g; };
      const sm = mat(look.top.color, { rough: 0.8, side: THREE.DoubleSide });
      const pl = add(mesh(skirtGeo(0.13 * W), sm, skL, 0.03, 0, 0.085)); pl.rotation.y = 0.35;
      const pr = add(mesh(skirtGeo(0.13 * W), sm, skR, -0.03, 0, 0.085)); pr.rotation.y = -0.35;
      add(mesh(skirtGeo(0.3 * W), sm, skB, 0, 0, -0.03));
      for (const s of [-1, 1]) {
        const side = add(mesh(skirtGeo(0.11), sm, s > 0 ? skL : skR, s * 0.085 * W, 0, -0.02));
        side.rotation.y = s * Math.PI / 2;
      }
      // 下摆饰边
      add(mesh(new THREE.BoxGeometry(0.3 * W, 0.025, 0.025), trimM, skB, 0, -len, -0.03));
    }
  } else if (st === 'armor') {
    const plate = mat(look.top.color, { rough: 0.35, metal: 0.75 });
    add(mesh(lathe(torsoProfile.slice(2, -1).map(([r, y]) => [r * 1.15 + 0.01, y]), W, 0.78, 16), plate, spine, 0, -0.1, 0));
    // 腰甲
    for (let i = 0; i < 5; i++) {
      const a = (i - 2) * 0.55;
      const fd = add(mesh(new THREE.BoxGeometry(0.1, 0.2, 0.02), plate, hips, Math.sin(a) * 0.15 * W, -0.06, Math.cos(a) * 0.12));
      fd.rotation.y = a; fd.rotation.x = 0.12;
    }
    const gorget = add(mesh(new THREE.CylinderGeometry(0.08, 0.12, 0.07, 14), plate, chest, 0, 0.21, 0));
    gorget.userData.fpHide = true;
    gorget.scale.z = 0.85;
  }
  if (look.sash) {
    const sash = add(mesh(new THREE.BoxGeometry(0.07, 0.34, 0.012), mat(look.sash, { rough: 0.7, side: THREE.DoubleSide }), hips, 0.07 * W, -0.12, 0.125));
    sash.rotation.z = 0.08;
  }
  if (look.scarf) {
    const sc = add(mesh(new THREE.TorusGeometry(0.085, 0.03, 8, 16), mat(look.scarf, { rough: 0.8 }), chest, 0, 0.2, 0));
    sc.userData.fpHide = true;
    sc.rotation.x = Math.PI / 2;
    const tail = add(mesh(new THREE.BoxGeometry(0.07, 0.3, 0.015), mat(look.scarf, { rough: 0.8, side: THREE.DoubleSide }), chest, 0.06, 0.08, -0.1));
    tail.rotation.set(0.25, 0, 0.1);
  }
  // 肩甲
  if (look.shoulder !== 'none') {
    const big = look.shoulder === 'heavy';
    for (const [s, sh] of [[1, shL], [-1, shR]]) {
      const pad = add(mesh(new THREE.SphereGeometry(big ? 0.1 : 0.075, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.55), mat(big ? look.top.trim : look.top.color, { rough: 0.4, metal: big ? 0.7 : 0.2 }), sh, s * 0.015, 0.02, 0));
      pad.scale.set(1.1, 0.9, 1.0);
      pad.rotation.z = -s * 0.25;
      if (big) add(mesh(new THREE.TorusGeometry(0.1, 0.012, 6, 16, Math.PI), trimM, sh, s * 0.01, 0.0, 0)).rotation.set(0, Math.PI / 2, 0);
    }
  }

  // ---- 脖子与头 ----
  const headParts = [];
  { const nk = add(mesh(taper(0.1, 0.045, 0.05, 10), skin, neck, 0, 0.08, 0)); headParts.push(nk); }
  const hp = (m) => { headParts.push(m); parts.push(m); return m; };
  const skull = hp(mesh(new THREE.SphereGeometry(0.105, 20, 16), skin, head, 0, 0.1, 0));
  skull.scale.set(0.92, 1.08, 1.0);
  const jaw = hp(mesh(new THREE.SphereGeometry(0.075, 14, 10), skin, head, 0, 0.045, 0.03));
  jaw.scale.set(1.0, 0.85, 1.05);
  hp(mesh(new THREE.ConeGeometry(0.014, 0.035, 6), skin, head, 0, 0.085, 0.11)).rotation.x = Math.PI / 2 + 0.3;
  const eyeM = mat(look.eyes, { rough: 0.3 });
  const whiteM = mat('#f5f2ee', { rough: 0.4 });
  for (const s of [-1, 1]) {
    const w = hp(mesh(new THREE.SphereGeometry(0.02, 10, 8), whiteM, head, s * 0.037, 0.105, 0.088));
    w.scale.set(1.25, 0.8, 0.5);
    const iris = hp(mesh(new THREE.SphereGeometry(0.0135, 10, 8), eyeM, head, s * 0.037, 0.104, 0.096));
    iris.scale.set(0.9, 1.1, 0.5);
    const brow = hp(mesh(new THREE.BoxGeometry(0.04, 0.007, 0.01), hairM, head, s * 0.037, 0.134, 0.097));
    brow.rotation.z = -s * 0.12;
    hp(mesh(new THREE.SphereGeometry(0.02, 8, 6), skin, head, s * 0.098, 0.095, 0.0)).scale.set(0.5, 1, 0.8);
  }
  hp(mesh(new THREE.BoxGeometry(0.03, 0.005, 0.005), mat('#a0645a'), head, 0, 0.047, 0.1));
  buildHair(look.hair, hairM, head, hp);

  // ---- 手臂 ----
  for (const [s, sh, el, ha] of [[1, shL, elL, haL], [-1, shR, elR, haR]]) {
    const sleeveM = st === 'vest' ? skin : (st === 'armor' ? mat(look.top.color, { rough: 0.35, metal: 0.75 }) : topM);
    add(mesh(taper(0.29, 0.056 * W, 0.046, 16), sleeveM, sh, 0, 0, 0));
    add(mesh(taper(0.26, 0.044, 0.035, 16), glovesM === skin ? skin : (st === 'robe' ? topM : skin), el, 0, 0, 0));
    // 护腕
    const cuff = add(mesh(new THREE.CylinderGeometry(0.043, 0.04, 0.1, 16), glovesM, el, 0, -0.2, 0));
    cuff.scale.z = 0.95;
    // 握拳：拳块 + 外侧指节 + 内侧指尖 + 贴合的拇指；握柄沿手掌前向（+Z）穿过拳心
    const fingerM = glovesM;
    add(mesh(roundBox(0.072, 0.074, 0.092), fingerM, ha, 0, -0.068, 0.0));
    for (let i = 0; i < 4; i++) {
      const fz = 0.03 - i * 0.02;
      add(mesh(new THREE.SphereGeometry(0.0125, 7, 5), fingerM, ha, -s * -0.033, -0.04, fz)).scale.set(0.9, 0.8, 1);   // 指节
      add(mesh(new THREE.SphereGeometry(0.012, 7, 5), fingerM, ha, s * 0.031, -0.095, fz)).scale.set(0.9, 1.1, 0.95);   // 指尖
    }
    const thumb = add(mesh(taper(0.05, 0.0135, 0.0115, 7), fingerM, ha, s * 0.036, -0.045, 0.043));
    thumb.rotation.set(0.25, 0, s * -0.15);
  }

  // ---- 腿 ----
  for (const [s, th, kn, ft] of [[1, thL, knL, ftL], [-1, thR, knR, ftR]]) {
    add(mesh(taper(0.45, 0.075 * W, 0.058, 14), pantsM, th, 0, 0, 0));
    add(mesh(taper(0.43, 0.056, 0.042, 10), pantsM, kn, 0, 0, 0));
    // 靴筒
    add(mesh(taper(0.24, 0.058, 0.05, 10), bootsM, kn, 0, -0.2, 0));
    // 护膝
    if (look.shoulder === 'heavy') add(mesh(new THREE.SphereGeometry(0.05, 8, 6, 0, Math.PI * 2, 0, Math.PI / 2), trimM, kn, 0, 0.0, 0.035)).rotation.x = Math.PI / 2;
    const foot = add(mesh(roundBox(0.085, 0.07, 0.22), bootsM, ft, 0, -0.035, 0.05));
    foot.castShadow = true;
  }

  // 小饰物：腰包 / 发光宝石
  add(mesh(new THREE.BoxGeometry(0.07, 0.08, 0.05), mat('#4a3a2c'), hips, -0.13 * W, -0.02, 0.04));
  add(mesh(new THREE.OctahedronGeometry(0.018), accentM, hips, 0, 0.05, 0.118));

  // 武器挂点
  const gripR = bone('gripR', haR, 0, -0.075, 0.0);
  const gripL = bone('gripL', haL, 0, -0.075, 0.0);
  gripR.rotation.x = Math.PI / 2; gripL.rotation.x = Math.PI / 2;
  const back = bone('back', chest, 0, 0.12, -0.16);

  const bones = { root, body, hips, spine, chest, neck, head, shL, elL, haL, shR, elR, haR, thL, knL, ftL, thR, knR, ftR, skL, skR, skB, gripR, gripL, back };
  for (const p of parts) { p.userData.charPart = true; if (p.userData.fpHide && !headParts.includes(p)) headParts.push(p); }
  return { root, body, bones, headParts, parts, look, height: 1.76, eyeHeight: 1.62 };
}

function roundBox(w, h, d) {
  const key = `rb${w}_${h}_${d}`;
  if (geoCache.has(key)) return geoCache.get(key);
  const g = new THREE.BoxGeometry(w, h, d, 2, 2, 2);
  const p = g.attributes.position; const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const nx = v.x / (w / 2), ny = v.y / (h / 2), nz = v.z / (d / 2);
    const k = 0.22;
    v.x *= 1 - k * (ny * ny + nz * nz) * 0.5;
    v.y *= 1 - k * (nx * nx + nz * nz) * 0.3;
    v.z *= 1 - k * (nx * nx + ny * ny) * 0.5;
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  geoCache.set(key, g);
  sharedResources.add(g);
  return g;
}

function buildHair(hair, hairM, head, hp) {
  const style = hair.style;
  if (style === 'bald') return;
  // 头顶发盖
  const cap = hp(mesh(new THREE.SphereGeometry(0.116, 18, 12, 0, Math.PI * 2, 0, Math.PI * 0.36), hairM, head, 0, 0.108, -0.012));
  cap.scale.set(0.98, 1.12, 1.06);
  const back = hp(mesh(new THREE.SphereGeometry(0.108, 14, 10, Math.PI * 0.9, Math.PI * 1.2, Math.PI * 0.3, Math.PI * 0.45), hairM, head, 0, 0.1, -0.01));
  back.scale.set(0.98, 1.1, 1.06);
  const spike = (len, r, x, y, z, rx, rz, ry = 0) => {
    const c = hp(mesh(new THREE.ConeGeometry(r, len, 5), hairM, head, x, y, z));
    c.rotation.set(rx, ry, rz);
    return c;
  };
  if (style === 'spiky' || style === 'short') {
    const big = style === 'spiky' ? 1 : 0.6;
    // 刘海
    for (let i = -2; i <= 2; i++) spike(0.05 * big + 0.03, 0.026, i * 0.03, 0.185, 0.08, 1.95, i * 0.28);
    // 头顶与后脑的尖刺
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2;
      spike(0.08 * big + 0.03, 0.035, Math.sin(a) * 0.07, 0.19, Math.cos(a) * 0.06 - 0.02, -Math.cos(a) * 1.0 - 0.3, Math.sin(a) * 1.0);
    }
    for (let i = -1; i <= 1; i++) spike(0.1 * big + 0.02, 0.035, i * 0.05, 0.1, -0.1, -2.2, i * 0.3);
    for (const s of [-1, 1]) spike(0.07, 0.022, s * 0.095, 0.1, 0.04, 3.0, -s * 0.2);
  } else if (style === 'long' || style === 'pony' || style === 'bun') {
    for (let i = -2; i <= 2; i++) spike(0.06, 0.03, i * 0.03, 0.18, 0.082, 2.0, i * 0.24);
    for (const s of [-1, 1]) {
      const lock = hp(mesh(taper(0.2, 0.03, 0.02, 6), hairM, head, s * 0.09, 0.14, 0.03));
      lock.rotation.z = s * 0.08;
    }
    if (style === 'long') {
      const panel = hp(mesh(taper(0.36, 0.085, 0.06, 10), hairM, head, 0, 0.12, -0.07));
      panel.scale.set(1.1, 1, 0.5);
      panel.rotation.x = 0.12;
    } else if (style === 'pony') {
      const tie = hp(mesh(new THREE.SphereGeometry(0.03, 8, 6), hairM, head, 0, 0.17, -0.1));
      const tail = hp(mesh(taper(0.3, 0.035, 0.015, 8), hairM, head, 0, 0.17, -0.12));
      tail.rotation.x = 0.35;
      tie.scale.set(1, 1, 1);
    } else {
      hp(mesh(new THREE.SphereGeometry(0.05, 10, 8), hairM, head, 0, 0.21, -0.07));
    }
  }
}

// 让某个角色的头部只在镜子/他人视角里出现（本地玩家第一人称隐藏）
export function setFirstPersonHidden(rig, hidden) {
  for (const m of rig.headParts) {
    if (hidden) { m.layers.set(1); } else { m.layers.set(0); }
  }
}

export function disposeRig(rig, { sharedRoots = [] } = {}) {
  if (!rig?.root) return;
  const keep = new Set(), sharedAttributes = new Set();
  const materials = (o) => Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
  for (const root of sharedRoots) root?.traverse((o) => {
    if (o.geometry) {
      keep.add(o.geometry);
      for (const attribute of Object.values(o.geometry.attributes)) sharedAttributes.add(attribute);
      for (const attributes of Object.values(o.geometry.morphAttributes)) for (const attribute of attributes) sharedAttributes.add(attribute);
      if (o.geometry.index) sharedAttributes.add(o.geometry.index);
    }
    for (const material of materials(o)) keep.add(material);
  });
  // 静态精模蒙皮分区按造型缓存，跨角色实例共享几何。
  if (rig.skinned) for (const mesh of Object.values(rig.skinned)) if (mesh?.geometry) keep.add(mesh.geometry);
  const geometries = new Set(), ownMaterials = new Set(), skeletons = new Set();
  rig.root.traverse((o) => {
    if (o.geometry && !keep.has(o.geometry) && !sharedResources.has(o.geometry)) geometries.add(o.geometry);
    for (const material of materials(o)) if (!keep.has(material) && !sharedResources.has(material)) ownMaterials.add(material);
    if (o.skeleton) skeletons.add(o.skeleton);
  });
  for (const geometry of geometries) {
    // 第一人称分区只拥有索引；dispose 时不能删除仍供源模型使用的属性 GPU 缓冲。
    const attributes = geometry.attributes, morphAttributes = geometry.morphAttributes, index = geometry.index;
    geometry.attributes = Object.fromEntries(Object.entries(attributes).filter(([, attribute]) => !sharedAttributes.has(attribute) && !sharedResources.has(attribute)));
    geometry.morphAttributes = Object.fromEntries(Object.entries(morphAttributes).map(([name, values]) => [name, values.filter((attribute) => !sharedAttributes.has(attribute) && !sharedResources.has(attribute))]));
    if (sharedAttributes.has(index) || sharedResources.has(index)) geometry.setIndex(null);
    try { geometry.dispose(); }
    finally { geometry.attributes = attributes; geometry.morphAttributes = morphAttributes; geometry.setIndex(index); }
  }
  for (const material of ownMaterials) material.dispose();
  for (const skeleton of skeletons) skeleton.dispose();
  // 材质贴图由预加载缓存持有；释放材质不会销毁贴图。
  rig.root.removeFromParent();
}
