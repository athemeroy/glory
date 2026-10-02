// 只缓存静态权重选出的脚部顶点编号；所有坐标与实例骨架仍现算。
// 已认证服饰mask必须只读；同一数组原地改内容不属于此缓存合同。
const cache = new WeakMap();
const maskKeys = [
  'clothProtectedLimbMask', 'clothStrength', 'attachmentStrength', 'attachmentComponent',
  'firstPersonHeadMask', 'clericWeightMask', 'sleeveStrength', 'sleeveComponent',
  'robeStrength', 'skirtStrength',
];

function attributeState(attribute) {
  const data = attribute.data, array = attribute.array ?? data?.array;
  return [attribute.constructor, attribute.version, data, data?.version, array, array?.constructor,
    attribute.itemSize, attribute.count, attribute.normalized, attribute.offset, data?.stride];
}

export function cachedFootIndices(mesh, side) {
  const { position, skinIndex, skinWeight } = mesh.geometry.attributes;
  const names = mesh.skeleton.bones.map(bone => bone.name);
  const state = [skinWeight, position.count, JSON.stringify(names),
    ...attributeState(skinIndex), ...attributeState(skinWeight),
    ...maskKeys.map(key => mesh.userData[key])];
  let entry = cache.get(skinIndex);
  if (!entry || entry.state.some((value, i) => value !== state[i])) {
    entry = { state, picks: {} };
    cache.set(skinIndex, entry);
  }
  if (side in entry.picks) return entry.picks[side];
  const boneIndices = new Set(names.map((name, i) => name.startsWith(side) && /Foot|Toe/.test(name) ? i : -1).filter(i => i >= 0));
  if (!boneIndices.size) return entry.picks[side] = null;
  const selected = [];
  for (let i = 0; i < position.count; i++) {
    if (mesh.userData.skirtStrength?.[i] > 0) continue;
    let weight = 0;
    for (let k = 0; k < 4; k++) if (boneIndices.has(skinIndex.getComponent(i, k))) weight += skinWeight.getComponent(i, k);
    if (weight < 0.5) continue;
    selected.push(i);
  }
  return entry.picks[side] = Uint32Array.from(selected);
}
