// 隔离审计候选：原index独立47点蓝领口，只改变FP分类，不改变权重。
import * as THREE from 'three';
export function skeletonNeckRootRegion(body) {
  const mesh=body.meshes[0],g=mesh.geometry,{position,skinIndex:si,skinWeight:sw}=g.attributes;
  if(!g.index||position.count!==27415)return null;
  const parents=Uint32Array.from({length:position.count},(_,i)=>i),root=i=>{while(parents[i]!==i){parents[i]=parents[parents[i]];i=parents[i]}return i};
  // 领口在UV/硬法线焊接后会连入11040主体；必须使用原始索引拓扑。
  for(let at=0;at<g.index.count;at+=3){const a=root(g.index.getX(at)),b=root(g.index.getX(at+1)),c=root(g.index.getX(at+2));parents[b]=a;parents[c]=a}
  const component=root(22243),ids=[];for(let i=0;i<position.count;i++)if(root(i)===component)ids.push(i);
  if(ids.length!==47)return null;
  body.model.updateMatrixWorld(true);mesh.skeleton.update();const point=new THREE.Vector3(),min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity],names=mesh.skeleton.bones.map(b=>b.name);
  let neckWeight=0,shoulderWeight=0,maxArmWeight=0,maxDistalWeight=0;
  for(const i of ids){
    mesh.getVertexPosition(i,point).applyMatrix4(mesh.matrixWorld);
    for(let k=0;k<3;k++){const v=point.getComponent(k);min[k]=Math.min(min[k],v);max[k]=Math.max(max[k],v)}
    let arm=0,distal=0;for(let k=0;k<4;k++){const name=names[si.getComponent(i,k)]||'',w=sw.getComponent(i,k);if(/neck/i.test(name))neckWeight+=w;if(/Shoulder/.test(name))shoulderWeight+=w;if(/^(Left|Right)Arm$/.test(name))arm+=w;if(/ForeArm|Hand/.test(name))distal+=w}maxArmWeight=Math.max(maxArmWeight,arm);maxDistalWeight=Math.max(maxDistalWeight,distal);
  }
  const low=[-.1257144,1.4224656,.1670450],high=[.1050489,1.5016826,.3771428];
  if(!min.every((v,k)=>Math.abs(v-low[k])<.003)||!max.every((v,k)=>Math.abs(v-high[k])<.003)||neckWeight/47<.25||shoulderWeight/47<.4||maxArmWeight>.2||maxDistalWeight>1e-6)return null;
  const mask=new Uint8Array(position.count);for(const i of ids)mask[i]=1;
  let crossBoundaryFaces=0;for(let at=0;at<g.index.count;at+=3){const n=mask[g.index.getX(at)]+mask[g.index.getX(at+1)]+mask[g.index.getX(at+2)];if(n>0&&n<3)crossBoundaryFaces++}
  if(crossBoundaryFaces)return null;
  return{mask,sourcePosition:position,component:{count:47,min,max,neckWeight:neckWeight/47,shoulderWeight:shoulderWeight/47,maxArmWeight,maxDistalWeight,crossBoundaryFaces}};
}
