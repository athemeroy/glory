// 仅独立审计页使用：已认证肩甲皮带154点中，两枚端点误绑前臂。
import * as THREE from 'three';
export function trialSkeletonArmAttachment(body) {
  if (body.model.userData.gloryClass !== 'skeleton') return null;
  const mesh=body.meshes[0],source=mesh.geometry,{position,skinIndex:si,skinWeight:sw}=source.attributes;
  if(!source.index||position.count!==27415)return null;
  const names=mesh.skeleton.bones.map(b=>b.name),arm=names.indexOf('LeftArm'),fore=names.indexOf('LeftForeArm');
  if(arm<0||fore<0)return null;
  body.model.updateMatrixWorld(true);mesh.skeleton.update();
  const point=new THREE.Vector3(),points=new Float32Array(si.count*3),welded=new Uint32Array(si.count),parents=[],cells=new Map();
  for(let i=0;i<si.count;i++){
    mesh.getVertexPosition(i,point).applyMatrix4(mesh.matrixWorld).toArray(points,i*3);
    const key=[point.x,point.y,point.z].map(v=>Math.round(v/.00005)).join(',');let id=cells.get(key);
    if(id===undefined){id=parents.length;parents.push(id);cells.set(key,id)}welded[i]=id;
  }
  const root=i=>{while(parents[i]!==i){parents[i]=parents[parents[i]];i=parents[i]}return i};
  for(let at=0;at<source.index.count;at+=3){const a=root(welded[source.index.getX(at)]),b=root(welded[source.index.getX(at+1)]),c=root(welded[source.index.getX(at+2)]);parents[b]=a;parents[c]=a}
  const parts=new Map();
  for(let i=0;i<si.count;i++){
    const id=root(welded[i]);let part=parts.get(id);if(!part){part={ids:[],min:[Infinity,Infinity,Infinity],max:[-Infinity,-Infinity,-Infinity],arm:0,fore:0};parts.set(id,part)}part.ids.push(i);
    for(let k=0;k<3;k++){part.min[k]=Math.min(part.min[k],points[i*3+k]);part.max[k]=Math.max(part.max[k],points[i*3+k])}
    for(let k=0;k<4;k++){const index=si.getComponent(i,k),weight=sw.getComponent(i,k);if(index===arm)part.arm+=weight;if(index===fore)part.fore+=weight}
  }
  const min=[.2772601,1.2261444,.3323677],max=[.3668101,1.3225829,.3668100];
  const certified=[...parts.values()].filter(p=>p.ids.length===154&&p.min.every((v,k)=>Math.abs(v-min[k])<.003)&&p.max.every((v,k)=>Math.abs(v-max[k])<.003)&&Math.abs(p.arm-152)<1e-5&&Math.abs(p.fore-2)<1e-5);
  if(certified.length!==1)return null;
  const component=certified[0],targets=component.ids.filter(i=>{let w=0;for(let k=0;k<4;k++)if(si.getComponent(i,k)===fore)w+=sw.getComponent(i,k);return w>.99999});
  if(targets.length!==2)return null;
  const indices=new Uint16Array(si.count*4),weights=new Float32Array(sw.count*4),target=new Uint8Array(si.count);
  for(let i=0;i<si.count;i++)for(let k=0;k<4;k++){indices[i*4+k]=si.getComponent(i,k);weights[i*4+k]=sw.getComponent(i,k)}
  for(const i of targets){indices.set([arm,0,0,0],i*4);weights.set([1,0,0,0],i*4);target[i]=1}
  const geometry=new THREE.BufferGeometry();for(const[name,attribute]of Object.entries(source.attributes))geometry.setAttribute(name,attribute);
  geometry.setAttribute('skinIndex',new THREE.Uint16BufferAttribute(indices,4));geometry.setAttribute('skinWeight',new THREE.Float32BufferAttribute(weights,4));geometry.setIndex(source.index);
  geometry.groups=source.groups.map(group=>({...group}));geometry.morphAttributes=source.morphAttributes;geometry.morphTargetsRelative=source.morphTargetsRelative;
  geometry.boundingBox=source.boundingBox?.clone()||null;geometry.boundingSphere=source.boundingSphere?.clone()||null;mesh.geometry=geometry;
  return{componentVertices:component.ids.length,targets,target,component};
}
