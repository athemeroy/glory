// 战斗法师外袍侧摆的局部错绑；全身连通片里不能把真人腿脚一起当衣料。
import * as THREE from 'three';
import { markSharedResource } from './model.js';

const prepared=new WeakMap();
const smooth=(a,b,value)=>{const t=THREE.MathUtils.clamp((value-a)/(b-a),0,1);return t*t*(3-2*t)};

function prepare(mesh,body) {
  const source=mesh.geometry,{position,skinIndex:si,skinWeight:sw}=source.attributes;
  if(!si||!sw||!source.index||position.count!==26925)return null;
  const names=mesh.skeleton.bones.map(bone=>bone.name),hip=names.indexOf('Hips'),spine=names.indexOf('Spine02');
  if(hip<0||spine<0||!body.bones.Hips)return null;
  const hips=body.bones.Hips.getWorldPosition(new THREE.Vector3()),segments=[];
  for(const side of ['Left','Right'])for(const [a,b]of [['Arm','ForeArm'],['ForeArm','Hand'],['UpLeg','Leg'],['Leg','Foot'],['Foot','ToeBase']]) {
    const start=body.bones[side+a],end=body.bones[side+b];if(start&&end)segments.push(new THREE.Line3(start.getWorldPosition(new THREE.Vector3()),end.getWorldPosition(new THREE.Vector3())));
  }
  if(segments.length!==10)return null;
  const point=new THREE.Vector3(),nearest=new THREE.Vector3(),points=new Float32Array(si.count*3),cells=new Map(),parent=[],welded=new Uint32Array(si.count);
  mesh.skeleton.update();
  for(let i=0;i<si.count;i++){
    mesh.getVertexPosition(i,point).applyMatrix4(mesh.matrixWorld).toArray(points,i*3);
    const key=[point.x,point.y,point.z].map(value=>Math.round(value/.00005)).join(',');let id=cells.get(key);
    if(id===undefined){id=parent.length;parent.push(id);cells.set(key,id)}welded[i]=id;
  }
  const root=id=>{while(parent[id]!==id){parent[id]=parent[parent[id]];id=parent[id]}return id};
  for(let i=0;i<source.index.count;i+=3){const a=root(welded[source.index.getX(i)]),b=root(welded[source.index.getX(i+1)]),c=root(welded[source.index.getX(i+2)]);parent[b]=a;parent[c]=a}
  const counts=new Map();for(let i=0;i<si.count;i++){const id=root(welded[i]);counts.set(id,(counts.get(id)||0)+1)}
  const main=[...counts].find(([,count])=>count===24107)?.[0];if(main===undefined)return null;
  const indices=new Uint16Array(si.count*4),weights=new Float32Array(si.count*4),strength=new Float32Array(si.count);
  const nodeCount=parent.length,boneCount=names.length,original=new Float64Array(nodeCount*boneCount),members=new Uint32Array(nodeCount),amounts=new Float32Array(nodeCount).fill(1),neighbors=Array.from({length:nodeCount},()=>new Set());
  let changed=0,protectedLimbVertices=0;
  for(let i=0;i<si.count;i++){
    const node=welded[i];members[node]++;
    for(let k=0;k<4;k++){indices[i*4+k]=si.getComponent(i,k);weights[i*4+k]=sw.getComponent(i,k);original[node*boneCount+si.getComponent(i,k)]+=sw.getComponent(i,k)}
    let amount=0;
    if(root(node)===main){
      point.fromArray(points,i*3);let distance=Infinity,armWeight=0;
      for(const segment of segments){segment.closestPointToPoint(point,true,nearest);distance=Math.min(distance,point.distanceTo(nearest))}
      for(let k=0;k<4;k++)if(/(Arm|Hand|Shoulder)$/.test(names[si.getComponent(i,k)]))armWeight+=sw.getComponent(i,k);
      if(distance<=.13)protectedLimbVertices++;
      // 长手指和袖口可能超过13cm，额外保留其原臂/手影响，避免被低处衣摆域误选。
      if(distance>.13&&armWeight<=.05){
        const side=smooth(.19,.29,Math.abs(point.x-hips.x));
        const depth=1-smooth(.09,.20,point.z);
        const lower=smooth(.06,.16,point.y)*(1-smooth(hips.y-.12,hips.y+.04,point.y));
        amount=side*depth*lower*smooth(.13,.22,distance);
      }
    }
    amounts[node]=Math.min(amounts[node],amount);
  }
  for(let node=0;node<nodeCount;node++)for(let bone=0;bone<boneCount;bone++)original[node*boneCount+bone]/=members[node];
  for(let i=0;i<source.index.count;i+=3){
    const nodes=[welded[source.index.getX(i)],welded[source.index.getX(i+1)],welded[source.index.getX(i+2)]];
    for(const [a,b]of [[nodes[0],nodes[1]],[nodes[1],nodes[2]],[nodes[2],nodes[0]]])if(a!==b){neighbors[a].add(b);neighbors[b].add(a)}
  }
  const mutable=[];for(let node=0;node<nodeCount;node++)if(amounts[node]>1e-6&&neighbors[node].size)mutable.push(node);
  // 沿真实三角邻域平滑原影响；保持边界原绑，避免整片改挂腰后在腿边造出新裂口。
  let field=original.slice(),next=original.slice();
  for(let step=0;step<40;step++){
    for(const node of mutable){
      const adjacent=neighbors[node],base=node*boneCount;
      for(let bone=0;bone<boneCount;bone++){
        let sum=0;for(const neighbor of adjacent)sum+=field[neighbor*boneCount+bone];
        next[base+bone]=.03*original[base+bone]+.97*sum/adjacent.size;
      }
    }
    [field,next]=[next,field];
  }
  for(let i=0;i<si.count;i++){
    const node=welded[i],amount=amounts[node];if(amount<=1e-6)continue;
    const byBone=new Map();
    for(let k=0;k<4;k++){const bone=si.getComponent(i,k);byBone.set(bone,(byBone.get(bone)||0)+sw.getComponent(i,k)*(1-amount))}
    for(let bone=0;bone<boneCount;bone++)if(field[node*boneCount+bone]>1e-8)byBone.set(bone,(byBone.get(bone)||0)+field[node*boneCount+bone]*amount);
    const selected=[...byBone].filter(([,weight])=>weight>1e-8).sort((a,b)=>b[1]-a[1]).slice(0,4),total=selected.reduce((sum,[,weight])=>sum+weight,0);
    for(let k=0;k<4;k++){indices[i*4+k]=selected[k]?.[0]||0;weights[i*4+k]=selected[k]?selected[k][1]/total:0}
    strength[i]=amount;changed++;
  }
  if(!changed)return null;
  const geometry=new THREE.BufferGeometry();for(const [name,attribute]of Object.entries(source.attributes))geometry.setAttribute(name,attribute);
  geometry.setAttribute('skinIndex',markSharedResource(new THREE.Uint16BufferAttribute(indices,4)));geometry.setAttribute('skinWeight',markSharedResource(new THREE.Float32BufferAttribute(weights,4)));
  geometry.setIndex(source.index);geometry.groups=source.groups.map(group=>({...group}));geometry.morphAttributes=source.morphAttributes;geometry.morphTargetsRelative=source.morphTargetsRelative;
  geometry.boundingBox=source.boundingBox?.clone()||null;geometry.boundingSphere=source.boundingSphere?.clone()||null;markSharedResource(geometry);
  return {geometry,strength,changed,protectedLimbVertices};
}

export function repairRobeWeights(body,classId) {
  if(classId!=='battlemage')return null;if(body.robe)return body.robe;
  let changed=0,protectedLimbVertices=0;
  for(const mesh of body.meshes){const source=mesh.geometry;if(!prepared.has(source))prepared.set(source,prepare(mesh,body));const result=prepared.get(source);if(!result)continue;
    mesh.geometry=result.geometry;mesh.userData.robeStrength=result.strength;changed+=result.changed;protectedLimbVertices+=result.protectedLimbVertices;
  }
  if(!changed)return null;body.robe={classId,changed,protectedLimbVertices};return body.robe;
}
