// Visual language for every playable skill. These are original art directions,
// not additional hit areas or claims about the novel's exact visual effects.
// Collision, status duration and damage continue to come from the skill data.
export const SKILL_VISUALS = Object.freeze({
  '拔刀斩': 'dash-blade', '三段斩': 'combo-blade', '上挑': 'rise-blade',
  '银光落刃': 'slam-frost', '连突刺': 'repeat-thrust', '回旋斩': 'spin-blade',
  '银光·千刃': 'storm-blade', '回锋': 'counter-blade',
  '龙牙': 'spear-thrust', '天击': 'spear-rise', '圆舞棍': 'spear-spin',
  '落花掌': 'palm', '连突': 'spear-thrust', '落星': 'slam-star', '伏龙翔天': 'dragon',
  '崩拳': 'heavy-fist', '铁步': 'step-fist', '升龙击': 'rise-fist',
  '旋风腿': 'spin-kick', '缠手': 'grapple', '铁山靠': 'shoulder', '猛虎乱舞': 'fist-storm',
  '乱射': 'rapid-gun', '浮空弹': 'lift-shot', '狙击射击': 'sniper',
  '踏射': 'kick-shot', '手雷': 'grenade', '转身射击': 'evade-shot', '枪林弹雨': 'gun-storm',
  '反坦克炮': 'heavy-shell', '激光炮': 'laser', '榴弹炮': 'grenade-shell',
  '格林机枪': 'gatling', '后跳炮': 'recoil-shell', '空中爆雷': 'air-mine', '卫星射线': 'satellite',
  '虚弱诅咒': 'weak-curse', '影缚术': 'root-curse', '暗影球': 'shadow-orb',
  '恐惧术': 'fear-cone', '生命吸取': 'drain', '暗影烈焰': 'shadow-fire', '地狱之门': 'gate',
  '治疗术': 'heal', '惩戒': 'holy-hammer', '神圣之火': 'holy-fire',
  '群体治疗': 'group-heal', '神圣护盾': 'shield', '光之冲击': 'holy-wave', '天使之翼': 'wings',
  '扫帚冲刺': 'broom-flight', '冰冻药水': 'ice-flask', '陨石术': 'meteor',
  '雷鹰·落雷': 'summon-lightning', '小飞龙·吐息': 'summon-fire',
  '魔法飞弹': 'homing-stars', '缚身药水': 'root-flask', '旋风扫': 'broom-spin', '星陨': 'meteor-rain',
  '崩山击': 'slam-blood', '血影狂刃': 'blood-spin', '地裂斩': 'slam-blood',
  '狂暴': 'berserk', '十字斩': 'cross-blade', '怒吼': 'fear-ring', '血之狂怒': 'blood-storm',
  '影袭': 'shadow-thrust', '背刺': 'backstab', '毒刃': 'poison-blade',
  '烟雾弹': 'smoke', '瞬影杀': 'shadow-dash', '飞刀': 'knives', '千影绝杀': 'shadow-storm',
  '撒沙': 'sand', '抛沙': 'sand', '板砖': 'brick', '背摔': 'grapple',
  '踩踏': 'stomp', '毒药瓶': 'poison-flask', '扫堂腿': 'low-kick', '流氓连环': 'brawl-storm',
  '千机·百式': 'umbrella-storm',
  '遮影步': 'shadow-dash',
  '混乱之雨': 'confusion-rain', '催眠术': 'sleep-curse', '圣诫之光': 'holy-edict',
  '净化': 'cleanse', '毒针': 'needle',
  '寒铁横扫': 'frost-blade', '盾撞': 'shoulder', '寒铁跃击': 'slam-frost', '霜环': 'frost-wave',
});

export const CLASS_VISUALS = Object.freeze({
  unspecialized: { color: '#71cbc1', school: 'steel' },
  swordmaster: { color: '#a1d9f5', school: 'steel' },
  battlemage: { color: '#e5b965', school: 'dragon' },
  striker: { color: '#de8063', school: 'impact' },
  sharpshooter: { color: '#ffc882', school: 'gun' },
  launcher: { color: '#f2aa5e', school: 'gun' },
  warlock: { color: '#a881df', school: 'dark' },
  cleric: { color: '#f0df9f', school: 'holy' },
  witch: { color: '#bbaaed', school: 'arcane' },
  summoner: { color: '#8cd7c4', school: 'arcane' },
  berserker: { color: '#d96054', school: 'blood' },
  assassin: { color: '#a28ace', school: 'shadow' },
  thug: { color: '#c5a56c', school: 'brawl' },
  // PvE characters use the same timing and direction rules as heroes.
  skeleton: { color: '#bad1c0', school: 'steel' },
  frostcaster: { color: '#9bbfcd', school: 'ice' },
  mob_thug: { color: '#bc9b73', school: 'brawl' },
  boss: { color: '#9bc4d2', school: 'ice' },
});

export function visualFor(def = {}, fighter = {}) {
  const named = SKILL_VISUALS[def.name];
  if (named) return named;
  if (def.slamOnLand) return 'slam-blood';
  if (def.flyDash) return 'broom-flight';
  if (def.shadowStep) return 'shadow-dash';
  if (def.heal) return def.heal.shield ? 'shield' : 'heal';
  if (def.buff) return 'berserk';
  if (def.beam) return def.beam.drain ? 'drain' : 'laser';
  if (def.blink) return 'shadow-thrust';
  if (def.grab) return 'grapple';
  if (def.proj?.some(p => p.kind === 'sand')) return 'sand';
  if (def.proj?.length) {
    const p = def.proj[0];
    if (p.kind === 'shell') return 'heavy-shell';
    if (p.kind === 'grenade') return 'grenade';
    if (p.kind === 'magic') return fighter.clsId === 'cleric' ? 'holy-hammer' : fighter.clsId === 'frostcaster' ? 'ice-bolt' : 'homing-stars';
    if (p.kind === 'wave') return 'ground-wave';
    if (p.kind === 'needle') return 'needle';
    return 'rapid-gun';
  }
  if (def.aoe?.length) return def.aoe[0].vfx || 'air-mine';
  if (def.vfx === 'palm' || def.vfx === 'punch' || def.vfx === 'punchBig') return 'fist';
  if (def.vfx === 'kick' || /kick|stomp/i.test(def.anim || '')) return 'kick';
  if (def.vfx === 'bash') return 'shoulder';
  if (/thrust/i.test(def.vfx || def.anim || '')) return 'thrust';
  if (def.vfx || def.hits?.length) return 'blade';
  return 'cast';
}
