// 解说与大招喊招语音（Mini 上用 macOS 神经语音预生成的 mp3，位于 assets/voice）
import { SKILLS } from '../data/classes.js';

const cache = new Map();
let vol = 0.9;
let enabled = true;
const ultKeyByName = new Map();
for (const k in SKILLS) if (SKILLS[k].ult) ultKeyByName.set(SKILLS[k].name, k);

function get(name) {
  let a = cache.get(name);
  if (!a) { a = new Audio(`assets/voice/${name}.mp3`); a.preload = 'auto'; cache.set(name, a); }
  return a;
}

export const voice = {
  setVolume(v) { vol = v; },
  setEnabled(on) { enabled = on; },
  preload(names) { for (const n of names) get(n); },
  play(name, gain = 1) {
    if (!enabled) return;
    const base = get(name);
    const a = base.paused ? base : base.cloneNode();
    a.volume = Math.max(0, Math.min(1, vol * gain));
    try { a.currentTime = 0; const p = a.play(); if (p && p.catch) p.catch(() => {}); } catch { /* 忽略 */ }
  },
  ult(skillName, gain = 1) {
    const k = ultKeyByName.get(skillName);
    if (k) this.play('ult_' + k, gain);
  },
};

voice.preload(['cd3', 'cd2', 'cd1', 'go', 'round1', 'round2', 'round3', 'win', 'lose', 'roundwin', 'roundlose']);
