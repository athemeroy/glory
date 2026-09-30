// 特效：刀光、火花、粒子、爆炸、预警圈、光束、武器拖尾。均为程序生成。
import * as THREE from 'three';
import { rand } from '../engine/util.js';

function glowTexture(inner = 'rgba(255,255,255,1)', mid = 'rgba(255,255,255,0.35)') {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, inner); gr.addColorStop(0.25, mid); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
function arcTexture() {
  // 横向：u 为弧长（两端淡出），v 为径向（外沿最亮）
  const c = document.createElement('canvas'); c.width = 128; c.height = 32;
  const g = c.getContext('2d');
  for (let y = 0; y < 32; y++) {
    const v = y / 31;
    const radial = Math.pow(v, 2.2);
    for (let x = 0; x < 128; x++) {
      const u = x / 127;
      const along = Math.sin(Math.PI * Math.pow(u, 0.7));
      const a = radial * along;
      g.fillStyle = `rgba(255,255,255,${a.toFixed(3)})`;
      g.fillRect(x, y, 1, 1);
    }
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
function ringTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(64, 64, 20, 64, 64, 64);
  gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.75, 'rgba(255,255,255,0.15)'); gr.addColorStop(0.93, 'rgba(255,255,255,1)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

const MAX_P = 900;

export class VFX {
  constructor(scene) {
    this.scene = scene;
    this.items = [];
    this.tex = { glow: glowTexture(), arc: arcTexture(), ring: ringTexture() };
    // 粒子池
    const g = new THREE.BufferGeometry();
    this.pPos = new Float32Array(MAX_P * 3);
    this.pCol = new Float32Array(MAX_P * 3);
    this.pSize = new Float32Array(MAX_P);
    this.pVel = new Float32Array(MAX_P * 3);
    this.pLife = new Float32Array(MAX_P);
    this.pMax = new Float32Array(MAX_P);
    this.pGrav = new Float32Array(MAX_P);
    this.pBase = new Float32Array(MAX_P);
    g.setAttribute('position', new THREE.BufferAttribute(this.pPos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(this.pCol, 3));
    g.setAttribute('size', new THREE.BufferAttribute(this.pSize, 1));
    const mat = new THREE.ShaderMaterial({
      uniforms: { map: { value: this.tex.glow }, scale: { value: 600 } },
      vertexShader: `attribute float size; attribute vec3 color; varying vec3 vC;
        uniform float scale;
        void main(){ vC=color; vec4 mv=modelViewMatrix*vec4(position,1.0); gl_PointSize=size*scale/max(0.1,-mv.z); gl_Position=projectionMatrix*mv; }`,
      fragmentShader: `uniform sampler2D map; varying vec3 vC; void main(){ vec4 t=texture2D(map, gl_PointCoord); gl_FragColor=vec4(vC*t.a, t.a); }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.points = new THREE.Points(g, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 10;
    scene.add(this.points);
    this.pNext = 0;
    this.flash = new THREE.PointLight('#ffb070', 0, 10, 2);
    scene.add(this.flash);
    this.flashT = 0;
    this.arcGeo = new Map();
  }

  setScale(h) { this.points.material.uniforms.scale.value = h * 0.9; }

  particle(x, y, z, vx, vy, vz, color, size, life, grav = 9) {
    const i = this.pNext; this.pNext = (this.pNext + 1) % MAX_P;
    this.pPos[i * 3] = x; this.pPos[i * 3 + 1] = y; this.pPos[i * 3 + 2] = z;
    this.pVel[i * 3] = vx; this.pVel[i * 3 + 1] = vy; this.pVel[i * 3 + 2] = vz;
    const c = color instanceof THREE.Color ? color : new THREE.Color(color);
    this.pCol[i * 3] = c.r; this.pCol[i * 3 + 1] = c.g; this.pCol[i * 3 + 2] = c.b;
    this.pBase[i] = size; this.pSize[i] = size;
    this.pLife[i] = life; this.pMax[i] = life; this.pGrav[i] = grav;
  }

  burst(pos, color, n = 14, speed = 5, size = 0.06, life = 0.35, grav = 9, up = 1) {
    const c = new THREE.Color(color);
    for (let i = 0; i < n; i++) {
      const th = rand(0, Math.PI * 2), ph = rand(-0.4, 1.2);
      const s = speed * rand(0.4, 1.1);
      this.particle(pos.x, pos.y, pos.z, Math.cos(th) * Math.cos(ph) * s, Math.sin(ph) * s * up + 1, Math.sin(th) * Math.cos(ph) * s, c, size * rand(0.6, 1.3), life * rand(0.6, 1.2), grav);
    }
  }

  add(obj, dur, update, onEnd) {
    this.scene.add(obj);
    this.items.push({ obj, t: 0, dur, update, onEnd });
    return obj;
  }

  sprite(pos, color, size, dur, grow = 1.6) {
    const m = new THREE.SpriteMaterial({ map: this.tex.glow, color: new THREE.Color(color), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    const s = new THREE.Sprite(m); s.position.copy(pos); s.scale.setScalar(size);
    s.renderOrder = 11;
    this.add(s, dur, (k) => { s.scale.setScalar(size * (1 + (grow - 1) * k)); m.opacity = 1 - k; }, () => m.dispose());
    return s;
  }

  // ---- 刀光：在攻击者前方生成一段弧 ----
  slash(f, kind, color = '#e8f4ff', range = 2.4) {
    const yaw = f.yaw;
    const base = new THREE.Vector3(f.pos.x, f.pos.y + 1.2 * f.scale, f.pos.z);
    const g = new THREE.Group();
    g.position.copy(base);
    g.rotation.order = 'YXZ';
    g.rotation.y = yaw;
    let geo, dur = 0.2, tilt = 0, roll = 0, start = 0, len = Math.PI * 0.8;
    const r0 = Math.max(0.3, range * 0.45), r1 = range;
    switch (kind) {
      case 'slashR': start = -Math.PI * 0.1; len = Math.PI * 0.75; tilt = -0.15; break;
      case 'slashL': start = -Math.PI * 0.1; len = Math.PI * 0.75; tilt = 0.15; roll = Math.PI; break;
      case 'slashWide': start = -Math.PI * 0.25; len = Math.PI * 1.0; tilt = -0.05; break;
      case 'slashUp': start = -Math.PI * 0.35; len = Math.PI * 0.7; roll = Math.PI / 2; break;
      case 'ring': case 'ringWide': start = 0; len = Math.PI * 2; dur = 0.3; base.y = f.pos.y + 0.7; g.position.copy(base); break;
      case 'thrust': case 'thrustMulti': {
        const cone = new THREE.Mesh(new THREE.ConeGeometry(0.16, range, 10, 1, true), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, map: this.tex.glow }));
        cone.rotation.x = -Math.PI / 2; cone.position.z = range * 0.55;
        g.add(cone);
        this.add(g, 0.14, (k) => { cone.material.opacity = 0.8 * (1 - k); cone.scale.set(1 + k, 1, 1 + k); }, () => cone.material.dispose());
        return;
      }
      case 'punch': case 'punchBig': case 'kick': case 'palm': case 'bash': {
        const p = base.clone().addScaledVector(f.forward(), kind === 'palm' ? 1.3 : 1.0);
        this.sprite(p, color, kind === 'punchBig' || kind === 'palm' ? 1.1 : 0.55, 0.16, 2.2);
        if (kind === 'palm' || kind === 'punchBig') this.shock(p, f.yaw, color);
        return;
      }
      default: start = -Math.PI * 0.1; len = Math.PI * 0.75;
    }
    const key = `${r0.toFixed(2)}_${r1.toFixed(2)}_${start.toFixed(2)}_${len.toFixed(2)}`;
    if (!this.arcGeo.has(key)) {
      const rg = new THREE.RingGeometry(r0, r1, 32, 1, start + Math.PI / 2 - len / 2, len);
      // 重新映射 UV：u 沿弧，v 沿半径
      const uv = rg.attributes.uv, pos = rg.attributes.position;
      for (let i = 0; i < uv.count; i++) {
        const x = pos.getX(i), y = pos.getY(i);
        const a = Math.atan2(y, x), r = Math.hypot(x, y);
        let u = (a - (start + Math.PI / 2 - len / 2)) / len; if (u < 0) u += Math.PI * 2 / len;
        uv.setXY(i, u, (r - r0) / (r1 - r0));
      }
      rg.rotateX(-Math.PI / 2);
      this.arcGeo.set(key, rg);
    }
    const m = new THREE.MeshBasicMaterial({ map: this.tex.arc, color, transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(this.arcGeo.get(key), m);
    mesh.rotation.z = roll; mesh.rotation.x = tilt;
    mesh.renderOrder = 9;
    g.add(mesh);
    this.add(g, dur, (k) => { m.opacity = (1 - k) * (1 - k); mesh.scale.setScalar(0.9 + 0.2 * k); }, () => m.dispose());
  }

  // 大招起手：脚下光环 + 上升光柱
  ultAura(pos, color = '#ffd27a') {
    this.ring(pos, 2.6, color, 0.6);
    this.ring(pos, 1.4, '#ffffff', 0.35);
    const c = new THREE.Color(color);
    for (let i = 0; i < 40; i++) {
      const a = Math.random() * Math.PI * 2, r = 0.3 + Math.random() * 0.7;
      this.particle(pos.x + Math.cos(a) * r, pos.y + 0.1, pos.z + Math.sin(a) * r, 0, 3 + Math.random() * 4, 0, c, 0.1, 0.7, -2);
    }
    const col = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.9, 4, 20, 1, true), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, map: this.tex.glow }));
    col.position.set(pos.x, pos.y + 2, pos.z);
    this.add(col, 0.5, (k) => { col.material.opacity = 0.5 * (1 - k); col.scale.set(1 + k * 0.6, 1 + k * 0.5, 1 + k * 0.6); }, () => { col.material.dispose(); col.geometry.dispose(); });
    this.flashAt(new THREE.Vector3(pos.x, pos.y + 1.2, pos.z), color, 5);
  }
  // 伏龙翔天：沿前方的龙形光流
  dragon(f, color = '#ffd27a') {
    const fw = f.forward();
    const base = new THREE.Vector3(f.pos.x, f.pos.y + 1.2, f.pos.z);
    const c = new THREE.Color(color);
    for (let i = 0; i < 26; i++) {
      const d = i * 0.35;
      const wob = Math.sin(i * 0.7) * 0.5;
      const p = base.clone().addScaledVector(fw, d);
      p.x += -fw.z * wob; p.z += fw.x * wob; p.y += Math.cos(i * 0.7) * 0.35 + i * 0.03;
      setTimeout(() => { this.sprite(p, color, 0.9 - i * 0.02, 0.35, 1.6); this.burst(p, c, 3, 1.5, 0.08, 0.5, -1); }, i * 14);
    }
  }
  // 千刃：多方向刀光
  blades(f, color) {
    const kinds = ['slashR', 'slashL', 'slashUp', 'slashWide'];
    this.slash(f, kinds[(Math.random() * 4) | 0], color, 3.0);
    const p = f.center(new THREE.Vector3()).addScaledVector(f.forward(), 1.6);
    this.sprite(p, color, 0.7, 0.1, 2.2);
  }

  shock(pos, yaw, color) {
    const m = new THREE.MeshBasicMaterial({ map: this.tex.ring, color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), m);
    mesh.position.copy(pos); mesh.rotation.y = yaw;
    this.add(mesh, 0.25, (k) => { mesh.scale.setScalar(0.4 + 2.2 * k); m.opacity = 1 - k; }, () => { m.dispose(); mesh.geometry.dispose(); });
  }

  // 地面冲击环
  ring(pos, radius, color = '#ffffff', dur = 0.35) {
    const m = new THREE.MeshBasicMaterial({ map: this.tex.ring, color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), m);
    mesh.rotation.x = -Math.PI / 2; mesh.position.set(pos.x, pos.y + 0.05, pos.z);
    this.add(mesh, dur, (k) => { mesh.scale.setScalar(radius * (0.3 + 0.8 * k)); m.opacity = 1 - k; }, () => { m.dispose(); mesh.geometry.dispose(); });
  }

  hitSpark(pos, color = '#ffe0a0', strong = false) {
    const sp = this.sprite(pos, color, strong ? 0.42 : 0.24, strong ? 0.1 : 0.07, 1.8); sp.material.opacity = 0.75;
    this.burst(pos, color, strong ? 22 : 10, strong ? 7 : 5, 0.04, 0.3, 12);
    if (strong) this.flashAt(pos, color, 2.5);
  }
  blockSpark(pos) {
    this.sprite(pos, '#bfe6ff', 0.7, 0.12, 1.8);
    this.burst(pos, '#dff4ff', 16, 6, 0.04, 0.25, 14);
  }
  parrySpark(pos) {
    this.sprite(pos, '#ffffff', 1.4, 0.2, 2.4);
    this.burst(pos, '#fff3c0', 30, 8, 0.05, 0.4, 10);
    this.flashAt(pos, '#fff0c0', 4);
  }
  dust(pos, n = 10) { this.burst(new THREE.Vector3(pos.x, pos.y + 0.1, pos.z), '#8a8070', n, 2.2, 0.12, 0.5, 2, 0.3); }

  flashAt(pos, color, intensity) {
    this.flash.position.copy(pos); this.flash.color.set(color); this.flash.intensity = intensity * 1.2; this.flashT = 0.08;
  }

  explosion(pos, radius, color = '#ffa050') {
    const m = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, map: this.tex.glow });
    const s = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), m);
    s.position.copy(pos);
    this.add(s, 0.4, (k) => { s.scale.setScalar(radius * (0.3 + 0.9 * Math.sqrt(k))); m.opacity = 0.9 * (1 - k); }, () => { m.dispose(); s.geometry.dispose(); });
    this.sprite(pos, '#fff2c0', radius * 1.2, 0.25, 1.8);
    this.burst(pos, color, 40, radius * 4, 0.1, 0.6, 6);
    this.burst(pos, '#555048', 16, radius * 2, 0.25, 0.9, -1, 0.6);
    this.ring(pos, radius * 1.2, color, 0.4);
    this.flashAt(pos, color, 8);
  }

  // 预警圈：外圈 + 由内向外填充表示剩余时间
  telegraph(pos, radius, dur, color = '#cf624b') {
    const g = new THREE.Group();
    g.position.set(pos.x, pos.y + 0.04, pos.z);
    const outline = new THREE.Mesh(new THREE.RingGeometry(radius * 0.94, radius, 48), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide }));
    const fill = new THREE.Mesh(new THREE.CircleGeometry(radius, 48), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.28, depthWrite: false, side: THREE.DoubleSide }));
    outline.rotation.x = fill.rotation.x = -Math.PI / 2;
    fill.position.y = 0.01;
    g.add(outline, fill);
    const item = this.add(g, dur, (k) => { fill.scale.setScalar(Math.max(0.02, k)); outline.material.opacity = 0.6 + 0.4 * Math.sin(k * 30); }, () => { outline.material.dispose(); fill.material.dispose(); outline.geometry.dispose(); fill.geometry.dispose(); });
    return item;
  }
  // 扇形预警（Boss 横扫）
  coneTelegraph(pos, yaw, radius, arcDeg, dur, color = '#cf624b') {
    const g = new THREE.Group();
    g.position.set(pos.x, pos.y + 0.04, pos.z);
    g.rotation.y = yaw;
    const a = arcDeg * Math.PI / 180;
    const geo = new THREE.CircleGeometry(radius, 40, Math.PI / 2 - a / 2, a); geo.rotateX(-Math.PI / 2);
    // CircleGeometry 在 XY 平面，旋转后指向 -Z；翻转到 +Z
    geo.rotateY(Math.PI);
    const m = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.3, depthWrite: false, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(geo, m);
    g.add(mesh);
    this.add(g, dur, (k) => { m.opacity = 0.2 + 0.3 * k + 0.1 * Math.sin(k * 40); }, () => { m.dispose(); geo.dispose(); });
    return g;
  }

  beam(from, to, width, color, dur) {
    const len = from.distanceTo(to);
    const m = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, map: this.tex.glow });
    const core = new THREE.Mesh(new THREE.CylinderGeometry(width * 0.5, width * 0.5, len, 10, 1, true), m);
    core.position.copy(from).lerp(to, 0.5);
    core.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), to.clone().sub(from).normalize());
    this.add(core, dur, (k) => { m.opacity = 0.9 * (1 - k); core.scale.set(1 + k, 1, 1 + k); }, () => { m.dispose(); core.geometry.dispose(); });
  }

  tracer(from, to, color = '#ffe6a0') {
    const len = from.distanceTo(to);
    const m = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false });
    const line = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, len, 4, 1, true), m);
    line.position.copy(from).lerp(to, 0.5);
    line.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), to.clone().sub(from).normalize());
    this.add(line, 0.06, (k) => { m.opacity = 0.85 * (1 - k); }, () => { m.dispose(); line.geometry.dispose(); });
  }

  // 投射物外形
  projectileMesh(kind, color = '#ffd27a') {
    const g = new THREE.Group();
    if (kind === 'bullet') {
      const core = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.5, 5), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false }));
      core.rotation.x = Math.PI / 2; g.add(core);
    } else if (kind === 'shell' || kind === 'grenade') {
      const s = new THREE.Mesh(new THREE.SphereGeometry(kind === 'shell' ? 0.13 : 0.1, 10, 8), new THREE.MeshStandardMaterial({ color: '#3a3a3e', metalness: 0.7, roughness: 0.4, emissive: new THREE.Color(color), emissiveIntensity: 0.4 }));
      g.add(s);
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.tex.glow, color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
      sp.scale.setScalar(0.6); g.add(sp);
    } else {
      const s = new THREE.Mesh(new THREE.IcosahedronGeometry(0.14, 1), new THREE.MeshBasicMaterial({ color }));
      g.add(s);
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.tex.glow, color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
      sp.scale.setScalar(0.9); g.add(sp);
    }
    return g;
  }

  update(dt) {
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i];
      it.t += dt;
      const k = Math.min(1, it.t / it.dur);
      if (it.update) it.update(k, dt);
      if (it.t >= it.dur) {
        it.obj.removeFromParent();
        if (it.onEnd) it.onEnd();
        this.items.splice(i, 1);
      }
    }
    // 粒子
    for (let i = 0; i < MAX_P; i++) {
      if (this.pLife[i] <= 0) { if (this.pSize[i] !== 0) this.pSize[i] = 0; continue; }
      this.pLife[i] -= dt;
      const j = i * 3;
      this.pVel[j + 1] -= this.pGrav[i] * dt;
      const drag = Math.exp(-2.5 * dt);
      this.pVel[j] *= drag; this.pVel[j + 2] *= drag;
      this.pPos[j] += this.pVel[j] * dt; this.pPos[j + 1] += this.pVel[j + 1] * dt; this.pPos[j + 2] += this.pVel[j + 2] * dt;
      if (this.pPos[j + 1] < 0.02) { this.pPos[j + 1] = 0.02; this.pVel[j + 1] *= -0.3; }
      this.pSize[i] = this.pBase[i] * Math.max(0, this.pLife[i] / this.pMax[i]);
    }
    const g = this.points.geometry;
    g.attributes.position.needsUpdate = true; g.attributes.size.needsUpdate = true; g.attributes.color.needsUpdate = true;
    if (this.flashT > 0) { this.flashT -= dt; if (this.flashT <= 0) this.flash.intensity = 0; else this.flash.intensity *= Math.exp(-dt * 20); }
  }

  clear() {
    for (const it of this.items) { it.obj.removeFromParent(); if (it.onEnd) it.onEnd(); }
    this.items.length = 0;
    this.pLife.fill(0);
  }
}

// 武器拖尾：记录刃根与刃尖轨迹，形成带状网格
export class WeaponTrail {
  constructor(parent, color = '#dff4ff', segs = 14, layer = 0) {
    this.parent = parent;
    this.segs = segs;
    this.pts = []; // [{b:Vector3, t:Vector3, age}]
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(segs * 2 * 3);
    this.alpha = new Float32Array(segs * 2);
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1));
    const idx = [];
    for (let i = 0; i < segs - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    g.setIndex(idx);
    this.mat = new THREE.ShaderMaterial({
      uniforms: { color: { value: new THREE.Color(color) } },
      vertexShader: 'attribute float alpha; varying float vA; void main(){ vA=alpha; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
      fragmentShader: 'uniform vec3 color; varying float vA; void main(){ gl_FragColor=vec4(color*vA, vA); }',
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(g, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.layers.set(layer);
    this.mesh.renderOrder = 8;
    parent.add(this.mesh);
    this.active = false;
    this._b = new THREE.Vector3(); this._t = new THREE.Vector3();
  }
  setColor(c) { this.mat.uniforms.color.value.set(c); }
  update(dt, baseObj, tipObj, emitting) {
    for (const p of this.pts) p.age += dt;
    if (emitting && baseObj && tipObj) {
      baseObj.getWorldPosition(this._b); tipObj.getWorldPosition(this._t);
      this.parent.worldToLocal(this._b); this.parent.worldToLocal(this._t);
      this.pts.unshift({ b: this._b.clone(), t: this._t.clone(), age: 0 });
    }
    while (this.pts.length > this.segs || (this.pts.length && this.pts[this.pts.length - 1].age > 0.14)) this.pts.pop();
    const n = this.pts.length;
    for (let i = 0; i < this.segs; i++) {
      const p = this.pts[Math.min(i, n - 1)];
      const j = i * 6;
      if (!p) { this.alpha[i * 2] = this.alpha[i * 2 + 1] = 0; continue; }
      this.pos[j] = p.b.x; this.pos[j + 1] = p.b.y; this.pos[j + 2] = p.b.z;
      this.pos[j + 3] = p.t.x; this.pos[j + 4] = p.t.y; this.pos[j + 5] = p.t.z;
      const a = i < n ? Math.max(0, 1 - p.age / 0.14) * (1 - i / this.segs) : 0;
      this.alpha[i * 2] = a * 0.15; this.alpha[i * 2 + 1] = a * 0.85;
    }
    this.mesh.geometry.attributes.position.needsUpdate = true;
    this.mesh.geometry.attributes.alpha.needsUpdate = true;
    this.mesh.visible = n > 1;
  }
  dispose() { this.mesh.removeFromParent(); this.mesh.geometry.dispose(); this.mat.dispose(); }
}
