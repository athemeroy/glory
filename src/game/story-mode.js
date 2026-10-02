import * as THREE from 'three';
import { BaseMode } from './modes.js';
import { CLASSES, ACCOUNTS } from '../data/classes.js';
import { MOBS, BOSS } from '../data/enemies.js';
import { STORY_CHAPTERS, storyProgress } from '../data/story.js';
import { store, fmtTime, wrapAngle } from '../engine/util.js';
import { input, keyLabel } from '../engine/input.js';
import { audio } from '../engine/audio.js';

export class StoryMode extends BaseMode {
  start() {
    const progress = storyProgress(store.get('storyProgress', {}));
    this.chapterIndex = Math.max(0, Math.min(progress.latest, Math.trunc(Number(this.opts.chapter)) || 0));
    this.chapter = STORY_CHAPTERS[this.chapterIndex];
    this.L = this.game.loadLevel(this.chapter.level);
    this.player = this.spawnHero(this.opts.account, 1, this.L.spawns.player, true);
    this.party = [this.player]; this.enemies = []; this.stage = 'intro'; this.t = 0;
    this.hud.bindPlayer(this.player, this.opts.account); this.hud.setBoss(null); this.hud.setTeams(null, null);
    this.hud.setGoals(null); this.hud.setHint('沿发光路标推进 · 高低差与掩体会影响命中');
    const markers = this.L.markers.story || {};
    const enemy = this.L.spawns.enemy || [0, 0, -5, 0];
    this.waypoint = new THREE.Vector3(...(markers.waypoint || [enemy[0], enemy[1], enemy[2]]));
    this.encounter = new THREE.Vector3(...(markers.encounter || [enemy[0], enemy[1], enemy[2]]));
    this.exit = new THREE.Vector3(...(markers.exit || [enemy[0], enemy[1], enemy[2]]));
    this.dialogueRoot = document.createElement('div'); this.dialogueRoot.className = 'story-dialogue'; this.hud.root.appendChild(this.dialogueRoot);
    this.dialogueRoot.innerHTML = '<div class="story-speaker"></div><div class="story-line"></div><button type="button" class="btn primary story-next"></button>';
    this.dialogueRoot.querySelector('button').onclick = () => this.nextDialogue();
    this.dialogue(this.chapter.intro, () => { this.stage = 'travel'; this.freeze(false); this.markWaypoint(); });
    this.refreshHUD();
  }
  dialogue(lines, done) {
    this.lines = lines; this.lineIndex = 0; this.dialogueDone = done; this.freeze(true); this.dialogueRoot.style.display = 'block';
    document.body.classList.add('story-speaking');
    input.cursorMode = true; input.unlock();
    this.showDialogue();
  }
  showDialogue() {
    const [speaker, text] = this.lines[this.lineIndex];
    this.dialogueRoot.querySelector('.story-speaker').textContent = speaker;
    this.dialogueRoot.querySelector('.story-line').textContent = text;
    this.dialogueRoot.querySelector('button').textContent = `${input.touchMode ? '点按' : keyLabel(input.binds.interact)} · ${this.lineIndex === this.lines.length - 1 ? '开始行动' : '继续'}`;
  }
  nextDialogue() {
    if (this.over || !this.lines) return;
    if (++this.lineIndex < this.lines.length) this.showDialogue();
    else {
      const done = this.dialogueDone; this.lines = null; this.dialogueRoot.style.display = 'none'; document.body.classList.remove('story-speaking');
      input.cursorMode = false; input.clear(); done?.();
      if (!input.touchMode && !this.game.manual && !this.over) input.lock(true);
    }
  }
  markWaypoint() { this.game.vfx.telegraph(this.stage === 'exit' ? this.exit : this.waypoint, .65, 2.1); this.beaconT = 2; }
  beginEncounter() {
    this.stage = 'fight'; this.hud.announce(this.chapter.fightGoal, 'enemy', 2);
    const diff = this.opts.diff || 'normal';
    const health = diff === 'easy' ? .72 : diff === 'hard' || diff === 'god' ? 1.2 : 1;
    this.chapter.encounter.forEach((type, i) => {
      const boss = type === 'boss', hero = !!CLASSES[type];
      const cls = boss ? BOSS : CLASSES[type] || MOBS[type];
      const spawn = this.chapter.enemySpawns?.[i];
      const x = spawn?.[0] ?? this.encounter.x + (i - (this.chapter.encounter.length - 1) / 2) * 2;
      const z = spawn?.[2] ?? this.encounter.z + (i % 2 ? 1 : -1);
      const y = this.game.world.floorHeight(x, z);
      const f = this.game.spawn({ name: boss ? '霜桥守卫' : hero ? '旧街拦路者' : cls.name, cls, clsId: type, modelKey: type, kind: boss ? 'boss' : hero ? 'hero' : 'mob', team: 2,
        pos: [x, y, z], yaw: Math.atan2(this.player.pos.x - x, this.player.pos.z - z), ai: diff,
        hp: (boss ? 4200 : hero ? 1250 : cls.hp) * health, dmgMul: boss ? .78 : hero ? .65 : .8, scale: boss ? 1.2 : 1 });
      f.target = this.player; f.phase = 1; f.bossStaggerable = true; this.enemies.push(f);
      if (boss) this.hud.setBoss(f, '注意横扫、跃击与霜环');
    });
    if (this.chapter.ally) {
      const account = ACCOUNTS.find(a => a.id === this.chapter.ally);
      if (account && account.id !== this.opts.account.id) {
        const sp = this.player.pos; const ally = this.spawnHero(account, 1, [sp.x - 1, sp.y, sp.z + 1, this.player.yaw], false, 'normal');
        ally.ai.follow = this.player; this.party.push(ally); this.hud.setTeams(this.party, null);
      }
    }
    this.refreshHUD();
  }
  tick(dt) {
    if (this.over) return;
    if (this.lines) { if (input.consume('interact', 200) || input.consume('jump', 100)) this.nextDialogue(); return; }
    this.t += dt;
    if (this.stage === 'travel') {
      if (this.player.pos.distanceTo(this.waypoint) < 2.1) this.beginEncounter();
      else { this.beaconT -= dt; if (this.beaconT <= 0) this.markWaypoint(); }
    }
    if (this.stage === 'fight') {
      const boss = this.enemies.find(f => f.kind === 'boss');
      if (boss && boss.alive && boss.hp < boss.maxHp * .5) boss.phase = 2;
      if (this.enemies.length && this.enemies.every(f => !f.alive)) {
        this.stage = 'outro'; this.hud.setBoss(null); this.dialogue(this.chapter.outro, () => { this.stage = 'exit'; this.freeze(false); this.markWaypoint(); });
      }
    }
    if (this.stage === 'exit') {
      if (this.player.pos.distanceTo(this.exit) < 2.1) this.completeChapter();
      else { this.beaconT -= dt; if (this.beaconT <= 0) this.markWaypoint(); }
    }
    this.refreshHUD();
  }
  refreshHUD() {
    const left = `<b>${this.chapter.title}</b>`, goal = this.stage === 'travel' ? this.chapter.goal : this.stage === 'fight' ? `${this.chapter.fightGoal} · ${this.enemies.filter(f => f.alive).length}名` : this.stage === 'exit' ? this.chapter.exitGoal : '剧情对话';
    this.hud.setTop(left, fmtTime(this.t), '', goal);
    if (['travel', 'exit'].includes(this.stage)) {
      const point = this.stage === 'exit' ? this.exit : this.waypoint;
      const dx = point.x - this.player.pos.x, dz = point.z - this.player.pos.z;
      const angle = wrapAngle(Math.atan2(dx, dz) - this.player.yaw);
      const arrow = Math.abs(angle) < .4 ? '↑ 前方' : Math.abs(angle) > 2.5 ? '↓ 转身' : angle > 0 ? '← 左侧' : '→ 右侧';
      this.hud.setPrompt(`${arrow} · 路标 ${Math.ceil(Math.hypot(dx, dz))}米 · 沿金色路线前进`);
    } else this.hud.setPrompt('');
    this.hud.setGoals([{ text: this.chapter.goal, done: !['intro', 'travel'].includes(this.stage) }, { text: this.chapter.fightGoal, done: ['outro', 'exit', 'complete'].includes(this.stage) }, { text: this.chapter.exitGoal, done: this.stage === 'complete' }], '章节目标');
  }
  onDeath(f) {
    if (f !== this.player || this.over) return;
    this.finish({ win: false, title: '本章挑战失败', sub: '进度已保留，可以重试本章。', fighters: this.party, mode: 'story' });
  }
  completeChapter() {
    const progress = storyProgress(store.get('storyProgress', {})), firstClear = !progress.cleared.includes(this.chapter.id);
    if (firstClear) { progress.cleared.push(this.chapter.id); store.set('storyProgress', progress); store.set('materials', store.get('materials', 0) + 5); }
    this.stage = 'complete'; audio.play('victory');
    this.finish({ win: true, title: this.chapter.title + ' · 完成', sub: firstClear ? '章节已保存 · 获得寒铁碎片×5' : '章节已完成 · 可以重温或继续',
      storyNext: this.chapterIndex + 1 < STORY_CHAPTERS.length ? this.chapterIndex + 1 : null, fighters: this.party, mode: 'story' });
  }
  dispose() { input.cursorMode = false; document.body.classList.remove('story-speaking'); this.dialogueRoot?.remove(); super.dispose(); }
}
