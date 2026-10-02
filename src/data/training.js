// 每个职业只显示能用自身机制完成的训练目标。
export function trainingGoals(f) {
  const goals = [{ id: 'basic', text: '用普攻命中木桩，观察命中反馈' }];
  if (f.clsId === 'witch') goals.push({ id: 'flight', text: '空中再次跳跃骑帚，并平稳落地' }, { id: 'aircast', text: '骑帚飞行时命中木桩' });
  else if (f.clsId === 'summoner') goals.push({ id: 'summon', text: '召出两种不同的召唤兽' }, { id: 'command', text: '用印记指挥集火、跟随或部署' }, { id: 'formation', text: '四兽齐备后发动兽王四元素阵' });
  else if (f.clsId === 'battlemage') goals.push({ id: 'chaser', text: '用龙牙或天击命中，生成炫纹' }, { id: 'chaserhit', text: '再次命中后，用职业特技发射炫纹' }, { id: 'will', text: '打出十连击，提升斗者意志' });
  else if (f.clsId === 'sharpshooter' || f.clsId === 'launcher') goals.push({ id: 'airshot', text: '跳起射击，体会飞枪 / 飞炮后坐力' }, { id: 'aimshot', text: '按住瞄准后命中木桩' });
  else {
    const launch = Object.values(f.cls.skills || {}).find(d => d.hits?.some(h => h.launch) || d.proj?.some(p => p.launch || p.explode?.launch));
    if (launch) goals.push({ id: 'launch', text: `用${launch.name}把木桩挑上天` }, { id: 'air', text: '在木桩浮空时继续命中' });
    else goals.push({ id: 'skillhit', text: '用职业技能命中木桩' });
    goals.push({ id: 'ult', text: '释放技能栏最后一项招式' });
  }
  goals.push({ id: 'stamina', text: '疾跑后停下，等体力恢复' }, { id: 'mirror', text: '到镜子前换装，观察完整动作' }, { id: 'spar', text: '在暂停菜单添加陪练，并击败它' });
  return goals;
}
