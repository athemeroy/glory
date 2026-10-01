// 牧师原绑骨漏掉整条脊柱，并把衣袍、胸条和右袖错误分配给头/异侧肢体。
// 只重建已审计衣装片；独立真实手、腿脚和头部保持原绑定。
import * as THREE from 'three';
import { markSharedResource } from './model.js';
import { sampleArmWeights } from './sleeve.js';

const prepared = new WeakMap();
const smooth = (a,b,value) => { const t=THREE.MathUtils.clamp((value-a)/(b-a),0,1);return t*t*(3-2*t); };

function prepare(mesh,body) {
  const source=mesh.geometry,{position,skinIndex:si,skinWeight:sw}=source.attributes;
  if (!si || !sw || !source.index || position.count!==27026) return null;
  const names=mesh.skeleton.bones.map(bone=>bone.name),point=new THREE.Vector3(),points=new Float32Array(position.count*3);
  const cells=new Map(),parent=[],welded=new Uint32Array(position.count);
  mesh.skeleton.update();
  for(let i=0;i<position.count;i++) {
    mesh.getVertexPosition(i,point).applyMatrix4(mesh.matrixWorld);point.toArray(points,i*3);
    const key=[point.x,point.y,point.z].map(value=>Math.round(value/.00005)).join(',');
    let id=cells.get(key);if(id===undefined){id=parent.length;parent.push(id);cells.set(key,id)}welded[i]=id;
  }
  const root=id=>{while(parent[id]!==id){parent[id]=parent[parent[id]];id=parent[id]}return id};
  const index=source.index;
  for(let i=0;i<index.count;i+=3){const a=root(welded[index.getX(i)]),b=root(welded[index.getX(i+1)]),c=root(welded[index.getX(i+2)]);parent[b]=a;parent[c]=a}
  const components=new Map();
  for(let i=0;i<position.count;i++){
    const id=root(welded[i]);let component=components.get(id);
    if(!component){component={count:0,min:new THREE.Vector3(Infinity,Infinity,Infinity),max:new THREE.Vector3(-Infinity,-Infinity,-Infinity)};components.set(id,component)}
    component.count++;point.fromArray(points,i*3);component.min.min(point);component.max.max(point);
  }
  const main=[...components].find(([,c])=>c.count===15258&&c.min.y>.18&&c.min.y<.22&&c.max.y>1.74)?.[0];
  const authentic=[...components.values()].filter(c=>[1135,1096,1115,1148].includes(c.count));
  if(main===undefined || authentic.length!==4) return null;
  const torso=['Hips','Spine02','Spine01','Spine','neck'].map(name=>({index:names.indexOf(name),position:body.bones[name]?.getWorldPosition(new THREE.Vector3())}));
  if(torso.some(entry=>entry.index<0||!entry.position))return null;
  torso.sort((a,b)=>a.position.y-b.position.y);
  const hips=torso[0].position,neck=body.bones.neck.getWorldPosition(new THREE.Vector3());
  const chest=torso.filter(entry=>names[entry.index]!=='neck').at(-1).index;
  const arms=[];
  for(const [side,sign] of [['Left',1],['Right',-1]]) {
    const bones=['Arm','ForeArm','Hand'].map(name=>body.bones[side+name]);if(bones.some(bone=>!bone))return null;
    const positions=bones.map(bone=>bone.getWorldPosition(new THREE.Vector3()));
    arms.push({sign,arm:positions[0],elbow:positions[1],wrist:positions[2],indices:['Arm','ForeArm','Hand'].map(name=>names.indexOf(side+name))});
  }
  const ornaments=new Map();
  for(const [id,c]of components){
    if([481,444].includes(c.count)&&c.min.y>1.08&&c.max.y<1.41&&c.min.z>.15&&c.max.z<.23&&c.max.x-c.min.x<.10)ornaments.set(id,'chest');
    if(c.count===42&&c.min.y>1.12&&c.max.y<1.15&&c.min.z>.16&&c.max.x<0)ornaments.set(id,'waist');
  }
  const indices=new Uint16Array(si.count*4),weights=new Float32Array(sw.count*4),mask=new Uint8Array(si.count);
  let changed=0,mainChanged=0,ornamentChanged=0;
  const torsoWeights=y=>{
    if(y<=torso[0].position.y)return new Map([[torso[0].index,1]]);
    for(let i=0;i<torso.length-1;i++)if(y<torso[i+1].position.y){const amount=smooth(torso[i].position.y,torso[i+1].position.y,y);return new Map([[torso[i].index,1-amount],[torso[i+1].index,amount]])}
    return new Map([[torso.at(-1).index,1]]);
  };
  for(let i=0;i<si.count;i++){
    for(let k=0;k<4;k++){indices[i*4+k]=si.getComponent(i,k);weights[i*4+k]=sw.getComponent(i,k)}
    const component=root(welded[i]),ornament=ornaments.get(component);
    if(component!==main&&!ornament)continue;
    point.fromArray(points,i*3);let desired,amount=1;
    if(ornament==='chest')desired=new Map([[chest,1]]);
    else if(ornament==='waist')desired=new Map([[names.indexOf('Hips'),.25],[names.indexOf('Spine02'),.75]]);
    else {
      // 头脸与发型退出，肩部披领仍跟随胸肩。近腿的主片下摆是袍料，不当作小腿。
      amount=1-smooth(neck.y+.055,neck.y+.10,point.y);
      if(amount<=1e-6)continue;
      desired=torsoWeights(point.y);
      const chain=arms.find(arm=>arm.sign*(point.x-hips.x)>0),sample=chain&&sampleArmWeights(point,chain);
      // 宽袖必须沿整个截面跟随同一骨链；按半径退出会把袖背错误留在胸口。
      const shoulder=smooth(hips.y+.03,hips.y+.18,point.y);
      const sideDistance=Math.abs(point.x-hips.x);
      const lowTorso=1-(1-smooth(.20,.28,sideDistance))*(1-smooth(hips.y-.12,hips.y+.14,point.y));
      const armAmount=smooth(.10-.08*shoulder,.38-.08*shoulder,sideDistance)*smooth(hips.y-.16,hips.y-.09,point.y)*lowTorso;
      if(armAmount>0&&sample){
        for(const [bone,weight]of desired)desired.set(bone,weight*(1-armAmount));
        for(let k=0;k<3;k++)desired.set(chain.indices[k],(desired.get(chain.indices[k])||0)+armAmount*sample.weights[k]);
      }
    }
    const byBone=new Map();
    for(let k=0;k<4;k++){const bone=si.getComponent(i,k);byBone.set(bone,(byBone.get(bone)||0)+sw.getComponent(i,k)*(1-amount))}
    for(const [bone,weight]of desired)byBone.set(bone,(byBone.get(bone)||0)+weight*amount);
    const selected=[...byBone].filter(([,weight])=>weight>1e-8).sort((a,b)=>b[1]-a[1]).slice(0,4),total=selected.reduce((sum,[,weight])=>sum+weight,0);
    for(let k=0;k<4;k++){indices[i*4+k]=selected[k]?.[0]||0;weights[i*4+k]=selected[k]?selected[k][1]/total:0}
    mask[i]=1;changed++;if(ornament)ornamentChanged++;else mainChanged++;
  }
  if(!changed)return null;
  const geometry=new THREE.BufferGeometry();
  for(const [name,attribute]of Object.entries(source.attributes))geometry.setAttribute(name,attribute);
  geometry.setAttribute('skinIndex',markSharedResource(new THREE.Uint16BufferAttribute(indices,4)));
  geometry.setAttribute('skinWeight',markSharedResource(new THREE.Float32BufferAttribute(weights,4)));
  geometry.setIndex(source.index);geometry.groups=source.groups.map(group=>({...group}));
  geometry.morphAttributes=source.morphAttributes;geometry.morphTargetsRelative=source.morphTargetsRelative;
  geometry.boundingBox=source.boundingBox?.clone()||null;geometry.boundingSphere=source.boundingSphere?.clone()||null;markSharedResource(geometry);
  return {geometry,mask,changed,mainChanged,ornamentChanged};
}

export function repairClericWeights(body,classId) {
  if(classId!=='cleric')return null;
  if(body.clericWeights)return body.clericWeights;
  let changed=0,mainChanged=0,ornamentChanged=0;
  const frame=['Hips','Spine02','Spine01','Spine','neck','LeftArm','LeftForeArm','LeftHand','RightArm','RightForeArm','RightHand']
    .map(name=>body.bones[name]?.getWorldPosition(new THREE.Vector3()).toArray().join(',')).join(';');
  for(const mesh of body.meshes){
    const source=mesh.geometry;let variants=prepared.get(source);
    if(!variants){variants=new Map();prepared.set(source,variants)}
    if(!variants.has(frame))variants.set(frame,prepare(mesh,body));
    const result=variants.get(frame);if(!result)continue;
    mesh.geometry=result.geometry;mesh.userData.clericWeightMask=result.mask;
    changed+=result.changed;mainChanged+=result.mainChanged;ornamentChanged+=result.ornamentChanged;
  }
  if(!changed)return null;
  body.clericWeights={changed,mainChanged,ornamentChanged};return body.clericWeights;
}
