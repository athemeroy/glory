// 程序化武器。约定：握点在原点，主轴 +Y（剑尖方向）。
import * as THREE from 'three';
import { mat } from './model.js';
import { lerp } from '../engine/util.js';

function m(geo, material, parent, x = 0, y = 0, z = 0) {
  const o = new THREE.Mesh(geo, material);
  o.position.set(x, y, z); o.castShadow = true;
  parent.add(o); return o;
}
function marker(parent, x, y, z) { const o = new THREE.Object3D(); o.position.set(x, y, z); parent.add(o); return o; }

// 细长剑身（菱形截面）
function bladeGeo(len, w, t, tipLen = 0.12) {
  const shape = new THREE.Shape();
  shape.moveTo(-w / 2, 0);
  shape.lineTo(-w / 2, len - tipLen);
  shape.lineTo(0, len);
  shape.lineTo(w / 2, len - tipLen);
  shape.lineTo(w / 2, 0);
  shape.lineTo(-w / 2, 0);
  const g = new THREE.ExtrudeGeometry(shape, { depth: t, bevelEnabled: true, bevelThickness: t * 0.5, bevelSize: w * 0.18, bevelSegments: 1 });
  g.translate(0, 0, -t / 2);
  return g;
}

let stripeTex = null;
function umbrellaTexture() {
  if (stripeTex) return stripeTex;
  const c = document.createElement('canvas'); c.width = 512; c.height = 64;
  const g = c.getContext('2d');
  for (let i = 0; i < 8; i++) {
    g.fillStyle = i % 2 ? '#e9e3d6' : '#d8d1c2';
    g.fillRect(i * 64, 0, 64, 64);
    g.fillStyle = '#4d9d9a'; g.fillRect(i * 64 + 26, 0, 12, 64);
    g.fillStyle = '#6b5a3a'; g.fillRect(i * 64, 0, 3, 64);
  }
  g.fillStyle = '#a98954'; g.fillRect(0, 56, 512, 8);
  stripeTex = new THREE.CanvasTexture(c);
  stripeTex.colorSpace = THREE.SRGBColorSpace;
  return stripeTex;
}

export function buildWeapon(type, opts = {}) {
  const root = new THREE.Group();
  root.name = 'weapon:' + type;
  const steel = mat(opts.steel || '#c9d2dc', { rough: 0.25, metal: 0.9 });
  const dark = mat('#2a2d33', { rough: 0.5, metal: 0.5 });
  const gold = mat('#a98954', { rough: 0.35, metal: 0.8 });
  const wood = mat('#5a3d27', { rough: 0.7 });
  const glow = (c, ei = 1.6) => mat(c, { rough: 0.3, emissive: c, ei });
  const W = { obj: root, type, tip: null, base: null, muzzle: null, left: null, update: null, setForm: null, form: null, twoHanded: false };

  switch (type) {
    case 'sword': { // 冰雨：细长直剑，冰蓝纹
      m(new THREE.CylinderGeometry(0.018, 0.02, 0.17, 8), mat('#2c3440'), root, 0, -0.03, 0);
      m(new THREE.SphereGeometry(0.028, 8, 6), gold, root, 0, -0.125, 0);
      const guard = m(new THREE.BoxGeometry(0.2, 0.025, 0.04), gold, root, 0, 0.065, 0);
      guard.geometry = new THREE.CylinderGeometry(0.018, 0.018, 0.2, 8); guard.rotation.z = Math.PI / 2;
      m(bladeGeo(0.86, 0.045, 0.012), steel, root, 0, 0.075, 0);
      m(new THREE.BoxGeometry(0.008, 0.62, 0.016), glow(opts.glow || '#7fd3ff', 1.2), root, 0, 0.42, 0);
      W.base = marker(root, 0, 0.12, 0); W.tip = marker(root, 0, 0.93, 0);
      break;
    }
    case 'greatsword': {
      m(new THREE.CylinderGeometry(0.022, 0.024, 0.34, 8), mat('#3a2a22'), root, 0, 0.0, 0);
      m(new THREE.BoxGeometry(0.34, 0.05, 0.07), dark, root, 0, 0.18, 0);
      m(bladeGeo(1.25, 0.16, 0.025, 0.22), mat('#b8bec6', { rough: 0.35, metal: 0.85 }), root, 0, 0.2, 0);
      m(new THREE.BoxGeometry(0.03, 0.9, 0.035), mat('#7a2630', { rough: 0.5 }), root, 0, 0.7, 0);
      W.base = marker(root, 0, 0.3, 0); W.tip = marker(root, 0, 1.43, 0); W.twoHanded = true;
      W.offhandGrip = new THREE.Vector3(0, -0.11, 0);
      break;
    }
    case 'spear': { // 却邪：战矛
      const shaft = m(new THREE.CylinderGeometry(0.02, 0.022, 2.0, 8), mat('#3b3f4a', { rough: 0.4, metal: 0.6 }), root, 0, 0.35, 0);
      shaft.name = 'shaft';
      for (const y of [-0.5, 0.0, 0.8]) m(new THREE.CylinderGeometry(0.027, 0.027, 0.05, 8), gold, root, 0, y, 0);
      m(new THREE.ConeGeometry(0.05, 0.12, 8), gold, root, 0, 1.36, 0);
      m(bladeGeo(0.36, 0.075, 0.018, 0.14), steel, root, 0, 1.4, 0);
      // 两翼
      for (const s of [-1, 1]) { const wg = m(new THREE.ConeGeometry(0.02, 0.14, 4), gold, root, s * 0.06, 1.38, 0); wg.rotation.z = -s * 2.4; }
      m(new THREE.ConeGeometry(0.025, 0.1, 6), gold, root, 0, -0.7, 0).rotation.x = Math.PI;
      // 缨
      m(new THREE.ConeGeometry(0.05, 0.16, 8, 1, true), mat('#b13a3a', { rough: 0.9, side: THREE.DoubleSide }), root, 0, 1.27, 0).rotation.x = Math.PI;
      W.base = marker(root, 0, 1.2, 0); W.tip = marker(root, 0, 1.76, 0); W.twoHanded = true;
      W.offhandGrip = new THREE.Vector3(0, -0.18, 0);
      break;
    }
    case 'gauntlet': { // 拳套：右手，左手另建
      const make = (parent) => {
        const g = new THREE.Group(); parent.add(g);
        m(new THREE.BoxGeometry(0.09, 0.05, 0.1), mat('#7a2e2a', { rough: 0.5, metal: 0.3 }), g, 0, 0.02, 0.0);
        for (let i = 0; i < 4; i++) m(new THREE.SphereGeometry(0.014, 6, 4), steel, g, -0.03 + i * 0.02, 0.05, 0.035);
        m(new THREE.CylinderGeometry(0.048, 0.045, 0.1, 10), mat('#2c2c30', { rough: 0.4, metal: 0.4 }), g, 0, -0.08, -0.03).rotation.x = Math.PI / 2;
        return g;
      };
      make(root);
      W.makeLeft = () => make(new THREE.Group());
      W.base = marker(root, 0, 0, 0); W.tip = marker(root, 0, 0.08, 0.02);
      break;
    }
    case 'umbrella': { // 千机伞
      const shaftM = mat('#2e3238', { rough: 0.35, metal: 0.7 });
      const shaft = m(new THREE.CylinderGeometry(0.016, 0.018, 1.0, 8), shaftM, root, 0, 0.35, 0);
      m(new THREE.CylinderGeometry(0.026, 0.024, 0.2, 8), mat('#3a2c24', { rough: 0.6 }), root, 0, -0.07, 0);
      m(new THREE.SphereGeometry(0.03, 8, 6), gold, root, 0, -0.18, 0);
      // 伞面
      const canopyMat = new THREE.MeshStandardMaterial({ map: umbrellaTexture(), roughness: 0.8, side: THREE.DoubleSide });
      canopyMat.userData.canopy = true;
      const canopy = new THREE.Mesh(new THREE.ConeGeometry(1, 1, 8, 1, true), canopyMat);
      canopy.castShadow = true;
      root.add(canopy);
      // 伞骨
      const ribs = [];
      for (let i = 0; i < 8; i++) {
        const r = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 1, 4), gold);
        root.add(r); ribs.push(r);
      }
      // 伞尖剑刃 / 矛头 / 枪口
      const blade = m(bladeGeo(0.36, 0.04, 0.01, 0.1), steel, root, 0, 0, 0);
      const spearHead = m(bladeGeo(0.24, 0.07, 0.014, 0.12), mat('#d7dde4', { rough: 0.2, metal: 0.9 }), root, 0, 0, 0);
      const barrel = m(new THREE.CylinderGeometry(0.022, 0.026, 0.28, 10), dark, root, 0, 0, 0);
      const trigger = m(new THREE.BoxGeometry(0.03, 0.09, 0.07), dark, root, 0, 0.12, 0.05);
      const tip = marker(root, 0, 1.0, 0);
      const muzzle = marker(root, 0, 1.0, 0);
      W.tip = tip; W.muzzle = muzzle; W.base = marker(root, 0, 0.5, 0);
      const cur = { open: 0, len: 1, blade: 1, spear: 0, gun: 0 };
      const target = { ...cur };
      const forms = {
        sword: { open: 0, len: 0.8, blade: 1, spear: 0, gun: 0 },
        spear: { open: 0, len: 1.45, blade: 0, spear: 1, gun: 0 },
        gun: { open: 0, len: 0.9, blade: 0, spear: 0, gun: 1 },
        shield: { open: 1, len: 0.85, blade: 0, spear: 0, gun: 0 },
      };
      const apply = () => {
        const L = cur.len;
        shaft.scale.y = L; shaft.position.y = L / 2 - 0.05;
        // 伞面：闭合时贴着伞杆（上端在 0.93L 处），张开时变成大圆锥
        const r = lerp(0.04, 0.62, cur.open);
        const h = lerp(0.55 * L, 0.3, cur.open);
        const apexY = lerp(0.9 * L, 0.9 * L, cur.open);
        canopy.scale.set(r, h, r);
        canopy.position.y = apexY - h / 2;
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
          const ex = Math.cos(a) * r, ez = Math.sin(a) * r, ey = apexY - h;
          const rb = ribs[i];
          const mx = ex / 2, my = (apexY + ey) / 2, mz = ez / 2;
          rb.position.set(mx, my, mz);
          const len = Math.hypot(ex, h, ez);
          rb.scale.y = len;
          rb.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(-ex, h, -ez).normalize());
        }
        blade.position.y = L * 0.95; blade.scale.set(1, Math.max(0.001, cur.blade), 1); blade.visible = cur.blade > 0.02;
        spearHead.position.y = L * 0.95; spearHead.scale.set(1, Math.max(0.001, cur.spear), 1); spearHead.visible = cur.spear > 0.02;
        barrel.position.y = L * 0.95 + 0.1; barrel.scale.set(cur.gun, Math.max(0.001, cur.gun), cur.gun); barrel.visible = cur.gun > 0.02;
        trigger.visible = cur.gun > 0.5;
        tip.position.y = L * 0.95 + 0.36 * cur.blade + 0.24 * cur.spear + 0.24 * cur.gun;
        muzzle.position.y = L * 0.95 + 0.25;
        W.base.position.y = L * 0.5;
      };
      apply();
      W.setForm = (f, instant = false) => { W.form = f; Object.assign(target, forms[f] || forms.sword); if (instant) { Object.assign(cur, target); apply(); } };
      W.update = (dt) => {
        let changed = false;
        for (const k in cur) {
          const d = target[k] - cur[k];
          if (Math.abs(d) > 0.001) { cur[k] += d * Math.min(1, dt * 16); changed = true; }
        }
        if (changed) apply();
      };
      W.setForm('sword', true);
      break;
    }
    case 'pistol': { // 荒火 / 碎霜 双枪
      const make = (parent, c) => {
        const g = new THREE.Group(); parent.add(g);
        // 枪管保持武器约定的 +Y；握把沿 +Z 垂下，与枪管成直角。
        m(new THREE.BoxGeometry(0.037, 0.052, 0.115), mat('#2b2b2f', { rough: 0.5 }), g, 0, -0.015, 0.012).rotation.x = 0.18;
        const body = m(new THREE.BoxGeometry(0.045, 0.255, 0.047), mat(c, { rough: 0.35, metal: 0.7 }), g, 0, 0.12, -0.055);
        body.name = 'slide';
        m(new THREE.CylinderGeometry(0.012, 0.012, 0.06, 10), dark, g, 0, 0.255, -0.055);
        // 护圈、准星和扳机，让近景轮廓可读。
        const guard = m(new THREE.TorusGeometry(0.027, 0.004, 5, 12), dark, g, 0, 0.055, -0.012); guard.rotation.y = Math.PI / 2;
        m(new THREE.BoxGeometry(0.006, 0.014, 0.009), dark, g, 0, 0.055, -0.019).rotation.x = 0.35;
        m(new THREE.BoxGeometry(0.011, 0.014, 0.009), dark, g, 0, 0.223, -0.082);
        const mz = marker(g, 0, 0.285, -0.055);
        return { g, mz };
      };
      const a = make(root, opts.color || '#8b3a2a');
      W.muzzle = a.mz; W.tip = a.mz; W.base = marker(root, 0, 0.1, -0.055);
      W.makeLeft = () => { const holder = new THREE.Group(); const b = make(holder, opts.colorL || '#5e7f9a'); holder.userData.muzzle = b.mz; return holder; };
      break;
    }
    case 'cannon': {
      // 炮管高于握点，双手握下方横柄，避免手掌被粗炮管吞进内部。
      const barrelZ = -0.14;
      const tube = m(new THREE.CylinderGeometry(0.09, 0.11, 1.05, 14), mat('#39414b', { rough: 0.35, metal: 0.8 }), root, 0, 0.25, barrelZ);
      tube.name = 'tube';
      m(new THREE.CylinderGeometry(0.12, 0.12, 0.08, 14), gold, root, 0, 0.72, barrelZ);
      m(new THREE.CylinderGeometry(0.115, 0.1, 0.12, 14), mat('#6a2d2d', { rough: 0.5, metal: 0.4 }), root, 0, -0.25, barrelZ);
      const handle = m(new THREE.CylinderGeometry(0.018, 0.018, 0.46, 10), dark, root, 0, -0.06, 0);
      handle.name = 'supportHandle';
      for (const y of [-0.28, 0.16]) m(new THREE.BoxGeometry(0.035, 0.035, 0.13), dark, root, 0, y, -0.065);
      m(new THREE.TorusGeometry(0.07, 0.012, 6, 14), glow('#ffb35a', 0.9), root, 0, 0.6, barrelZ).rotation.x = Math.PI / 2;
      W.muzzle = marker(root, 0, 0.8, barrelZ); W.tip = W.muzzle; W.base = marker(root, 0, 0.3, barrelZ); W.twoHanded = true;
      W.offhandGrip = new THREE.Vector3(0, -0.18, 0);
      break;
    }
    case 'staff': {
      m(new THREE.CylinderGeometry(0.018, 0.022, 1.6, 8), wood, root, 0, 0.3, 0);
      const orb = m(new THREE.IcosahedronGeometry(0.07, 1), glow(opts.glow || '#9ad0ff', 2.2), root, 0, 1.18, 0);
      orb.name = 'orb';
      for (let i = 0; i < 3; i++) { const p = m(new THREE.TorusGeometry(0.08, 0.008, 5, 12, Math.PI * 1.2), gold, root, 0, 1.18, 0); p.rotation.set(i, i * 2, 0); }
      W.muzzle = marker(root, 0, 1.18, 0); W.tip = W.muzzle; W.base = marker(root, 0, 0.8, 0);
      break;
    }
    case 'broom': { // 魔道学者扫帚
      m(new THREE.CylinderGeometry(0.018, 0.02, 1.4, 8), wood, root, 0, 0.3, 0);
      const bristle = m(new THREE.ConeGeometry(0.1, 0.4, 10), mat('#b99a5d', { rough: 0.95 }), root, 0, -0.55, 0);
      bristle.rotation.x = Math.PI;
      m(new THREE.TorusGeometry(0.035, 0.01, 6, 10), gold, root, 0, -0.35, 0).rotation.x = Math.PI / 2;
      m(new THREE.OctahedronGeometry(0.035), glow('#b58cff'), root, 0, 1.02, 0);
      W.muzzle = marker(root, 0, 1.05, 0); W.tip = W.muzzle; W.base = marker(root, 0, 0.5, 0);
      break;
    }
    case 'dagger': {
      const make = (parent) => {
        const g = new THREE.Group(); parent.add(g);
        m(new THREE.CylinderGeometry(0.015, 0.016, 0.1, 6), dark, g, 0, -0.01, 0);
        m(new THREE.BoxGeometry(0.08, 0.015, 0.025), gold, g, 0, 0.045, 0);
        m(bladeGeo(0.28, 0.035, 0.008, 0.09), mat('#9aa6b2', { rough: 0.25, metal: 0.9 }), g, 0, 0.05, 0);
        return g;
      };
      make(root);
      W.makeLeft = () => make(new THREE.Group());
      W.base = marker(root, 0, 0.1, 0); W.tip = marker(root, 0, 0.33, 0);
      break;
    }
    case 'holy': { // 牧师十字杖
      m(new THREE.CylinderGeometry(0.018, 0.02, 1.5, 8), mat('#e9e3d6', { rough: 0.5 }), root, 0, 0.3, 0);
      m(new THREE.BoxGeometry(0.035, 0.26, 0.035), gold, root, 0, 1.12, 0);
      m(new THREE.BoxGeometry(0.2, 0.035, 0.035), gold, root, 0, 1.15, 0);
      m(new THREE.TorusGeometry(0.075, 0.01, 6, 20), glow('#ffe7a0', 1.5), root, 0, 1.15, 0);
      W.muzzle = marker(root, 0, 1.15, 0); W.tip = W.muzzle; W.base = marker(root, 0, 0.7, 0);
      break;
    }
    case 'tome': { // 术士：魔典（左手）+ 骨杖（右手）
      m(new THREE.CylinderGeometry(0.014, 0.016, 0.6, 6), mat('#3b2c3f', { rough: 0.6 }), root, 0, 0.18, 0);
      m(new THREE.IcosahedronGeometry(0.045, 0), glow('#b05cff', 2.0), root, 0, 0.52, 0);
      m(new THREE.TorusGeometry(0.05, 0.008, 5, 10, Math.PI * 1.5), mat('#ccc2b0', { rough: 0.6 }), root, 0, 0.52, 0);
      W.muzzle = marker(root, 0, 0.52, 0); W.tip = W.muzzle; W.base = marker(root, 0, 0.3, 0);
      W.makeLeft = () => {
        const g = new THREE.Group();
        const book = m(new THREE.BoxGeometry(0.16, 0.2, 0.05), mat('#4a1f3d', { rough: 0.6 }), g, 0, 0.05, 0.03);
        book.rotation.x = -0.4;
        m(new THREE.BoxGeometry(0.14, 0.18, 0.052), mat('#e6dcc3'), g, 0.012, 0.05, 0.03).rotation.x = -0.4;
        m(new THREE.OctahedronGeometry(0.02), glow('#b05cff'), g, 0, 0.07, 0.065);
        return g;
      };
      break;
    }
    case 'knight': { // 骑士：长剑+大盾
      m(new THREE.CylinderGeometry(0.018, 0.02, 0.18, 8), mat('#2c3440'), root, 0, -0.03, 0);
      m(new THREE.BoxGeometry(0.22, 0.03, 0.04), gold, root, 0, 0.07, 0);
      m(bladeGeo(0.95, 0.06, 0.014), steel, root, 0, 0.08, 0);
      W.base = marker(root, 0, 0.2, 0); W.tip = marker(root, 0, 1.03, 0);
      W.makeLeft = () => {
        const g = new THREE.Group();
        const sh = m(new THREE.CylinderGeometry(0.34, 0.3, 0.05, 6), mat('#8c96a4', { rough: 0.35, metal: 0.8 }), g, 0, 0.05, 0.08);
        sh.rotation.x = Math.PI / 2; sh.scale.set(0.9, 1, 1.35);
        const emb = m(new THREE.CylinderGeometry(0.12, 0.12, 0.06, 6), gold, g, 0, 0.05, 0.11);
        emb.rotation.x = Math.PI / 2;
        return g;
      };
      break;
    }
    case 'axe': { // 寒铁守卫：长柄战斧 + 塔盾
      m(new THREE.CylinderGeometry(0.03, 0.035, 1.5, 8), mat('#2b2f36', { rough: 0.5, metal: 0.6 }), root, 0, 0.45, 0);
      const bladeShape = new THREE.Shape();
      bladeShape.moveTo(0, -0.22); bladeShape.quadraticCurveTo(0.5, -0.3, 0.55, 0); bladeShape.quadraticCurveTo(0.5, 0.3, 0, 0.22); bladeShape.lineTo(0, -0.22);
      const bg = new THREE.ExtrudeGeometry(bladeShape, { depth: 0.04, bevelEnabled: true, bevelThickness: 0.015, bevelSize: 0.02, bevelSegments: 1 });
      bg.translate(0.02, 0, -0.02);
      m(bg, mat(opts.steel || '#b9d4e6', { rough: 0.25, metal: 0.9 }), root, 0, 1.0, 0);
      m(new THREE.BoxGeometry(0.08, 0.12, 0.08), gold, root, 0, 1.0, 0);
      m(new THREE.ConeGeometry(0.04, 0.2, 6), steel, root, 0, 1.3, 0);
      m(new THREE.BoxGeometry(0.02, 0.4, 0.05), glow('#8fe0ff', 1.3), root, 0.3, 1.0, 0.01);
      W.base = marker(root, 0.1, 0.8, 0); W.tip = marker(root, 0.5, 1.05, 0); W.twoHanded = true;
      W.makeLeft = () => {
        const g = new THREE.Group();
        const sh = m(new THREE.BoxGeometry(0.55, 0.8, 0.06), mat('#56606c', { rough: 0.35, metal: 0.8 }), g, 0, 0.1, 0.12);
        sh.rotation.x = 0.1;
        m(new THREE.BoxGeometry(0.2, 0.2, 0.04), mat('#8fe0ff', { rough: 0.3, emissive: '#8fe0ff', ei: 0.8 }), g, 0, 0.15, 0.16);
        return g;
      };
      break;
    }
    case 'club': { // 流氓：缠布木棍
      m(new THREE.CylinderGeometry(0.035, 0.05, 0.85, 8), wood, root, 0, 0.33, 0);
      m(new THREE.CylinderGeometry(0.03, 0.03, 0.18, 8), mat('#d8d0bc', { rough: 0.9 }), root, 0, -0.02, 0);
      for (const y of [0.45, 0.6]) m(new THREE.TorusGeometry(0.05, 0.008, 5, 10), dark, root, 0, y, 0).rotation.x = Math.PI / 2;
      for (let i = 0; i < 4; i++) { const n = m(new THREE.ConeGeometry(0.008, 0.05, 4), steel, root, Math.cos(i * 1.6) * 0.05, 0.62 + i * 0.03, Math.sin(i * 1.6) * 0.05); n.rotation.z = Math.cos(i * 1.6) * -1.4; n.rotation.x = Math.sin(i * 1.6) * 1.4; }
      W.base = marker(root, 0, 0.3, 0); W.tip = marker(root, 0, 0.76, 0);
      break;
    }
    case 'scythe': { // 狂剑士也可用；留作扩展
      m(new THREE.CylinderGeometry(0.02, 0.022, 1.7, 8), dark, root, 0, 0.35, 0);
      const bl = m(bladeGeo(0.6, 0.1, 0.015, 0.2), steel, root, 0.28, 1.15, 0);
      bl.rotation.z = -1.4;
      W.base = marker(root, 0, 1.0, 0); W.tip = marker(root, 0.55, 1.1, 0); W.twoHanded = true;
      break;
    }
    default: {
      m(new THREE.BoxGeometry(0.03, 0.6, 0.03), steel, root, 0, 0.3, 0);
      W.base = marker(root, 0, 0.1, 0); W.tip = marker(root, 0, 0.6, 0);
    }
  }
  root.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return W;
}
