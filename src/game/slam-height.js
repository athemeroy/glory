// Per-cast drop distance. Landing on a raised platform uses that platform's
// real elevation; flight/height cannot multiply a shared global skill object.
export function prepareHeightSlam(def, fighter) {
  if (!def.heightSlam) return def;
  return { ...def, _startHeight: fighter.pos.y, hits: def.hits.map(h => ({ ...h })) };
}
export function trackHeightSlam(fighter, action) {
  if (!action?.def.heightSlam || action.landed) return;
  action.slamPeakY = Math.max(action.slamPeakY ?? action.def._startHeight ?? fighter.pos.y, fighter.pos.y);
}
export function landHeightSlam(fighter, action) {
  const rule = action?.def.heightSlam;
  if (!rule || action.heightSlamApplied) return;
  action.heightSlamApplied = true;
  const height = Math.min(rule.maxHeight ?? 6, Math.max(0, (action.slamPeakY ?? action.def._startHeight ?? fighter.pos.y) - fighter.pos.y));
  action.slamDrop = height;
  for (const hit of action.def.hits) {
    hit.range = Math.min(rule.maxRadius ?? 4.5, hit.range + height * (rule.radiusPerMeter ?? .35));
    hit.dmg = Math.round(hit.dmg * (1 + height * (rule.damagePerMeter ?? .14)));
    hit.knock = Math.min(8, (hit.knock || 0) + height * .45);
  }
}
