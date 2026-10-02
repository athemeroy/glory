// 在固定模拟步之间插值局部姿势；只用于绘制，绘制后恢复真实模拟结果。
// 镜子和主画面在同一次绘制中看到同一个姿势。
export class RenderPose {
  constructor(nodes) {
    this.samples = [...new Set(nodes)].filter(Boolean).map(node => ({
      node, prevP: node.position.clone(), currP: node.position.clone(),
      prevQ: node.quaternion.clone(), currQ: node.quaternion.clone(),
      prevS: node.scale.clone(), currS: node.scale.clone(),
    }));
  }
  capture() {
    for (const s of this.samples) {
      s.prevP.copy(s.currP); s.prevQ.copy(s.currQ); s.prevS.copy(s.currS);
      s.currP.copy(s.node.position); s.currQ.copy(s.node.quaternion); s.currS.copy(s.node.scale);
    }
  }
  present(alpha) {
    const t = Math.max(0, Math.min(1, alpha));
    for (const s of this.samples) {
      s.node.position.lerpVectors(s.prevP, s.currP, t);
      s.node.quaternion.slerpQuaternions(s.prevQ, s.currQ, t);
      s.node.scale.lerpVectors(s.prevS, s.currS, t);
    }
  }
  restore() {
    for (const s of this.samples) {
      s.node.position.copy(s.currP); s.node.quaternion.copy(s.currQ); s.node.scale.copy(s.currS);
    }
  }
}
