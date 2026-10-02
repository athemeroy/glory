// Seeded matches use the real AI, animation, collisions and status rules.
// Rendering/audio are suppressed, so this measures combat rather than frame rate.
export async function checkBalance(app, options = {}) {
  const { CLASSES } = await import('../src/data/classes.js');
  const { hasStatusFlag } = await import('../src/game/statuses.js');
  const g = app.game;
  const seconds = options.seconds || 45, baseSeed = options.seed || 7129;
  const pairs = options.pairs || [
    ['battlemage', 'swordmaster'], ['battlemage', 'striker'], ['battlemage', 'witch'],
    ['witch', 'sharpshooter'], ['witch', 'launcher'], ['witch', 'thug'],
    ['summoner', 'swordmaster'], ['summoner', 'striker'], ['summoner', 'warlock'], ['summoner', 'launcher'],
    ['sharpshooter', 'assassin'], ['sharpshooter', 'berserker'],
    ['launcher', 'striker'], ['launcher', 'warlock'], ['striker', 'berserker'], ['berserker', 'swordmaster'],
    ['cleric', 'summoner'], ['unspecialized', 'battlemage'],
  ];
  app.mode?.dispose(); app.mode = null; g.mode = null; g.paused = true;
  g.clearFighters(); g.loadLevel('arena'); g.inputFrozen = true; g.aiFrozen = false;
  g.sfx = g.shake = () => {};
  g.hud.floatText = () => {};
  for (const name of ['hitSpark', 'statusTarget', 'fire', 'projectileStep', 'areaEvent', 'explosionEvent', 'channelBeam', 'healTarget', 'blinkTrail']) g.vfx[name] = () => true;
  const actionCounts = new Map(), healed = new Map(), whiffs = new Map(), mechanics = new Map(), damageBySkill = new Map();
  const pendingDamage = new WeakMap(), gameplayOnHit = g.onHit.bind(g);
  g.onHit = (att, target, result, hit, def, ...rest) => {
    const damage = pendingDamage.get(target), totals = damageBySkill.get(att);
    if (totals && damage?.hit === hit && damage.src === att) {
      const name = def?.name || def?.anim || '普攻';
      totals['未归因'] -= damage.amount; totals[name] = (totals[name] || 0) + damage.amount;
      pendingDamage.delete(target);
    }
    return gameplayOnHit(att, target, result, hit, def, ...rest);
  };
  // Physical gun recoil belongs to Combat, so this only silences presentation.
  g.onFire = (f, p) => {
    const m = mechanics.get(f); if (!m) return;
    if (p.chaser) m.chasersFired++;
    if (p.summon) m.summonProjectiles++;
  };
  g.onWhiff=(f,def)=>{
    const counts=whiffs.get(f),key=def.name||def.anim;
    if(counts)counts[key]=(counts[key]||0)+1;
  };
  g.onFighterEvent = (f, type, data) => {
    if (type === 'action') {
      const counts = actionCounts.get(f); counts[data.slot] = (counts[data.slot] || 0) + 1;
    }
    if (type === 'chaser' && data.generated && mechanics.has(f)) mechanics.get(f).chasersGenerated++;
    if (type === 'damage' && damageBySkill.has(data.src)) {
      const totals = damageBySkill.get(data.src), key = data.hit?.dot ? '持续伤害' : '未归因';
      totals[key] = (totals[key] || 0) + data.dmg;
      if (!data.hit?.dot) pendingDamage.set(f, { src: data.src, hit: data.hit, amount: data.dmg });
    }
    // Preserve this gameplay responsibility of Game.onFighterEvent, even though
    // its audio, text and screen effects are suppressed in the benchmark.
    if (type === 'death') g.summons.removeOwner(f);
  };
  const savedRandom = Math.random, results = [], invariantErrors = [];
  const finiteVector = v => [v.x, v.y, v.z].every(Number.isFinite);
  const finiteFighter = f => [f.hp, f.mp, f.stamina, f.yaw, f.pitch, f.stateT].every(Number.isFinite) &&
    [f.pos, f.vel, f.knockVel].every(finiteVector) && f.rig.root.matrixWorld.elements.every(Number.isFinite);
  const stamp = performance.now();
  try {
    for (let caseIndex = 0; caseIndex < pairs.length; caseIndex++) {
      for (let swap = 0; swap < 2; swap++) {
        const caseSeed = (baseSeed + caseIndex * 971 + swap * 137) >>> 0;
        let seed = caseSeed;
        Math.random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
        g.clearFighters(); g.time = 0;
        actionCounts.clear(); healed.clear(); whiffs.clear(); mechanics.clear(); damageBySkill.clear();
        const ids = pairs[caseIndex];
        const fighters = ids.map((id, index) => {
          const side = (index === swap ? -1 : 1);
          const f = g.spawn({ cls: { ...CLASSES[id], ...options.classOverrides?.[id] }, clsId: id, name: id, team: index + 1,
            pos: [side * 5, 0, 0], yaw: side < 0 ? Math.PI / 2 : -Math.PI / 2,
            ai: options.diff || 'normal' });
          actionCounts.set(f, {}); healed.set(f, 0);whiffs.set(f,{});
          damageBySkill.set(f, { '未归因': 0 });
          mechanics.set(f, { flightStarts: 0, flightSeconds: 0, maxHeight: 0,
            chasersGenerated: 0, chasersFired: 0, maxChasers: 0, maxWillTier: 0,
            maxSummons: 0, summonSeconds: 0, formationSeconds: 0, summonProjectiles: 0,
            gunDischarges: 0, maxHorizontalKnockSpeed: 0 });
          const heal=f.heal.bind(f);
          f.heal=(...args)=>{const got=heal(...args);healed.set(f,healed.get(f)+got);return got;};
          return f;
        });
        const measures=fighters.map(f=>({controlledSeconds:0,movementLockedSeconds:0,
          maxControlSeconds:0,controlRun:0,manaMin:f.mp,staminaMin:f.stamina,
          manaLowSeconds:0,staminaLowSeconds:0}));
        let elapsed = 0, separation = 0, samples = 0, damageTotal = 0, lastDamageAt = 0, longestNoDamageSeconds = 0;
        const wasFlying = [false, false], finiteThroughout = [true, true], trace = [];
        const snapshot = f => ({ id: f.clsId, pos: f.pos.toArray().map(v=>+v.toFixed(2)), state: f.state,
          yaw: +f.yaw.toFixed(3), pitch: +f.pitch.toFixed(3),
          action: f.action?.def?.name || f.action?.def?.anim || '', target: f.target?.clsId || f.target?.beastKind || null,
          targetVisible: !!f.targetVisible, plan: f.ai?.plan, memory: +(f.ai?.memoryT || 0).toFixed(2),
          move: f.moveInput.toArray().map(v=>+v.toFixed(2)), damage: +f.stats.dmgDealt.toFixed(2) });
        const errorStart = invariantErrors.length;
        for (let frame = 0; frame < seconds * 60; frame++) {
          g.tick(1 / 60); g.vfx.update(1 / 60); elapsed += 1 / 60;
          fighters.forEach((f,index)=>{
            const m=measures[index],controlled=['hitstun','air','down','getup','stun'].includes(f.state)||
              hasStatusFlag(f,'actionLock')||hasStatusFlag(f,'attackLock');
            m.controlRun=controlled?m.controlRun+1/60:0;
            m.controlledSeconds+=controlled?1/60:0;
            m.maxControlSeconds=Math.max(m.maxControlSeconds,m.controlRun);
            m.movementLockedSeconds+=f.movementLocked()?1/60:0;
            m.manaMin=Math.min(m.manaMin,f.mp);m.staminaMin=Math.min(m.staminaMin,f.stamina);
            m.manaLowSeconds+=f.mp<10?1/60:0;m.staminaLowSeconds+=f.stamina<12?1/60:0;
            const mech = mechanics.get(f), pets = g.summons.owned(f);
            mech.flightStarts += f.flightActive && !wasFlying[index] ? 1 : 0;
            wasFlying[index] = f.flightActive;
            mech.flightSeconds += f.flightActive ? 1/60 : 0;
            mech.maxHeight = Math.max(mech.maxHeight, f.pos.y);
            mech.maxChasers = Math.max(mech.maxChasers, f.chasers?.length || 0);
            mech.maxWillTier = Math.max(mech.maxWillTier, f.battleWill?.tier || 0);
            mech.maxSummons = Math.max(mech.maxSummons, pets.length);
            mech.summonSeconds += pets.length/60;
            mech.formationSeconds += pets.some(p => p.formation) ? 1/60 : 0;
            mech.gunDischarges = Math.max(mech.gunDischarges, f._gunFeedback?.serial || 0);
            mech.maxHorizontalKnockSpeed = Math.max(mech.maxHorizontalKnockSpeed, Math.hypot(f.knockVel.x, f.knockVel.z));
          });
          const dealt = fighters.reduce((sum, f) => sum + f.stats.dmgDealt, 0);
          if (dealt > damageTotal) { lastDamageAt = elapsed; damageTotal = dealt; }
          longestNoDamageSeconds = Math.max(longestNoDamageSeconds, elapsed - lastDamageAt);
          if (frame % 60 === 0 || fighters.some(f => f.dead)) {
            if (options.trace) trace.push({ seconds: +elapsed.toFixed(2), fighters: fighters.map(snapshot) });
            separation += fighters[0].pos.distanceTo(fighters[1].pos); samples++;
            fighters.forEach((f, i) => {
              finiteThroughout[i] &&= finiteFighter(f);
              if (f.hp < 0 || f.hp > f.maxHp + 1e-5 || f.mp < -1e-5 || f.mp > f.maxMp + 1e-5 ||
                  f.stamina < -1e-5 || f.stamina > f.maxStamina + 1e-5) invariantErrors.push({ ids, swap, frame, kind: 'resource-bounds', fighter: f.clsId });
            });
            for (const p of g.summons.units) if (![p.hp, p.remaining, p.yaw].every(Number.isFinite) ||
                ![p.pos, p.vel, p.knockVel].every(finiteVector) || !p.owner.alive) {
              invariantErrors.push({ ids, swap, frame, kind: 'summon-state', beast: p.beastKind });
            }
            for (const p of g.combat.projectiles) if (!finiteVector(p.pos) || !finiteVector(p.vel)) {
              invariantErrors.push({ ids, swap, frame, kind: 'projectile-state' });
            }
            if (fighters.some(f => g.summons.owned(f).length > 4)) invariantErrors.push({ ids, swap, frame, kind: 'summon-limit' });
          }
          if (fighters.some(f => f.dead)) break;
          if (frame % 360 === 359) await new Promise(resolve => setTimeout(resolve, 0));
        }
        results.push({ ids, swap, seed: caseSeed, seconds: +elapsed.toFixed(2),
          winner: fighters.find(f => !f.dead && fighters.some(o => o.dead))?.clsId || 'timeout',
          meanDistance: +(separation / samples).toFixed(2),
          longestNoDamageSeconds: +longestNoDamageSeconds.toFixed(2),
          finalNoDamageSeconds: +(elapsed-lastDamageAt).toFixed(2),
          invariantsPassed: invariantErrors.length === errorStart,
          ...(options.trace ? { trace } : {}),
          fighters: fighters.map((f,index) => ({ id: f.clsId, hp: Math.round(f.hp), maxHp: f.maxHp,
            damageMultiplier:f.dmgMul, manaRegenPerSecond:f.mpRegen,
            mp: Math.round(f.mp), stamina: Math.round(f.stamina), healed: Math.round(healed.get(f)),
            control:Object.fromEntries(Object.entries(measures[index]).filter(([key])=>key!=='controlRun').map(([key,value])=>[key,+value.toFixed(2)])),
            mechanics:Object.fromEntries(Object.entries(mechanics.get(f)).map(([key,value])=>[key,+value.toFixed(2)])),
            heroDamageBySkill:Object.fromEntries(Object.entries(damageBySkill.get(f)).filter(([,value])=>value>.01).map(([key,value])=>[key,+value.toFixed(2)])),
            ...f.stats, finalState: snapshot(f), actions: actionCounts.get(f), physicalWhiffs:whiffs.get(f), finite: finiteThroughout[index] && finiteFighter(f) })) });
        g.clearFighters();
        const cleanup = { fighters: g.fighters.length, summons: g.summons.units.length, summonOrders: g.summons.orders.size,
          recentSummons: g.summons.recent.size, projectiles: g.combat.projectiles.length, aoes: g.combat.aoes.length,
          meleeWindows: g.combat.meleeWindows.length };
        results.at(-1).cleanup = cleanup;
        if (Object.values(cleanup).some(Boolean)) invariantErrors.push({ ids, swap, kind: 'cleanup', cleanup });
        await new Promise(resolve => setTimeout(resolve, 0));
      }
    }
  } finally { Math.random = savedRandom; g.clearFighters(); }
  return { rules: `Real animated 3D contact, AI ${options.diff || 'normal'}, ${seconds} simulated seconds per matchup; 2 spawn assignments. Small sample, not a complete win-rate study.`,
    secondsPerCase: seconds, seed: baseSeed, classOverrides: options.classOverrides || {},
    elapsedWallSeconds: +((performance.now() - stamp) / 1000).toFixed(2), invariantErrors, results };
}
