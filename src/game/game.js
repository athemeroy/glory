// 游戏主控：渲染（主画面 + 第一人称手臂层 + 镜子）、固定步长模拟、玩家操控、打击反馈。
import * as THREE from 'three';
import { World } from './world.js';
import { Combat } from './combat.js';
import { VFX, WeaponTrail } from './vfx.js';
import { Fighter } from './fighter.js';
import { FPView, FP_LAYER, hideWorldArmsForFP } from './fpview.js';
import { Brain } from './ai.js';
import { buildLevel } from './levels.js';
import { Post } from './post.js';
import { loadModel } from './skin.js';
import { loadClipLibrary } from './mocap.js';
import { GLTFLoader } from '../../vendor/GLTFLoader.js';
import { input } from '../engine/input.js';
import { audio } from '../engine/audio.js';
import { voice } from '../engine/voice.js';
import { clamp, DEG, rand, store, wrapAngle } from '../engine/util.js';

const STEP = 1 / 60;

export const SETTINGS_DEFAULT = {
  sens: 1.0, fov: 95, invertY: false, shake: true, bob: true, quality: 'high', master: 0.8, sfx: 1.0, music: 0.6,
  dmgNumbers: true, showTrails: true, hudScale: 1, crosshair: true,
};

export class Game {
  constructor(canvas, hud) {
    this.canvas = canvas;
    this.hud = hud;
    this.settings = { ...SETTINGS_DEFAULT, ...store.get('settings', {}) };
    const hi = this.settings.quality === 'high';
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: hi, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, hi ? 1.5 : 1));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.localClippingEnabled = true;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.05, 700);
    this.camera.rotation.order = 'YXZ';
    this.camera.layers.set(0); // 主相机：不看本地玩家头部(1)，不看手臂层(2)
    this.vmCamera = new THREE.PerspectiveCamera(54, 16 / 9, 0.02, 20);
    this.vmCamera.layers.set(FP_LAYER);
    this.camera.add(this.vmCamera);
    this.scene.add(this.camera);
    this.world = new World();
    this.combat = new Combat(this);
    this.vfx = new VFX(this.scene);
    this.fighters = [];
    this.trails = new Map();
    this.player = null;
    this.firstPerson = true;
    this.timeScale = 1; this.hitstop = 0;
    this.shakeAmt = 0; this.shakeT = 0;
    this.acc = 0;
    this.time = 0;
    this.paused = true;
    this.running = false;
    this.mode = null;
    this.lockTarget = null;
    this.texCache = new Map();
    this.loader = new THREE.TextureLoader();
    this.stepDist = 0;
    this.camOff = new THREE.Vector3();
    this.viewYaw = 0; this.viewPitch = 0;
    this.lastMouse = [0, 0];
    this.tmp = new THREE.Vector3();
    this.frames = 0; this.fpsT = 0; this.fps = 60;
    this.post = new Post(this.renderer, this.scene, this.camera, this.vmCamera, () => !!(this.player && this.firstPerson && this.player.fp && this.player.fp.root.visible), this.settings.quality);
    this.resize();
    window.addEventListener('resize', () => this.resize());
    this.applyAudioSettings();
  }

  applyAudioSettings() { audio.setVolume(this.settings.master, this.settings.sfx, this.settings.music); voice.setVolume(this.settings.master * (this.settings.voice ?? 1)); }
  voice(name, gain = 1) { voice.play(name, gain); }
  saveSettings() { store.set('settings', this.settings); this.applyAudioSettings(); this.resize(); }

  degrade() {
    this.degraded = true;
    this.renderer.setPixelRatio(1);
    if (this.post && this.post.smaa) this.post.smaa.enabled = false;
    if (this.post) this.post.bloom.strength *= 0.8;
    this.resize();
    this.hud.toast('帧率偏低，已自动切换为流畅画质');
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    if (this.post) { const pr = this.renderer.getPixelRatio(); this.post.setSize(w * pr, h * pr); }
    this.aspect = w / h;
    this.updateFov();
    this.vfx.setScale(h * this.renderer.getPixelRatio());
  }
  updateFov(zoom = 1) {
    // 越肩/第三人称用更窄的视野（约 80°），角色不至于太小
    const hf = this.settings.fov * DEG * zoom * (this.firstPerson || !this.player ? 1 : 0.84);
    const vf = 2 * Math.atan(Math.tan(hf / 2) / this.aspect) / DEG;
    this.camera.fov = vf; this.camera.aspect = this.aspect; this.camera.updateProjectionMatrix();
    // 手臂层：固定竖直视野，保证不同 FOV 下手臂大小一致
    this.vmCamera.fov = 60; this.vmCamera.aspect = this.aspect; this.vmCamera.updateProjectionMatrix();
  }

  // 关卡构建前预加载平铺贴图（关卡会用它们烘焙环境光与画布纹理）
  preload() {
    if (this._preload) return this._preload;
    const names = ['stone', 'wood', 'iron', 'cloth', 'leather', 'bronze'];
    this.models = new Map();
    this.loadDone = 0; this.loadTotal = 6;
    const tex = Promise.all(names.map((n) => this.loader.loadAsync(`assets/tex/${n}.jpg`).then((t) => {
      t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
      this.texCache.set(n, t); this.loadDone++;
    }).catch(() => { this.loadDone++; })));
    // 动捕绑定模型（Tripo + Meshy）优先；没有绑定模型的角色才加载旧的静态精模
    this.rigged = new Map();
    const q = new URLSearchParams(location.search);
    const noRig = this.settings.mocap === false || q.get('mocap') === '0';
    const noModels = this.settings.models === false || q.get('models') === '0';
    const getList = (u) => fetch(u).then((r) => (r.ok ? r.json() : [])).catch(() => []);
    const rigged = (noRig || noModels ? Promise.resolve([]) : loadClipLibrary().then((lib) => (lib ? getList('assets/models/rigged/manifest.json') : [])))
      .then((list) => { this.loadTotal += (list || []).length; return Promise.all((list || []).map((k) => new GLTFLoader().loadAsync(`assets/models/rigged/${k}.glb`).then((g) => { this.rigged.set(k, g.scene); this.loadDone++; }).catch(() => { this.loadDone++; }))); });
    const models = noModels ? Promise.resolve() : rigged.then(() => getList('assets/models/manifest.json'))
      .then((list) => { list = (list || []).filter((k) => !this.rigged.has(k)); this.loadTotal += list.length; return Promise.all(list.map((k) => loadModel(`assets/models/${k}.glb`).then((sc) => { if (sc) this.models.set(k, sc); this.loadDone++; }))); });
    this._preload = Promise.all([tex, models, rigged]);
    return this._preload;
  }

  tex(name) {
    if (this.texCache.has(name)) return this.texCache.get(name);
    const t = this.loader.load(`assets/tex/${name}.jpg`);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    this.texCache.set(name, t);
    return t;
  }

  // ---- 关卡 ----
  loadLevel(id) {
    this.unloadLevel();
    const level = buildLevel(id, { THREE, renderer: this.renderer, tex: (n) => this.tex(n), quality: this.settings.quality, noEnv: new URLSearchParams(location.search).get('noenv') === '1' });
    this.level = level;
    this.scene.add(level.group);
    this.scene.background = level.background || new THREE.Color('#8fa3b8');
    this.scene.fog = level.fog || null;
    this.world.setLevel(level);
    // 灯光对所有图层生效（手臂层、镜中头部）
    level.group.traverse((o) => { if (o.isLight) { o.layers.enable(1); o.layers.enable(FP_LAYER); } if (o.isMesh && o.receiveShadow === undefined) o.receiveShadow = true; });
    if (level.sun) {
      level.sun.shadow.camera.layers.enable(1);
      this.sunOffset = level.sun.position.clone().sub(level.sun.target.position);
    }
    for (const m of level.mirrors || []) m.reflectLayers = (1 << 0) | (1 << 1);
    return level;
  }
  unloadLevel() {
    if (!this.level) return;
    this.level.group.removeFromParent();
    if (this.level.dispose) this.level.dispose();
    this.level = null;
  }

  // ---- 角色 ----
  spawn(opts) {
    const f = new Fighter(this, opts);
    this.fighters.push(f);
    if (opts.isPlayer) this.setPlayer(f);
    if (opts.ai) { f.ai = new Brain(f, opts.ai); }
    const accent = f.cls.look?.accent || '#e8f4ff';
    if (f.weapon.tip && f.weapon.base) this.trails.set(f, new WeaponTrail(this.scene, opts.trailColor || accent, 14, 0));
    return f;
  }
  removeFighter(f) {
    if (this.lockTarget === f) this.lockTarget = null;
    if (this.spectate === f) this.spectate = null;
    const i = this.fighters.indexOf(f);
    if (i >= 0) this.fighters.splice(i, 1);
    const tr = this.trails.get(f); if (tr) { tr.dispose(); this.trails.delete(f); }
    if (f === this.player) { if (this.fpTrail) { this.fpTrail.dispose(); this.fpTrail = null; } }
    f.dispose();
  }
  clearFighters() {
    for (const f of [...this.fighters]) this.removeFighter(f);
    this.player = null;
    this.combat.clear();
    this.vfx.clear();
  }

  setPlayer(f) {
    this.player = f;
    f.isPlayer = true;
    f.fp = new FPView(f.lookData || f.cls.look, f.cls.weapon, f.cls.weaponOpts || {}, f.fpGlb || null, f.modelKey + (f.mocap ? ':rig' : ''));
    if (f.form) { f.fp.setForm(f.form); f.fp.weapon.setForm?.(f.form, true); }
    this.camera.add(f.fp.root);
    this.fpTrail = new WeaponTrail(this.camera, f.cls.look?.accent || '#dff4ff', 12, FP_LAYER);
    this.viewYaw = f.yaw; this.viewPitch = 0;
    this.applyView();
  }
  rebuildPlayerLook(look) {
    const f = this.player; if (!f) return;
    f.rebuildLook(look);
    if (f.fp) f.fp.dispose();
    f.fp = new FPView(look, f.cls.weapon, f.cls.weaponOpts || {}, f.fpGlb || null, f.modelKey + (f.mocap ? ':rig' : ''));
    if (f.form) { f.fp.setForm(f.form); f.fp.weapon.setForm?.(f.form, true); }
    this.camera.add(f.fp.root);
    this.applyView();
  }
  applyView() {
    const f = this.player; if (!f) return;
    f.setFirstPerson(this.firstPerson);
    // 精模身体：主相机第一人称时裁掉胸口以上（避免领口贴脸穿插），镜子与他人视角不受影响
    const bodyMesh = f.rig.mocapBodyMeshes ? f.rig.mocapBodyMeshes[0] : (f.usesModel && f.rig.skinned ? f.rig.skinned.body : null);
    if (bodyMesh) {
      const body = bodyMesh;
      const plane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 1e5);
      body.material.clippingPlanes = [plane];
      const game = this;
      body.onBeforeRender = (r, sc, cam) => {
        plane.constant = game.firstPerson && cam === game.camera ? f.pos.y + 1.36 * f.scale : 1e5;
      };
    }
    hideWorldArmsForFP(f.rig, f.weapon.obj, f.leftWeapon, this.firstPerson);
    f.fp.root.visible = this.firstPerson;
  }
  get viewMode() { return this._viewMode || (this.firstPerson ? 'fp' : 'ots'); }
  setViewMode(m) {
    this._viewMode = m; this.firstPerson = m === 'fp';
    store.set('viewMode', m);
    this.applyView();
    if (this.hud) this.hud.toast({ fp: '第一人称', ots: '越肩视角', tp: '第三人称' }[m]);
  }
  toggleView() { const order = ['fp', 'ots', 'tp']; this.setViewMode(order[(order.indexOf(this.viewMode) + 1) % 3]); }

  // ---- 事件 ----
  sfx(name, pos, vol = 1, rate = 1) { audio.play(name, pos ? { pos: [pos.x, pos.y, pos.z], vol, rate } : { vol, rate }); }

  shake(pos, amt) {
    if (!this.settings.shake || !this.player) return;
    const d = pos ? pos.distanceTo(this.player.pos) : 0;
    const a = amt * Math.max(0, 1 - d / 18);
    this.shakeAmt = Math.max(this.shakeAmt, a);
  }

  onFighterEvent(f, type, data) {
    const pos = f.center(new THREE.Vector3());
    const isP = f === this.player;
    switch (type) {
      case 'action': {
        const d = data.def;
        if (d.ult) {
          this.hud.announce(`${f.name}「${d.name}」`, f.team === this.player?.team ? 'ally' : 'enemy'); this.sfx('magic_cast', pos, 1.2);
          const dist = this.player ? f.pos.distanceTo(this.player.pos) : 0;
          voice.ult(d.name, isP ? 1 : Math.max(0.25, 0.9 - dist / 40));
          this.vfx.ultAura(f.pos, f.cls.look?.accent || '#ffd27a');
        }
        if (d.tele) this.spawnTelegraph(f, d);
        if (isP && data.slot !== 'atk') this.hud.skillFlash(data.slot);
        break;
      }
      case 'active': {
        const d = data.def;
        if (d.sfx && !d.proj) this.sfx(d.sfx, pos, 1, rand(0.95, 1.05));
        const acc = f.cls.look?.accent || '#e8f4ff';
        if (d.vfx === 'ult_dragon') this.vfx.dragon(f, acc);
        else if (d.vfx === 'ult_blades') this.vfx.blades(f, acc);
        else if (d.vfx === 'ult_fists') { this.vfx.shock(f.center(new THREE.Vector3()).addScaledVector(f.forward(), 1.2), f.yaw, acc); }
        else if (d.vfx && !d.slamOnLand && d.hits) this.vfx.slash(f, d.vfx, acc, (d.hits[0]?.range || 2.4) * 0.9);
        break;
      }
      case 'swing': {
        const d = data.def; const acc = f.cls.look?.accent || '#e8f4ff';
        this.sfx(d.sfx || 'swing_light', pos, 0.8);
        if (d.vfx === 'ult_blades') this.vfx.blades(f, acc);
        else if (d.vfx === 'ult_fists') { this.vfx.shock(f.center(new THREE.Vector3()).addScaledVector(f.forward(), 1.2), f.yaw, acc); this.vfx.sprite(f.center(new THREE.Vector3()).addScaledVector(f.forward(), 1.1), acc, 0.6, 0.1, 2); }
        else if (d.vfx && d.hits) this.vfx.slash(f, data.i % 2 ? 'slashL' : 'slashR', acc, (d.hits[0]?.range || 2.4) * 0.9);
        break;
      }
      case 'slam': this.vfx.ring(f.pos, (data.def.hits?.[0]?.range || 3) * 1.1, f.cls.look?.accent || '#ffffff', 0.4); this.vfx.dust(f.pos, 24); this.sfx('boss_slam', f.pos); this.shake(f.pos, 0.6); break;
      case 'jump': this.sfx('jump', f.pos, 0.6); break;
      case 'fullcharge': this.sfx('parry', pos, 0.6, 1.4); this.vfx.sprite(f.center(new THREE.Vector3()), '#ffc040', 1.2, 0.2, 2); break;
      case 'land': this.sfx('land', f.pos, 0.7); this.vfx.dust(f.pos, 6); if (isP) this.camDip = Math.min(0.12, (data.impact || 6) * 0.012); break;
      case 'dash': this.sfx('dash', pos, 0.8); this.vfx.dust(f.pos, 8); break;
      case 'knockdown': this.sfx('knockdown', f.pos); this.vfx.dust(f.pos, 14); if (isP) this.shake(f.pos, 0.35); break;
      case 'tech': this.sfx('tech', pos); this.hud.floatText(pos, '受身', 'tech'); break;
      case 'getup': this.sfx('getup', pos, 0.6); break;
      case 'protect': this.hud.floatText(pos, '保护', 'armor'); break;
      case 'heal': this.hud.floatText(pos, '+' + data.amount, 'heal'); break;
      case 'absorb': if (Math.random() < 0.5) this.hud.floatText(pos, '吸收', 'blocked'); break;
      case 'buff': this.sfx('magic_cast', pos, 0.8); this.vfx.ring(f.pos, 1.6, data.def.buffColor || '#ff5a4a', 0.5); break;
      case 'cleanse': this.hud.floatText(pos, '净化', 'tech'); break;
      case 'form': if (!data.silent) { this.sfx('form_switch', pos, 0.9); if (data.form === 'shield') this.sfx('umbrella_open', pos, 0.7); } if (isP) this.hud.setForm(data.form); break;
      case 'parry': this.sfx('parry', pos, 1.2); this.vfx.parrySpark(pos.clone().add(f.forward().multiplyScalar(0.6))); this.hud.floatText(pos, data.zhen ? '振刀！' : '完美格挡', 'parry'); if (data.zhen) { this.shake(pos, 0.5); this.post && this.post.kick(0, 0.015); } this.hitstop = Math.max(this.hitstop, 0.12); break;
      case 'block': this.sfx('block', pos); this.vfx.blockSpark(pos.clone().add(f.forward().multiplyScalar(0.5))); break;
      case 'guardbreak': this.sfx('guard_break', pos); this.hud.floatText(pos, '破防', 'crit'); break;
      case 'armor': this.hud.floatText(pos, '霸体', 'armor'); break;
      case 'interrupted': if (data.why === 'parried') this.hud.floatText(pos, '被弹开', 'enemy'); break;
      case 'nomana': if (isP) { this.sfx('no_mana', null, 0.6); this.hud.toast('法力不足'); } break;
      case 'cooldown': if (isP) this.hud.toast('技能冷却中'); break;
      case 'comboEnd': if (isP && data.n >= 5) this.hud.comboEnd(data.n); break;
      case 'damage': {
        if (this.settings.dmgNumbers) {
          const src = data.src;
          const cls = data.blocked ? 'blocked' : f === this.player ? 'taken' : (src === this.player ? (data.crit ? 'crit' : 'dealt') : 'other');
          if (cls !== 'other' || Math.random() < 0.6) this.hud.damageNumber(pos, data.dmg, cls);
        }
        if (isP) { this.hud.hurt(data.src ? data.src.pos : null, data.dmg / f.maxHp); if (!data.blocked) this.post.kick(Math.min(0.9, 0.25 + data.dmg / f.maxHp * 5), Math.min(0.02, 0.004 + data.dmg / f.maxHp * 0.1)); }
        if (data.src === this.player && !data.blocked) this.hud.combo(this.player.comboDealt, data.dmg);
        break;
      }
      case 'death': {
        this.sfx('knockdown', pos, 1.2);
        if (f.kind === 'hero' || f.kind === 'boss') this.slowMo(f.kind === 'boss' ? 1.6 : 1.0);
        if (this.mode && this.mode.onDeath) this.mode.onDeath(f, data.src);
        break;
      }
    }
  }

  startCinematic(targets, dur = 2.6) {
    if (this.manual) return;
    const p = this.player;
    this.cinematic = { t: 0, dur, targets, a0: p ? p.yaw + Math.PI * 0.75 : 0 };
  }

  slowMo(sec) {
    if (this.netGuest || this.manual) return;
    this.timeScale = 0.25; this.post && this.post.kick(0, 0.012);
    clearTimeout(this._smT); this._smT = setTimeout(() => { this.timeScale = this._baseScale || 1; }, sec * 1000);
  }

  spawnTelegraph(f, d) {
    const t = d.tele;
    const dur = (d.wind + (t.extra || 0)) / 1000;
    if (t.type === 'cone') this.vfx.coneTelegraph(f.pos, f.yaw, t.radius, t.arc, dur);
    else if (t.type === 'circle') {
      const p = t.at === 'target' && f.leapTarget ? f.leapTarget : f.pos;
      this.vfx.telegraph(p, t.radius, dur + (t.at === 'target' ? (d.active / 1000) : 0));
    }
    this.sfx('boss_warn', f.pos, 1);
  }

  onHit(att, t, res, hit, def, ranged = false, at = null) {
    const p = at ? at.clone() : t.center(new THREE.Vector3());
    if (!at) { p.x += (att.pos.x - t.pos.x) * 0.25; p.z += (att.pos.z - t.pos.z) * 0.25; p.y += 0.2; }
    const color = att.cls.look?.accent || '#ffe0a0';
    const heavy = (hit.dmg || 0) >= 130 || hit.launch || hit.down;
    if (res === 'hit' || res === 'armor') {
      this.vfx.hitSpark(p, res === 'armor' ? '#ffd27a' : color, heavy);
      const snd = t.kind === 'mob' || t.kind === 'boss' ? (t.cls.metal ? 'hit_metal' : 'mob_hit') : heavy ? 'hit_heavy' : 'hit_flesh';
      this.sfx(snd, p, heavy ? 1.1 : 0.9);
      if (hit.launch && res === 'hit') this.sfx('launch', p, 0.7);
      if (att === this.player || t === this.player) {
        this.hitstop = Math.max(this.hitstop, heavy ? 0.075 : 0.035);
        if (att === this.player) this.fovPunch = Math.max(this.fovPunch || 0, heavy ? 0.035 : 0.012);
        this.shake(p, heavy ? 0.35 : 0.15);
        if (att === this.player) this.hud.hitmarker(heavy);
      }
    }
    if (att === this.player && !ranged && att.fp) att.fp.kick = -0.02;
    // 散人被动“百家”：连续用不同形态的技能命中叠层
    if (att.cls.forms && def && def.form && (res === 'hit' || res === 'armor')) {
      if (att.lastForm !== def.form) { att.stacks = Math.min(3, (att.stacks || 0) + 1); att.lastForm = def.form; if (att === this.player) this.hud.toast(`百家 ×${att.stacks}`); }
      att.stackT = 5000;
    }
    // 附加状态
    if (hit.effect && (res === 'hit' || res === 'armor') && t.alive) {
      const e = { ...hit.effect, src: att, debuff: true };
      if (att.clsId === 'witch') e.t *= 1.2;
      t.addEffect(e);
      const names = { slow: '减速', root: '定身', weak: '虚弱', fear: '恐惧', blind: '致盲', dot: '持续伤害', silence: '沉默' };
      if (names[e.type]) this.hud.floatText(t.center(new THREE.Vector3()).setY(t.pos.y + 2), names[e.type], 'enemy');
    }
    if (this.mode && this.mode.onHit) this.mode.onHit(att, t, res, hit, def);
  }
  onWhiff(att, def) { /* 挥空 */ }
  onFire(att, p, def, visual, dir) {
    this.sfx(def.sfx || 'gun_shot', visual, p.kind === 'shell' ? 1.1 : 0.85, rand(0.95, 1.05));
    const mf = p.kind === 'bullet' ? '#ffe6a0' : '#ffb35a';
    this.vfx.sprite(visual.clone().addScaledVector(dir, 0.15), mf, p.kind === 'shell' ? 0.8 : 0.35, 0.06, 1.5);
    if (att === this.player) this.shake(null, p.kind === 'shell' ? 0.25 : 0.05);
  }

  // ---- 主循环 ----
  start() {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    const loop = () => {
      if (!this.running) return;
      requestAnimationFrame(loop);
      const now = performance.now();
      let dt = Math.min(0.1, (now - this.last) / 1000);
      this.last = now;
      this.frame(dt);
    };
    requestAnimationFrame(loop);
  }

  frame(dt) {
    this.fpsT += dt; this.frames++;
    if (this.fpsT >= 1) {
      this.fps = this.frames / this.fpsT; this.frames = 0; this.fpsT = 0;
      // 自动画质：对局中连续 4 秒低于 40 帧则降档
      if (this.level && !this.paused && !this.manual && !this.renderSkip && this.settings.autoQuality !== false) {
        this.lowFpsSec = this.fps < 40 ? (this.lowFpsSec || 0) + 1 : 0;
        if (this.lowFpsSec >= 4 && !this.degraded) this.degrade();
      }
    }
    if (!this.paused && this.level && !this.manual) {
      this.handleLook(dt);
      // 顿帧
      let sdt = dt;
      if (this.hitstop > 0) { this.hitstop -= dt; sdt = dt * 0.08; }
      sdt *= this.timeScale;
      this.acc += sdt;
      let n = 0;
      const maxSteps = this.maxSteps || 5;
      while (this.acc >= STEP && n < maxSteps) { this.tick(STEP); this.acc -= STEP; n++; }
      if (n === maxSteps) this.acc = 0;
      this.vfx.update(sdt);
      if (this.level.update) this.level.update(dt, this.time);
      this.updateTrails(dt);
      if (this.mode && this.mode.frame) this.mode.frame(dt);
    }
    this.updateCamera(dt);
    if (!this.renderSkip || (this._rf = (this._rf || 0) + 1) % this.renderSkip === 0) this.render(dt);
    if (this.hud && this.level) this.hud.update(dt, this);
  }

  // 调试：手动推进模拟（测试用，manual 模式下实时循环不推进模拟）
  debugAdvance(sec) {
    const n = Math.max(1, Math.round(sec * 60));
    for (let i = 0; i < n; i++) { this.tick(STEP); this.vfx.update(STEP); this.updateTrails(STEP); if (this.mode && this.mode.frame) this.mode.frame(STEP); }
    this.updateCamera(STEP);
    this.render();
    if (this.hud) this.hud.update(STEP, this);
  }

  handleLook(dt) {
    const p = this.player;
    let [mx, my] = input.takeMouse();
    const [kx, ky] = input.keyLook();
    mx += kx * 900 * dt; my += ky * 600 * dt;
    this.lastMouse = [mx, my];
    if (!p) return;
    const s = 0.0022 * this.settings.sens * (p.aiming ? 0.55 : 1);
    this.viewYaw -= mx * s;
    this.viewPitch -= my * s * (this.settings.invertY ? -1 : 1);
    this.viewPitch = clamp(this.viewPitch, -85 * DEG, 85 * DEG);
    // 锁定目标：视线柔和跟随
    if (this.lockTarget) {
      const t = this.lockTarget;
      if (!t.alive) this.lockTarget = null;
      else {
        const want = Math.atan2(t.pos.x - p.pos.x, t.pos.z - p.pos.z);
        const k = 1 - Math.exp(-7 * dt);
        this.viewYaw += wrapAngle(want - this.viewYaw) * k;
        const dy = (t.pos.y + 1.2) - (p.pos.y + 1.6);
        const want2 = Math.atan2(dy, Math.hypot(t.pos.x - p.pos.x, t.pos.z - p.pos.z));
        this.viewPitch += (want2 - this.viewPitch) * k * 0.5;
      }
    }
  }

  tick(dt) {
    this.time += dt;
    const p = this.player;
    if (this.netGuest) { if (this.mode && this.mode.tick) this.mode.tick(dt); return; }
    if (this.mode && this.mode.preTick) this.mode.preTick(dt);
    if (p && !this.inputFrozen && !this.autoPlayer) this.playerControl(p, dt);
    if (p && this.autoPlayer) { this.viewYaw = p.yaw; this.viewPitch = p.pitch * 0.5; const cp = Math.cos(p.pitch); p.aimDir.set(Math.sin(p.yaw) * cp, Math.sin(p.pitch), Math.cos(p.yaw) * cp); }
    for (const f of this.fighters) if (f.ai && !this.aiFrozen && !(f === p && !this.autoPlayer)) f.ai.update(dt);
    for (const f of this.fighters) f.update(dt);
    this.separate();
    this.combat.updateProjectiles(dt);
    this.combat.updateAoes(dt);
    if (this.mode && this.mode.tick) this.mode.tick(dt);
    // 脚步声
    for (const f of this.fighters) {
      if (!f.onGround || f.dead) continue;
      const sp = Math.hypot(f.vel.x, f.vel.z);
      if (sp < 1) continue;
      f.footT += sp * dt;
      if (f.footT > 1.6) { f.footT = 0; this.sfx('footstep', f.pos, f === p ? 0.35 : 0.8); }
    }
  }

  playerControl(p, dt) {
    p.yaw = this.viewYaw;
    p.pitch = this.viewPitch;
    const cp = Math.cos(p.pitch);
    p.aimDir.set(Math.sin(p.yaw) * cp, Math.sin(p.pitch), Math.cos(p.yaw) * cp).normalize();
    let mx = 0, my = 0;
    if (input.held('forward')) my += 1;
    if (input.held('back')) my -= 1;
    if (input.held('left')) mx -= 1;
    if (input.held('right')) mx += 1;
    p.moveInput.set(mx, my);
    p.wantGuard = input.held('special');
    if (input.consume('jump', 150)) {
      if (p.state === 'air' || p.state === 'down') p.requestTech();
      else p.wantJump = true;
    }
    if (input.consume('dash', 120)) p.wantDash = true;
    if (p.cls.forms) {
      const forms = ['sword', 'spear', 'gun', 'shield'];
      for (let i = 0; i < 4; i++) if (input.consume('form' + (i + 1), 150) && !p.action && p.canAct()) p.setForm(forms[i]);
    }
    // 近战：按住左键，当前普攻收招后进入蓄力；松开即出手
    const held = input.held('attack');
    if (p.action && p.action.slot === 'charge') p.charging = held;
    if (input.consume('attack', 180)) { p.tryUse('atk'); this.atkHeldT = 0; }
    if (held) this.atkHeldT = (this.atkHeldT || 0) + dt; else this.atkHeldT = 0;
    if (held && this.atkHeldT > 0.28 && p.chain && !p.chain[0].proj && (!p.action || (p.action.slot === 'atk' && p.action.stage === 'recover'))) {
      if (p.action) { p.action = null; p.state = 'idle'; }
      p.startCharge();
    }
    else if (input.held('attack') && !p.action && (p.state === 'idle' || p.state === 'move') && p.chain && p.chain[0].proj) p.tryUse('atk'); // 远程按住连射
    for (const s of ['s1', 's2', 's3', 's4', 's5', 's6', 'ult']) if (input.consume(s, 200)) p.tryUse(s);
    if (input.consume('lockon', 200)) this.toggleLock();
  }

  toggleLock() {
    if (this.lockTarget) { this.lockTarget = null; this.hud.toast('取消锁定'); return; }
    const p = this.player; if (!p) return;
    let best = null, bs = 1e9;
    for (const f of this.fighters) {
      if (f.team === p.team || !f.alive || f.kind === 'dummy' && false) continue;
      const dx = f.pos.x - p.pos.x, dz = f.pos.z - p.pos.z;
      const a = Math.abs(wrapAngle(Math.atan2(dx, dz) - this.viewYaw));
      const s = a * 10 + Math.hypot(dx, dz);
      if (a < 70 * DEG && s < bs) { bs = s; best = f; }
    }
    this.lockTarget = best;
    if (best) this.hud.toast(`锁定：${best.name}`);
  }

  // 角色之间的推挤
  separate() {
    const fs = this.fighters;
    for (let i = 0; i < fs.length; i++) {
      const a = fs[i]; if (a.dead || a.state === 'down') continue;
      for (let j = i + 1; j < fs.length; j++) {
        const b = fs[j]; if (b.dead || b.state === 'down') continue;
        if (Math.abs(a.pos.y - b.pos.y) > 1.5) continue;
        const dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z;
        const d = Math.hypot(dx, dz), min = a.radius + b.radius;
        if (d >= min || d < 1e-5) continue;
        const push = (min - d);
        const wa = a.kind === 'boss' || a.kind === 'dummy' ? 0 : b.kind === 'boss' || b.kind === 'dummy' ? 1 : 0.5;
        const nx = dx / d, nz = dz / d;
        a.pos.x -= nx * push * wa; a.pos.z -= nz * push * wa;
        b.pos.x += nx * push * (1 - wa); b.pos.z += nz * push * (1 - wa);
      }
    }
  }

  updateTrails(dt) {
    if (!this.settings.showTrails) return;
    for (const [f, tr] of this.trails) {
      const a = f.action;
      const emitting = !!a && a.stage === 'active' && !!a.def.hits && !(f === this.player && this.firstPerson);
      tr.update(dt, f.weapon.base, f.weapon.tip, emitting);
    }
    const p = this.player;
    if (p && this.fpTrail && p.fp) {
      const a = p.action;
      const emitting = this.firstPerson && !!a && a.stage === 'active' && !!a.def.hits;
      this.camera.updateMatrixWorld(true);
      this.fpTrail.update(dt, p.fp.weapon.base, p.fp.weapon.tip, emitting);
    }
  }

  updateCamera(dt) {
    const p = this.player || (this.cinematic && this.cinematic.orbit ? this.cinematic.targets[0] : null);
    const cam = this.camera;
    if (p) {
      const zoom = p.aiming && p.cls.special?.fov ? p.cls.special.fov : 1;
      this._zoom = (this._zoom || 1) + (zoom - (this._zoom || 1)) * Math.min(1, dt * 12);
      // 冲刺/突进时视野略拉宽，命中时轻微收缩
      const dashing = p.state === 'dash' || (p.action && p.action.def.dash && p.action.stage === 'active');
      this.fovKick = (this.fovKick || 0) + ((dashing ? 0.07 : 0) - (this.fovKick || 0)) * Math.min(1, dt * (dashing ? 10 : 5));
      this.fovPunch = (this.fovPunch || 0) * Math.exp(-dt * 10);
      this.updateFov(this._zoom * (1 + this.fovKick - this.fovPunch));
      this.camDip = (this.camDip || 0) * Math.exp(-dt * 9);
      // 抖动
      this.shakeAmt *= Math.exp(-dt * 9);
      const sh = this.shakeAmt;
      // 团队赛阵亡后观战队友（第三人称跟随）
      const spec = p.dead && this.spectate && this.spectate.alive ? this.spectate : null;
      const cine = this.cinematic;
      if (cine) {
        cine.t += dt;
        const k = cine.orbit ? 0.35 : Math.min(1, cine.t / cine.dur);
        const fs = cine.targets.filter((f) => f && !f.dead);
        const mid = new THREE.Vector3(); for (const f of fs) mid.add(f.pos); if (fs.length) mid.divideScalar(fs.length);
        let span = 4; for (const f of fs) span = Math.max(span, f.pos.distanceTo(mid) * 2);
        const ang = cine.orbit ? cine.a0 + cine.t * 0.12 : cine.a0 + k * 1.1;
        const r = cine.orbit ? Math.min(9, span * 0.5 + 4.5) : span * 0.75 + 3.5 - k * 1.2;
        cine.mid = cine.mid ? cine.mid.lerp(mid, Math.min(1, dt * 2)) : mid.clone();
        const m2 = cine.mid;
        cam.position.set(m2.x + Math.sin(ang) * r, m2.y + (cine.orbit ? 1.2 : 2.2 + (1 - k) * 1.2), m2.z + Math.cos(ang) * r);
        cam.lookAt(m2.x, m2.y + (cine.orbit ? 0.35 : 1.1), m2.z);
        cam.layers.enable(1);
        if (p.fp) p.fp.root.visible = false;
        if (!cine.orbit && k >= 1) { this.cinematic = null; cam.layers.disable(1); }
        audio.setListener(cam.position.x, cam.position.y, cam.position.z, this.viewYaw);
        return;
      }
      if (spec) {
        const t = new THREE.Vector3(spec.pos.x, spec.pos.y + 1.6, spec.pos.z);
        const back = new THREE.Vector3(-Math.sin(spec.yaw) * 4, 1.2, -Math.cos(spec.yaw) * 4);
        cam.position.lerp(t.clone().add(back), Math.min(1, dt * 5));
        this.viewYaw += wrapAngle(spec.yaw - this.viewYaw) * Math.min(1, dt * 4);
        this.viewPitch += (-0.2 - this.viewPitch) * Math.min(1, dt * 4);
      } else if (this.firstPerson) {
        p.eyePos(this.tmp);
        // 眼睛略前移，避免看到脖子内部
        this.tmp.x += Math.sin(this.viewYaw) * 0.08; this.tmp.z += Math.cos(this.viewYaw) * 0.08;
        this.camPos = this.camPos || this.tmp.clone();
        // 纵向平滑（倒地/起身时不突跳）
        this.camPos.x = this.tmp.x; this.camPos.z = this.tmp.z;
        if (this.camFade) this.camFade.value = 0;
        this.camPos.y += (this.tmp.y - this.camPos.y) * Math.min(1, dt * 18);
        cam.position.copy(this.camPos);
        cam.position.y -= this.camDip || 0;
      } else {
        const tp = this.viewMode === 'tp';
        if (this.camFade) this.camFade.value = 1.25;
        const back = tp ? 4.4 : 2.9, up = tp ? 0.75 : 0.08, shoulder = tp ? 0 : 0.7;
        const cp = Math.cos(this.viewPitch);
        const target = new THREE.Vector3(p.pos.x, p.pos.y + (tp ? 1.45 : 1.5), p.pos.z);
        const dir = new THREE.Vector3(Math.sin(this.viewYaw) * cp, Math.sin(this.viewPitch), Math.cos(this.viewYaw) * cp);
        const want = target.clone().addScaledVector(dir, -back); want.y += up;
        // 越肩：相机偏右肩
        want.x += -Math.cos(this.viewYaw) * shoulder; want.z += Math.sin(this.viewYaw) * shoulder;
        // 相机碰撞
        const hit = this.world.raycast(target, want.clone().sub(target).normalize(), target.distanceTo(want), null);
        cam.position.copy(hit.dist < target.distanceTo(want) ? hit.point.lerp(target, 0.1) : want);
      }
      cam.rotation.set(this.viewPitch + (Math.random() - 0.5) * sh * 0.03, this.viewYaw + Math.PI + (Math.random() - 0.5) * sh * 0.03, 0);
      if (p.fp) {
        p.fp.sync(p.rig, dt, this.settings.bob ? Math.hypot(p.vel.x, p.vel.z) * (p.onGround ? 1 : 0) : 0, this.lastMouse[0], this.lastMouse[1], this.settings.bob);
        p.fp.root.visible = this.firstPerson && !p.dead && p.state !== 'down';
      }
      audio.setListener(cam.position.x, cam.position.y, cam.position.z, this.viewYaw);
      // 阴影相机跟随玩家
      if (this.level && this.level.sun && this.sunOffset) {
        const s = this.level.sun;
        s.target.position.set(p.pos.x, 0, p.pos.z);
        s.position.copy(s.target.position).add(this.sunOffset);
        s.target.updateMatrixWorld();
      }
    }
  }

  render(dt = 1 / 60) {
    // 录制工具用：外部接管机位（宣传片运镜），游戏本身不设置
    if (this.camHook) { try { this.camHook(this.camera, this); } catch (e) { this.camHook = null; console.warn('camHook', e); } }
    if (this.settings.post !== false && this.post) { this.post.render(dt); return; }
    const r = this.renderer;
    r.autoClear = true;
    r.render(this.scene, this.camera);
    if (this.player && this.firstPerson && this.player.fp && this.player.fp.root.visible) {
      r.autoClear = false;
      const sm = r.shadowMap.autoUpdate; r.shadowMap.autoUpdate = false;
      r.clearDepth();
      const bg = this.scene.background, fog = this.scene.fog;
      this.scene.background = null;
      r.render(this.scene, this.vmCamera);
      this.scene.background = bg; this.scene.fog = fog;
      r.shadowMap.autoUpdate = sm;
      r.autoClear = true;
    }
  }
}
