// 入口：把渲染/模拟（Game）、HUD、菜单与模式串起来
import { Game } from './game/game.js';
import { HUD } from './ui/hud.js';
import { Menu } from './ui/menu.js';
import { TouchControls } from './ui/touch.js';
import { MODES, AttractMode } from './game/modes.js';
import { NetHostDuel, NetGuestDuel } from './game/netmodes.js';
import { net } from './engine/net.js';
import { ACCOUNTS } from './data/classes.js';

MODES.nethost = NetHostDuel;
MODES.attract = AttractMode;
MODES.netguest = NetGuestDuel;
import { input, keyLabel } from './engine/input.js';
import { audio } from './engine/audio.js';
import { store } from './engine/util.js';

class App {
  constructor() {
    this.canvas = document.getElementById('game');
    this.hud = new HUD(document.getElementById('hud'));
    this.hud.show(false);
    this.game = new Game(this.canvas, this.hud);
    this.menu = new Menu(document.getElementById('menu'), this);
    input.attach(this.canvas);
    input.onLockChange = (locked) => {
      if (!locked && !input.touchMode && this.mode && this.modeId !== 'attract' && !this.game.paused && !this.inWardrobe && !this.mode.over && !input.fallbackLook) this.pause();
    };
    input.onLockNeeded = () => this.showClickPlay();
    input.onLockFail = () => { if (!this._lockWarned) { this._lockWarned = true; this.hud.toast('无法锁定鼠标：按住右键拖动或用方向键转视角'); } };
    input.onEscape = () => {
      if (this.inWardrobe || this.modeId === 'attract') return;
      if (this.mode && !this.mode.over) { if (this.game.paused) this.resume(); else this.pause(); }
    };
    input.onKey = (code, down) => {
      if (code === input.binds.stats && !down) this.hud.showStats(false, this.game);
      if (!this.mode || this.game.paused || this.modeId === 'attract') return;
      if (code === input.binds.stats) this.hud.showStats(down, this.game);
      if (down && code === input.binds.view) this.game.toggleView();
    };
    this.touch = new TouchControls(this);
    this.game.start();
    this.game.preload();
    this.menu.title();
    window.__glory = this; // 调试/自动测试
  }

  startMode(id, opts) {
    this.endMode();
    const generation = this._modeGeneration;
    const current = () => generation === this._modeGeneration;
    this._loadingMode = true;
    const load = this.menu.loading(id);
    audio.music(false);
    this.modeId = id; this.modeOpts = opts;
    // 让加载界面先渲染一帧，并等贴图就绪
    const go = () => { this._startTimer = setTimeout(() => {
      this._startTimer = null;
      if (!current()) return;
      try {
        const M = MODES[id];
        this.mode = new M(this, opts);
        this.game.mode = this.mode;
        this.game.paused = false;
        const vm = store.get('viewMode', this.game.settings.defaultView || 'fp');
        this.game._viewMode = vm; this.game.firstPerson = vm === 'fp';
        this.mode.start();
        this.game.applyView();
        this.hud.show(true);
        const bar = load.querySelector('.load-bar i'); if (bar) bar.style.width = '100%';
        this._hideLoadTimer = setTimeout(() => {
          this._hideLoadTimer = null;
          if (!current()) return;
          this._loadingMode = false;
          this.menu.hide(); input.enabled = true; input.lock(false); this.firstTimeHelp();
        }, 350);
      } catch (e) {
        console.error(e);
        this.endMode();
        this.menu.main();
        alert('加载失败：' + e.message);
      }
    }, 60); };
    const bar = load.querySelector('.load-bar i');
    this._loadTick = setInterval(() => { const g = this.game; if (bar && g.loadTotal) bar.style.width = Math.min(95, 10 + 85 * (g.loadDone || 0) / g.loadTotal) + '%'; }, 100);
    this.game.preload().then(() => {
      if (!current()) return;
      clearInterval(this._loadTick); this._loadTick = null;
      go();
    });
  }

  firstTimeHelp() {
    const helpKey = input.touchMode ? 'seenTouchHelp' : 'seenHelp';
    if (store.get(helpKey, false) || this.modeId === 'attract' || new URLSearchParams(location.search).get('auto')) return;
    store.set(helpKey, true);
    const b = input.binds; const k = (x) => keyLabel(b[x]);
    const el = document.createElement('div');
    el.className = 'quick-help';
    el.innerHTML = input.touchMode ? `<h3>触屏操作</h3>
      <p>左下摇杆移动 · 在画面空白处拖动视角</p>
      <p>右下点按技能，普攻长按蓄力 / 连射，格挡或瞄准长按保持。</p>
      <p>跳跃可受身，闪避躲攻击；顶部可暂停、切视角和查看数据。</p>
      <small>横屏操作更舒适 · 轻触此提示关闭</small>` : `<h3>操作速览</h3>
      <p><kbd>${k('forward')}${k('left')}${k('back')}${k('right')}</kbd> 移动　鼠标 视角　<kbd>${k('attack')}</kbd> 普攻（连按三段）　<kbd>${k('special')}</kbd> 格挡/瞄准</p>
      <p><kbd>${k('s1')}</kbd><kbd>${k('s2')}</kbd><kbd>${k('s3')}</kbd><kbd>${k('s4')}</kbd><kbd>${k('s5')}</kbd><kbd>${k('s6')}</kbd> 技能　<kbd>${k('ult')}</kbd> 大招　<kbd>${k('dash')}</kbd> 闪避　<kbd>${k('jump')}</kbd> 跳跃 / 被击飞时受身</p>
      <p><kbd>${k('lockon')}</kbd> 锁定目标　<kbd>${k('view')}</kbd> 切换视角　<kbd>Tab</kbd> 数据　<kbd>Esc</kbd> 暂停</p>
      <small>挑空 → 空中追击 → 击倒，是荣耀连段的基本套路。按任意键关闭</small>`;
    document.body.appendChild(el);
    let expireTimer, keyTimer, fadeTimer;
    const close = (immediate = false) => {
      clearTimeout(expireTimer); clearTimeout(keyTimer); clearTimeout(fadeTimer);
      window.removeEventListener('keydown', close);
      const remove = () => { el.remove(); if (this._closeHelp === close) this._closeHelp = null; };
      if (immediate === true) remove();
      else { el.classList.add('out'); fadeTimer = setTimeout(remove, 400); }
    };
    this._closeHelp = close;
    if (input.touchMode) el.addEventListener('pointerdown', (e) => { e.stopPropagation(); close(); });
    expireTimer = setTimeout(close, 9000);
    keyTimer = setTimeout(() => window.addEventListener('keydown', close), 800);
  }

  endMode() {
    this._modeGeneration = (this._modeGeneration || 0) + 1;
    clearInterval(this._loadTick); clearTimeout(this._startTimer); clearTimeout(this._hideLoadTimer);
    this._loadTick = this._startTimer = this._hideLoadTimer = null;
    this._loadingMode = false;
    this._closeHelp?.(true);
    input.enabled = false;
    document.body.classList.remove('attract');
    this.hideClickPlay();
    if (this.mode) { this.mode.over = true; this.mode.dispose(); }
    this.mode = null;
    this.game.mode = null;
    this.game.isAttract = false;
    this.game.clearFighters();
    this.game.unloadLevel();
    this.game.lockTarget = null;
    this.game.inputFrozen = false; this.game.aiFrozen = false;
    this.hud.show(false);
    this.hud.resetBattle();
  }

  // 需要用户点击才能锁定鼠标时显示的遮罩
  showClickPlay(onGo) {
    if (input.touchMode || input.locked || input.fallbackLook || !this.mode || this.modeId === 'attract' || new URLSearchParams(location.search).get('auto')) { if (onGo) onGo(); return; }
    let el = document.getElementById('clickplay');
    if (!el) {
      el = document.createElement('div'); el.id = 'clickplay';
      el.innerHTML = '<div><b>点击画面继续</b><small>锁定鼠标以控制视角 · Esc 暂停</small></div>';
      document.body.appendChild(el);
    }
    el.style.display = 'flex';
    el.onclick = () => { el.style.display = 'none'; input.lock(true); if (onGo) onGo(); };
  }
  hideClickPlay() { const el = document.getElementById('clickplay'); if (el) el.style.display = 'none'; }

  pause() {
    if (!this.mode) return;
    this.hideClickPlay();
    this.hud.showStats(false, this.game);
    if (this.modeId === 'netguest') net.relay({ k: 'in', mx: 0, my: 0, yaw: this.game.viewYaw, pitch: this.game.viewPitch, guard: 0, atk: 0, p: [] });
    this.game.paused = true;
    input.enabled = false;
    input.unlock();
    this.menu.pause(this.game, this.modeId);
  }
  resume() {
    this.menu.hide();
    input.enabled = true;
    const go = () => { this.game.paused = false; this.game.last = performance.now(); };
    // 通过按钮点击继续：这是用户手势，可以直接锁定；通过 Esc 继续则需要再点一次画面
    if (input.touchMode || input.locked || input.fallbackLook) { go(); return; }
    this.game.paused = true;
    this.showClickPlay(go);
  }
  // ---- 联机 ----
  async openNet() {
    try { await net.connect(); }
    catch (e) { this.menu.netUnavailable(); return; }
    this.menu.netLobby(net);
  }
  armGuest() {
    if (this._guestOff) return;
    this._guestOff = net.on('relay', (d) => {
      if (d.k !== 'go') return;
      const byId = (id) => ACCOUNTS.find((a) => a.id === id) || ACCOUNTS[0];
      this.startMode('netguest', { net, level: d.level, hostAcc: byId(d.host.acc), hostId: d.host.id, guestAcc: byId(d.guest.acc), guestId: d.guest.id });
    });
  }
  leaveNet() {
    if (this._guestOff) { this._guestOff(); this._guestOff = null; }
    net.leave();
  }

  quit() {
    if (this.modeId === 'nethost' || this.modeId === 'netguest') this.leaveNet();
    this.endMode();
    input.enabled = false;
    input.unlock();
    audio.music(true);
    this.menu.main();
    this.startAttract();
  }

  // 主菜单背景的实时 AI 对战
  startAttract() {
    if (input.touchMode || this.game.settings.attract === false || this.mode || this._loadingMode) return;
    const generation = this._modeGeneration || 0;
    this.game.preload().then(() => {
      if (input.touchMode || this.mode || this._loadingMode || generation !== (this._modeGeneration || 0)) return;
      try {
        this.mode = new MODES.attract(this, {});
        this.modeId = 'attract';
        this.game.mode = this.mode;
        this.game.isAttract = true;
        this.game.paused = false;
        this.mode.start();
        this.hud.show(false);
        document.body.classList.add('attract');
      } catch (e) { console.warn(e); this.mode = null; }
    });
  }

  openWardrobe() {
    const p = this.game.player; if (!p || this.inWardrobe) return;
    this.inWardrobe = true;
    input.enabled = false;
    input.unlock();
    this.game.inputFrozen = true;
    this.game.aiFrozen = true;
    p.moveInput.set(0, 0);
    audio.play('ui_confirm');
    this.menu.wardrobe(p, (look) => this.game.rebuildPlayerLook(JSON.parse(JSON.stringify(look))), (ok, look) => {
      if (ok) { store.set('look.' + p.clsId, look); this.hud.toast('外观已保存'); }
      this.inWardrobe = false;
      this.game.inputFrozen = false;
      this.game.aiFrozen = false;
      this.menu.hide();
      input.enabled = true;
      input.lock(true);
    });
  }

  showResults(res) {
    input.enabled = false;
    input.unlock();
    this.game.paused = true;
    this.hud.show(false);
    if (this.modeId === 'netguest') { this.menu.results(res, () => this.menu.netWaiting('等待主机开始下一局…'), () => this.quit()); return; }
    this.menu.results(res, () => this.startMode(this.modeId, this.modeOpts), () => this.quit());
  }
}

const app = new App();

// ---- 自动测试 / 演示：?auto=duel&acc=jmx&enemy=yysf&diff=hard&bot=1&dump=1 ----
const q = new URLSearchParams(location.search);
if (q.get('auto')) {
  const { ACCOUNTS } = await import('./data/classes.js');
  const { Brain } = await import('./game/ai.js');
  const byId = (id) => ACCOUNTS.find((a) => a.id === id) || ACCOUNTS[0];
  const mode = q.get('auto');
  const opts = { account: byId(q.get('acc') || 'jmx'), enemy: byId(q.get('enemy') || 'yysf'), diff: q.get('diff') || 'normal',
    teamA: (q.get('ta') || 'jmx,myc,yyzq').split(',').map(byId), teamB: (q.get('tb') || 'yysf,dmgy,yqcy').split(',').map(byId) };
  if (mode === 'dungeon' && q.get('party') !== '0') opts.party = [byId('myc'), byId('yyzq')];
  if (q.get('fp') === '0') { const { store } = await import('./engine/util.js'); store.set('viewMode', q.get('view') || 'ots'); }
  else if (q.get('view')) { const { store } = await import('./engine/util.js'); store.set('viewMode', q.get('view')); }
  else { const { store } = await import('./engine/util.js'); store.set('viewMode', 'fp'); }
  if (q.get('speed')) { app.game.timeScale = app.game._baseScale = parseFloat(q.get('speed')); app.game.maxSteps = 40; }
  if (q.get('rskip')) app.game.renderSkip = parseInt(q.get('rskip'));
  if (q.get('manual')) app.game.manual = true;
  app.startMode(mode, opts);
  if (q.get('bot')) {
    const waitP = setInterval(() => {
      const g = app.game; const p = g.player;
      if (!p) return;
      clearInterval(waitP);
      p.ai = new Brain(p, q.get('botdiff') || 'hard');
      g.autoPlayer = true;
    }, 50);
  }
  if (q.get('look')) setTimeout(() => { const g = app.game; g.viewPitch = parseFloat(q.get('look')) * Math.PI / 180; }, 800);
  if (q.get('dump')) {
    const pre = document.createElement('pre'); pre.id = 'status'; pre.style.cssText = 'position:fixed;left:0;bottom:0;z-index:99;color:#0f0;font:10px monospace;background:rgba(0,0,0,.6);max-width:60vw;white-space:pre-wrap;display:' + (q.get('dump') === '2' ? 'block' : 'none');
    document.body.appendChild(pre);
    const errs = window.__errs || [];
    setInterval(() => {
      const g = app.game;
      const fs = g.fighters.map((f) => `${f.name}[${f.clsId}] t${f.team} hp${Math.round(f.hp)}/${f.maxHp} mp${Math.round(f.mp)} ${f.state}${f.action ? ':' + (f.action.def.name || f.action.slot) + '/' + f.action.stage : ''} pos(${f.pos.x.toFixed(1)},${f.pos.y.toFixed(1)},${f.pos.z.toFixed(1)}) dmg${f.stats.dmgDealt} hits${f.stats.hits} sk${f.stats.skills} combo${f.stats.maxCombo}`);
      pre.textContent = `time ${g.time.toFixed(1)} fps ${g.fps.toFixed(0)} mode ${app.modeId} over ${app.mode && app.mode.over}\n` + fs.join('\n') + (errs.length ? '\nERR ' + errs.join(' | ') : '') + '\nMENU ' + (document.getElementById('menu').innerText || '').slice(0, 200).replace(/\n/g, ' ');
    }, 250);
  }
}
