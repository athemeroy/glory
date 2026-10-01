// 狂剑士护腿/后披条独立候选；不由游戏生产入口导入。
import * as THREE from 'three';
const point=new THREE.Vector3(),part=new THREE.Vector3();
export function trialBerserkerWeights(original,current,capeBone=null,bind=null){
  if(current.model.userData.gloryClass!=='berserker')return null;
  if(!bind){
    original.model.updateMatrixWorld(true);const mesh=original.meshes[0];mesh.skeleton.update();
    const points=new Float32Array(mesh.geometry.attributes.position.count*3);
    for(let i=0;i<points.length/3;i++)mesh.getVertexPosition(i,point).applyMatrix4(mesh.matrixWorld).toArray(points,i*3);
    bind={points};
  }
  const mesh=current.meshes[0],source=original.meshes[0].geometry,g=mesh.geometry,count=source.attributes.position.count;
  if(count!==27036)throw Error('狂剑士网格版本变化，试验须重新认证');
  const names=mesh.skeleton.bones.map(bone=>bone.name),welded=new Uint32Array(count),parent=[],cells=new Map();
  const root=i=>{while(parent[i]!==i){parent[i]=parent[parent[i]];i=parent[i]}return i};
  for(let i=0;i<count;i++){
    const key=[0,1,2].map(k=>Math.round(bind.points[i*3+k]/.00005)).join(',');let node=cells.get(key);
    if(node===undefined){node=parent.length;parent.push(node);cells.set(key,node)}welded[i]=node;
  }
  for(let i=0;i<source.index.count;i+=3){const a=root(welded[source.index.getX(i)]),b=root(welded[source.index.getX(i+1)]),c=root(welded[source.index.getX(i+2)]);parent[b]=a;parent[c]=a}
  const components=new Map();for(let i=0;i<count;i++){const id=root(welded[i]);if(!components.has(id))components.set(id,[]);components.get(id).push(i)}
  const profiles=[
    {count:571,bounds:[-.3736989,.0895500,-.0223863,-.1326030,.5407437,.2083758],kind:1},
    {count:563,bounds:[.1326027,.0826612,-.0189433,.3840312,.5372993,.2083757],kind:1},
    {count:1285,bounds:[.1188258,.7542857,-.3530328,.4391389,1.5326807,.0912720],kind:2},
  ];
  const certified=profiles.map(profile=>{
    const ids=[...components.values()].find(ids=>{
      if(ids.length!==profile.count)return false;
      const bounds=[Infinity,Infinity,Infinity,-Infinity,-Infinity,-Infinity];
      for(const i of ids)for(let k=0;k<3;k++){bounds[k]=Math.min(bounds[k],bind.points[i*3+k]);bounds[k+3]=Math.max(bounds[k+3],bind.points[i*3+k])}
      return bounds.every((v,k)=>Math.abs(v-profile.bounds[k])<.0035);
    });
    if(!ids)throw Error('未找到已认证组件 '+profile.count);return {...profile,ids};
  });
  const si=source.attributes.skinIndex,sw=source.attributes.skinWeight,indices=g.attributes.skinIndex.array.slice(),weights=g.attributes.skinWeight.array.slice(),target=new Uint8Array(count),boots=[],cape=[],strength=mesh.userData.clothStrength.slice();
  for(const component of certified){
    if(component.kind===2&&!capeBone)continue;
    const anchor=names.indexOf(capeBone);if(component.kind===2&&anchor<0)throw Error('未知披条骨 '+capeBone);
    for(const i of component.ids){
      if(component.kind===1){for(let k=0;k<4;k++){indices[i*4+k]=si.getComponent(i,k);weights[i*4+k]=sw.getComponent(i,k)}boots.push(i);strength[i]=0}
      else {indices.set([anchor,0,0,0],i*4);weights.set([1,0,0,0],i*4);cape.push(i);strength[i]=1}
      target[i]=component.kind;
    }
  }
  const geometry=new THREE.BufferGeometry();for(const[name,attribute]of Object.entries(g.attributes))geometry.setAttribute(name,attribute);
  geometry.setAttribute('skinIndex',new THREE.Uint16BufferAttribute(indices,4));geometry.setAttribute('skinWeight',new THREE.Float32BufferAttribute(weights,4));geometry.setIndex(g.index);geometry.groups=g.groups.map(group=>({...group}));
  mesh.geometry=geometry;
  mesh.userData.clothStrength=strength;mesh.userData.berserkerTrial=target;
  return {target,boots,cape,capeBone};
}
