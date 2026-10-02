// 原创剧情任务，沿用《全职高手》的职业与战术概念，不复刻小说对白。
export const STORY_CHAPTERS = Object.freeze([
  {
    id: 'first-night', title: '第一章 · 第十区的夜', level: 'courtyard',
    summary: '初入第十区，穿过遗迹，在旧街练出第一套连招。',
    intro: [
      ['旁白', '新区刚刚开放。远处传来键盘声，遗迹另一端的旧街却已经被人堵住。'],
      ['叶修', '先别急着按技能。看清距离和方向，刀真正碰到对方，才算打中。'],
      ['陈果', '桥边有落差，别只顾着追人。体力留一点，落地时还要受身。'],
    ],
    goal: '穿过遗迹，抵达旧街的路标', fightGoal: '击败封路的两名对手', exitGoal: '沿路标前往钟塔方向',
    encounter: ['thug', 'skeleton'],
    outro: [['叶修', '格挡、僵直、浮空，每一种都留着下一招的机会。把这些机会接起来，才是连招。'], ['旁白', '封路的人散了。钟塔方向传来一声短促的求援。']],
  },
  {
    id: 'clocktower', title: '第二章 · 钟塔盲区', level: 'clocktower',
    summary: '沿着阶梯与掩体逼近守点者，学会在立体空间中找机会。',
    intro: [['旁白', '钟楼的阴影切开广场。高台上有人架起法杖，等待下方的挑战者。'], ['苏沐橙', '站得高不代表安全。不过够不着的时候，别对着空气挥剑。找阶梯，或者换一种进攻。'], ['叶修', '对手看不见的位置也可以成为路线。浮空后沿视角死角追击，就是遮影步。']],
    goal: '利用阶梯与掩体接近钟塔', fightGoal: '清除钟塔的远程守点者', exitGoal: '抵达北侧出口，前往霜桥',
    encounter: ['frostcaster', 'skeleton', 'frostcaster'],
    enemySpawns: [[-8, 2.4, -3], [-2, 0, -12], [0, 1.2, -21]],
    outro: [['苏沐橙', '掩体后面的枪口也会被挡住。准星看见了，身体和武器还得走到能出手的位置。'], ['旁白', '最后一枚冰晶碎裂，遗迹深处的封印亮了起来。']],
  },
  {
    id: 'frostbridge', title: '第三章 · 霜桥封印', level: 'frostbridge',
    summary: '穿越冰霜遗桥，击败守卫，完成一次团队式决战。',
    intro: [['旁白', '霜桥尽头，寒铁守卫缓缓举起长柄战斧。地面的霜纹开始蔓延。'], ['叶修', '先看前摇和地面预警。霸体仍然吃伤害，抓取有机会破掉它；无敌才真正打不到。'], ['苏沐橙', '这一战我陪你。别把所有体力花在追击上，给闪避留余量。']],
    goal: '抵达霜桥尽头的封印', fightGoal: '击败寒铁守卫并解除封印', exitGoal: '抵达桥后封印，完成任务',
    encounter: ['boss'], ally: 'myc',
    outro: [['旁白', '守卫的甲片碎落，封印在风中消散。天光重新落到霜桥上。'], ['叶修', '这才是开始。换一种职业，再走一次，你会看到完全不同的机会。']],
  },
]);
export function storyProgress(value = {}) {
  if (!value || typeof value !== 'object') value = {};
  const cleared = STORY_CHAPTERS.filter(c => Array.isArray(value.cleared) && value.cleared.includes(c.id)).map(c => c.id);
  return { cleared, latest: Math.min(STORY_CHAPTERS.length - 1, cleared.length) };
}
