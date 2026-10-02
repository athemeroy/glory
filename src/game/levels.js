// 关卡入口。接口见 ARCHITECTURE.md「关卡接口」。
// buildLevel(id, ctx) -> { id, name, group, colliders, bounds, spawns, markers, sun, background, fog, mirrors, update, dispose, ... }
// ctx = { THREE, renderer, tex(name), quality: 'high'|'low' }；ctx.tex 返回的贴图最好已加载完成（用于旗帜画布与环境图烘焙）。
import { buildTraining } from './levels/training.js';
import { buildCourtyard } from './levels/courtyard.js';
import { buildColdiron } from './levels/coldiron.js';
import { buildArena } from './levels/arena.js';
import { buildClocktower } from './levels/clocktower.js';
import { buildFrostbridge } from './levels/frostbridge.js';

const BUILDERS = {
  training: buildTraining,
  courtyard: buildCourtyard,
  coldiron: buildColdiron,
  arena: buildArena,
  clocktower: buildClocktower,
  frostbridge: buildFrostbridge,
};

export const LEVEL_IDS = Object.keys(BUILDERS);

export function buildLevel(id, ctx) {
  const fn = BUILDERS[id];
  if (!fn) throw new Error('未知关卡: ' + id);
  const level = fn(ctx);
  level.group.updateMatrixWorld(true);
  return level;
}
