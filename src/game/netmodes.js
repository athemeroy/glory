// 联机个人赛：主机权威模拟（NetHostDuel），客机只发输入、按快照插值显示并重放特效（NetGuestDuel）。
import * as THREE from 'three';
import { DuelMode } from './modes.js';
import { CLASSES, skillClass } from '../data/classes.js';
import { input } from '../engine/input.js';
import { audio } from '../engine/audio.js';
import { fmtTime, store, uid } from '../engine/util.js';
import { ModeTimers } from './mode-timers.js';
import { flightSnapshot, applyFlightSnapshot } from './witch-flight.js';
import { battleMageSnapshot, applyBattleMageSnapshot } from './battle-mage.js';

const SNAP_MS = 33;
const PRESS_ACTIONS = ['jump', 'dash', 'attack', 'special', 's1', 's2', 's3', 's4', 's5', 's6', 'ult', 'form1', 'form2', 'form3', 'form4'];

// ---------- 序列化：角色 → {__f:id}，向量 → {__v:[..]} ----------
function ser(v, d = 0) {
  if (v == null || typeof v !== 'object') return typeof v === 'function' ? undefined : v;
  if (d > 7) return undefined;
  if (v.isVector3) return { __v: [+v.x.toFixed(3), +v.y.toFixed(3), +v.z.toFixed(3)] };
  if (v.rig && v.cls && v.id !== undefined) return { __f: v.id };
  if (v.isColor) return '#' + v.getHexString();
  if (Array.isArray(v)) return v.map((x) => ser(x, d + 1));
  if (v.isObject3D) return undefined;
  const o = {};
  for (const k in v) { const s = ser(v[k], d + 1); if (s !== undefined) o[k] = s; }
  return o;
}
function deser(v, lookup) {
  if (v == null || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.map((x) => deser(x, lookup));
  if (v.__v) return new THREE.Vector3(v.__v[0], v.__v[1], v.__v[2]);
  if (v.__f !== undefined) return lookup(v.__f);
  const o = {}; for (const k in v) o[k] = deser(v[k], lookup); return o;
}

// 在主机上录制需要在客机重放的表现层调用（嵌套调用只录最外层）
export function installRecorder(game, hud, sink) {
  const saved = []; let depth = 0;
  const wrap = (obj, name, tag) => {
    const orig = obj[name]; saved.push([obj, name, orig]);
    obj[name] = function (...args) {
      if (depth === 0) sink([tag, name, ser(args)]);
      depth++;
      try { return orig.apply(this, args); } finally { depth--; }
    };
  };
  for (const m of ['onFighterEvent', 'onHit', 'onFire', 'spawnTelegraph', 'shake', 'voice']) wrap(game, m, 'G');
  for (const m of ['slash', 'hitSpark', 'blockSpark', 'parrySpark', 'dust', 'explosion', 'ring', 'telegraph', 'coneTelegraph', 'beam', 'tracer', 'sprite', 'burst', 'shock', 'flashAt', 'fire', 'areaEvent', 'explosionEvent', 'channelBeam', 'healTarget', 'statusTarget', 'blinkTrail']) if (typeof game.vfx[m] === 'function') wrap(game.vfx, m, 'V');
  // Both peers animate trails and effect timelines locally. Deferred strike
  // callbacks also draw their own burst/slash; recording those a second time
  // would duplicate the guest's flash after its original action replay.
  for(const method of ['projectileStep','update']) if (typeof game.vfx[method] === 'function') {
    const orig = game.vfx[method]; saved.push([game.vfx, method, orig]);
    game.vfx[method] = function (...args) {
      depth++; try { return orig.apply(this, args); } finally { depth--; }
    };
  }
  wrap(audio, 'play', 'A');
  wrap(hud, 'announce', 'H'); wrap(hud, 'bigCenter', 'H');
  return () => { for (const [o, n, f] of saved.reverse()) o[n] = f; };
}

export function fighterSnap(f, full) {
  const a = f.action;
  const o = {
    id: f.id, p: [+f.pos.x.toFixed(3), +f.pos.y.toFixed(3), +f.pos.z.toFixed(3)], v: [+f.vel.x.toFixed(2), +f.vel.y.toFixed(2), +f.vel.z.toFixed(2)],
    y: +f.yaw.toFixed(3), pi: +f.pitch.toFixed(3), hp: Math.round(f.hp), mp: Math.round(f.mp), st: f.state, sT: +f.stateT.toFixed(3), og: f.onGround ? 1 : 0,
    a: a ? [a.slot, a.chainIdx || 0, a.stageN ?? -1, a.stage, Math.round(a.t), a.animIdx || 0, a.uid, a.aimYaw, a.aimPitch] : 0, fm: f.form, dead: f.dead ? 1 : 0,
    sp: Math.round(f.stamina), sprint: f.sprinting ? 1 : 0, fl: flightSnapshot(f), bm: battleMageSnapshot(f), inv: f.invuln > 0 ? 1 : 0, shadow: f.shadowTime || 0,
    sd: f.stunDur || 0, aim: f.aiming ? 1 : 0, ch: f.cheer ? 1 : 0, ar: f.armor > 0 ? 1 : 0, cb: f.comboDealt, yr: f.netYawReset || 0,
    ef: f.effects.map((e) => [e.type, Math.round(e.t), e.debuff ? 1 : 0, e.amount || 0]),
    stats: full ? f.stats : undefined,
  };
  if (full) { o.cd = {}; for (const k in f.cd) if (f.cd[k] > 0) o.cd[k] = Math.round(f.cd[k]); o.si = f.stageInfo ? f.stageInfo.slot : null; o.pt = f.parryT > 0 ? 1 : 0; }
  return o;
}

function resolveDef(cls, slot, ci, sn, form) {
  if (slot === 'atk') { const chain = cls.forms && form ? cls.forms[form].chain : cls.chain; return chain ? chain[ci] || chain[0] : null; }
  if (slot === 'counter') return cls.counter;
  if (slot === 'charge') return { name: '蓄力重击', anim: 'slash3', wind: 1100, active: 130, recover: 420, armor: true, charge: true, hits: [] };
  const base = cls.skills?.[slot];
  if (!base) return null;
  if (base.stages && sn >= 0) return { ...base, ...base.stageDefs[sn] };
  return base;
}

// ======================= 主机 =======================
export class NetHostDuel extends DuelMode {
  constructor(app, opts) { super(app, opts); this.net = opts.net; this.evq = []; this.remoteIn = { mx: 0, my: 0, yaw: 0, pitch: 0, guard: 0, atk: 0 }; this.presses = []; this.snapT = 0; }
  start() {
    super.start();
    const r = this.enemy;
    r.cls = skillClass(r.clsId, r.cls, this.opts.enemyLoadout || {});
    r.ai = null; r.isPlayer = true; r.remote = true; // 由远端玩家操控（视线瞄准）
    r.netYawReset = 1;
    this.uninstall = installRecorder(this.game, this.hud, (e) => this.evq.push(e));
    this.offs = [
      this.net.on('relay', (d) => {
        if (d.k === 'in') { this.remoteIn = d; this.lastInT = performance.now(); if (d.p) this.presses.push(...d.p); }
      }),
      this.net.on('left', () => this.peerLost()),
      this.net.on('close', () => this.peerLost()),
    ];
    this.lastInT = performance.now();
    if (this.net.peerGone || !this.net.connected) this.timers.after(() => this.peerLost(), 500);
    this.net.relay({ k: 'go', level: this.L.id || 'courtyard', host: { acc: this.opts.account.id, id: this.player.id, skills: this.player.cls.skillSelection }, guest: { acc: this.opts.enemy.id, id: this.enemy.id, skills: this.enemy.cls.skillSelection } });
  }
  peerLost() {
    if (this.over) return;
    this.net.peerGone = true;
    this.hud.bigCenter('对手已离开', '', 2.5, 'lose');
    this.finish({ win: true, title: '对手离线', sub: '对局结束', fighters: [this.player, this.enemy], mode: 'net' });
  }
  resetFighter(f, spawn) { super.resetFighter(f, spawn); if (f && f.remote) f.netYawReset = (f.netYawReset || 0) + 1; }
  preTick() {
    const r = this.enemy; if (!r) return;
    let inp = this.remoteIn;
    // 超过 300ms 没收到输入（对方暂停/卡顿）：视为松开所有按键
    if (performance.now() - this.lastInT > 300) inp = { ...inp, mx: 0, my: 0, guard: 0, atk: 0, sprint: 0, jump: 0 };
    if (this.game.inputFrozen) { r.moveInput.set(0, 0); r.jumpHeld = false; this.presses.length = 0; return; }
    if (r.dead) return;
    r.yaw = inp.yaw; r.pitch = inp.pitch;
    const cp = Math.cos(r.pitch);
    r.aimDir.set(Math.sin(r.yaw) * cp, Math.sin(r.pitch), Math.cos(r.yaw) * cp);
    r.moveInput.set(inp.mx || 0, inp.my || 0);
    r.wantGuard = !!inp.guard;
    r.wantSprint = !!inp.sprint;
    r.jumpHeld = !!inp.jump;
    const forms = ['sword', 'spear', 'gun', 'shield'];
    for (const p of this.presses) {
      if (p === 'jump') { if (r.state === 'air' || r.state === 'down') r.requestTech(); else r.wantJump = true; }
      else if (p === 'dash') r.wantDash = true;
      else if (p === 'attack') r.tryUse('atk');
      else if (p === 'special') { if (r.cls.special?.type === 'chaser') r.wantChaser = true; }
      else if (p.startsWith('form')) { if (!r.action) r.setForm(forms[+p.slice(4) - 1]); }
      else r.tryUse(p);
    }
    this.presses.length = 0;
    // 远端按住左键：蓄力
    this.remoteHeldT = inp.atk ? (this.remoteHeldT || 0) + 1 / 60 : 0;
    if (r.action && r.action.slot === 'charge') r.charging = !!inp.atk;
    if (inp.atk && this.remoteHeldT > 0.28 && r.chain && !r.chain[0].proj && (!r.action || (r.action.slot === 'atk' && r.action.stage === 'recover'))) { if (r.action) { r.action = null; r.state = 'idle'; } r.startCharge(); }
    if (inp.atk && !r.action && (r.state === 'idle' || r.state === 'move' || r.state === 'jump') && r.chain && r.chain[0].proj) r.tryUse('atk');
  }
  frame(dt) {
    super.frame(dt);
    this.snapT += dt * 1000;
    if (this.snapT >= SNAP_MS) {
      this.snapT = 0;
      const g = this.game;
      const pr = g.combat.projectiles.map((p) => {
        if (!p.id) p.id = uid();
        return [p.id, p.p.kind, p.color, +p.mesh.position.x.toFixed(3), +p.mesh.position.y.toFixed(3), +p.mesh.position.z.toFixed(3),
          p.owner?.id, ser(p.p), p.def?.name || '', +p.age.toFixed(3), ...p.vel.toArray().map(v => +v.toFixed(2))];
      });
      const ao = g.combat.aoes.map(z => {
        if (!z.id) z.id = uid();
        return [z.id, z.owner?.id, z.def?.name || '', ser(z.a), z.pos.toArray(), z.tick || 0, z.t];
      });
      this.net.relay({ k: 'snap', tm: g.time, fs: [fighterSnap(this.player, true), fighterSnap(this.enemy, true)], pr, ao, sm: g.summons.snapshot(), ev: this.evq, m: { t: this.t, w: this.wins, r: this.round, over: this.over } });
      this.evq = [];
    }
  }
  finish(result) {
    if (this.over) return;
    this.net.relay({ k: 'end', res: { win: !result.win, title: result.win ? '个人赛失败' : '个人赛胜利', sub: result.sub } });
    super.finish(result);
  }
  dispose() { super.dispose(); if (this.uninstall) this.uninstall(); for (const o of this.offs || []) o(); }
}

// ======================= 客机 =======================
export class NetGuestDuel {
  constructor(app, opts) { this.app = app; this.game = app.game; this.hud = app.hud; this.opts = opts; this.net = opts.net; this.over = false; this.snaps = []; this.pendingEvents = []; this.areaVisuals = new Map(); this.puppets = new Map(); this.projs = new Map(); this.sendT = 0; this.lastYr = 0; this.replayErrors = []; this.timers = new ModeTimers(() => this.app.mode === this); }
  start() {
    const g = this.game, o = this.opts;
    const L = g.loadLevel(o.level || 'courtyard');
    this.L = L;
    const accH = o.hostAcc, accG = o.guestAcc;
    const sp = L.spawns;
    this.enemy = this.spawnPuppet(accH, 1, sp.player || [0, 0, 12, Math.PI], false, o.hostId, o.hostSkills);
    this.player = this.spawnPuppet(accG, 2, sp.enemy || [0, 0, -12, 0], true, o.guestId, o.guestSkills);
    this.hud.bindPlayer(this.player, accG);
    this.hud.setTeams(null, null); this.hud.setBoss(null); this.hud.setHint('');
    g.netGuest = true;
    this.offs = [
      this.net.on('relay', (d) => {
        if (d.k === 'snap') {
          d.rt = performance.now(); this.snaps.push(d); if (this.snaps.length > 30) this.snaps.shift();
          if (d.ev?.length) this.pendingEvents.push({ rt: d.rt, ev: d.ev });
          // A paused tab needs current ongoing state, not hundreds of stale flashes.
          if (this.pendingEvents.length > 120) this.pendingEvents.splice(0, this.pendingEvents.length - 120);
        }
        else if (d.k === 'end' && !this.over) { this.over = true; this.timers.after(() => this.app.showResults({ ...d.res, fighters: [this.player, this.enemy], mode: 'net' }), 2200); }
      }),
      this.net.on('left', () => this.hostLost()),
      this.net.on('close', () => this.hostLost()),
    ];
    input.resetApm();
  }
  spawnPuppet(acc, team, spawn, isPlayer, hostId, skillLoadout) {
    const cls = CLASSES[acc.cls];
    const look = isPlayer ? { ...cls.look, ...(store.get('look.' + acc.cls, {})) } : cls.look;
    const f = this.game.spawn({ name: acc.name, cls, clsId: acc.cls, team, pos: [spawn[0], spawn[1], spawn[2]], yaw: spawn[3], isPlayer, look, skillLoadout: skillLoadout || {} });
    f.account = acc;
    this.puppets.set(hostId, f);
    return f;
  }
  hostLost() {
    if (this.over) return;
    this.over = true;
    this.hud.bigCenter('主机已离开', '', 2.5, 'lose');
    this.timers.after(() => this.app.showResults({ win: true, title: '对手离线', sub: '对局结束', fighters: [this.player, this.enemy], mode: 'net' }), 2000);
  }
  lookup(id) { return this.puppets.get(id) || this.game.summons.lookup(id) || null; }
  replay(evs) {
    const g = this.game;
    for (const [tag, name, rawArgs] of evs) {
      const args = deser(rawArgs, (id) => this.lookup(id));
      try {
        if (tag === 'G' && name === 'voice') { const sw = { win: 'lose', lose: 'win', roundwin: 'roundlose', roundlose: 'roundwin' }; g.voice(sw[args[0]] || args[0], args[1]); }
        else if (tag === 'G') g[name](...args);
        else if (tag === 'V') g.vfx[name](...args);
        else if (tag === 'A') {
          let n = args[0];
          if (n === 'victory') n = 'defeat'; else if (n === 'defeat') n = 'victory';
          audio.play(n, args[1]);
        } else if (tag === 'H') {
          if (name === 'bigCenter') {
            let [text, sub, dur, cls] = args;
            if (text && text.includes('胜利')) { text = text.replace('胜利', '失败'); cls = 'lose'; } else if (text && text.includes('失败')) { text = text.replace('失败', '胜利'); cls = 'go'; }
            this.hud.bigCenter(text, sub, dur, cls);
          } else this.hud[name](...args);
        }
      } catch (e) {
        // Kept for QA: one bad event does not discard the rest of a snapshot.
        if (this.replayErrors.length < 20) this.replayErrors.push(`${tag}.${name}: ${e.message}`);
      }
    }
  }
  // Game.tick 在 netGuest 时只调用这里
  tick(dt) {
    const g = this.game;
    this.sendInput(dt);
    if (!this.snaps.length) return;
    // 插值：渲染时刻 = 最新快照接收时间 - 60ms
    const now = performance.now() - 60;
    let a = this.snaps[0], b = this.snaps[this.snaps.length - 1];
    for (let i = this.snaps.length - 1; i > 0; i--) { if (this.snaps[i - 1].rt <= now) { a = this.snaps[i - 1]; b = this.snaps[i]; break; } }
    const k = b.rt > a.rt ? Math.min(1, Math.max(0, (now - a.rt) / (b.rt - a.rt))) : 1;
    for (let i = 0; i < b.fs.length; i++) {
      const sb = b.fs[i], sa = a.fs.find((x) => x.id === sb.id) || sb;
      const f = this.lookup(sb.id); if (!f) continue;
      f.pos.set(sa.p[0] + (sb.p[0] - sa.p[0]) * k, sa.p[1] + (sb.p[1] - sa.p[1]) * k, sa.p[2] + (sb.p[2] - sa.p[2]) * k);
      f.vel.set(sb.v[0], sb.v[1], sb.v[2]);
      if (f === this.player) {
        if (sb.yr !== this.lastYr) { this.lastYr = sb.yr; g.viewYaw = sb.y; g.viewPitch = 0; }
        f.yaw = g.viewYaw; f.pitch = g.viewPitch;
      } else { f.yaw = sb.y; f.pitch = sb.pi; }
      const aimCos = Math.cos(f.pitch);
      f.aimDir.set(Math.sin(f.yaw) * aimCos, Math.sin(f.pitch), Math.cos(f.yaw) * aimCos);
      f.hp = sb.hp; f.mp = sb.mp; f.dead = !!sb.dead; f.onGround = !!sb.og; f.stunDur = sb.sd; f.aiming = !!sb.aim; f.cheer = !!sb.ch;
      f.stamina = sb.sp ?? f.stamina; f.sprinting = !!sb.sprint; f.invuln = sb.inv ? 100 : 0; f.shadowTime = sb.shadow || 0;
      applyFlightSnapshot(f, sb.fl);
      applyBattleMageSnapshot(f, sb.bm);
      if (f.state !== sb.st) f.stateT = sb.sT; else f.stateT += dt;
      f.state = sb.st;
      f.armor = sb.ar ? 100 : 0;
      f.comboDealt = sb.cb;
      if (sb.fm && sb.fm !== f.form) { f.form = sb.fm; f.weapon.setForm?.(sb.fm); f.fp?.setForm(sb.fm); if (f === this.player) this.hud.setForm(sb.fm); }
      if (sb.a) {
        const [slot, ci, sn, stage, t, animIdx, actionId, aimYaw, aimPitch] = sb.a;
        const def = resolveDef(f.cls, slot, ci, sn, f.form);
        if (def) {
          if (!f.action || f.action.uid !== actionId || f.action.slot !== slot || f.action.chainIdx !== ci || f.action.stageN !== sn) f.action = { uid: actionId, def, slot, stage, t, animIdx, chainIdx: ci, stageN: sn, aimYaw, aimPitch };
          f.action.stage = stage; f.action.t = t; f.action.animIdx = animIdx;
        } else f.action = null;
      } else f.action = null;
      f.effects = sb.ef.map(([type, t, debuff, amount]) => ({ type, t, debuff: !!debuff, amount }));
      // Rebuild ongoing status markers even when the original hit occurred while
      // this browser was loading or paused. The VFX engine updates one object.
      for (const e of f.effects) g.vfx.statusTarget?.(f, e);
      if (sb.cd) { f.cd = { ...sb.cd }; f.stageInfo = sb.si ? { slot: sb.si } : null; f.parryT = sb.pt ? 100 : 0; }
      if (sb.stats) f.stats = sb.stats;
      f.updateModel(dt);
      if (f.weapon.update) f.weapon.update(dt);
      if (f.fp) f.fp.update(dt);
    }
    g.summons.applySnapshot(b.sm, a.sm, k, id => this.puppets.get(id), dt);
    // 投射物外形
    const seen = new Set();
    for (const [id, kind, color, x, y, z, ownerId, payload, skillName, age, vx, vy, vz] of b.pr) {
      seen.add(id);
      let m = this.projs.get(id);
      const owner = this.lookup(ownerId), p = payload || { kind, radius: .18 }, def = { name: skillName || '' };
      if (!m) {
        m = g.vfx.projectileMesh(kind, color, def, p, owner || {}); g.scene.add(m); this.projs.set(id, m); m.position.set(x, y, z);
        m.userData.netProjectile = { mesh: m, p, def, owner, color, age: age || 0, vel: new THREE.Vector3(vx || 0, vy || 0, vz || 0) };
      }
      const np = new THREE.Vector3(x, y, z);
      const pr = m.userData.netProjectile;
      if (vx !== undefined) pr.vel.set(vx, vy, vz);
      else pr.vel.copy(np).sub(m.position).multiplyScalar(1 / Math.max(.001, dt));
      pr.age = age ?? (pr.age + dt);
      if (pr.vel.lengthSq() > 1e-6) m.lookAt(np.clone().add(pr.vel));
      m.position.lerp(np, 1 - Math.exp(-dt * 22));
      g.vfx.projectileStep?.(pr, dt);
    }
    for (const [id, m] of this.projs) if (!seen.has(id)) { m.removeFromParent(); this.projs.delete(id); }
    const seenAreas = new Set();
    const queuedEffect = (name, at, radius, index) => this.pendingEvents.some(batch => now - batch.rt <= 500 && batch.ev.some(([tag, method, args]) => {
      const p = args[index]?.__v;
      return tag === 'V' && method === name && p && Math.abs(p[0] - at.x) < .02 && Math.abs(p[1] - at.y) < .02 && Math.abs(p[2] - at.z) < .02 &&
        (name !== 'telegraph' || Math.abs((args[1] || 0) - radius) < .02);
    }));
    for (const [id, ownerId, skillName, a, pos, tick, elapsed] of b.ao || []) {
      seenAreas.add(id);
      const shown = this.areaVisuals.get(id) || { tele: false, active: false };
      const owner = this.lookup(ownerId), at = new THREE.Vector3(...pos);
      if (!shown.tele && !tick && a.telegraph && elapsed < a.delay) {
        if (!queuedEffect('telegraph', at, a.radius, 0)) g.vfx.telegraph(at, a.radius, (a.delay - elapsed) / 1000, a.color || (owner?.team === g.player?.team ? '#4d9d9a' : '#cf624b'));
        shown.tele = true;
      }
      if (!shown.active && tick > 0 && (a.vfx === 'zone' || skillName === '烟雾弹')) {
        const remaining = Math.max(.1, (a.delay + ((a.ticks || 1) - 1) * (a.interval || 0) + 400 - elapsed) / 1000);
        if (!queuedEffect('areaEvent', at, a.radius, 3)) g.vfx.areaEvent?.(owner, { ...a, visualRemaining: remaining }, { name: skillName }, at, tick);
        shown.active = true;
      }
      this.areaVisuals.set(id, shown);
    }
    for (const id of this.areaVisuals.keys()) if (!seenAreas.has(id)) this.areaVisuals.delete(id);
    // Match event effects to the same 60 ms delayed character pose/state. Fire
    // and impacts no longer render against a previous action or stale target.
    while (this.pendingEvents.length && this.pendingEvents[0].rt <= now) {
      const batch = this.pendingEvents.shift();
      if (now - batch.rt <= 500) this.replay(batch.ev);
    }
    this.meta = b.m;
  }
  sendInput(dt) {
    this.sendT += dt * 1000;
    const presses = [];
    for (const a of PRESS_ACTIONS) if (input.consume(a, 250)) presses.push(a);
    if (input.consume('lockon', 200)) this.game.toggleLock();
    if (!presses.length && this.sendT < 16) return;
    this.sendT = 0;
    const [mx, my] = input.moveAxes();
    const g = this.game;
    this.net.relay({ k: 'in', mx, my, yaw: +g.viewYaw.toFixed(4), pitch: +g.viewPitch.toFixed(4), guard: input.held('special') ? 1 : 0, atk: input.held('attack') ? 1 : 0, sprint: input.held('sprint') ? 1 : 0, jump: input.held('jump') ? 1 : 0, p: presses });
    const p = this.player; if (p) { const cp = Math.cos(g.viewPitch); p.aimDir.set(Math.sin(g.viewYaw) * cp, Math.sin(g.viewPitch), Math.cos(g.viewYaw) * cp); }
  }
  frame() {
    const m = this.meta; if (!m) return;
    const pips = (n) => [0, 1].map((i) => `<i class="${i < n ? 'on' : ''}"></i>`).join('');
    this.hud.setTop(`<span class="acc ally">${this.player.name}</span><span class="pips">${pips(m.w[1])}</span>`, fmtTime(m.t), `<span class="pips">${pips(m.w[0])}</span><span class="acc enemy">${this.enemy.name}</span>`, `联机个人赛 · 三局两胜 · 第 ${m.r} 局 · 延迟 ${Math.round(this.net.rtt)}ms`);
  }
  onDeath() {}
  onHit() {}
  dispose() { this.timers.clear(); this.game.netGuest = false; for (const o of this.offs || []) o(); for (const [, m] of this.projs) m.removeFromParent(); this.projs.clear(); this.areaVisuals.clear(); this.pendingEvents.length = 0; this.snaps.length = 0; }
}
