// 菜单界面：标题、模式、账号卡、设置、暂停、镜前换装、结算
import { CLASSES, ACCOUNTS, CLASS_ORDER, SLOT_ORDER } from '../data/classes.js';
import { DIFFICULTY } from '../game/ai.js';
import { input, BIND_LABELS, keyLabel, DEFAULT_BINDS } from '../engine/input.js';
import { audio } from '../engine/audio.js';
import { store, fmtTime } from '../engine/util.js';
import { CharViewer } from './viewer.js';

function el(tag, cls, parent, html) { const e = document.createElement(tag); if (cls) e.className = cls; if (html !== undefined) e.innerHTML = html; if (parent) parent.appendChild(e); return e; }
const click = (e, fn) => { e.addEventListener('click', (ev) => { audio.play('ui_click'); fn(ev); }); e.addEventListener('mouseenter', () => audio.play('ui_hover', { vol: 0.4 })); return e; };

export const MODE_INFO = {
  training: { name: '训练场', en: 'TRAINING', desc: '镜廊训练室：木桩、镜子换装、陪练 Bot。先熟悉职业连段。', img: 'env-training-hall' },
  duel: { name: '个人赛', en: 'SOLO', desc: '断桥庭院 1v1，三局两胜，每局 3 分钟。', img: 'env-duel-courtyard' },
  relay: { name: '擂台赛', en: 'ARENA', desc: '3 对 3 车轮战，胜者留场并保留生命。', img: 'env-league-arena' },
  team: { name: '团队赛', en: 'TEAM', desc: '3 VS 3 同场混战，你与两名 AI 队友并肩作战。', img: 'loading-team' },
  dungeon: { name: '副本', en: 'DUNGEON', desc: '寒铁遗庭：清理骸骨卫兵，击破两阶段 Boss「寒铁守卫」。', img: 'env-coldiron-arena' },
  net: { name: '联机对战', en: 'ONLINE', desc: '局域网 / 同一服务器上与真人 1v1。需用 node server/server.mjs 启动。', img: 'loading-duel' },
  nethost: { name: '联机个人赛', en: 'ONLINE', desc: '', img: 'env-duel-courtyard' },
  netguest: { name: '联机个人赛', en: 'ONLINE', desc: '', img: 'env-duel-courtyard' },
};

export class Menu {
  constructor(root, app) {
    this.root = root; this.app = app;
    this.sel = store.get('lastSel', { account: 'jmx', enemy: 'yysf', diff: 'normal', teamA: ['jmx', 'myc', 'yyzq'], teamB: ['yysf', 'dmgy', 'yqcy'], party: true });
  }
  clear() { input.captureNext = null; this.dropViewer(); this.root.innerHTML = ''; this.root.style.display = ''; }
  hide() { input.captureNext = null; this.dropViewer(); this.root.style.display = 'none'; this.root.innerHTML = ''; }
  dropViewer() { if (this.viewer) { this.viewer.dispose(); this.viewer = null; } }

  // ---------- 标题 ----------
  title() {
    this.clear();
    const s = el('div', 'screen title-screen', this.root);
    s.innerHTML = `
      <div class="bg" style="background-image:url(assets/img/ui-login-background.jpg)"></div>
      <div class="title-block">
        <div class="logo">荣耀</div>
        <div class="logo-en">GLORY · 第一人称动作网游</div>
        <div class="tagline">操作、意识、手速——在第一人称里重现荣耀。越肩、第三人称随时切换。</div>
        <button class="btn primary big" id="enter">进入荣耀</button>
        <div class="fine">《全职高手》（蝴蝶蓝 著）粉丝同人作品，非官方，无任何商业利益。角色账号名、招式名归原著权利人所有，如有侵权请联系，我们会立即下线。<br>需要键盘和鼠标；推荐 Chrome / Edge 浏览器。</div>
      </div>`;
    click(s.querySelector('#enter'), () => { audio.init(); audio.music(true); this.main(); this.app.startAttract(); });
  }

  // ---------- 主菜单 ----------
  main() {
    this.clear();
    const s = el('div', 'screen main-screen', this.root);
    s.innerHTML = `<div class="bg dim" style="background-image:url(assets/img/ui-login-background.jpg)"></div>
      <div class="main-head"><div class="logo small">荣耀</div><div class="head-right"><span class="mats">寒铁碎片 ×${store.get('materials', 0)}</span><button class="btn ghost" id="set">设置</button><button class="btn ghost" id="help">操作说明</button></div></div>
      <div class="mode-grid"></div>`;
    const grid = s.querySelector('.mode-grid');
    for (const id of ['training', 'duel', 'relay', 'team', 'dungeon', 'net']) {
      const m = MODE_INFO[id];
      const c = el('div', 'mode-card', grid, `<div class="mc-img" style="background-image:url(assets/img/${m.img}.jpg)"></div><div class="mc-body"><div class="mc-en">${m.en}</div><div class="mc-name">${m.name}</div><div class="mc-desc">${m.desc}</div></div>`);
      if (id === 'dungeon' && store.get('dungeonBest', null)) el('div', 'mc-best', c, `最佳 ${fmtTime(store.get('dungeonBest'))}`);
      click(c, () => (id === 'net' ? this.app.openNet() : this.setup(id)));
    }
    click(s.querySelector('#set'), () => this.settings(() => this.main()));
    click(s.querySelector('#help'), () => this.help(() => this.main()));
  }

  accountCard(acc, parent, selected, onPick, extraCls = '') {
    const cls = CLASSES[acc.cls];
    const c = el('div', `acc-card ${selected ? 'sel' : ''} ${extraCls}`, parent, `
      <div class="ac-portrait" style="background-image:url(assets/portraits/${cls.portrait}.jpg)"></div>
      <div class="ac-info"><div class="ac-name">${acc.name}</div><div class="ac-cls">${cls.name}<span>${acc.weaponName}</span></div><div class="ac-player">${acc.team} · ${acc.player}</div></div>`);
    c.style.setProperty('--acc', acc.color);
    click(c, () => onPick(acc));
    return c;
  }

  // ---------- 模式设置 ----------
  setup(mode) {
    this.clear();
    const m = MODE_INFO[mode];
    const s = el('div', 'screen setup-screen', this.root);
    s.innerHTML = `<div class="bg dim2" style="background-image:url(assets/img/${m.img}.jpg)"></div>
      <div class="setup-head"><button class="btn ghost" id="back">← 返回</button><div class="setup-title"><span>${m.en}</span>${m.name}</div><div></div></div>
      <div class="setup-body"></div>
      <div class="setup-foot"><div class="diff"></div><button class="btn primary big" id="go">开始</button></div>`;
    const body = s.querySelector('.setup-body');
    const sel = this.sel;
    const byId = (id) => ACCOUNTS.find((a) => a.id === id) || ACCOUNTS[0];
    const render = () => {
      body.innerHTML = '';
      if (mode === 'training' || mode === 'duel' || mode === 'dungeon') {
        const col = el('div', 'setup-col', body, '<h3>你的账号卡</h3>');
        const g = el('div', 'acc-grid', col);
        for (const a of ACCOUNTS) this.accountCard(a, g, a.id === sel.account, (x) => { sel.account = x.id; render(); });
        this.classDetail(byId(sel.account), el('div', 'class-detail', col));
      }
      if (mode === 'duel') {
        const col = el('div', 'setup-col', body, '<h3>对手</h3>');
        const g = el('div', 'acc-grid', col);
        for (const a of ACCOUNTS) this.accountCard(a, g, a.id === sel.enemy, (x) => { sel.enemy = x.id; render(); }, 'enemy');
      }
      if (mode === 'dungeon') {
        const col = el('div', 'setup-col', body, '<h3>队伍</h3>');
        const t = el('label', 'toggle', col, `<input type="checkbox" ${sel.party ? 'checked' : ''}> 带两名 AI 队友（沐雨橙风 · 一叶之秋）`);
        t.querySelector('input').onchange = (e) => { sel.party = e.target.checked; };
        el('div', 'boss-preview', col, `<img src="assets/portraits/boss-coldiron.jpg"><div><b>寒铁守卫</b><p>宽盾重甲、长柄战斧。正面攻击胸甲锁扣累积破甲，破甲后失衡。生命低于 50% 进入第二阶段：跃击、霜环与冰晶术士支援。看清地面预警圈再走位。</p></div>`);
      }
      if (mode === 'relay' || mode === 'team') {
        for (const side of ['teamA', 'teamB']) {
          const col = el('div', 'setup-col', body, `<h3>${side === 'teamA' ? '我方（点击选择 3 名，第一位由你操作）' : '对手（3 名）'}</h3>`);
          const g = el('div', 'acc-grid', col);
          for (const a of ACCOUNTS) {
            const idx = sel[side].indexOf(a.id);
            const c = this.accountCard(a, g, idx >= 0, (x) => {
              const arr = sel[side]; const i = arr.indexOf(x.id);
              if (i >= 0) arr.splice(i, 1); else { arr.push(x.id); if (arr.length > 3) arr.shift(); }
              render();
            }, side === 'teamB' ? 'enemy' : '');
            if (idx >= 0) el('div', 'order', c, String(idx + 1));
          }
        }
      }
    };
    render();
    const diffBox = s.querySelector('.diff');
    if (mode !== 'training') {
      diffBox.innerHTML = '<span>对手难度</span>';
      for (const k in DIFFICULTY) {
        const b = el('button', `btn chip ${sel.diff === k ? 'on' : ''}`, diffBox, DIFFICULTY[k].name);
        click(b, () => { sel.diff = k; for (const x of diffBox.querySelectorAll('.chip')) x.classList.remove('on'); b.classList.add('on'); });
      }
    }
    click(s.querySelector('#back'), () => this.main());
    click(s.querySelector('#go'), () => {
      if ((mode === 'relay' || mode === 'team') && (sel.teamA.length < 3 || sel.teamB.length < 3)) { this.app.hud.toast('每队需要 3 名账号卡'); alert('每队需要选择 3 名账号卡'); return; }
      store.set('lastSel', sel);
      const opts = { account: byId(sel.account), enemy: byId(sel.enemy), diff: sel.diff, teamA: sel.teamA.map(byId), teamB: sel.teamB.map(byId) };
      if (mode === 'dungeon' && sel.party) opts.party = ['myc', 'yyzq'].filter((id) => id !== sel.account).slice(0, 2).map(byId);
      if (mode === 'dungeon' && sel.party && opts.party.length < 2) opts.party.push(byId('yysf'));
      this.app.startMode(mode, opts);
    });
  }

  classDetail(acc, box) {
    const c = CLASSES[acc.cls];
    const rows = [];
    const k = (slot) => keyLabel(input.binds[slot]);
    rows.push(`<tr><td><kbd>${keyLabel(input.binds.attack)}</kbd></td><td>普通攻击</td><td>连按三段</td></tr>`);
    rows.push(`<tr><td><kbd>${keyLabel(input.binds.special)}</kbd></td><td>${c.special?.name || ''}</td><td>${c.special?.type === 'aim' ? '按住瞄准，精度与伤害提高' : c.special?.parry ? '按住格挡；出招瞬间格挡为完美格挡，可左键回锋' : '按住格挡正面攻击，消耗法力'}</td></tr>`);
    for (const slot of SLOT_ORDER) { const d = c.skills[slot]; if (d) rows.push(`<tr><td><kbd>${k(slot)}</kbd></td><td>${d.name}${d.form ? `<small>（${{ sword: '剑', spear: '矛', gun: '枪', shield: '盾' }[d.form]}）</small>` : ''}</td><td>${d.desc || ''}</td></tr>`); }
    box.innerHTML = `<div class="cd-flex"><div class="viewer"><div class="viewer-tag">${acc.name}<small>${acc.weaponName}</small></div></div><div class="cd-text"><div class="cd-head"><b>${c.name}</b><span>${c.role}</span></div><p>${c.desc}</p><p class="passive">被动 · ${c.passive}</p><table class="skill-table">${rows.join('')}</table></div></div>`;
    const vbox = box.querySelector('.viewer');
    try {
      if (!this.viewer) this.viewer = new CharViewer(vbox, this.app.game.models, this.app.game.rigged);
      else { this.viewer.el = vbox; vbox.appendChild(this.viewer.r.domElement); }
      this.viewer.show(acc.cls);
    } catch (e) { vbox.remove(); }
  }

  // ---------- 联机大厅 ----------
  netUnavailable() {
    this.clear();
    const s = el('div', 'screen pause-screen', this.root);
    const box = el('div', 'panel help-box', s, `<h2>联机对战</h2>
      <p>这个浏览器不支持 WebRTC 直连，无法联机。</p>
      <p>请换用新版 Chrome 或 Edge 再打开本页。</p>`);
    click(el('button', 'btn primary', box, '返回'), () => this.main());
  }
  netLobby(net) {
    this.clear();
    const sel = this.sel;
    const byId = (id) => ACCOUNTS.find((a) => a.id === id) || ACCOUNTS[0];
    const s = el('div', 'screen setup-screen', this.root);
    s.innerHTML = `<div class="bg dim2" style="background-image:url(assets/img/loading-duel.jpg)"></div>
      <div class="setup-head"><button class="btn ghost" id="back">← 返回</button><div class="setup-title"><span>ONLINE</span>联机对战</div><div class="net-rtt"></div></div>
      <div class="setup-body"><div class="setup-col"><h3>你的账号卡</h3><div class="acc-grid"></div><div class="class-detail"></div></div>
      <div class="setup-col net-col"><h3>联机（浏览器直连）</h3>
        <div class="set-row"><label>昵称</label><div class="ctl"><input class="name-in" maxlength="12"></div></div>
        <div class="net-room"></div>
        <div class="net-block"><b>创建房间</b>
          <div class="net-actions"><input class="pw-new" placeholder="密码（可不填）" maxlength="16"><button class="btn primary" id="create">创建房间</button></div></div>
        <div class="net-block"><b>加入房间</b>
          <div class="net-actions"><input class="code-in" placeholder="6 位房间号" maxlength="6" inputmode="numeric"><input class="pw-join" placeholder="密码" maxlength="16"><button class="btn" id="join">加入</button></div></div>
        <details class="net-manual"><summary>没有房间号也能连：复制连接码</summary>
          <p class="muted">不经过任何服务器：房主把连接码发给对方，对方粘贴后得到回复码，再发回给房主。</p>
          <div class="net-actions"><button class="btn" id="mk-offer">我是房主：生成连接码</button></div>
          <textarea class="code-out" readonly placeholder="连接码 / 回复码会显示在这里"></textarea>
          <div class="net-actions"><button class="btn chip" id="copy-out">复制</button></div>
          <textarea class="code-paste" placeholder="粘贴对方发来的连接码或回复码"></textarea>
          <div class="net-actions"><button class="btn" id="use-code">使用粘贴的码</button></div>
        </details>
        <p class="muted net-tip">游戏数据在两台电脑之间直连，不经过服务器。双方都在运营商大内网（比如都用手机流量）时可能打不通，换一方用家里宽带或热点即可。</p>
      </div></div>`;
    const nameIn = s.querySelector('.name-in');
    nameIn.value = store.get('netName', '玩家' + Math.floor(Math.random() * 900 + 100));
    nameIn.onchange = () => store.set('netName', nameIn.value);
    const grid = s.querySelector('.acc-grid');
    const renderAcc = () => { grid.innerHTML = ''; for (const a of ACCOUNTS) this.accountCard(a, grid, a.id === sel.account, (x) => { sel.account = x.id; store.set('lastSel', sel); renderAcc(); }); this.classDetail(byId(sel.account), s.querySelector('.class-detail')); };
    renderAcc();
    const roomBox = s.querySelector('.net-room');
    const out = s.querySelector('.code-out'), paste = s.querySelector('.code-paste');
    const card = (html, cls = '') => { roomBox.innerHTML = `<div class="room-card ${cls}">${html}</div>`; };
    const me = () => ({ name: nameIn.value || '玩家', info: { acc: sel.account } });
    const copy = async (text) => {
      try { await navigator.clipboard.writeText(text); return true; } catch { /* 非 https 时退回旧接口 */ }
      const t = el('textarea', '', document.body); t.value = text; t.select();
      const ok = document.execCommand('copy'); t.remove(); return ok;
    };
    const busy = (b) => { for (const x of s.querySelectorAll('#create,#join,#mk-offer,#use-code')) x.disabled = b; };
    const offs = [];
    const cleanup = () => { clearInterval(this._netListT); for (const o of offs) o(); };
    this._netListT = setInterval(() => { const rt = s.querySelector('.net-rtt'); if (rt) rt.textContent = net.connected ? `已直连 · ${Math.round(net.rtt)}ms` : ''; }, 1000);

    // 房主：先试房间号服务，失败则退回连接码
    const create = async (useServer) => {
      busy(true); card('正在准备连接信息…（约 3 秒）');
      const pw = s.querySelector('.pw-new').value.trim();
      try {
        const r = await net.host({ ...me(), password: pw, useServer });
        if (r.room) {
          const invite = `【荣耀】来联机：打开 ${location.origin}${location.pathname} → 联机对战 → 加入房间，房间号 ${r.room}${pw ? `，密码 ${pw}` : ''}`;
          card(`房间号 <b class="big-code">${r.room}</b>${pw ? ` · 密码 <b>${pw}</b>` : ''}<div class="muted">等待对手加入…（15 分钟内有效）</div>
            <div class="net-actions"><button class="btn chip" id="copy-inv">复制邀请</button></div>`);
          click(roomBox.querySelector('#copy-inv'), async () => { const ok = await copy(invite); roomBox.querySelector('#copy-inv').textContent = ok ? '已复制' : '复制失败，请手动抄房间号'; });
        } else {
          s.querySelector('.net-manual').open = true;
          out.value = r.code;
          card(`${r.sigError ? '这个网址没有房间号服务，改用连接码：' : '连接码已生成：'}复制下方连接码发给对方，再把对方的回复码粘贴到下面，点“使用粘贴的码”。`);
        }
      } catch (e) { card(e.message, 'err'); }
      busy(false);
    };
    const joinRoom = async () => {
      const room = s.querySelector('.code-in').value.trim();
      if (!/^\d{6}$/.test(room)) { card('请输入 6 位房间号', 'err'); return; }
      busy(true); card('正在连接房主…');
      try { await net.join({ ...me(), password: s.querySelector('.pw-join').value.trim(), room }); card('已找到房间，正在打通直连…'); }
      catch (e) { card(e.message, 'err'); }
      busy(false);
    };
    const useCode = async () => {
      const code = paste.value.trim();
      if (!code) return;
      busy(true);
      try {
        if (net.role === 'host' && net.pc && !net.connected) { await net.acceptAnswer(code); card('已收到回复码，正在打通直连…'); }
        else {
          card('正在生成回复码…（约 3 秒）');
          const r = await net.join({ ...me(), password: s.querySelector('.pw-join').value.trim(), code });
          out.value = r.answer;
          card('回复码已生成：复制上方回复码发回给房主，等房主粘贴后自动连上。');
        }
      } catch (e) { card(e.message, 'err'); }
      busy(false);
    };

    offs.push(net.on('peer', (m) => {
      const opp = byId(m.info && m.info.acc);
      card(`已直连 · 对手 <b>${m.name}</b>（${opp.name} · ${opp.title}）
        <div class="diff"><span>地图</span><button class="btn chip on" data-l="courtyard">断桥庭院</button><button class="btn chip" data-l="arena">联赛赛场</button></div>
        <button class="btn primary big" id="start">开始对局</button>`);
      let level = 'courtyard';
      for (const b of roomBox.querySelectorAll('[data-l]')) click(b, () => { level = b.dataset.l; for (const x of roomBox.querySelectorAll('[data-l]')) x.classList.toggle('on', x === b); });
      click(roomBox.querySelector('#start'), () => { cleanup(); this.app.startMode('nethost', { net, account: byId(sel.account), enemy: opp, level, diff: 'normal' }); });
    }));
    offs.push(net.on('joined', (m) => {
      this.app.armGuest();
      const opp = byId(m.info && m.info.acc);
      card(`已直连房主 <b>${m.host}</b>（${opp.name}）<div class="muted">等待房主开始对局…</div>`);
    }));
    offs.push(net.on('error', (m) => card(m.msg, 'err')));
    offs.push(net.on('left', () => card('对方离开了房间。', 'err')));
    offs.push(net.on('relay', (d) => { if (d.k === 'go') cleanup(); }));
    click(s.querySelector('#create'), () => create(true));
    click(s.querySelector('#join'), joinRoom);
    click(s.querySelector('#mk-offer'), () => create(false));
    click(s.querySelector('#use-code'), useCode);
    click(s.querySelector('#copy-out'), async () => { if (out.value) s.querySelector('#copy-out').textContent = (await copy(out.value)) ? '已复制' : '复制失败'; });
    click(s.querySelector('#back'), () => { cleanup(); this.app.leaveNet(); this.main(); });
  }
  netWaiting(text) {
    this.clear();
    const s = el('div', 'screen pause-screen', this.root);
    const box = el('div', 'panel pause-box', s, `<h2>联机</h2><p>${text}</p>`);
    click(el('button', 'btn danger', box, '离开房间'), () => this.app.quit());
  }

  // ---------- 加载 ----------
  loading(mode) {
    this.clear();
    const img = mode === 'duel' || mode === 'relay' ? 'loading-duel' : mode === 'team' ? 'loading-team' : MODE_INFO[mode].img;
    const s = el('div', 'screen loading-screen', this.root, `<div class="bg" style="background-image:url(assets/img/${img}.jpg)"></div><div class="load-box"><div class="load-title">${MODE_INFO[mode].name}</div><div class="load-bar"><i></i></div><div class="load-tip">${this.tip()}</div></div>`);
    return s;
  }
  tip() {
    const tips = [
      '被挑空后，在落地瞬间按空格可以“受身”，避免倒地被追击。',
      '同一连段第三次挑空后，目标进入浮空保护，无法再被挑起。',
      '连段伤害从第二段开始递减，最低到 45%。',
      '散人的技能会自动切换千机伞形态；连续用不同形态的技能命中，叠加“百家”增伤。',
      '剑客在敌人出招瞬间格挡会触发完美格挡，然后立刻左键“回锋”。',
      '霸体技能不会被打断，但仍然会受到伤害。',
      '背后攻击伤害 +15%。',
      '战斗中没有背景音乐——仔细听脚步声和出招声判断方位。',
      '按 T 锁定目标，视线会柔和地跟随对手。',
      '倒地后的起身有短暂无敌，别急着出大招。',
      'APM 只是复盘数据，不等于实力。',
    ];
    return '提示：' + tips[Math.floor(Math.random() * tips.length)];
  }

  // ---------- 暂停 ----------
  pause(game, modeId) {
    this.clear();
    const s = el('div', 'screen pause-screen', this.root);
    const box = el('div', 'panel pause-box', s, `<h2>暂停</h2>`);
    const btn = (t, fn, cls = '') => click(el('button', 'btn wide ' + cls, box, t), fn);
    btn('继续游戏', () => { input.lock(true); this.app.resume(); }, 'primary');
    if (modeId === 'training') {
      btn('切换账号卡 / 职业', () => this.switchClass());
      btn('召唤陪练 Bot', () => this.sparring());
      if (this.app.mode.sparring) btn('移除陪练', () => { this.app.mode.removeSparring(); this.app.resume(); });
    }
    btn('设置', () => this.settings(() => this.pause(game, modeId)));
    btn('操作说明', () => this.help(() => this.pause(game, modeId)));
    btn('退出到主菜单', () => this.app.quit(), 'danger');
  }
  switchClass() {
    this.clear();
    const s = el('div', 'screen pause-screen', this.root);
    const box = el('div', 'panel wide-box', s, '<h2>切换账号卡</h2>');
    const g = el('div', 'acc-grid', box);
    for (const a of ACCOUNTS) this.accountCard(a, g, a.id === this.app.mode.opts.account.id, (x) => { this.app.startMode('training', { ...this.app.mode.opts, account: x }); });
    click(el('button', 'btn', box, '返回'), () => this.pause(this.app.game, 'training'));
  }
  sparring() {
    this.clear();
    const s = el('div', 'screen pause-screen', this.root);
    const box = el('div', 'panel wide-box', s, '<h2>召唤陪练</h2>');
    const d = el('div', 'diff', box, '<span>难度</span>');
    let diff = this.sel.diff || 'normal';
    for (const k in DIFFICULTY) { const b = el('button', `btn chip ${diff === k ? 'on' : ''}`, d, DIFFICULTY[k].name); click(b, () => { diff = k; for (const x of d.querySelectorAll('.chip')) x.classList.remove('on'); b.classList.add('on'); }); }
    const g = el('div', 'acc-grid', box);
    for (const a of ACCOUNTS) this.accountCard(a, g, false, (x) => { this.app.mode.addSparring(x.id, diff); this.app.resume(); }, 'enemy');
    click(el('button', 'btn', box, '返回'), () => this.pause(this.app.game, 'training'));
  }

  // ---------- 设置 ----------
  settings(back) {
    this.clear();
    const game = this.app.game;
    const st = game.settings;
    const s = el('div', 'screen pause-screen', this.root);
    const box = el('div', 'panel settings-box', s, '<h2>设置</h2>');
    const row = (label, html) => { const r = el('div', 'set-row', box, `<label>${label}</label><div class="ctl">${html}</div>`); return r.querySelector('.ctl'); };
    const range = (key, label, min, max, step, fmt = (v) => v) => {
      const c = row(label, `<input type="range" min="${min}" max="${max}" step="${step}" value="${st[key]}"><span>${fmt(st[key])}</span>`);
      const i = c.querySelector('input'), sp = c.querySelector('span');
      i.oninput = () => { st[key] = parseFloat(i.value); sp.textContent = fmt(st[key]); game.saveSettings(); };
    };
    const check = (key, label) => { const c = row(label, `<input type="checkbox" ${st[key] ? 'checked' : ''}>`); c.querySelector('input').onchange = (e) => { st[key] = e.target.checked; game.saveSettings(); }; };
    range('sens', '鼠标灵敏度', 0.2, 3, 0.05, (v) => v.toFixed(2));
    range('fov', '水平视野 FOV', 80, 110, 1, (v) => v + '°');
    { const c = row('视角（对局中 F5 切换）', `<select><option value="fp">第一人称</option><option value="ots">越肩</option><option value="tp">第三人称</option></select>`);
      const sel = c.querySelector('select'); sel.value = store.get('viewMode', st.defaultView || 'fp');
      sel.onchange = (e) => { st.defaultView = e.target.value; store.set('viewMode', e.target.value); game.saveSettings(); if (game.player) game.setViewMode(e.target.value); }; }
    check('invertY', '反转 Y 轴');
    check('shake', '镜头震动');
    check('bob', '走路晃动');
    check('dmgNumbers', '显示伤害数字');
    check('showTrails', '武器拖尾');
    check('crosshair', '准星');
    check('showFps', '显示帧率');
    if (st.post === undefined) st.post = true;
    check('post', '后期特效（泛光/调色/抗锯齿）');
    const q = row('画质（重启对局生效）', `<select><option value="high">高</option><option value="low">低（老电脑）</option></select>`);
    q.querySelector('select').value = st.quality; q.querySelector('select').onchange = (e) => { st.quality = e.target.value; game.saveSettings(); };
    range('master', '总音量', 0, 1, 0.05, (v) => Math.round(v * 100) + '%');
    range('sfx', '音效', 0, 1, 0.05, (v) => Math.round(v * 100) + '%');
    range('music', '菜单音乐', 0, 1, 0.05, (v) => Math.round(v * 100) + '%');
    if (st.voice === undefined) st.voice = 1;
    range('voice', '解说与喊招语音', 0, 1, 0.05, (v) => Math.round(v * 100) + '%');
    el('h3', '', box, '键位（点击后按新键；Esc 取消）');
    const kb = el('div', 'bind-grid', box);
    const renderBinds = () => {
      kb.innerHTML = '';
      for (const k in DEFAULT_BINDS) {
        const b = el('div', 'bind', kb, `<span>${BIND_LABELS[k] || k}</span><button class="btn chip">${keyLabel(input.binds[k])}</button>`);
        click(b.querySelector('button'), (ev) => { ev.target.textContent = '按键…'; input.captureNext = (code) => { if (code) input.setBind(k, code); renderBinds(); }; });
      }
    };
    renderBinds();
    const foot = el('div', 'set-foot', box);
    click(el('button', 'btn', foot, '恢复默认键位'), () => { input.resetBinds(); renderBinds(); });
    click(el('button', 'btn primary', foot, '完成'), () => back());
  }

  help(back) {
    this.clear();
    const s = el('div', 'screen pause-screen', this.root);
    const b = input.binds;
    el('div', 'panel help-box', s, `<h2>操作说明</h2>
      <div class="help-cols"><div>
      <h3>基础</h3>
      <p><kbd>${keyLabel(b.forward)}${keyLabel(b.left)}${keyLabel(b.back)}${keyLabel(b.right)}</kbd> 移动 · 鼠标转视角</p>
      <p><kbd>${keyLabel(b.attack)}</kbd> 普通攻击（连按三段；近战按住＝蓄力重击，带霸体，蓄满破防；远程按住连射）</p>
      <p><kbd>${keyLabel(b.special)}</kbd> 格挡 / 瞄准（按住）</p>
      <p><kbd>${keyLabel(b.s1)}</kbd><kbd>${keyLabel(b.s2)}</kbd><kbd>${keyLabel(b.s3)}</kbd><kbd>${keyLabel(b.s4)}</kbd><kbd>${keyLabel(b.s5)}</kbd><kbd>${keyLabel(b.s6)}</kbd> 技能 · <kbd>${keyLabel(b.ult)}</kbd> 大招</p>
      <p><kbd>${keyLabel(b.jump)}</kbd> 跳跃；被击飞时按下 = 受身 · <kbd>${keyLabel(b.dash)}</kbd> 闪避冲刺（短暂无敌）</p>
      <p><kbd>1</kbd>–<kbd>4</kbd> 散人切换千机伞形态（剑 / 矛 / 枪 / 盾）</p>
      <p><kbd>${keyLabel(b.lockon)}</kbd> 锁定目标 · <kbd>${keyLabel(b.stats)}</kbd> 数据面板 · <kbd>${keyLabel(b.view)}</kbd> 第一人称 / 越肩 / 第三人称 · <kbd>G</kbd> 镜前换装 · <kbd>Esc</kbd> 暂停</p>
      </div><div>
      <h3>荣耀的战斗</h3>
      <p><b>浮空</b>：天击、上挑、升龙击、浮空弹等把人打上天，空中继续命中会把目标托住。</p>
      <p><b>保护</b>：同一连段第三次挑空或浮空超过 2 秒后，目标进入保护，不能再被挑起；连段伤害逐段递减到 45%。</p>
      <p><b>受身</b>：被击飞时在落地前后按空格，翻滚起身并短暂无敌；否则倒地，起身时也有无敌。</p>
      <p><b>霸体</b>：部分技能（崩拳、铁山靠、各职业大招）与蓄力重击出招过程中不会被打断——看到对手武器发<b style="color:#6fb6ff">蓝光</b>就别硬拼。</p>
      <p><b>破防</b>：武器发<b style="color:#ffc040">金光</b>的招式无视格挡（蓄满的重击、崩拳、缠手、背摔），要闪开。</p>
      <p><b>取消</b>：普攻收招可以接技能，技能收招末段可以接别的技能——这就是连段。</p>
      <p><b>视角</b>：原著的荣耀是第一人称视角，低头能看到自己的身体，去训练室能照镜子。按 <kbd>${keyLabel(b.view)}</kbd> 可切到越肩（像《永劫无间》）或第三人称，看清自己的出招。</p>
      </div></div>`);
    click(el('button', 'btn primary', s.querySelector('.help-box'), '返回'), () => back());
  }

  // ---------- 镜前换装 ----------
  wardrobe(player, onChange, onClose) {
    this.clear();
    this.root.classList.add('side');
    const look = JSON.parse(JSON.stringify(player.rig.look));
    const orig = JSON.parse(JSON.stringify(look));
    const s = el('div', 'wardrobe', this.root, '<h2>镜前 · 换装</h2><p class="wd-note">镜中是你的实时模型；试穿不改变属性，确认后保存。</p>');
    const row = (label, html) => { const r = el('div', 'set-row', s, `<label>${label}</label><div class="ctl">${html}</div>`); return r.querySelector('.ctl'); };
    const color = (label, get, set) => {
      const c = row(label, `<input type="color" value="${get()}">`);
      c.querySelector('input').oninput = (e) => { set(e.target.value); look.proc = true; onChange(look); };
    };
    const choice = (label, opts, get, set) => {
      const c = row(label, opts.map(([v, n]) => `<button class="btn chip ${get() === v ? 'on' : ''}" data-v="${v}">${n}</button>`).join(''));
      for (const b of c.querySelectorAll('button')) click(b, () => { set(b.dataset.v); if (label !== '造型') look.proc = true; for (const x of c.querySelectorAll('button')) x.classList.toggle('on', x === b); onChange(look); });
    };
    if (this.app.game.models && this.app.game.models.has(player.modelKey)) {
      choice('造型', [['model', '原画精模'], ['proc', '自定义配色']], () => (look.proc ? 'proc' : 'model'), (v) => (look.proc = v === 'proc'));
      el('p', 'wd-note', s, '原画精模由概念图生成 3D，颜色固定；选“自定义配色”后下方各项生效。');
    }
    choice('体型', [['m', '男'], ['f', '女']], () => look.sex, (v) => (look.sex = v));
    choice('发型', [['spiky', '刺猬'], ['short', '短发'], ['long', '长发'], ['pony', '马尾'], ['bun', '发髻'], ['bald', '光头']], () => look.hair.style, (v) => (look.hair.style = v));
    color('发色', () => look.hair.color, (v) => (look.hair.color = v));
    choice('上衣', [['coat', '长外套'], ['jacket', '短外套'], ['robe', '长袍'], ['armor', '铠甲'], ['vest', '背心']], () => look.top.style, (v) => (look.top.style = v));
    color('外衣颜色', () => look.top.color, (v) => (look.top.color = v));
    color('饰边', () => look.top.trim, (v) => (look.top.trim = v));
    color('内衬', () => look.top.inner, (v) => (look.top.inner = v));
    color('裤子', () => look.pants, (v) => (look.pants = v));
    color('靴子', () => look.boots, (v) => (look.boots = v));
    color('肤色', () => look.skin, (v) => (look.skin = v));
    choice('肩甲', [['none', '无'], ['light', '轻'], ['heavy', '重']], () => look.shoulder, (v) => (look.shoulder = v));
    const foot = el('div', 'set-foot', s);
    click(el('button', 'btn', foot, '取消'), () => { onChange(orig); this.root.classList.remove('side'); onClose(false); });
    click(el('button', 'btn primary', foot, '确认保存'), () => { this.root.classList.remove('side'); onClose(true, look); });
  }

  // ---------- 结算 ----------
  results(res, onAgain, onMenu) {
    this.clear();
    const s = el('div', 'screen results-screen', this.root);
    const rows = (res.fighters || []).filter(Boolean).map((f) => `<tr class="${f.team === 1 ? 'ally' : 'enemy'}"><td>${f.name}</td><td>${f.cls.name}</td><td>${f.stats.dmgDealt}</td><td>${f.stats.dmgTaken}</td><td>${f.stats.maxCombo}</td><td>${f.stats.skills}</td><td>${f.stats.kills}</td></tr>`).join('');
    el('div', `panel results-box ${res.win ? 'win' : 'lose'}`, s, `
      <div class="res-grid"><div class="viewer res-viewer"></div><div class="res-main">
      <div class="res-title">${res.title}</div><div class="res-sub">${res.sub || ''}</div>
      <table class="res-table"><thead><tr><th>账号</th><th>职业</th><th>输出</th><th>承伤</th><th>最高连击</th><th>技能</th><th>击杀</th></tr></thead><tbody>${rows}</tbody></table>
      <div class="res-apm">本局 APM <b>${input.apm()}</b></div></div></div>
      <div class="set-foot"><button class="btn" id="menu">返回主菜单</button><button class="btn primary" id="again">再来一局</button></div>`);
    click(s.querySelector('#again'), onAgain);
    click(s.querySelector('#menu'), onMenu);
    const me = (res.fighters || []).find((f) => f && f.isPlayer && !f.remote) || (res.fighters || [])[0];
    const vb = s.querySelector('.res-viewer');
    if (me && CLASSES[me.clsId]) { try { this.viewer = new CharViewer(vb, this.app.game.models, this.app.game.rigged); this.viewer.show(me.clsId, res.win ? 'cheer' : null); } catch { vb.remove(); } }
    else vb.remove();
  }
}
