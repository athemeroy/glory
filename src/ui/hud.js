// 战斗 HUD（DOM 叠层）
import * as THREE from 'three';
import { input, keyLabel } from '../engine/input.js';
import { SLOT_ORDER } from '../data/classes.js';
import { fmtTime, clamp } from '../engine/util.js';

const $ = (sel, root = document) => root.querySelector(sel);
function el(tag, cls, parent, html) { const e = document.createElement(tag); if (cls) e.className = cls; if (html !== undefined) e.innerHTML = html; if (parent) parent.appendChild(e); return e; }

const FORM_NAMES = { sword: '剑', spear: '矛', gun: '枪', shield: '盾' };
const FORM_ICONS = { sword: 'sword', spear: 'spear', gun: 'target', shield: 'guard' };

export class HUD {
  constructor(root) {
    this.root = root;
    root.innerHTML = '';
    this.v = new THREE.Vector3();
    // 准星
    this.cross = el('div', 'crosshair', root, '<i></i><i></i><i></i><i></i><b></b>');
    this.hitmark = el('div', 'hitmarker', root, '<i></i><i></i><i></i><i></i>');
    // 顶部：计时与比分
    this.top = el('div', 'hud-top', root);
    this.topL = el('div', 'hud-top-side left', this.top);
    this.timer = el('div', 'hud-timer', this.top);
    this.topR = el('div', 'hud-top-side right', this.top);
    this.sub = el('div', 'hud-sub', root);
    // 目标 / Boss
    this.targetBox = el('div', 'target-frame', root, '<div class="tf-name"></div><div class="bar hp"><i></i><span></span></div><div class="tf-state"></div>');
    this.bossBox = el('div', 'boss-frame', root, '<div class="bf-name"></div><div class="bar boss"><i></i><em></em><span></span></div><div class="bf-phase"></div>');
    // 队伍
    this.teamBox = el('div', 'team-frame', root);
    // 左下：自己
    this.selfBox = el('div', 'self-frame', root, `
      <div class="sf-head"><img class="sf-portrait" alt=""><div><div class="sf-name"></div><div class="sf-cls"></div></div></div>
      <div class="bar hp big"><i></i><em></em><span></span></div>
      <div class="bar mp"><i></i><span></span></div>
      <div class="sf-effects"></div>`);
    // 技能栏
    this.skillBar = el('div', 'skill-bar', root);
    this.formBar = el('div', 'form-bar', root);
    // 右侧：连击与 APM
    this.comboBox = el('div', 'combo-box', root, '<div class="combo-n"></div><div class="combo-l">连击</div><div class="combo-d"></div>');
    this.apmBox = el('div', 'apm-box', root, '<span class="apm-n">0</span><span class="apm-l">APM</span><span class="fps"></span>');
    // 伤害数字与飘字
    this.floatLayer = el('div', 'float-layer', root);
    this.pool = [];
    // 公告与提示
    this.announceBox = el('div', 'announce', root);
    this.toastBox = el('div', 'toast', root);
    this.prompt = el('div', 'prompt', root);
    this.hurtBox = el('div', 'hurt', root);
    this.blindBox = el('div', 'blind', root);
    this.dirBox = el('div', 'hurt-dir', root);
    this.center = el('div', 'center-msg', root);
    this.stats = el('div', 'stats-panel', root);
    this.lockMark = el('div', 'lock-mark', root);
    this.hint = el('div', 'hud-hint', root);
    this.plateLayer = el('div', 'plate-layer', root);
    this.plates = new Map();
    this.goalBox = el('div', 'goal-box', root);
    this.slots = {};
    this.comboT = 0;
    this.hurtT = 0;
    this.toastT = 0;
    this.announceT = 0;
    this.mode = null;
    this.visible = false;
  }

  show(on) { this.visible = on; this.root.style.display = on ? '' : 'none'; }

  // 根据玩家职业重建技能栏
  bindPlayer(p, account) {
    this.player = p;
    $('.sf-name', this.selfBox).textContent = p.name;
    $('.sf-cls', this.selfBox).textContent = `${p.cls.name}${account ? ' · ' + account.weaponName : ''}`;
    const img = $('.sf-portrait', this.selfBox);
    img.src = `assets/portraits/${p.cls.portrait || p.clsId}.jpg`;
    this.skillBar.innerHTML = '';
    this.slots = {};
    const mk = (slot, name, icon, keyName, extra = '') => {
      const s = el('button', 'slot ' + extra, this.skillBar, `<img src="assets/icons/${icon}.svg" alt=""><div class="cd"></div><div class="cdn"></div><div class="key">${keyName}</div><div class="nm">${name}</div>`);
      s.type = 'button'; s.dataset.action = slot === 'atk' ? 'attack' : slot;
      s.setAttribute('aria-label', name);
      this.slots[slot] = s;
      return s;
    };
    const chain = p.chain;
    mk('atk', '普攻', p.cls.forms ? FORM_ICONS[p.form] : (chain?.[0]?.proj ? 'target' : p.cls.weapon === 'gauntlet' ? 'fist' : p.cls.weapon === 'spear' ? 'spear' : 'sword'), keyLabel(input.binds.attack), 'basic');
    mk('special', p.cls.special?.name || '特技', p.cls.special?.type === 'aim' ? 'crosshair' : 'guard', keyLabel(input.binds.special), 'basic');
    const accent = p.cls.look?.accent || '#4d9d9a';
    const usedGlyph = new Set();
    this.skillBar.style.setProperty('--accent', accent);
    for (const slot of SLOT_ORDER) {
      const d = p.cls.skills?.[slot];
      if (!d) continue;
      const s = mk(slot, d.name, d.icon || 'sword', keyLabel(input.binds[slot]), slot === 'ult' ? 'ult glyphed' : 'glyphed');
      const chars = [...d.name.replace(/[·「」]/g, '')];
      let glyph = d.glyph || chars.find((c) => !usedGlyph.has(c)) || chars[0];
      usedGlyph.add(glyph);
      el('span', 'glyph', s, glyph);
      s.title = `${d.name}（${(d.cd / 1000).toFixed(1)}s，${d.mp || 0} 法力）\n${d.desc || ''}`;
      if (d.form) el('div', 'form-tag', s, FORM_NAMES[d.form]);
    }
    this.formBar.innerHTML = '';
    this.formBar.style.display = p.cls.forms ? '' : 'none';
    if (p.cls.forms) {
      ['sword', 'spear', 'gun', 'shield'].forEach((f, i) => {
        const btn = el('button', 'form ' + f, this.formBar, `<img src="assets/icons/${FORM_ICONS[f]}.svg" alt=""><span>${FORM_NAMES[f]}</span><kbd>${keyLabel(input.binds['form' + (i + 1)])}</kbd>`);
        btn.type = 'button'; btn.dataset.action = 'form' + (i + 1);
        btn.setAttribute('aria-label', '千机伞·' + FORM_NAMES[f]);
      });
      this.setForm(p.form);
    }
  }
  setForm(f) {
    for (const e of this.formBar.children) e.classList.toggle('on', e.classList.contains(f));
    const s = this.slots.atk; if (s && FORM_ICONS[f]) $('img', s).src = `assets/icons/${FORM_ICONS[f]}.svg`;
  }
  skillFlash(slot) { const s = this.slots[slot]; if (!s) return; s.classList.remove('flash'); void s.offsetWidth; s.classList.add('flash'); }

  setTeams(allies, enemies) { this.allies = allies; this.enemies = enemies; this.teamBox.innerHTML = ''; this.teamRows = []; }
  setTop(left, mid, right, sub = '') { this.topL.innerHTML = left; this.timer.innerHTML = mid; this.topR.innerHTML = right; this.sub.innerHTML = sub; }
  setBoss(f, phaseText = '') { this.boss = f; this.bossBox.style.display = f ? 'block' : 'none'; if (f) { $('.bf-name', this.bossBox).textContent = f.name; $('.bf-phase', this.bossBox).textContent = phaseText; } }
  setPrompt(t) { if (this._prompt !== t) { this._prompt = t; this.prompt.innerHTML = t || ''; this.prompt.style.display = t ? 'block' : 'none'; } }
  setHint(t) { this.hint.innerHTML = t || ''; this.hint.style.display = t ? '' : 'none'; }

  announce(text, cls = '', dur = 1.8) {
    this.announceBox.innerHTML = `<div class="a ${cls}">${text}</div>`;
    this.announceBox.classList.remove('show'); void this.announceBox.offsetWidth; this.announceBox.classList.add('show');
    this.announceT = dur;
  }
  bigCenter(text, sub = '', dur = 1.2, cls = '') {
    this.center.innerHTML = `<div class="big ${cls}">${text}</div>${sub ? `<div class="small">${sub}</div>` : ''}`;
    this.center.classList.remove('show'); void this.center.offsetWidth; this.center.classList.add('show');
    this.centerT = dur;
  }
  toast(t) { this.toastBox.textContent = t; this.toastBox.classList.add('show'); this.toastT = 1.2; }

  hitmarker(heavy) { this.hitmark.classList.remove('on', 'heavy'); void this.hitmark.offsetWidth; this.hitmark.classList.add('on'); if (heavy) this.hitmark.classList.add('heavy'); }
  hurt(from, frac) {
    this.hurtT = Math.min(1, 0.35 + frac * 6);
    if (from && this.player) {
      this.dirFrom = from.clone ? from.clone() : from;
      this.dirT = 1.0;
    }
  }
  combo(n, dmg) {
    if (n < 2) { this.comboDmg = dmg; return; }
    this.comboDmg = (this.comboDmg || 0) + dmg;
    $('.combo-n', this.comboBox).textContent = n;
    $('.combo-d', this.comboBox).textContent = `${Math.round(this.comboDmg)} 伤害`;
    this.comboBox.classList.add('show');
    this.comboBox.classList.remove('pop'); void this.comboBox.offsetWidth; this.comboBox.classList.add('pop');
    this.comboT = 1.6;
  }
  comboEnd(n) { /* 保留：连击结算 */ }

  project(pos) {
    const cam = this.game.camera;
    this.v.copy(pos).project(cam);
    if (this.v.z > 1) return null;
    return [(this.v.x * 0.5 + 0.5) * window.innerWidth, (-this.v.y * 0.5 + 0.5) * window.innerHeight];
  }

  damageNumber(pos, dmg, cls) {
    this.floatText(pos, String(dmg), 'dmg ' + cls);
  }
  floatText(pos, text, cls) {
    if (!this.game) return;
    let e = this.pool.pop();
    if (!e) e = el('div', '', this.floatLayer);
    e.className = 'ft ' + cls;
    e.textContent = text;
    e.style.display = '';
    const it = { e, pos: pos.clone(), t: 0, dur: cls.includes('dmg') ? 0.9 : 1.1, dx: (Math.random() - 0.5) * 40 };
    (this.floats || (this.floats = [])).push(it);
  }

  setGoals(list) {
    if (!list) { this.goalBox.style.display = 'none'; return; }
    this.goalBox.style.display = 'block';
    const html = '<div class="gb-title">训练目标</div>' + list.map((g) => `<div class="g ${g.done ? 'done' : ''}"><i></i>${g.text}</div>`).join('');
    if (html !== this._goalHtml) { this._goalHtml = html; this.goalBox.innerHTML = html; }
  }

  updatePlates(game) {
    const p = game.player;
    const seen = new Set();
    for (const f of game.fighters) {
      if (f === p || f.kind === 'dummy' && !f.comboTaken) continue;
      const d = p ? f.pos.distanceTo(p.pos) : 0;
      if (d > 45 || (f.dead && f.kind !== 'hero')) continue;
      const sp = this.project(this.v.set(f.pos.x, f.pos.y + (f.state === 'down' ? 0.8 : 2.05 * f.scale), f.pos.z));
      if (!sp) continue;
      seen.add(f);
      let e = this.plates.get(f);
      if (!e) {
        e = el('div', 'plate', this.plateLayer, '<span class="pn"></span><div class="pb"><i></i></div>');
        this.plates.set(f, e);
      }
      const ally = p && f.team === p.team;
      e.className = 'plate ' + (ally ? 'ally' : 'enemy') + (f.kind === 'boss' ? ' boss' : '') + (f.dead ? ' dead' : '');
      const nm = f.kind === 'hero' ? `${f.name}<small>${f.cls.name}</small>` : f.name;
      if (e._nm !== nm) { e._nm = nm; e.firstChild.innerHTML = nm; }
      e.lastChild.firstChild.style.width = (Math.max(0, f.hp / f.maxHp) * 100) + '%';
      const sc = Math.max(0.55, Math.min(1, 12 / Math.max(1, d)));
      e.style.transform = `translate(${sp[0]}px, ${sp[1]}px) translate(-50%, -100%) scale(${sc})`;
      e.style.opacity = d > 35 ? (45 - d) / 10 : 1;
    }
    for (const [f, e] of this.plates) if (!seen.has(f)) { if (!game.fighters.includes(f)) { e.remove(); this.plates.delete(f); } else e.style.opacity = 0; }
  }

  showStats(on, game) {
    this.stats.style.display = on ? 'block' : 'none';
    if (!on) return;
    const rows = game.fighters.filter((f) => f.kind === 'hero').map((f) => `<tr class="${f.team === game.player?.team ? 'ally' : 'enemy'}"><td>${f.name}</td><td>${f.cls.name}</td><td>${f.stats.dmgDealt}</td><td>${f.stats.dmgTaken}</td><td>${f.stats.maxCombo}</td><td>${f.stats.skills}</td><td>${f.stats.kills}</td></tr>`).join('');
    this.stats.innerHTML = `<table><thead><tr><th>账号</th><th>职业</th><th>输出</th><th>承伤</th><th>最高连击</th><th>技能</th><th>击杀</th></tr></thead><tbody>${rows}</tbody></table><div class="apm-big">APM ${input.apm()}</div>`;
  }

  update(dt, game) {
    this.game = game;
    if (!this.visible) return;
    const p = this.player;
    if (p) {
      // 自己
      const hpBar = $('.hp', this.selfBox), mpBar = $('.mp', this.selfBox);
      const hpR = clamp(p.hp / p.maxHp, 0, 1);
      $('i', hpBar).style.width = (hpR * 100) + '%';
      this._hpLag = this._hpLag === undefined ? hpR : Math.max(hpR, this._hpLag - dt * 0.35);
      $('em', hpBar).style.width = (this._hpLag * 100) + '%';
      $('span', hpBar).textContent = `${Math.ceil(p.hp)} / ${p.maxHp}`;
      $('i', mpBar).style.width = (clamp(p.mp / p.maxMp, 0, 1) * 100) + '%';
      $('span', mpBar).textContent = `${Math.floor(p.mp)}`;
      hpBar.classList.toggle('low', hpR < 0.3);
      // 状态
      const eff = [];
      if (p.hasEffect('swordIntent')) eff.push('<b class="buff">剑意</b>');
      if (p.stacks > 0) eff.push(`<b class="buff">百家×${p.stacks}</b>`);
      if (p.hasEffect('slow')) eff.push('<b class="debuff">减速</b>');
      if (p.hasEffect('weak')) eff.push('<b class="debuff">虚弱</b>');
      if (p.hasEffect('root')) eff.push('<b class="debuff">定身</b>');
      if (p.hasEffect('fear')) eff.push('<b class="debuff">恐惧</b>');
      if (p.hasEffect('blind')) eff.push('<b class="debuff">致盲</b>');
      if (p.hasEffect('dot')) eff.push('<b class="debuff">中毒</b>');
      if (p.hasEffect('berserk')) eff.push('<b class="buff">狂暴</b>');
      if (p.hasEffect('shield')) eff.push('<b class="buff">护盾</b>');
      if (p.hasEffect('hot')) eff.push('<b class="buff">回复</b>');
      if (p.armor > 0) eff.push('<b class="buff">霸体</b>');
      if (p.parryT > 0) eff.push('<b class="buff">回锋！</b>');
      const effHtml = eff.join('');
      if (this._eff !== effHtml) { this._eff = effHtml; $('.sf-effects', this.selfBox).innerHTML = effHtml; }
      // 技能冷却
      for (const slot in this.slots) {
        const s = this.slots[slot];
        let cd = 0, max = 1, ready = true, mpOk = true, active = false;
        if (slot === 'atk') { active = p.action && p.action.slot === 'atk'; }
        else if (slot === 'special') { active = p.state === 'guard' || p.aiming; }
        else {
          const d = p.cls.skills[slot];
          cd = Math.max(0, p.cd[slot] || 0); max = d.cd;
          if (p.stageInfo && p.stageInfo.slot === slot) { cd = 0; active = true; }
          ready = cd <= 0; mpOk = p.mp >= (d.mp || 0);
          active = active || (p.action && p.action.slot === slot);
        }
        const frac = ready ? 0 : cd / max;
        const cdEl = s.children[1];
        cdEl.style.background = frac > 0 ? `conic-gradient(rgba(10,14,20,.78) ${frac * 360}deg, transparent 0)` : 'transparent';
        s.children[2].textContent = frac > 0 ? (cd > 1000 ? Math.ceil(cd / 1000) : (cd / 1000).toFixed(1)) : '';
        s.classList.toggle('nomp', !mpOk);
        s.classList.toggle('active', !!active);
        if (s._wasReady === false && ready && slot !== 'atk' && slot !== 'special') { s.classList.remove('ready'); void s.offsetWidth; s.classList.add('ready'); }
        s._wasReady = ready;
      }
      // 目标：锁定 > 准星所指 > 最近攻击者
      let tgt = game.lockTarget;
      if (!tgt) {
        const o = p.eyePos(new THREE.Vector3());
        const r = game.world.raycast(o, p.aimDir, 40, game.fighters, p.team, p);
        if (r.fighter) { this._aimT = r.fighter; this._aimKeep = 2; }
        else if (this._aimKeep > 0) this._aimKeep -= dt;
        tgt = this._aimKeep > 0 ? this._aimT : (p.lastHitBy && p.lastHitBy.alive && p.lastHitBy !== p ? p.lastHitBy : null);
      }
      if (tgt && tgt.kind !== 'boss' && (tgt.alive || tgt.kind === 'hero')) {
        this.targetBox.style.display = 'block';
        $('.tf-name', this.targetBox).innerHTML = `${tgt.name} <small>${tgt.cls.name || ''}</small>`;
        $('i', this.targetBox).style.width = (clamp(tgt.hp / tgt.maxHp, 0, 1) * 100) + '%';
        $('span', this.targetBox).textContent = tgt.kind === 'dummy' ? '∞' : `${Math.ceil(tgt.hp)}`;
        const st = { air: '浮空', down: '倒地', hitstun: '硬直', stun: '眩晕', guard: '格挡', getup: '起身·无敌', tech: '受身', dead: '阵亡' }[tgt.state] || (tgt.action && tgt.action.def.armor && tgt.action.stage !== 'recover' ? '霸体' : '');
        $('.tf-state', this.targetBox).textContent = st;
      } else this.targetBox.style.display = 'none';
      // 锁定标记
      if (game.lockTarget) {
        const sp = this.project(game.lockTarget.center(this.v.clone()).setY(game.lockTarget.pos.y + 1.2));
        if (sp) { this.lockMark.style.display = 'block'; this.lockMark.style.transform = `translate(${sp[0]}px, ${sp[1]}px)`; } else this.lockMark.style.display = 'none';
      } else this.lockMark.style.display = 'none';
      // 连击
      if (this.comboT > 0) { this.comboT -= dt; if (this.comboT <= 0 || p.comboDealt === 0) { this.comboBox.classList.remove('show'); this.comboT = 0; } }
      // APM
      this._apmT = (this._apmT || 0) - dt;
      if (this._apmT <= 0) { this._apmT = 0.5; $('.apm-n', this.apmBox).textContent = input.apm(); $('.fps', this.apmBox).textContent = game.settings.showFps ? Math.round(game.fps) + ' FPS' : ''; }
      // 准星
      this.cross.style.display = game.settings.crosshair && game.firstPerson ? '' : 'none';
      this.cross.classList.toggle('aim', !!p.aiming);
    }
    // Boss
    if (this.boss) {
      const b = this.boss;
      const r = clamp(b.hp / b.maxHp, 0, 1);
      $('i', this.bossBox).style.width = (r * 100) + '%';
      this._bossLag = this._bossLag === undefined ? r : Math.max(r, this._bossLag - dt * 0.2);
      $('em', this.bossBox).style.width = (this._bossLag * 100) + '%';
      $('span', this.bossBox).textContent = `${Math.ceil(b.hp)} / ${b.maxHp}`;
    }
    // 队伍栏
    if (this.allies || this.enemies) {
      const rows = [];
      const row = (f, side) => `<div class="tm ${side} ${f.alive ? '' : 'dead'} ${f === p ? 'me' : ''}"><span class="n">${f.name}</span><span class="c">${f.cls.name}</span><div class="bar mini"><i style="width:${clamp(f.hp / f.maxHp, 0, 1) * 100}%"></i></div></div>`;
      for (const f of this.allies || []) rows.push(row(f, 'ally'));
      if (this.enemies?.length) rows.push('<div class="tm-sep">对手</div>');
      for (const f of this.enemies || []) rows.push(row(f, 'enemy'));
      const html = rows.join('');
      if (html !== this._teamHtml) { this._teamHtml = html; this.teamBox.innerHTML = html; }
    }
    // 头顶名牌
    this.updatePlates(game);
    // 飘字
    if (this.floats) {
      for (let i = this.floats.length - 1; i >= 0; i--) {
        const it = this.floats[i];
        it.t += dt;
        const k = it.t / it.dur;
        const sp = this.project(this.v.copy(it.pos).setY(it.pos.y + 0.6 + k * 0.8));
        if (!sp || k >= 1) { it.e.style.display = 'none'; this.pool.push(it.e); this.floats.splice(i, 1); continue; }
        it.e.style.transform = `translate(${sp[0] + it.dx * k}px, ${sp[1]}px) translate(-50%,-50%) scale(${k < 0.12 ? 1.5 - k * 4 : 1})`;
        it.e.style.opacity = k > 0.7 ? (1 - k) / 0.3 : 1;
      }
    }
    // 致盲
    const blind = p && p.effects.find((e) => e.type === 'blind');
    this.blindBox.style.opacity = blind ? Math.min(0.92, blind.t / 400) : 0;
    // 受伤
    if (this.hurtT > 0) { this.hurtT = Math.max(0, this.hurtT - dt * 1.6); }
    this.hurtBox.style.opacity = this.hurtT;
    if (p && p.hp / p.maxHp < 0.25 && !p.dead) this.hurtBox.style.opacity = Math.max(this.hurtT, 0.25 + 0.1 * Math.sin(performance.now() / 200));
    if (this.dirT > 0 && p && this.dirFrom) {
      this.dirT -= dt;
      const ang = Math.atan2(this.dirFrom.x - p.pos.x, this.dirFrom.z - p.pos.z) - game.viewYaw;
      this.dirBox.style.opacity = Math.max(0, this.dirT);
      this.dirBox.style.transform = `translate(-50%,-50%) rotate(${-ang}rad)`;
    } else this.dirBox.style.opacity = 0;
    if (this.toastT > 0) { this.toastT -= dt; if (this.toastT <= 0) this.toastBox.classList.remove('show'); }
    if (this.announceT > 0) { this.announceT -= dt; if (this.announceT <= 0) this.announceBox.classList.remove('show'); }
    if (this.centerT > 0) { this.centerT -= dt; if (this.centerT <= 0) this.center.classList.remove('show'); }
    if (this.stats.style.display !== 'none') { this._statT = (this._statT || 0) - dt; if (this._statT <= 0) { this._statT = 0.5; this.showStats(true, game); } }
  }
}

export { fmtTime };
