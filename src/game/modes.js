import { trainingGoals } from '../data/training.js';
// 玩法模式：训练场、个人赛、擂台赛、团队赛、副本
import * as THREE from 'three';
import { CLASSES, ACCOUNTS } from '../data/classes.js';
import { MOBS, BOSS } from '../data/enemies.js';
import { Brain } from './ai.js';
import { input } from '../engine/input.js';
import { audio } from '../engine/audio.js';
import { fmtTime, rand, pick, store } from '../engine/util.js';
import { ModeTimers } from './mode-timers.js';

const ROUND_TIME = 180;

function accountCls(acc) { return CLASSES[acc.cls]; }

// 关卡出生点兜底：缺少时按玩家出生点镜像生成
function spawnsOf(L) {
  const sp = { ...L.spawns };
  const p = sp.player || [0, 0, 8, Math.PI];
  sp.player = p;
  if (!sp.enemy) sp.enemy = [-p[0], p[1], -p[2], p[3] + Math.PI];
  if (!sp.teamA) sp.teamA = [p, [p[0] - 2, p[1], p[2], p[3]], [p[0] + 2, p[1], p[2], p[3]]];
  if (!sp.teamB) sp.teamB = sp.teamA.map((q) => [-q[0], q[1], -q[2], q[3] + Math.PI]);
  return sp;
}

export class BaseMode {
  constructor(app, opts) {
    this.app = app; this.game = app.game; this.hud = app.hud; this.opts = opts;
    this.t = 0; this.phase = 'intro'; this.phaseT = 0;
    this.over = false;
    this.timers = new ModeTimers(() => this.app.mode === this);
  }
  spawnHero(acc, team, spawn, isPlayer, diff) {
    const cls = accountCls(acc);
    const [x, y, z, yaw] = spawn;
    const look = isPlayer ? { ...cls.look, ...(store.get('look.' + acc.cls, {})) } : cls.look;
    const f = this.game.spawn({ name: acc.name, cls, clsId: acc.cls, team, pos: [x, y, z], yaw, isPlayer, ai: isPlayer ? null : (diff || 'normal'), look });
    f.account = acc;
    return f;
  }
  freeze(on) { this.game.inputFrozen = on; this.game.aiFrozen = on; for (const f of this.game.fighters) if (on) { f.moveInput.set(0, 0); } }
  countdown(then) {
    this.freeze(true);
    let n = 3;
    const step = () => {
      if (this.over) return;
      if (n > 0) { this.hud.bigCenter(String(n), '', 0.9, 'count'); audio.play('countdown'); this.game.voice('cd' + n); n--; this.timers.after(step, 800); }
      else { this.hud.bigCenter('开始', '', 0.8, 'go'); audio.play('round_start'); this.game.voice('go'); this.freeze(false); input.resetApm(); then && then(); }
    };
    this.timers.after(step, 400);
  }
  finish(result) {
    if (this.over) return;
    this.over = true;
    this.freeze(true);
    this.timers.after(() => this.app.showResults(result), 2200);
  }
  resetFighter(f, spawn) {
    f.resetState();
    f.hp = f.maxHp; f.mp = f.maxMp;
    if (spawn) { f.pos.set(spawn[0], spawn[1], spawn[2]); f.yaw = spawn[3]; }
    if (f === this.game.player) { this.game.viewYaw = f.yaw; this.game.viewPitch = 0; }
  }
  tick() {}
  frame() {}
  onDeath() {}
  onHit() {}
  dispose() { this.timers.clear(); }
}

// ---------------- 训练场 ----------------
export class TrainingMode extends BaseMode {
  start() {
    const g = this.game;
    const L = g.loadLevel('training');
    const acc = this.opts.account;
    this.player = this.spawnHero(acc, 1, L.spawns.player, true);
    this.hud.bindPlayer(this.player, acc);
    this.dummies = [];
    const ds = L.markers.dummies || [[2, -2, 0], [2, 0, 0], [2, 2, 0]];
    ds.forEach(([x, z, yaw], i) => this.spawnDummy(x, z, yaw, i));
    this.hud.setTop('<b>镜廊训练室</b>', '', '');
    this.hud.setTeams(null, null);
    this.hud.setBoss(null);
    this.dpsLog = [];
    this.total = 0;
    this.phase = 'play';
    this.freeze(false);
    this.hud.announce('镜廊训练室', 'ally', 2.2);
    this.game.voice('training');
    this.hud.setHint(input.touchMode ? '暂停菜单可切换职业、调整招式、添加陪练' : '<kbd>Esc</kbd> 训练菜单 · <kbd>G</kbd> 镜前换装');
    this.mirrorZone = L.markers.mirrorZone;
    this.goals = trainingGoals(this.player);
    this._lastDamage = 0; this.sprintSeen = false; this.flightSeen = false;
  }
  goal(id) { const g = this.goals.find((x) => x.id === id); if (g && !g.done) { g.done = true; audio.play('levelup'); this.hud.toast('训练目标完成：' + g.text); } }
  refreshGoals() {
    const done = new Set(this.goals.filter(g => g.done).map(g => g.id));
    this.goals = trainingGoals(this.player).map(g => ({ ...g, done: done.has(g.id) }));
  }
  spawnDummy(x, z, yaw, i) {
    const g = this.game;
    const cls = { name: '木桩', hp: 99999, mp: 100, speed: 0, weapon: 'none', stance: 'none', chain: null, skills: {}, look: { sex: 'm', skin: '#b08a5a', hair: { style: 'bald', color: '#000' }, top: { style: 'armor', color: '#8a6a44', trim: '#5a4a34', inner: '#6a5236' }, pants: '#6a5236', boots: '#4a3a28', gloves: '#b08a5a', sash: null, shoulder: 'none', accent: '#cf624b' } };
    const f = g.spawn({ name: `木桩 ${i + 1}`, cls, clsId: 'dummy', kind: 'dummy', team: 2, pos: [x, 0, z], yaw, hp: 99999 });
    f.home = [x, z, yaw];
    f.untargetable = false;
    this.dummies.push(f);
    return f;
  }
  addSparring(accId, diff) {
    const acc = ACCOUNTS.find((a) => a.id === accId) || pick(ACCOUNTS);
    if (this.sparring) this.game.removeFighter(this.sparring);
    const p = this.player;
    this.sparring = this.spawnHero(acc, 3, [p.pos.x + Math.sin(p.yaw) * 6, 0, p.pos.z + Math.cos(p.yaw) * 6, p.yaw + Math.PI], false, diff);
    this.sparring.target = p;
    this.sparring.ai.pickTarget = () => (this.sparring.target = this.player);
    this.hud.announce(`陪练「${acc.name}」加入`, 'enemy');
  }
  removeSparring() { if (this.sparring) { this.game.removeFighter(this.sparring); this.sparring = null; } }
  onFire(att) { if (att === this.player && !att.onGround) this.goal('airshot'); }
  onHit(att, t, res, hit, def) {
    if (att === this.player && res !== 'miss') {
      const basic = def?.charge || att.chain?.includes(def) || Object.values(att.cls.forms || {}).some(form => form.chain?.includes(def));
      if (basic) this.goal('basic');
      else if (def?.name && Object.values(att.cls.skills || {}).some(skill => skill.name === def.name)) this.goal('skillhit');
      if (att.flightActive) this.goal('aircast');
      if (att.aiming) this.goal('aimshot');
      if (hit.chaser) this.goal('chaserhit');
      if (att.action && att.action.slot === 'atk' && att.action.chainIdx >= 2) this.goal('chain');
      if (hit.launch && t.state === 'air') this.goal('launch');
      if (t.state === 'air' && t.air.time > 0.2) this.goal('air');
      if (att.comboDealt >= 10) this.goal('combo10');
      if (att.action && att.action.def.ult) this.goal('ult');
    }
  }
  onDeath(f) {
    if (f === this.player) {
      this.hud.bigCenter('重伤', '3 秒后在训练室复活', 2);
      this.timers.after(() => { if (!this.over) { this.resetFighter(this.player, this.game.level.spawns.player); } }, 2500);
    } else if (f === this.sparring) {
      this.hud.bigCenter('胜利', `击败陪练「${f.name}」`, 1.6, 'go');
      this.goal('spar');
      audio.play('victory');
      this.timers.after(() => { if (this.sparring === f) this.resetFighter(f, [this.player.pos.x + 6, 0, this.player.pos.z, 0]); }, 3000);
    }
  }
  tick(dt) {
    // 木桩：3 秒无伤害回满，倒地后自动站起
    for (const d of this.dummies) {
      d.pos.x += (d.home[0] - d.pos.x) * (d.state === 'idle' ? 0.02 : 0);
      d.pos.z += (d.home[1] - d.pos.z) * (d.state === 'idle' ? 0.02 : 0);
      if (d.state === 'idle') d.yaw = d.home[2];
      d.stats.idle = (d.stats.idle || 0) + dt;
      if (d.comboTaken > 0) d.stats.idle = 0;
      if (d.stats.idle > 3) d.hp = d.maxHp;
    }
    // 统计
    const now = this.game.time;
    const total = this.player.stats.dmgDealt || 0;
    const dealt = total >= this._lastDamage ? total - this._lastDamage : total;
    this._lastDamage = total;
    if (dealt > 0) this.dpsLog.push([now, dealt]);
    while (this.dpsLog.length && now - this.dpsLog[0][0] > 5) this.dpsLog.shift();
  }
  frame(dt) {
    if (this.player.sprinting) this.sprintSeen = true;
    if (this.sprintSeen && !this.player.wantSprint && this.player.stamina >= this.player.maxStamina - 1) this.goal('stamina');
    const p = this.player;
    if (p.flightActive) this.flightSeen = true;
    if (this.flightSeen && p.onGround) this.goal('flight');
    if (p.chasers?.length) this.goal('chaser');
    if (p.battleWill?.tier >= 1) this.goal('will');
    if (p.summonState?.count >= 2) this.goal('summon');
    if (['focus', 'escort', 'guard'].includes(p.summonState?.mode)) this.goal('command');
    if (p.summonState?.formation > 0) this.goal('formation');
    if (p.action?.def.ult && p.action.stage === 'active') this.goal('ult');
    // 镜前提示
    const mz = this.mirrorZone;
    let prompt = '';
    if (mz && Math.hypot(p.pos.x - mz.center[0], p.pos.z - mz.center[1]) < mz.radius + 0.6) {
      prompt = input.touchMode ? '点击左侧“换装”照镜子' : '<kbd>G</kbd> 照镜子 · 换装';
      if (input.consume('interact', 200)) { this.goal('mirror'); this.app.openWardrobe(); }
    }
    this.hud.setPrompt(prompt);
    this.hud.setGoals(this.goals, `${p.cls.name} · 训练`);
    const dmg5 = this.dpsLog.reduce((s, x) => s + x[1], 0);
    const dps = Math.round(dmg5 / 5);
    this.hud.setTop('<b>镜廊训练室</b>', `<span class="dps">${dps}</span><small>DPS</small>`, `最高连击 <b>${p.stats.maxCombo}</b> · 总伤害 <b>${Math.round(p.stats.dmgDealt)}</b>`);
  }
}

// ---------------- 个人赛 1v1 ----------------
export class DuelMode extends BaseMode {
  start() {
    const g = this.game;
    const L = g.loadLevel(this.opts.level || 'courtyard');
    L.spawns = spawnsOf(L);
    this.L = L;
    this.player = this.spawnHero(this.opts.account, 1, L.spawns.player, true);
    this.enemy = this.spawnHero(this.opts.enemy, 2, L.spawns.enemy, false, this.opts.diff);
    this.hud.bindPlayer(this.player, this.opts.account);
    this.hud.setTeams(null, null);
    this.hud.setBoss(null);
    this.hud.setHint('');
    this.round = 1; this.wins = [0, 0];
    this.startRound();
  }
  startRound() {
    this.resetFighter(this.player, this.L.spawns.player);
    this.resetFighter(this.enemy, this.L.spawns.enemy);
    this.game.combat.clear();
    this.t = ROUND_TIME;
    this.roundOver = false;
    this.hud.announce(`第 ${this.round} 局`, 'ally', 1.4);
    this.timers.after(() => this.game.voice(this.round >= 3 ? 'round3' : 'round' + this.round), 150);
    if (this.round === 1) this.game.startCinematic([this.player, this.enemy], 2.7);
    this.countdown();
  }
  tick(dt) {
    if (this.roundOver || this.game.inputFrozen) return;
    this.t -= dt;
    if (this.t <= 0) {
      const a = this.player.hp / this.player.maxHp, b = this.enemy.hp / this.enemy.maxHp;
      this.game.voice('timeup');
      this.endRound(a >= b ? 0 : 1, '时间到');
    }
  }
  frame() {
    const pips = (n) => [0, 1].map((i) => `<i class="${i < n ? 'on' : ''}"></i>`).join('');
    this.hud.setTop(`<span class="acc ally">${this.player.name}</span><span class="pips">${pips(this.wins[0])}</span>`, fmtTime(this.t), `<span class="pips">${pips(this.wins[1])}</span><span class="acc enemy">${this.enemy.name}</span>`, `个人赛 · 三局两胜 · 第 ${this.round} 局`);
  }
  onDeath(f) { if (!this.roundOver) this.endRound(f === this.player ? 1 : 0, '击败'); }
  endRound(winner, why) {
    this.roundOver = true;
    this.wins[winner]++;
    const w = winner === 0 ? this.player : this.enemy;
    this.freeze(true);
    this.hud.bigCenter(winner === 0 ? '本局胜利' : '本局失败', `${w.name} · ${why}`, 2, winner === 0 ? 'go' : 'lose');
    audio.play(winner === 0 ? 'victory' : 'defeat');
    if (!w.dead) w.cheer = true;
    const final = this.wins[winner] >= 2;
    this.timers.after(() => this.game.voice(final ? (winner === 0 ? 'win' : 'lose') : (winner === 0 ? 'roundwin' : 'roundlose')), 500);
    if (final) {
      this.finish({ win: winner === 0, title: winner === 0 ? '个人赛胜利' : '个人赛失败', sub: `${this.wins[0]} : ${this.wins[1]}`, fighters: [this.player, this.enemy], mode: 'duel' });
    } else {
      this.timers.after(() => { if (!this.over) { this.round++; this.startRound(); } }, 2600);
    }
  }
}

// ---------------- 擂台赛 3v3 车轮战 ----------------
export class RelayMode extends BaseMode {
  start() {
    const g = this.game;
    const L = g.loadLevel('arena');
    L.spawns = spawnsOf(L);
    this.L = L;
    this.teamA = this.opts.teamA; this.teamB = this.opts.teamB;
    this.ia = 0; this.ib = 0;
    this.hpCarry = [null, null];
    this.hud.setBoss(null); this.hud.setHint('');
    this.bout = 0;
    this.nextBout(true);
  }
  nextBout(first) {
    const g = this.game;
    const sp = this.L.spawns;
    if (!this.a || this.a.dead) {
      if (this.a) g.removeFighter(this.a);
      this.a = this.spawnHero(this.teamA[this.ia], 1, sp.player, true);
      this.hud.bindPlayer(this.a, this.teamA[this.ia]);
    } else { this.resetKeepHp(this.a, sp.player); }
    if (!this.b || this.b.dead) {
      if (this.b) g.removeFighter(this.b);
      this.b = this.spawnHero(this.teamB[this.ib], 2, sp.enemy, false, this.opts.diff);
    } else { this.resetKeepHp(this.b, sp.enemy); }
    g.combat.clear();
    this.bout++;
    this.t = ROUND_TIME;
    this.boutOver = false;
    this.hud.announce(`擂台 · 第 ${this.bout} 场：${this.a.name} VS ${this.b.name}`, 'ally', 2.2);
    this.game.startCinematic([this.a, this.b], 2.7);
    this.game.voice(this.bout === 1 ? 'relay' : 'nextup');
    this.countdown();
  }
  resetKeepHp(f, spawn) { const hp = f.hp; this.resetFighter(f, spawn); f.hp = Math.min(f.maxHp, hp + f.maxHp * 0.1); }
  tick(dt) {
    if (!this.a || !this.b || this.boutOver || this.game.inputFrozen) return;
    this.t -= dt;
    if (this.t <= 0) { const loser = this.a.hp / this.a.maxHp < this.b.hp / this.b.maxHp ? this.a : this.b; loser.hp = 0; loser.die(null); }
  }
  frame() {
    if (!this.a) return;
    const left = this.teamA.map((x, i) => `<span class="rel ${i < this.ia ? 'out' : i === this.ia ? 'cur' : ''}">${x.name}</span>`).join('');
    const right = this.teamB.map((x, i) => `<span class="rel ${i < this.ib ? 'out' : i === this.ib ? 'cur' : ''}">${x.name}</span>`).join('');
    this.hud.setTop(left, fmtTime(this.t), right, `擂台赛 · 胜者留场（保留生命）`);
  }
  onDeath(f) {
    if (this.boutOver) return;
    this.boutOver = true;
    this.freeze(true);
    const aLost = f === this.a;
    if (aLost) this.ia++; else this.ib++;
    const w = aLost ? this.b : this.a;
    this.hud.bigCenter(`${w.name} 守擂成功`, aLost ? '我方下一位登场' : '对手下一位登场', 2, aLost ? 'lose' : 'go');
    audio.play(aLost ? 'defeat' : 'victory');
    if (this.ia >= this.teamA.length || this.ib >= this.teamB.length) {
      const win = this.ib >= this.teamB.length;
      this.timers.after(() => this.game.voice(win ? 'win' : 'lose'), 500);
      this.finish({ win, title: win ? '擂台赛胜利' : '擂台赛失败', sub: `剩余 ${this.teamA.length - this.ia} : ${this.teamB.length - this.ib}`, fighters: [this.a, this.b], mode: 'relay' });
    } else this.timers.after(() => { if (!this.over) this.nextBout(); }, 2800);
  }
}

// ---------------- 团队赛 3v3 ----------------
export class TeamMode extends BaseMode {
  dispose() { super.dispose(); this.game.spectate = null; }
  start() {
    const g = this.game;
    const L = g.loadLevel('arena');
    L.spawns = spawnsOf(L);
    this.L = L;
    const sa = L.spawns.teamA || [L.spawns.player, L.spawns.player, L.spawns.player];
    const sb = L.spawns.teamB || [L.spawns.enemy, L.spawns.enemy, L.spawns.enemy];
    this.allies = this.opts.teamA.map((acc, i) => this.spawnHero(acc, 1, sa[i], i === 0, this.opts.allyDiff || this.opts.diff));
    this.enemies = this.opts.teamB.map((acc, i) => this.spawnHero(acc, 2, sb[i], false, this.opts.diff));
    this.player = this.allies[0];
    this.hud.bindPlayer(this.player, this.opts.teamA[0]);
    this.hud.setTeams(this.allies, this.enemies);
    this.hud.setBoss(null); this.hud.setHint('');
    this.t = 300;
    this.hud.announce('团队赛 3 VS 3', 'ally', 2);
    this.game.startCinematic([...this.allies, ...this.enemies], 2.8);
    this.game.voice('team');
    this.countdown();
  }
  tick(dt) {
    if (!this.allies || this.over || this.game.inputFrozen) return;
    this.t -= dt;
    if (this.t <= 0) {
      const sa = this.allies.reduce((s, f) => s + Math.max(0, f.hp), 0), sb = this.enemies.reduce((s, f) => s + Math.max(0, f.hp), 0);
      this.end(sa >= sb, '时间到');
    }
  }
  frame() {
    if (!this.allies) return;
    const alive = (arr) => arr.filter((f) => f.alive).length;
    this.hud.setTop(`<span class="acc ally">兴欣 ${alive(this.allies)}</span>`, fmtTime(this.t), `<span class="acc enemy">${alive(this.enemies)} 对手</span>`, '团队赛 · 全灭对手获胜');
    // 玩家阵亡后观战：跟随存活队友
    if (this.player.dead && !this.over) {
      const mate = this.allies.find((f) => f.alive);
      if (mate && this.game.spectate !== mate) { this.hud.toast(`你已阵亡 · 观战：${mate.name}`); this.game.spectate = mate; }
    }
  }
  onDeath(f, src) {
    this.hud.announce(`${src ? src.name + ' 击败了 ' : ''}${f.name}`, f.team === 1 ? 'enemy' : 'ally', 1.6);
    if (this.enemies.every((x) => !x.alive)) this.end(true, '全灭对手');
    else if (this.allies.every((x) => !x.alive)) this.end(false, '全队阵亡');
  }
  end(win, why) {
    if (this.over) return;
    this.hud.bigCenter(win ? '团队赛胜利' : '团队赛失败', why, 2.2, win ? 'go' : 'lose');
    this.game.voice(win ? 'win' : 'lose');
    audio.play(win ? 'victory' : 'defeat');
    this.finish({ win, title: win ? '团队赛胜利' : '团队赛失败', sub: why, fighters: [...this.allies, ...this.enemies], mode: 'team' });
  }
}

// ---------------- 副本：寒铁遗庭 ----------------
export class DungeonMode extends BaseMode {
  start() {
    const g = this.game;
    const L = g.loadLevel('coldiron');
    this.L = L;
    const sp = L.spawns.player;
    this.party = [this.spawnHero(this.opts.account, 1, sp, true)];
    this.player = this.party[0];
    const mates = this.opts.party || [];
    mates.forEach((acc, i) => this.party.push(this.spawnHero(acc, 1, [sp[0] + (i ? 1.5 : -1.5), sp[1], sp[2] - 1.5, sp[3]], false, 'hard')));
    for (const m of this.party) if (m.ai) m.ai.follow = this.player;
    this.hud.bindPlayer(this.player, this.opts.account);
    this.hud.setTeams(this.party.length > 1 ? this.party : null, null);
    this.hud.setBoss(null); this.hud.setHint('');
    this.mobGroups = L.markers.mobGroups ? L.markers.mobGroups.map((g) => g.map((m) => (Array.isArray(m) ? m : [m.x ?? m[0], m.z ?? m[1]]))) : this.groupMobs(L.markers.mobs || []);
    this.wave = 0;
    this.mobs = [];
    this.stage = 'corridor';
    this.t = 0;
    this.deaths = 0;
    this.hud.announce('寒铁遗庭', 'ally', 2.5);
    this.game.voice('dungeon');
    this.countdown(() => this.spawnWave());
  }
  groupMobs(pts) {
    if (!pts.length) return [[[0, -6], [1.5, -8]], [[0, -14], [-1.5, -16], [1.5, -16]]];
    // 按离玩家出生点的距离聚类成 3 组（近的先刷）
    const sp = this.L.spawns.player;
    const d = (p) => Math.hypot(p[0] - sp[0], p[1] - sp[2]);
    const sorted = [...pts].sort((a, b) => d(a) - d(b));
    const n = Math.min(3, sorted.length);
    const groups = Array.from({ length: n }, () => []);
    sorted.forEach((p, i) => groups[Math.min(n - 1, Math.floor(i / Math.ceil(sorted.length / n)))].push(p));
    return groups;
  }
  spawnMob(type, x, z) {
    const cls = MOBS[type];
    const f = this.game.spawn({ name: cls.name, cls, clsId: type, kind: 'mob', team: 2, pos: [x, this.game.world.floorHeight(x, z), z], yaw: 0, ai: this.opts.diff === 'easy' ? 'easy' : 'normal', hp: cls.hp });
    f.mpRegen = 20;
    this.mobs.push(f);
    return f;
  }
  spawnWave() {
    const grp = this.mobGroups[this.wave];
    if (!grp) return;
    grp.forEach(([x, z]) => this.spawnMob('skeleton', x, z));
    // 每组后方加一名冰晶术士（更靠近遗庭）；组队时再多一名骸骨卫兵
    const cz = grp.reduce((s, p) => s + p[1], 0) / grp.length, cx = grp.reduce((s, p) => s + p[0], 0) / grp.length;
    this.spawnMob('frostcaster', cx, cz - 4);
    if (this.party.length > 1) this.spawnMob('skeleton', cx + 2.5, cz - 1.5);
    this.hud.toast(`第 ${this.wave + 1} 波敌人`);
    audio.play('bone_rattle');
    this.wave++;
  }
  tick(dt) {
    if (this.over || this.game.inputFrozen) return;
    this.t += dt;
    if (this.stage === 'corridor') {
      const alive = this.mobs.filter((m) => m.alive);
      if (!alive.length) {
        if (this.wave < this.mobGroups.length) this.spawnWave();
        else {
          this.stage = 'gate';
          if (this.L.openGate) this.L.openGate();
          const c = this.L.markers.bossCenter || [0, 0];
          for (const m of this.party) if (m.ai) m.ai.goal = [c[0], c[1] + 3];
          this.hud.announce('大门开启 · 前往遗庭中心', 'ally', 2.2);
          this.game.voice('gate');
          audio.play('boss_roar');
        }
      }
    } else if (this.stage === 'gate') {
      const c = this.L.markers.bossCenter || [0, -40];
      if (Math.hypot(this.player.pos.x - c[0], this.player.pos.z - c[1]) < 14) this.spawnBoss();
    } else if (this.stage === 'boss') {
      const b = this.boss;
      if (b.alive && b.phase === 1 && b.hp < b.maxHp * 0.5) this.enterPhase2();
      // 拴在圆场内
      const c = this.L.markers.bossCenter || [0, 0], R = (this.L.markers.arenaRadius || 9) + 0.5;
      const dx = b.pos.x - c[0], dz = b.pos.z - c[1], d = Math.hypot(dx, dz);
      if (d > R) { b.pos.x = c[0] + dx / d * R; b.pos.z = c[1] + dz / d * R; }
      if (b.breakImmune > 0) b.breakImmune -= dt * 1000;
      if (b.broken > 0) { b.broken -= dt * 1000; if (b.broken <= 0) { b.defMul = 1; } }
    }
    // 清理尸体
    for (const m of this.mobs) if (m.dead && !m.removeAt) m.removeAt = this.t + 4;
    for (const m of [...this.mobs]) if (m.removeAt && this.t > m.removeAt) { this.game.removeFighter(m); this.mobs.splice(this.mobs.indexOf(m), 1); }
  }
  spawnBoss() {
    this.stage = 'boss';
    for (const m of this.party) if (m.ai) m.ai.goal = null;
    const c = this.L.markers.bossCenter || [0, -40];
    const f = this.game.spawn({ name: BOSS.name, cls: BOSS, clsId: 'boss', kind: 'boss', team: 2, pos: [c[0], 0, c[1] - 4], yaw: 0, ai: this.opts.diff === 'easy' ? 'normal' : this.opts.diff === 'god' ? 'god' : 'hard', hp: BOSS.hp * (this.party.length > 1 ? 1.8 : 1) * ({ easy: 0.75, normal: 0.85, hard: 1, god: 1.15 }[this.opts.diff] || 1), scale: 1.5 });
    f.phase = 1; f.breakMeter = 0; f.breakImmune = 0; f.broken = 0; f.mpRegen = 50;
    f.ai.d = { ...f.ai.d, guardP: 0, dodgeP: 0, techP: 1, react: 400 };
    f.ai.prefRange = 2.6;
    f.yaw = Math.atan2(this.player.pos.x - f.pos.x, this.player.pos.z - f.pos.z);
    this.boss = f;
    this.hud.setBoss(f, '第一阶段');
    this.hud.announce('寒铁守卫', 'enemy', 2.5);
    audio.play('boss_roar');
    this.game.voice('boss');
    // 关门锁场：落在门外的队友拉进来
    const gz = this.L.markers.gate ? this.L.markers.gate.pos[2] : 11.5;
    for (const m of this.party) if (m !== this.player && m.alive && m.pos.z > gz - 1) { m.pos.set(m.pos.x * 0.5, 0, gz - 2); }
    this.timers.after(() => { if (!this.over && this.L.closeGate) this.L.closeGate(); }, 1500);
    this.game.shake(f.pos, 0.8);
  }
  enterPhase2() {
    const b = this.boss;
    b.phase = 2;
    b.armor = 1500;
    this.hud.setBoss(b, '第二阶段 · 寒铁苏醒');
    this.hud.announce('寒铁守卫进入第二阶段', 'enemy', 2.2);
    this.game.voice('phase2');
    audio.play('boss_roar');
    this.game.vfx.ring(b.pos, 8, '#8fe0ff', 0.8);
    this.game.shake(b.pos, 1);
    const c = this.L.markers.bossCenter || [0, -40];
    this.spawnMob('frostcaster', c[0] - 7, c[1] + 2);
    this.spawnMob('frostcaster', c[0] + 7, c[1] + 2);
  }
  onHit(att, t, res, hit) {
    const b = this.boss;
    if (t !== b || res === 'miss' || !b || !b.alive) return;
    // 胸甲锁扣：正面命中累积破甲值
    const toAtt = Math.atan2(att.pos.x - b.pos.x, att.pos.z - b.pos.z);
    const front = Math.abs(((toAtt - b.yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI) < 0.9;
    if (front && b.breakImmune <= 0 && b.broken <= 0) {
      b.breakMeter += hit.dmg || 0;
      if (b.breakMeter >= 700) {
        b.breakMeter = 0; b.broken = 3500; b.breakImmune = 14000; b.defMul = 1.35;
        b.interrupt(2600, 'break');
        this.hud.announce('胸甲锁扣破碎！守卫失衡', 'ally', 2);
        this.game.voice('breakarmor');
        this.game.vfx.explosion(b.center(new THREE.Vector3()).setY(b.pos.y + 1.6), 1.2, '#8fe0ff');
        audio.play('guard_break');
      }
    }
    this.hud.setBoss(b, `${b.phase === 1 ? '第一阶段' : '第二阶段'} · 破甲 ${Math.min(100, Math.round(b.breakMeter / 7))}%${b.broken > 0 ? ' · 失衡中' : ''}`);
  }
  partyWiped() { return this.party.every((m) => !m.alive); }
  failRun() {
    if (this.over) return;
    this.hud.bigCenter('挑战失败', '', 2.5, 'lose');
    this.game.voice('lose');
    audio.play('defeat');
    this.finish({ win: false, title: '寒铁遗庭 · 失败', sub: this.boss ? `守卫剩余生命 ${Math.round(this.boss.hp / this.boss.maxHp * 100)}%` : '倒在了通道中', fighters: this.party, mode: 'dungeon' });
  }
  onDeath(f) {
    if (this.party.includes(f) && f !== this.player && this.partyWiped()) { this.failRun(); return; }
    if (f === this.boss) {
      this.hud.bigCenter('副本通关', `用时 ${fmtTime(this.t)}`, 3, 'go');
      this.game.voice('clear');
      audio.play('victory');
      const best = store.get('dungeonBest', null);
      if (!best || this.t < best) store.set('dungeonBest', this.t);
      const mats = store.get('materials', 0) + 3; store.set('materials', mats);
      this.finish({ win: true, title: '寒铁遗庭 · 通关', sub: `用时 ${fmtTime(this.t)}${best ? ` · 最佳 ${fmtTime(Math.min(best, this.t))}` : ''} · 获得寒铁碎片 ×3`, fighters: this.party, mode: 'dungeon' });
    } else if (f === this.player) {
      this.deaths++;
      if (this.party.some((m) => m.alive && m !== this.player)) {
        this.hud.bigCenter('重伤倒地', '5 秒后在队友身边复活', 2.5, 'lose');
        this.timers.after(() => {
          if (this.over) return;
          const mate = this.party.find((m) => m.alive && m !== this.player);
          if (!mate) { this.failRun(); return; }
          this.resetFighter(this.player, [mate.pos.x + 1, mate.pos.y, mate.pos.z, mate.yaw]); this.player.hp = this.player.maxHp * 0.5;
        }, 5000);
      } else this.failRun();
    }
  }
}

// 主菜单背景：两名 AI 在断桥庭院对战，镜头环绕
export class AttractMode extends BaseMode {
  start() {
    const g = this.game;
    this.L = g.loadLevel('courtyard');
    this.L.spawns = spawnsOf(this.L);
    this.spawnPair();
    g.startCinematic(this.fs, 1e9);
    g.cinematic.orbit = true;
    g.camera.layers.enable(1);
  }
  spawnPair() {
    const g = this.game;
    for (const f of this.fs || []) g.removeFighter(f);
    const pool = [...ACCOUNTS].sort(() => Math.random() - 0.5);
    const a = this.spawnHero(pool[0], 1, [0, 0, 4, Math.PI], false, 'god');
    const b = this.spawnHero(pool[1], 2, [0, 0, -4, 0], false, 'god');
    this.fs = [a, b];
    if (g.cinematic) g.cinematic.targets = this.fs;
    this.deadT = 0;
  }
  tick(dt) {
    if (this.fs.some((f) => f.dead)) { this.deadT += dt; if (this.deadT > 3) this.spawnPair(); }
    for (const f of this.fs) if (f.hp < f.maxHp * 0.25 && !f.dead) f.hp += f.maxHp * 0.002; // 拉长表演
  }
  onDeath() {}
  dispose() { super.dispose(); this.game.cinematic = null; this.game.camera.layers.disable(1); }
}

export const MODES = { training: TrainingMode, duel: DuelMode, relay: RelayMode, team: TeamMode, dungeon: DungeonMode };
