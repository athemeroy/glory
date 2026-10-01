// 选角界面的 3D 角色展示：待机站姿、缓慢旋转、可拖拽，定时演示招式
import * as THREE from 'three';
import { buildCharacter } from '../game/model.js';
import { buildWeapon } from '../game/weapons.js';
import { Animator, CLIPS } from '../game/anim.js';
import { CLASSES } from '../data/classes.js';
import { store } from '../engine/util.js';
import { applySkinnedModel } from '../game/skin.js';
import { createMocapBody, MocapAnimator, hasClips, weaponTilt, mountMocapWeapon } from '../game/mocap.js';

let shared = null; // 复用一个渲染器，避免反复创建 WebGL 上下文

export class CharViewer {
  constructor(container, models = null, rigged = null) {
    this.models = models; this.rigged = rigged;
    if (!shared) {
      const r = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      r.outputColorSpace = THREE.SRGBColorSpace;
      r.toneMapping = THREE.ACESFilmicToneMapping;
      r.shadowMap.enabled = true;
      shared = r;
    }
    this.r = shared;
    this.el = container;
    container.appendChild(this.r.domElement);
    this.r.domElement.className = 'viewer-canvas';
    this.scene = new THREE.Scene();
    this.cam = new THREE.PerspectiveCamera(30, 1, 0.1, 50);
    this.cam.position.set(0, 1.3, 5.6);
    this.cam.lookAt(0, 0.9, 0);
    this.scene.add(new THREE.HemisphereLight('#dfe8f5', '#3a3028', 1.1));
    const key = new THREE.DirectionalLight('#fff1dc', 2.4); key.position.set(2.5, 4, 3); key.castShadow = true; key.shadow.mapSize.set(1024, 1024);
    this.scene.add(key);
    const rim = new THREE.DirectionalLight('#7fd6cd', 1.6); rim.position.set(-3, 2.5, -3); this.scene.add(rim);
    const floor = new THREE.Mesh(new THREE.CircleGeometry(1.2, 48), new THREE.MeshStandardMaterial({ color: '#1c232c', roughness: 0.6, metalness: 0.3, transparent: true, opacity: 0.85 }));
    floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; this.scene.add(floor);
    const ring = new THREE.Mesh(new THREE.RingGeometry(1.15, 1.2, 64), new THREE.MeshBasicMaterial({ color: '#c3a775', transparent: true, opacity: 0.6 }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.005; this.scene.add(ring);
    this.holder = new THREE.Group(); this.scene.add(this.holder);
    this.rot = 0.4; this.drag = null; this.t = 0; this.demoT = 3;
    const cvs = this.r.domElement;
    this.onDown = (e) => { this.drag = e.clientX; this.dragPointer = e.pointerId; };
    this.onMove = (e) => { if (this.drag !== null && e.pointerId === this.dragPointer) { this.rot += (e.clientX - this.drag) * 0.01; this.drag = e.clientX; } };
    this.onUp = (e) => { if (e.pointerId === this.dragPointer) this.drag = null; };
    cvs.addEventListener('pointerdown', this.onDown); window.addEventListener('pointermove', this.onMove); window.addEventListener('pointerup', this.onUp); window.addEventListener('pointercancel', this.onUp);
    this.running = true;
    this.last = performance.now();
    const loop = () => { if (!this.running) return; requestAnimationFrame(loop); this.frame(); };
    requestAnimationFrame(loop);
  }

  show(clsId, pose = null) {
    this.pose = pose;
    if (this.clsId === clsId) return;
    this.clsId = clsId;
    this.holder.clear();
    const cls = CLASSES[clsId];
    const look = { ...cls.look, ...(store.get('look.' + clsId, {})) };
    this.rig = buildCharacter(look);
    this.holder.add(this.rig.root);
    this.mocap = null;
    const rs = this.rigged && this.rigged.get(clsId);
    if (rs && hasClips() && !look.proc) {
      try {
        const body = createMocapBody(rs);
        for (const p of this.rig.parts) p.visible = false;
        this.rig.root.add(body.model);
        this.rig.root.updateMatrixWorld(true);
        this._mountLater = body;
        this.mocap = new MocapAnimator(body);
      } catch { this.mocap = null; }
    }
    const glb = this.models && this.models.get(clsId);
    if (!this.mocap && glb && !look.proc) { try { applySkinnedModel(this.rig, glb, { key: `${clsId}|${look.sex}|${look.build || 1}` }); } catch { /* 用程序化造型 */ } }
    this.weapon = buildWeapon(cls.weapon, cls.weaponOpts || {});
    this.rig.bones.gripR.add(this.weapon.obj);
    const left = this.weapon.makeLeft ? this.weapon.makeLeft() : null;
    if (left) this.rig.bones.gripL.add(left);
    if (this._mountLater) { const body = this._mountLater; const tilt = weaponTilt(cls.weapon); mountMocapWeapon(body, 'Right', this.weapon.obj, tilt); mountMocapWeapon(body, 'Left', left, -tilt); this._mountLater = null; }
    if (this.weapon.setForm) this.weapon.setForm('sword', true);
    this.rig.root.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    this.anim = new Animator(this.rig);
    this.cls = cls;
    this.demo = null; this.demoT = 1.5;
  }

  frame() {
    const now = performance.now();
    const dt = Math.min(0.05, (now - this.last) / 1000); this.last = now;
    const w = this.el.clientWidth, h = this.el.clientHeight;
    if (!w || !h) return;
    if (this.r.domElement.width !== Math.floor(w * Math.min(2, devicePixelRatio)) || this._h !== h) {
      this.r.setPixelRatio(Math.min(2, devicePixelRatio)); this.r.setSize(w, h, false); this._h = h;
      this.cam.aspect = w / h; this.cam.updateProjectionMatrix();
    }
    if (!this.rig) return;
    if (this.drag === null) this.rot += dt * 0.35;
    this.holder.rotation.y = this.rot;
    // 招式演示：每隔几秒挑一个技能播放
    this.demoT -= dt;
    if (!this.demo && this.demoT <= 0 && !this.pose) {
      const skills = Object.values(this.cls.skills || {}).filter((s) => CLIPS[s.anim]);
      const d = skills[Math.floor(Math.random() * skills.length)] || this.cls.chain?.[0];
      if (d) this.demo = { d, t: 0, key: Math.random() };
    }
    let action = null;
    if (this.demo) {
      const d = this.demo.d; this.demo.t += dt * 1000 * 0.8;
      const tt = this.demo.t;
      if (tt < d.wind) action = { clip: d.anim, stage: 'wind', t: tt / d.wind };
      else if (tt < d.wind + d.active) action = { clip: d.anim, stage: 'active', t: (tt - d.wind) / d.active };
      else if (tt < d.wind + d.active + d.recover + 300) action = { clip: d.anim, stage: 'recover', t: Math.min(1, (tt - d.wind - d.active) / d.recover) };
      else { this.demo = null; this.demoT = 3.5; }
    }
    this.t += dt;
    const react = this.pose === 'cheer' ? { type: 'cheer', t: this.t } : this.pose === 'down' ? { type: 'down', t: this.t } : null;
    const st = { speed: 0, onGround: true, stance: this.cls.stance, action: action ? { ...action, key: this.demo ? this.demo.key : 0 } : null, pitch: 0, react };
    this.anim.update(dt, st);
    if (this.mocap) this.mocap.update(dt, st);
    if (this.weapon.update) this.weapon.update(dt);
    this.r.render(this.scene, this.cam);
  }

  dispose() {
    this.running = false;
    window.removeEventListener('pointermove', this.onMove); window.removeEventListener('pointerup', this.onUp); window.removeEventListener('pointercancel', this.onUp);
    this.r.domElement.removeEventListener('pointerdown', this.onDown);
    this.r.domElement.remove();
  }
}
