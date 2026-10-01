// 仅用于只读QA候选：不由游戏生产入口导入。
import * as THREE from 'three';
const point=new THREE.Vector3(),part=new THREE.Vector3();
export function trialSkeletonWeights(original,current,bind=null){
  if(current.model.userData.gloryClass!=='skeleton')return null;
  if(!bind){
    original.model.updateMatrixWorld(true);const mesh=original.meshes[0];mesh.skeleton.update();
    const points=new Float32Array(mesh.geometry.attributes.position.count*3);
    for(let i=0;i<points.length/3;i++)mesh.getVertexPosition(i,point).applyMatrix4(mesh.matrixWorld).toArray(points,i*3);
    bind={points};
  }
  const mesh=current.meshes[0],source=original.meshes[0].geometry,g=mesh.geometry,count=source.attributes.position.count;
  if(count!==27415)throw Error('骸骨网格版本变化，试验须重新认证');
  const names=mesh.skeleton.bones.map(bone=>bone.name),hip=names.indexOf('Hips'),welded=new Uint32Array(count),parent=[],cells=new Map();
  const root=i=>{while(parent[i]!==i){parent[i]=parent[parent[i]];i=parent[i]}return i};
  for(let i=0;i<count;i++){
    const key=[0,1,2].map(k=>Math.round(bind.points[i*3+k]/.00005)).join(',');let node=cells.get(key);
    if(node===undefined){node=parent.length;parent.push(node);cells.set(key,node)}welded[i]=node;
  }
  for(let i=0;i<source.index.count;i+=3){const a=root(welded[source.index.getX(i)]),b=root(welded[source.index.getX(i+1)]),c=root(welded[source.index.getX(i+2)]);parent[b]=a;parent[c]=a}
  const components=new Map();for(let i=0;i<count;i++){const id=root(welded[i]);if(!components.has(id))components.set(id,[]);components.get(id).push(i)}
  const skirt=[...components.values()].find(ids=>{
    if(ids.length!==1860)return false;
    const bounds=[Infinity,Infinity,Infinity,-Infinity,-Infinity,-Infinity];for(const i of ids)for(let k=0;k<3;k++){bounds[k]=Math.min(bounds[k],bind.points[i*3+k]);bounds[k+3]=Math.max(bounds[k+3],bind.points[i*3+k])}
    return bounds.every((value,k)=>Math.abs(value-[-.3151468,.1515451,.0774960,.3668103,1.0608220,.4976900][k])<.003);
  });
  if(!skirt)throw Error('未找到已认证1860顶点独立破裙片');
  const si=source.attributes.skinIndex,sw=source.attributes.skinWeight,indices=g.attributes.skinIndex.array.slice(),weights=g.attributes.skinWeight.array.slice(),target=new Uint8Array(count),hands=[];
  for(let i=0;i<count;i++)for(const side of ['Left','Right']){
    const hand=names.indexOf(side+'Hand');let weight=0;for(let k=0;k<4;k++)if(si.getComponent(i,k)===hand)weight+=sw.getComponent(i,k);
    if(weight<.98)continue;
    mesh.skeleton.bones[hand].getWorldPosition(point);if(point.distanceTo(part.fromArray(bind.points,i*3))>.22)continue;
    for(let k=0;k<4;k++){indices[i*4+k]=si.getComponent(i,k);weights[i*4+k]=sw.getComponent(i,k)}target[i]=1;hands.push(i);break;
  }
  for(const i of skirt){indices.set([hip,0,0,0],i*4);weights.set([1,0,0,0],i*4);target[i]=2}
  const geometry=new THREE.BufferGeometry();for(const[name,attribute]of Object.entries(g.attributes))geometry.setAttribute(name,attribute);
  geometry.setAttribute('skinIndex',new THREE.Uint16BufferAttribute(indices,4));geometry.setAttribute('skinWeight',new THREE.Float32BufferAttribute(weights,4));geometry.setIndex(g.index);geometry.groups=g.groups.map(group=>({...group}));
  mesh.geometry=geometry;
  mesh.userData.reactionTrial=target;
  return {target,hands,skirt};
}
