// 菜单界面：标题、模式、账号卡、设置、暂停、镜前换装、结算
import { CLASSES, ACCOUNTS, CLASS_ORDER, SLOT_ORDER, SKILLS, SKILL_CHOICES, skillClass } from '../data/classes.js';
import { DIFFICULTY } from '../game/ai.js';
import { input, BIND_LABELS, keyLabel, DEFAULT_BINDS } from '../engine/input.js';
import { audio } from '../engine/audio.js';
import { store, fmtTime } from '../engine/util.js';
import { CharViewer } from './viewer.js';
import { STORY_CHAPTERS, storyProgress } from '../data/story.js';
import { HANDBOOK } from '../data/handbook.js';

function el(tag, cls, parent, html) { const e = document.createElement(tag); if (cls) e.className = cls; if (html !== undefined) e.innerHTML = html; if (parent) parent.appendChild(e); return e; }
const click = (e, fn) => { e.addEventListener('click', (ev) => { audio.play('ui_click'); fn(ev); }); e.addEventListener('mouseenter', () => audio.play('ui_hover', { vol: 0.4 })); return e; };

export const MODE_INFO = {
  story: { name: '剧情模式', en: 'STORY', desc: '在三章同人历程中，练习连段、立体走位与团队配合。', img: 'loading-duel' },
  training: { name: '训练场', en: 'TRAINING', desc: '镜廊训练室：木桩、镜子换装、陪练 Bot。先熟悉职业连段。', img: 'env-training-hall' },
  duel: { name: '个人赛', en: 'SOLO', desc: '断桥庭院 1v1，三局两胜，每局 3 分钟。', img: 'env-duel-courtyard' },
  relay: { name: '擂台赛', en: 'ARENA', desc: '3 对 3 车轮战，胜者留场并保留生命。', img: 'env-league-arena' },
  team: { name: '团队赛', en: 'TEAM', desc: '3 VS 3 同场混战，你与两名 AI 队友并肩作战。', img: 'loading-team' },
  dungeon: { name: '副本', en: 'DUNGEON', desc: '寒铁遗庭：清理骸骨卫兵，击破两阶段 Boss「寒铁守卫」。', img: 'env-coldiron-arena' },
  net: { name: '联机对战', en: 'ONLINE', desc: '与同一局域网的朋友创建房间，选定地图，进行真人个人赛。', img: 'loading-duel' },
  nethost: { name: '联机个人赛', en: 'ONLINE', desc: '', img: 'env-duel-courtyard' },
  netguest: { name: '联机个人赛', en: 'ONLINE', desc: '', img: 'env-duel-courtyard' },
};

export class Menu {
  constructor(root, app) {
    this.root = root; this.app = app;
    const defaults = { account: 'jmx', enemy: 'yysf', diff: 'normal', teamA: ['jmx', 'myc', 'yyzq'], teamB: ['yysf', 'dmgy', 'yqcy'], party: true };
    const saved = store.get('lastSel', {});
    this.sel = { ...defaults, ...(saved && typeof saved === 'object' ? saved : {}) };
    for (const side of ['teamA', 'teamB']) {
      const valid = Array.isArray(this.sel[side]) ? [...new Set(this.sel[side])].filter(id => ACCOUNTS.some(a => a.id === id)).slice(0, 3) : [];
      this.sel[side] = [...valid, ...defaults[side].filter(id => !valid.includes(id))].slice(0, 3);
    }
    if (!DIFFICULTY[this.sel.diff]) this.sel.diff = 'normal';
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
        <div class="fine">《全职高手》（蝴蝶蓝 著）粉丝同人作品，非官方，无任何商业利益。角色账号名、招式名归原著权利人所有，<br>支持键鼠与手机触屏；手机横屏操作更舒适。</div>
      </div>`;
    click(s.querySelector('#enter'), () => { audio.init(); audio.music(true); this.main(); });
  }

  // ---------- 主菜单 ----------
  main() {
    this.clear();
    const ids = ['training', 'story', 'duel', 'relay', 'team', 'dungeon', 'net'];
    let selected = store.get('lastMode', 'training'); if (!ids.includes(selected)) selected = 'training';
    const account = ACCOUNTS.find(a => a.id === this.sel.account) || ACCOUNTS[0], cls = CLASSES[account.cls];
    const progress = storyProgress(store.get('storyProgress', {}));
    const s = el('div', 'screen main-screen lobby-screen', this.root);
    s.innerHTML = `<div class="bg lobby-background" style="background-image:url(assets/img/ui-login-background.jpg)"></div>
      <header class="lobby-header"><div class="lobby-brand"><div class="logo small">荣耀</div><span>GLORY<small>第十区 · 集结大厅</small></span></div>
        <div class="lobby-tools"><span class="lobby-materials">寒铁碎片 <b>${store.get('materials', 0)}</b></span><button class="btn ghost" id="help">荣耀手册</button><button class="btn ghost" id="set">设置</button></div></header>
      <div class="lobby-body"><nav class="lobby-modes" aria-label="选择游戏模式"><span class="eyebrow">PLAY / 选择模式</span></nav>
        <section class="lobby-character" aria-label="当前账号卡"><div class="lobby-identity"><span class="eyebrow">${cls.group === '散人' ? '未转职' : cls.group + '系'} · ${cls.name}</span><h1>${account.name}</h1><p>${account.team} / ${account.player}<span>${account.title}</span></p></div><div class="lobby-viewer"></div>
          <div class="lobby-character-foot"><div><span>当前武器</span><strong>${account.weaponName}</strong></div><button class="btn ghost" id="choose-account">更换账号 / 配招 <span>↗</span></button></div></section>
        <section class="lobby-play" aria-live="polite"></section></div>
      <footer class="lobby-footer"><span><i></i> 第一人称 · 自由操作</span><span>《全职高手》粉丝同人作品</span><button class="lobby-quick-guide" id="quick-training">进入训练场 →</button></footer>`;
    const subtitles = { training: '自由练习 · 镜前换装', story: '新区历程 · 章节任务', duel: '单人对决 · 三局两胜', relay: '三人轮换 · 胜者留场', team: '三人协同 · 团队作战', dungeon: '组队挑战 · 寒铁遗庭', net: '局域网 · 与朋友对战' };
    const nav = s.querySelector('.lobby-modes');
    const renderMode = () => {
      const m = MODE_INFO[selected];
      for (const button of nav.querySelectorAll('button')) { const active = button.dataset.mode === selected; button.classList.toggle('on', active); button.setAttribute('aria-pressed', String(active)); }
      const rules = {
        training: ['木桩、陪练与镜廊', '自由切换职业与招式', '练习距离、连段和受身'],
        story: [`章节进度 ${progress.cleared.length} / ${STORY_CHAPTERS.length}`, STORY_CHAPTERS[progress.latest].title, '通关后自动保存进度'],
        duel: ['1 对 1 · 三局两胜', '每局限时 3 分钟', '四张地图可选'],
        relay: ['每方三人 · 依次上场', '胜者保留当前生命', '第一名角色由你操作'],
        team: ['3 对 3 · 同场协作', '你与两名电脑队友', '治疗与控制配合进攻'],
        dungeon: ['寒铁遗庭 · 两阶段首领', '可带两名电脑队友', '注意预警与护甲弱点'],
        net: ['创建或加入六位房间号', '同一局域网，真人对战', '房主选择地图与开始时间'],
      }[selected];
      const box = s.querySelector('.lobby-play');
      box.innerHTML = `<div class="lobby-mode-art" style="background-image:url(assets/img/${m.img}.jpg)"><span>${m.en}</span></div><div class="lobby-mode-copy"><span class="eyebrow">${selected === 'story' ? '继续你的荣耀之旅' : '准备就绪'}</span><h2>${m.name}</h2><p>${m.desc}</p><ul>${rules.map(t => `<li>${t}</li>`).join('')}</ul></div>
        <div class="lobby-launch"><button class="btn primary" id="play-now">${selected === 'net' ? '进入联机大厅' : selected === 'story' ? '继续剧情' : '开始' + m.name}<span>→</span></button>${selected === 'net' ? '<small>无需账号登录，房间号即可邀请</small>' : '<button class="btn ghost" id="configure">账号、地图与对局设置</button>'}</div>`;
      click(box.querySelector('#play-now'), () => { if (selected === 'story') this.sel.chapter = progress.latest; selected === 'net' ? this.app.openNet() : this.launch(selected); });
      if (box.querySelector('#configure')) click(box.querySelector('#configure'), () => this.setup(selected));
    };
    for (const id of ids) {
      const button = el('button', 'lobby-mode', nav, `<span class="mode-mark">${ids.indexOf(id) + 1 < 10 ? '0' : ''}${ids.indexOf(id) + 1}</span><span><b>${MODE_INFO[id].name}</b><small>${subtitles[id]}</small></span><i>›</i>`);
      button.type = 'button'; button.dataset.mode = id;
      click(button, () => { selected = id; store.set('lastMode', id); renderMode(); });
    }
    renderMode();
    this.mountViewer(s.querySelector('.lobby-viewer'), account, 'idle');
    click(s.querySelector('#choose-account'), () => this.setup(selected === 'net' ? 'training' : selected));
    click(s.querySelector('#quick-training'), () => this.launch('training'));
    click(s.querySelector('#set'), () => this.settings(() => this.main()));
    click(s.querySelector('#help'), () => this.help(() => this.main()));
  }

  mountViewer(box, acc, pose = null) {
    try {
      if (!this.viewer) this.viewer = new CharViewer(box, this.app.game.models, this.app.game.rigged);
      else this.viewer.attach(box);
      this.viewer.show(acc.cls, pose);
    } catch { this.dropViewer(); box.classList.add('viewer-unavailable'); box.textContent = '角色预览暂不可用'; }
  }

  launch(mode) {
    const sel = this.sel, byId = id => ACCOUNTS.find(a => a.id === id) || ACCOUNTS[0];
    if ((mode === 'relay' || mode === 'team') && (sel.teamA.length < 3 || sel.teamB.length < 3)) { this.setup(mode); return; }
    if (mode === 'relay' || mode === 'team') {
      const i = sel.teamA.indexOf(sel.account);
      if (i > 0) sel.teamA[i] = sel.teamA[0];
      sel.teamA[0] = byId(sel.account).id;
    }
    if (mode === 'story') { const progress = storyProgress(store.get('storyProgress', {})); sel.chapter = Math.max(0, Math.min(Number.isInteger(sel.chapter) ? sel.chapter : progress.latest, progress.latest)); }
    store.set('lastSel', sel); store.set('lastMode', mode);
    const opts = { account: byId(sel.account), enemy: byId(sel.enemy), diff: sel.diff, chapter: sel.chapter, level: mode === 'duel' ? sel.level || 'courtyard' : undefined, teamA: sel.teamA.map(byId), teamB: sel.teamB.map(byId) };
    if (mode === 'dungeon' && sel.party) opts.party = ['myc', 'yyzq', 'yysf'].filter(id => id !== sel.account).slice(0, 2).map(byId);
    this.app.startMode(mode, opts);
  }

  accountCard(acc, parent, selected, onPick, extraCls = '') {
    const cls = CLASSES[acc.cls];
    const c = el('button', `acc-card ${selected ? 'sel' : ''} ${extraCls}`, parent, `
      <div class="ac-portrait" style="background-image:url(assets/portraits/avatars/${acc.cls}.png)"></div>
      <div class="ac-info"><div class="ac-name">${acc.name}</div><div class="ac-cls">${cls.name}<span>${acc.weaponName}</span></div><div class="ac-player">${acc.team} · ${acc.player}</div></div>`);
    c.type = 'button'; c.dataset.account = acc.id; c.setAttribute('aria-pressed', String(selected)); c.setAttribute('aria-label', `${acc.name} · ${cls.name}`);
    c.style.setProperty('--acc', acc.color);
    click(c, () => onPick(acc));
    return c;
  }

  // ---------- 模式设置 ----------
  setup(mode) {
    this.clear();
    const m = MODE_INFO[mode], sel = this.sel;
    if (mode === 'relay' || mode === 'team') sel.account = sel.teamA[0];
    const byId = id => ACCOUNTS.find(a => a.id === id) || ACCOUNTS[0];
    const s = el('div', `screen setup-screen selection-screen mode-${mode}`, this.root);
    s.innerHTML = `<div class="bg dim2" style="background-image:url(assets/img/ui-character-background.jpg)"></div>
      <header class="setup-head"><button class="btn ghost" id="back">← 大厅</button><div class="setup-title"><span>${m.en} / 准备</span>${m.name}</div><span class="setup-instruction">选择账号卡，带上你的招式</span></header>
      <div class="setup-body"></div><footer class="setup-foot"><div class="selection-summary"></div><div class="diff"></div><button class="btn primary big" id="go">进入${m.name} →</button></footer>`;
    const body = s.querySelector('.setup-body');
    let filter = '全部';
    const render = () => {
      this.dropViewer(); body.innerHTML = '';
      const roster = el('section', 'setup-col roster-panel', body, '<div class="panel-label"><h3>账号卡</h3><span>选择你的职业</span></div>');
      const filters = el('div', 'roster-filters', roster);
      for (const group of ['全部', ...new Set(ACCOUNTS.map(a => CLASSES[a.cls].group))]) {
        const button = el('button', 'roster-filter' + (filter === group ? ' on' : ''), filters, group); button.type = 'button'; button.setAttribute('aria-pressed', String(filter === group));
        click(button, () => { filter = group; render(); });
      }
      const grid = el('div', 'acc-grid', roster);
      for (const a of ACCOUNTS.filter(a => filter === '全部' || CLASSES[a.cls].group === filter)) this.accountCard(a, grid, a.id === sel.account, x => { if (mode === 'relay' || mode === 'team') { const i = sel.teamA.indexOf(x.id); if (i > 0) sel.teamA[i] = sel.teamA[0]; sel.teamA[0] = x.id; } sel.account = x.id; store.set('lastSel', sel); render(); });
      this.classDetail(byId(sel.account), el('section', 'class-detail selection-detail', body));
      const side = el('section', 'setup-col match-panel', body);
      if (mode === 'story') {
        const progress = storyProgress(store.get('storyProgress', {}));
        sel.chapter = Math.max(0, Math.min(Number.isInteger(sel.chapter) ? sel.chapter : progress.latest, progress.latest));
        el('h3', '', side, '章节进度');
        el('p', 'muted', side, `已完成 ${progress.cleared.length} / ${STORY_CHAPTERS.length} · 自动保存`);
        STORY_CHAPTERS.forEach((chapter, i) => {
          const done = progress.cleared.includes(chapter.id), available = i <= progress.latest;
          const button = el('button', `story-chapter ${i === sel.chapter ? 'on' : ''}`, side, `<b>${chapter.title}</b><p>${chapter.summary}</p><span>${done ? '已通关 · 重温' : available ? '开始挑战' : '完成前一章解锁'}</span>`);
          button.disabled = !available; click(button, () => { sel.chapter = i; render(); });
        });
      } else if (mode === 'duel') {
        el('h3', '', side, '地图与对手');
        const maps = el('div', 'map-choices', side);
        for (const [id, name] of [['courtyard', '断桥庭院'], ['arena', '联赛赛场'], ['clocktower', '钟塔广场'], ['frostbridge', '霜桥遗迹']]) {
          const button = el('button', `btn chip ${(sel.level || 'courtyard') === id ? 'on' : ''}`, maps, name); click(button, () => { sel.level = id; render(); });
        }
        el('div', 'opponent-label', side, '对手账号');
        const enemies = el('div', 'acc-grid opponent-grid', side);
        for (const a of ACCOUNTS) this.accountCard(a, enemies, a.id === sel.enemy, x => { sel.enemy = x.id; render(); }, 'enemy');
      } else if (mode === 'dungeon') {
        el('h3', '', side, '寒铁遗庭');
        const toggle = el('label', 'toggle', side, `<input type="checkbox" ${sel.party ? 'checked' : ''}> 与两名电脑队友同行`); toggle.querySelector('input').onchange = e => { sel.party = e.target.checked; };
        el('div', 'boss-preview', side, '<img src="assets/portraits/boss-coldiron.jpg" alt="寒铁守卫"><div><b>寒铁守卫</b><p>攻击胸甲锁扣累积破甲。生命低于一半后进入第二阶段，留意跃击、霜环和冰晶术士。</p></div>');
      } else if (mode === 'relay' || mode === 'team') {
        for (const key of ['teamA', 'teamB']) {
          el('h3', '', side, key === 'teamA' ? '我方 · 第一位由你操作' : '对手阵容');
          const slots = el('div', 'lineup-slots', side);
          for (let i = 0; i < 3; i++) {
            const label = el('label', '', slots, `<span>${i + 1}</span><select aria-label="${key === 'teamA' ? '我方' : '对手'}第${i + 1}位">${ACCOUNTS.map(a => `<option value="${a.id}">${a.name} · ${CLASSES[a.cls].name}</option>`).join('')}</select>`);
            const select = label.querySelector('select'); select.value = sel[key][i] || ACCOUNTS[i].id;
            select.onchange = () => { const previous = sel[key][i], duplicate = sel[key].indexOf(select.value); if (duplicate >= 0 && duplicate !== i) sel[key][duplicate] = previous; sel[key][i] = select.value; if (key === 'teamA') sel.account = sel.teamA[0]; render(); };
          }
        }
        el('p', 'muted', side, mode === 'relay' ? '胜者保留生命继续迎战，安排好上场顺序。' : '治疗、控制与近战互相掩护。阵容由你决定。');
      } else {
        el('h3', '', side, '训练从这里开始');
        el('div', 'training-steps', side, '<div><span>01</span><b>感受距离</b><p>对准木桩，让武器真正碰到目标。</p></div><div><span>02</span><b>练习连段</b><p>挑空、追击与收招，保留体力用于受身。</p></div><div><span>03</span><b>自由试招</b><p>暂停后可切换职业、配置招式、添加陪练。</p></div>');
        el('p', 'muted', side, '镜廊可以观察完整角色与动作，也可以换装。');
      }
      const current = byId((mode === 'relay' || mode === 'team') ? sel.teamA[0] : sel.account);
      s.querySelector('.selection-summary').innerHTML = `<span>出战账号</span><b>${current.name}</b><small>${CLASSES[current.cls].name}</small>`;
    };
    render();
    const diffBox = s.querySelector('.diff');
    if (mode !== 'training') {
      el('span', '', diffBox, '难度');
      for (const key in DIFFICULTY) {
        const button = el('button', `btn chip ${sel.diff === key ? 'on' : ''}`, diffBox, DIFFICULTY[key].name);
        click(button, () => { sel.diff = key; for (const b of diffBox.querySelectorAll('.chip')) b.classList.remove('on'); button.classList.add('on'); });
      }
    }
    click(s.querySelector('#back'), () => { store.set('lastSel', sel); this.main(); });
    click(s.querySelector('#go'), () => this.launch(mode));
  }

  classDetail(acc, box, draft = null) {
    const loadouts = draft || store.get('skillLoadouts', {});
    const c = skillClass(acc.cls, CLASSES[acc.cls], loadouts[acc.cls]);
    const rows = [];
    const k = (slot) => input.touchMode ? (BIND_LABELS[slot] || slot) : keyLabel(input.binds[slot]);
    rows.push(`<tr><td><kbd>${k('attack')}</kbd></td><td>普通攻击</td><td>${c.chain?.[0]?.proj ? '点按普攻；长按连续发射' : '点按连招；长按蓄力，松手出击'}</td></tr>`);
    rows.push(`<tr><td><kbd>${k('special')}</kbd></td><td>${c.special?.name || ''}</td><td>${c.special?.type === 'chaser' ? '生成炫纹后再次命中，点按发射一枚；弹体命中获得对应增益' : c.special?.type === 'aim' ? '按住瞄准，精度与伤害提高' : c.special?.parry ? '按住格挡；出招瞬间格挡为完美格挡，可普攻回锋' : '按住格挡正面攻击，消耗法力'}</td></tr>`);
    for (const slot of SLOT_ORDER) { const d = c.skills[slot]; if (d) rows.push(`<tr><td><kbd>${k(slot)}</kbd></td><td>${d.name}${d.form ? `<small>（${{ sword: '剑', spear: '矛', gun: '枪', shield: '盾' }[d.form]}）</small>` : ''}</td><td>${d.desc || ''}</td></tr>`); }
    box.innerHTML = `<div class="cd-flex"><div class="viewer"><div class="viewer-tag">${acc.name}<small>${acc.weaponName}</small></div><span class="viewer-drag">拖动查看角色</span></div><div class="cd-text"><div class="cd-head"><b>${c.name}</b><span>${c.role}</span></div><p class="class-description">${c.desc}</p><div class="class-resources"><span>生命 <b>${c.hp}</b></span><span>法力 <b>${c.mp}</b></span><span>移速 <b>${c.speed}</b></span></div><p class="passive">${c.passive}</p><details class="skill-details"><summary>招式与按键 <span>${SLOT_ORDER.filter(slot => c.skills[slot]).length} 项技能</span></summary><table class="skill-table">${rows.join('')}</table></details></div></div>`;
    const options = SKILL_CHOICES[acc.cls];
    if (options) {
      const choices = el('div', 'skill-choices', box.querySelector('.cd-text'), '<b>招式配置</b>');
      for (const [slot, ids] of Object.entries(options)) {
        const row = el('label', 'skill-choice', choices, `<span>${k(slot)}</span><select aria-label="${k(slot)}招式">${ids.map(id => `<option value="${id}" ${c.skillSelection[slot] === id ? 'selected' : ''}>${SKILLS[id].name}</option>`).join('')}</select>`);
        row.querySelector('select').onchange = event => {
          loadouts[acc.cls] = { ...(loadouts[acc.cls] || {}), [slot]: event.target.value };
          if (!draft) store.set('skillLoadouts', loadouts);
          this.classDetail(acc, box, draft);
        };
      }
    }
    this.mountViewer(box.querySelector('.viewer'), acc, 'idle');
    const demo = el('button', 'viewer-demo', box.querySelector('.viewer'), '演示招式'); demo.type = 'button'; demo.setAttribute('aria-pressed', 'false');
    click(demo, () => { if (!this.viewer) return; const active = this.viewer.pose === 'idle'; this.viewer.pose = active ? null : 'idle'; this.viewer.demo = null; this.viewer.demoT = .2; demo.textContent = active ? '回到待机' : '演示招式'; demo.setAttribute('aria-pressed', String(active)); });
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
      <div class="setup-col net-col"><h3>邀请朋友对战</h3>
        <div class="set-row"><label>昵称</label><div class="ctl"><input class="name-in" maxlength="12"></div></div>
        <div class="net-room"></div>
        <div class="net-block"><b>创建房间</b>
          <div class="net-actions"><input class="pw-new" placeholder="密码（可不填）" maxlength="16"><button class="btn primary" id="create">创建房间</button></div></div>
        <div class="net-block"><b>加入房间</b>
          <div class="net-actions"><input class="code-in" placeholder="6 位房间号" maxlength="6" inputmode="numeric"><input class="pw-join" placeholder="密码" maxlength="16"><button class="btn" id="join">加入</button></div></div>
        <details class="net-manual"><summary>高级连接方式：使用连接码</summary>
          <p class="muted">不经过任何服务器：房主把连接码发给对方，对方粘贴后得到回复码，再发回给房主。</p>
          <div class="net-actions"><button class="btn" id="mk-offer">我是房主：生成连接码</button></div>
          <textarea class="code-out" readonly placeholder="连接码 / 回复码会显示在这里"></textarea>
          <div class="net-actions"><button class="btn chip" id="copy-out">复制</button></div>
          <textarea class="code-paste" placeholder="粘贴对方发来的连接码或回复码"></textarea>
          <div class="net-actions"><button class="btn" id="use-code">使用粘贴的码</button></div>
        </details>
        <p class="muted net-tip">同一局域网下，创建房间后把六位房间号发给朋友。双方准备好后，由房主开始。</p>
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
    const me = () => ({ name: nameIn.value || '玩家', info: { acc: sel.account, skillLoadout: store.get('skillLoadouts', {})[byId(sel.account).cls] || {} } });
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
        <div class="diff"><span>地图</span><button class="btn chip on" data-l="courtyard">断桥庭院</button><button class="btn chip" data-l="arena">联赛赛场</button><button class="btn chip" data-l="clocktower">钟楼旧街</button><button class="btn chip" data-l="frostbridge">霜溪古桥</button></div>
        <button class="btn primary big" id="start">开始对局</button>`);
      let level = 'courtyard';
      for (const b of roomBox.querySelectorAll('[data-l]')) click(b, () => { level = b.dataset.l; for (const x of roomBox.querySelectorAll('[data-l]')) x.classList.toggle('on', x === b); });
      click(roomBox.querySelector('#start'), () => { cleanup(); this.app.startMode('nethost', { net, account: byId(sel.account), enemy: opp, enemyLoadout: m.info?.skillLoadout || {}, level, diff: 'normal' }); });
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
    const s = el('div', 'screen loading-screen', this.root, `<div class="bg" style="background-image:url(assets/img/${img}.jpg)"></div><div class="load-box"><div class="load-heading"><div class="load-title">${MODE_INFO[mode].name}</div><button type="button" class="btn ghost load-cancel">返回菜单</button></div><div class="load-bar" role="progressbar" aria-label="加载进度" aria-valuemin="0" aria-valuemax="100" aria-valuenow="10"><i></i></div><div class="load-state" role="status">准备资源</div><div class="load-tip">${this.tip()}</div></div>`);
    click(s.querySelector('.load-cancel'), () => this.app.quit());
    return s;
  }
  tip() {
    const tips = [
      input.touchMode ? '被挑空后，在落地瞬间点“跳跃”可以受身，避免倒地被追击。' : '被挑空后，在落地瞬间按空格可以“受身”，避免倒地被追击。',
      '同一连段第三次挑空后，目标进入浮空保护，无法再被挑起。',
      '连段伤害从第二段开始递减，最低到 45%。',
      '散人的技能会自动切换千机伞形态；连续用不同形态的技能命中，叠加“百家”增伤。',
      '剑客在敌人出招瞬间格挡会触发完美格挡，然后立刻左键“回锋”。',
      '霸体技能不会被打断，但仍然会受到伤害。',
      '背后攻击伤害 +15%。',
      '战斗中没有背景音乐——仔细听脚步声和出招声判断方位。',
      input.touchMode ? '点“观察”标记可见目标；拖动空白处手动瞄准。' : '按 T 观察可见目标；视角与出手方向仍由你控制。',
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
      if (SKILL_CHOICES[game.player?.clsId]) btn('调整招式配置', () => this.configureSkills());
      btn('召唤陪练 Bot', () => this.sparring());
      if (this.app.mode.sparring) btn('移除陪练', () => { this.app.mode.removeSparring(); this.app.resume(); });
    }
    btn('设置', () => this.settings(() => this.pause(game, modeId)));
    btn('荣耀手册', () => this.help(() => this.pause(game, modeId)));
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
  configureSkills() {
    this.clear();
    const screen = el('div', 'screen pause-screen', this.root), panel = el('div', 'panel wide-box', screen, '<h2>招式配置</h2>');
    const draft = JSON.parse(JSON.stringify(store.get('skillLoadouts', {})));
    this.classDetail(this.app.mode.opts.account, el('div', 'class-detail', panel), draft);
    const actions = el('div', 'set-foot', panel);
    click(el('button', 'btn', actions, '取消'), () => this.app.resume());
    click(el('button', 'btn primary', actions, '应用并继续'), () => {
      const p = this.app.game.player;
      p.cancelAction(); p.queued = null; p.state = p.onGround ? 'idle' : 'jump';
      store.set('skillLoadouts', draft);
      p.cls = skillClass(p.clsId, CLASSES[p.clsId], draft[p.clsId]);
      this.app.mode.refreshGoals?.();
      this.app.hud.bindPlayer(p, p.account); this.app.resume();
    });
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
    const row = (label, html, key) => {
      const r = el('div', 'set-row', box, `<label>${label}</label><div class="ctl">${html}</div>`);
      const control = r.querySelector('input, select');
      control.id = `setting-${key}`;
      r.querySelector('label').htmlFor = control.id;
      return r.querySelector('.ctl');
    };
    const range = (key, label, min, max, step, fmt = (v) => v) => {
      const c = row(label, `<input type="range" min="${min}" max="${max}" step="${step}" value="${st[key]}"><span>${fmt(st[key])}</span>`, key);
      const i = c.querySelector('input'), sp = c.querySelector('span');
      i.oninput = () => { st[key] = parseFloat(i.value); sp.textContent = fmt(st[key]); game.saveSettings(); };
    };
    const check = (key, label) => { const c = row(label, `<label class="set-toggle"><input type="checkbox" ${st[key] ? 'checked' : ''}></label>`, key); c.querySelector('input').onchange = (e) => { st[key] = e.target.checked; game.saveSettings(); }; };
    range('sens', input.touchMode ? '触屏视角灵敏度' : '鼠标灵敏度', 0.2, 3, 0.05, (v) => v.toFixed(2));
    range('fov', '水平视野 FOV', 80, 110, 1, (v) => v + '°');
    { const c = row(input.touchMode ? '视角（对局中点“视角”切换）' : '视角（对局中 F5 切换）', `<select><option value="fp">第一人称</option><option value="ots">越肩</option><option value="tp">第三人称</option></select>`, 'defaultView');
      const sel = c.querySelector('select'); sel.value = store.get('viewMode', st.defaultView || 'fp');
      sel.onchange = (e) => { st.defaultView = e.target.value; store.set('viewMode', e.target.value); game.saveSettings(); if (game.player) game.setViewMode(e.target.value); }; }
    check('invertY', '反转 Y 轴');
    check('aimAssist', '辅助跟随视角（练习）');
    check('shake', '镜头震动');
    check('bob', '走路晃动');
    check('dmgNumbers', '显示伤害数字');
    check('showTrails', '武器拖尾');
    check('crosshair', '准星');
    check('showFps', '显示帧率');
    if (st.post === undefined) st.post = true;
    check('post', '后期特效（泛光/调色/抗锯齿）');
    const q = row('画质（刷新页面生效）', `<select><option value="high">高</option><option value="low">流畅（手机 / 老电脑）</option></select>`, 'quality');
    q.querySelector('select').value = st.quality; q.querySelector('select').onchange = (e) => { st.quality = e.target.value; game.saveSettings(); };
    range('master', '总音量', 0, 1, 0.05, (v) => Math.round(v * 100) + '%');
    range('sfx', '音效', 0, 1, 0.05, (v) => Math.round(v * 100) + '%');
    range('music', '菜单音乐', 0, 1, 0.05, (v) => Math.round(v * 100) + '%');
    if (st.voice === undefined) st.voice = 1;
    range('voice', '解说与喊招语音', 0, 1, 0.05, (v) => Math.round(v * 100) + '%');
    if (input.touchMode) el('p', 'muted', box, '触屏：左下摇杆移动，拖动空白处转视角，右下点按技能。普攻与格挡支持长按。');
    else el('h3', '', box, '键位（点击后按新键；Esc 取消）');
    const kb = el('div', 'bind-grid', box);
    const renderBinds = () => {
      kb.innerHTML = '';
      if (input.touchMode) return;
      for (const k in DEFAULT_BINDS) {
        const b = el('div', 'bind', kb, `<span>${BIND_LABELS[k] || k}</span><button class="btn chip">${keyLabel(input.binds[k])}</button>`);
        click(b.querySelector('button'), (ev) => { ev.target.textContent = '按键…'; input.captureNext = (code) => { if (code) input.setBind(k, code); renderBinds(); }; });
      }
    };
    renderBinds();
    const controls = [...box.children].filter(child => child.tagName !== 'H2');
    const tabs = el('div', 'settings-tabs', box); tabs.setAttribute('role', 'tablist'); tabs.setAttribute('aria-label', '设置分类');
    const sections = {};
    for (const [id, name] of [['controls', '操作与视角'], ['graphics', '画面'], ['audio', '声音']]) {
      const button = el('button', id === 'controls' ? 'on' : '', tabs, name); button.type = 'button'; button.id = `settings-tab-${id}`; button.setAttribute('role', 'tab'); button.setAttribute('aria-selected', String(id === 'controls')); button.setAttribute('aria-controls', `settings-section-${id}`);
      const section = el('div', 'settings-section', box); section.id = `settings-section-${id}`; section.hidden = id !== 'controls'; section.setAttribute('role', 'tabpanel'); section.setAttribute('aria-labelledby', button.id); sections[id] = section;
      click(button, () => { for (const [key, panel] of Object.entries(sections)) panel.hidden = key !== id; for (const tab of tabs.children) { const active = tab === button; tab.classList.toggle('on', active); tab.setAttribute('aria-selected', String(active)); } });
    }
    for (const row of controls) {
      const key = row.querySelector('[id^="setting-"]')?.id.slice(8);
      const group = ['master', 'sfx', 'music', 'voice'].includes(key) ? 'audio' : ['dmgNumbers', 'showTrails', 'crosshair', 'showFps', 'post', 'quality'].includes(key) ? 'graphics' : 'controls';
      sections[group].appendChild(row);
    }
    el('p', 'settings-note', sections.controls, '默认自由瞄准。辅助跟随仅帮助转动视角，攻击仍需要真实接触。');
    el('p', 'settings-note', sections.audio, '战斗中没有背景音乐，留意脚步与出手声。菜单音乐与语音可以分别调整。');
    const foot = el('div', 'set-foot', box);
    if (!input.touchMode) click(el('button', 'btn', foot, '恢复默认键位'), () => { input.resetBinds(); renderBinds(); });
    click(el('button', 'btn primary', foot, '完成'), () => back());
  }

  help(back) {
    this.clear();
    const screen = el('div', 'screen pause-screen', this.root);
    const box = el('section', 'panel handbook', screen, '<header class="handbook-head"><div><span class="eyebrow">GLORY / FIELD GUIDE</span><h2>荣耀手册</h2></div><button class="btn ghost" id="guide-back">← 返回</button></header><div class="handbook-layout"><nav class="handbook-nav" aria-label="手册章节"></nav><article class="handbook-article"></article></div>');
    const nav = box.querySelector('.handbook-nav'), article = box.querySelector('.handbook-article');
    const label = text => text.replace(/\{(\w+)\}/g, (_, key) => `<kbd>${input.touchMode ? ({ special: '职业特技', jump: '跳跃', attack: '普攻', sprint: '疾跑', dash: '闪避', lockon: '观察' }[key] || BIND_LABELS[key] || key) : keyLabel(input.binds[key])}</kbd>`);
    const draw = topic => {
      for (const button of nav.children) { const active = button.dataset.topic === topic.id; button.classList.toggle('on', active); button.setAttribute('aria-pressed', String(active)); }
      article.innerHTML = `<span class="eyebrow">${topic.kicker}</span><h3>${topic.lead}</h3><p class="handbook-intro">${topic.intro}</p><div class="handbook-cards">${topic.cards.map(([title, text, account]) => `<section><h4>${title}</h4><p>${label(text)}</p>${account ? `<button class="guide-practice" data-account="${account}">用${ACCOUNTS.find(a => a.id === account)?.name || '该职业'}练习 →</button>` : ''}</section>`).join('')}</div>${topic.practice ? `<button class="btn primary handbook-practice" data-account="${topic.practice}">到训练场试一试 →</button>` : ''}`;
      article.scrollTop = 0;
      for (const button of article.querySelectorAll('[data-account]')) click(button, () => { this.sel.account = button.dataset.account; this.launch('training'); });
    };
    for (const topic of HANDBOOK) { const button = el('button', '', nav, topic.title); button.type = 'button'; button.dataset.topic = topic.id; click(button, () => draw(topic)); }
    draw(HANDBOOK[0]); click(box.querySelector('#guide-back'), back);
  }

  // ---------- 镜前换装 ----------
  wardrobe(player, onChange, onClose) {
    this.clear();
    this.root.classList.add('side');
    const look = JSON.parse(JSON.stringify(player.rig.look));
    const orig = JSON.parse(JSON.stringify(look));
    const s = el('div', 'wardrobe', this.root, '<h2>镜前 · 换装</h2><p class="wd-note">镜中是你的实时模型；试穿不改变属性，确认后保存。</p>');
    let modeButtons = null;
    const preview = () => {
      for (const b of modeButtons?.querySelectorAll('button') || []) b.classList.toggle('on', b.dataset.v === (look.proc ? 'proc' : 'model'));
      onChange(look);
    };
    const row = (label, html) => { const r = el('div', 'set-row', s, `<label>${label}</label><div class="ctl">${html}</div>`); return r.querySelector('.ctl'); };
    const color = (label, get, set) => {
      const c = row(label, `<input type="color" value="${get()}">`);
      c.querySelector('input').oninput = (e) => { set(e.target.value); look.proc = true; preview(); };
    };
    const choice = (label, opts, get, set) => {
      const c = row(label, opts.map(([v, n]) => `<button class="btn chip ${get() === v ? 'on' : ''}" data-v="${v}">${n}</button>`).join(''));
      for (const b of c.querySelectorAll('button')) click(b, () => { set(b.dataset.v); if (label !== '造型') look.proc = true; for (const x of c.querySelectorAll('button')) x.classList.toggle('on', x === b); preview(); });
      return c;
    };
    if (this.app.game.models?.has(player.modelKey) || this.app.game.rigged?.has(player.modelKey)) {
      modeButtons = choice('造型', [['model', '原画精模'], ['proc', '自定义配色']], () => (look.proc ? 'proc' : 'model'), (v) => (look.proc = v === 'proc'));
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
      <div class="set-foot"><button class="btn" id="result-menu">返回主菜单</button><button class="btn primary" id="again">再来一局</button></div>`);
    if (res.mode === 'story') s.querySelector('#again').textContent = res.storyNext != null ? '继续下一章' : res.win ? '重温本章' : '重试本章';
    click(s.querySelector('#again'), onAgain);
    click(s.querySelector('#result-menu'), onMenu);
    const me = (res.fighters || []).find((f) => f && f.isPlayer && !f.remote) || (res.fighters || [])[0];
    const vb = s.querySelector('.res-viewer');
    if (me && CLASSES[me.clsId]) { try { this.viewer = new CharViewer(vb, this.app.game.models, this.app.game.rigged); this.viewer.show(me.clsId, res.win ? 'cheer' : null); } catch { vb.remove(); } }
    else vb.remove();
  }
}
