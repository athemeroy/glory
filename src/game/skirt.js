// 已认证的拳法师前披条与魔道学者下袍：同一薄壳截面跟随腰身，保留真人手脚。
import * as THREE from 'three';
import { markSharedResource } from './model.js';

const prepared=new WeakMap();
const profiles={
  striker:{vertices:24429,component:23038,bounds:[-.563131,0,-.198043,.563131,1.76,.198043]},
  witch:{vertices:24650,component:7793,bounds:[-.528689,.340978,-.229041,.528689,1.574012,.229041]},
};
const smooth=(a,b,value)=>{const t=THREE.MathUtils.clamp((value-a)/(b-a),0,1);return t*t*(3-2*t)};

function prepare(mesh,body,classId) {
  const source=mesh.geometry,{position,skinIndex:si,skinWeight:sw}=source.attributes;
  if(!si||!sw||!source.index||!profiles[classId]||position.count!==profiles[classId].vertices)return null;
  const names=mesh.skeleton.bones.map(bone=>bone.name),hip=names.indexOf('Hips');
  if(hip<0||!body.bones.Hips)return null;
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
  const main=[...counts].find(([,count])=>count===profiles[classId].component)?.[0];if(main===undefined)return null;
  const actual=[Infinity,Infinity,Infinity,-Infinity,-Infinity,-Infinity];
  for(let i=0;i<si.count;i++)if(root(welded[i])===main)for(let axis=0;axis<3;axis++){
    actual[axis]=Math.min(actual[axis],points[i*3+axis]);actual[axis+3]=Math.max(actual[axis+3],points[i*3+axis]);
  }
  if(actual.some((value,axis)=>Math.abs(value-profiles[classId].bounds[axis])>.0035))return null;
  const indices=new Uint16Array(si.count*4),weights=new Float32Array(si.count*4),strength=new Float32Array(si.count);
  const amounts=new Float32Array(parent.length).fill(1),nearLimb=new Uint8Array(si.count);
  let changed=0,protectedLimbVertices=0;
  for(let i=0;i<si.count;i++){
    const node=welded[i];
    for(let k=0;k<4;k++){indices[i*4+k]=si.getComponent(i,k);weights[i*4+k]=sw.getComponent(i,k)}
    let amount=0;
    if(root(node)===main){
      point.fromArray(points,i*3);let distance=Infinity,armWeight=0;
      for(const segment of segments){segment.closestPointToPoint(point,true,nearest);distance=Math.min(distance,point.distanceTo(nearest))}
      for(let k=0;k<4;k++)if(/(Arm|Hand|Shoulder)$/.test(names[si.getComponent(i,k)]))armWeight+=sw.getComponent(i,k);
      if(distance<=.13)nearLimb[i]=1;
      // 长手指和袖口可能超过13cm，额外保留其原臂/手影响，避免被低处衣摆域误选。
      // 魔道的该片确认为外袍加原生手：黑裤/靴在其他片。下袍无骨距门槛，原手臂/手仍保护。
      if((classId==='witch'||distance>.13)&&armWeight<=.05){
        const radial=classId==='witch'?1:smooth(.13,.18,distance);
        const lower=smooth(classId==='striker'?.30:.15,classId==='striker'?.48:.30,point.y)*(1-smooth(hips.y-.15,hips.y+.04,point.y));
        const region=classId==='striker'?(1-smooth(.08,.23,Math.abs(point.x-hips.x)))*smooth(-.025,-.010,point.z-(.195-.17*(point.y-.60))):1;
        amount=region*lower*radial;
      }
    }
    amounts[node]=Math.min(amounts[node],amount);
  }
  // 披条内外面只隔几毫米；同x/y近1cm的截面使用同amount，避免沿厚度折返。
  if(classId==='striker'){
    const layers=new Map(),seenNodes=new Set();
    for(let i=0;i<si.count;i++){
      const node=welded[i];if(amounts[node]<=1e-6||seenNodes.has(node))continue;seenNodes.add(node);
      const key=Math.round(points[i*3]/.00005)+':'+Math.round(points[i*3+1]/.00005);
      if(!layers.has(key))layers.set(key,[]);layers.get(key).push({node,z:points[i*3+2]});
    }
    for(const nodes of layers.values()){
      nodes.sort((a,b)=>a.z-b.z);let start=0;
      while(start<nodes.length){let end=start+1;while(end<nodes.length&&nodes[end].z-nodes[start].z<=.01)end++;
        const amount=Math.max(...nodes.slice(start,end).map(({node})=>amounts[node]));
        for(let at=start;at<end;at++)amounts[nodes[at].node]=amount;start=end;
      }
    }
  }
  // 起身时披条上部内/外薄壳需要共同的平滑腰身影响，保留已认证472点范围。
  // .6平台的全部71连续/静态采样已确认不新增折面；不得对整片强行Hips1。
  if(classId==='striker'){
    const seenNodes=new Set(),lowerY=.82,upperY=.91,soft=.08;
    for(let i=0;i<si.count;i++){
      const node=welded[i];if(amounts[node]<=1e-6||seenNodes.has(node))continue;seenNodes.add(node);
      const x=points[i*3],y=points[i*3+1];
      const boost=(1-smooth(.025,.09,Math.abs(x+.014)))*smooth(lowerY-soft,lowerY,y)*(1-smooth(upperY,upperY+soft,y));
      amounts[node]+=boost*(.6-amounts[node]);
    }
  }
  for(let i=0;i<si.count;i++){
    const node=welded[i],amount=amounts[node];if(amount<=1e-6){if(nearLimb[i])protectedLimbVertices++;continue;}
    const byBone=new Map();
    for(let k=0;k<4;k++){const bone=si.getComponent(i,k);byBone.set(bone,(byBone.get(bone)||0)+sw.getComponent(i,k)*(1-amount))}
    byBone.set(hip,(byBone.get(hip)||0)+amount);
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

export function repairSkirtWeights(body,classId) {
  if(!profiles[classId])return null;if(body.skirt?.classId===classId)return body.skirt;
  let changed=0,protectedLimbVertices=0;
  for(const mesh of body.meshes){
    const source=mesh.geometry;let byClass=prepared.get(source);if(!byClass){byClass=new Map();prepared.set(source,byClass);}
    if(!byClass.has(classId))byClass.set(classId,prepare(mesh,body,classId));const result=byClass.get(classId);if(!result)continue;
    mesh.geometry=result.geometry;mesh.userData.skirtStrength=result.strength;changed+=result.changed;protectedLimbVertices+=result.protectedLimbVertices;
  }
  if(!changed)return null;body.skirt={classId,changed,protectedLimbVertices};return body.skirt;
}
