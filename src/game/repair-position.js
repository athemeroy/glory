// Offline Blender polish retains its original sculpt positions for deterministic
// clothing/component identification. Rendering and collision use POSITION.
export function getRepairPosition(mesh, index, target) {
  const original = mesh.geometry.attributes._glory_repair_position;
  if (!original) return mesh.getVertexPosition(index, target);
  target.fromBufferAttribute(original, index);
  if (mesh.isSkinnedMesh) mesh.applyBoneTransform(index, target);
  return target;
}
