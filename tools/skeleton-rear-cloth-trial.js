// 隔离候选：已认证1434点下后披风，只按高度连续跟随躯干，避免x/z残留腿权重裂边。
import * as THREE from 'three';
const smooth=(a,b,v)=>{const t=THREE.MathUtils.clamp((v-a)/(b-a),0,1);return t*t*(3-2*t)};
export function trialSkeletonRearCloth(original,body) {
  if(body.model.userData.gloryClass!=='skeleton')return null;
  const raw=original.meshes[0],mesh=body.meshes[0],source=raw.geometry,current=mesh.geometry,{position,skinIndex:si,skinWeight:sw}=source.attributes;
  if(!source.index||position.count!==27415)return null;
  const names=raw.skeleton.bones.map(b=>b.name),hip=names.indexOf('Hips'),spine=names.indexOf('Spine02');if(hip<0||spine<0)return null;
  original.model.updateMatrixWorld(true);raw.skeleton.update();const point=new THREE.Vector3(),nearest=new THREE.Vector3(),hips=original.bones.Hips.getWorldPosition(new THREE.Vector3()),segments=[];
  for(const side of ['Left','Right'])for(const[a,b]of[['Arm','ForeArm'],['ForeArm','Hand'],['UpLeg','Leg'],['Leg','Foot']])segments.push(new THREE.Line3(original.bones[side+a].getWorldPosition(new THREE.Vector3()),original.bones[side+b].getWorldPosition(new THREE.Vector3())));
  const points=new Float32Array(si.count*3),welded=new Uint32Array(si.count),eligible=new Uint8Array(si.count),cells=new Map(),parents=[];
  for(let i=0;i<si.count;i++){
    raw.getVertexPosition(i,point).applyMatrix4(raw.matrixWorld).toArray(points,i*3);
    const key=[point.x,point.y,point.z].map(v=>Math.round(v/.00005)).join(',');let id=cells.get(key);if(id===undefined){id=parents.length;parents.push(id);cells.set(key,id)}welded[i]=id;
    let armWeight=0,distance=Infinity;for(let k=0;k<4;k++)if(/Arm|Hand/.test(names[si.getComponent(i,k)]))armWeight+=sw.getComponent(i,k);
    for(const segment of segments){segment.closestPointToPoint(point,true,nearest);distance=Math.min(distance,point.distanceTo(nearest))}
    if(point.z<.18&&point.y<1.15&&armWeight<.05&&distance>.18)eligible[i]=1;
  }
  const root=i=>{while(parents[i]!==i){parents[i]=parents[parents[i]];i=parents[i]}return i};
  for(let at=0;at<source.index.count;at+=3){const a=root(welded[source.index.getX(at)]),b=root(welded[source.index.getX(at+1)]),c=root(welded[source.index.getX(at+2)]);parents[b]=a;parents[c]=a}
  const main=root(welded[13648]);if(Array.from(welded,i=>root(i)).filter(i=>i===main).length!==11040)return null;
  for(let i=0;i<eligible.length;i++)if(root(welded[i])!==main)eligible[i]=0;
  const graph=Array.from({length:parents.length},(_,i)=>i),graphRoot=i=>{while(graph[i]!==i){graph[i]=graph[graph[i]];i=graph[i]}return i};
  for(let at=0;at<source.index.count;at+=3){const tri=[source.index.getX(at),source.index.getX(at+1),source.index.getX(at+2)];for(let k=0;k<3;k++){const a=tri[k],b=tri[(k+1)%3];if(eligible[a]&&eligible[b])graph[graphRoot(welded[b])]=graphRoot(welded[a])}}
  const seed=graphRoot(welded[13648]),roi=[],target=new Uint8Array(si.count);for(let i=0;i<si.count;i++)if(eligible[i]&&graphRoot(welded[i])===seed){roi.push(i);target[i]=1}
  if(roi.length!==1434)return null;
  const indices=new Uint16Array(si.count*4),weights=new Float32Array(si.count*4),strength=new Float32Array(si.count),ci=current.attributes.skinIndex,cw=current.attributes.skinWeight;
  for(let i=0;i<si.count;i++)for(let k=0;k<4;k++){indices[i*4+k]=ci.getComponent(i,k);weights[i*4+k]=cw.getComponent(i,k)}
  let changed=0,footVertices=0,trueFootVertices=0;const footSegments=['Left','Right'].map(side=>new THREE.Line3(original.bones[side+'Foot'].getWorldPosition(new THREE.Vector3()),original.bones[side+'ToeBase'].getWorldPosition(new THREE.Vector3())));
  for(const i of roi){
    let footWeight=0;for(let k=0;k<4;k++)if(/Foot|Toe/.test(names[si.getComponent(i,k)]))footWeight+=sw.getComponent(i,k);if(footWeight>=.5){footVertices++;point.fromArray(points,i*3);let distance=Infinity;for(const segment of footSegments){segment.closestPointToPoint(point,true,nearest);distance=Math.min(distance,point.distanceTo(nearest))}if(distance<=.18)trueFootVertices++}
    const y=points[i*3+1],amount=1-smooth(hips.y-.04,hips.y+.12,y),torso=smooth(hips.y-.10,hips.y+.12,y)*.40;if(amount<=1e-6)continue;
    const byBone=new Map();for(let k=0;k<4;k++){const index=si.getComponent(i,k);byBone.set(index,(byBone.get(index)||0)+sw.getComponent(i,k)*(1-amount))}
    byBone.set(hip,(byBone.get(hip)||0)+amount*(1-torso));byBone.set(spine,(byBone.get(spine)||0)+amount*torso);
    const selected=[...byBone].filter(([,w])=>w>1e-8).sort((a,b)=>b[1]-a[1]).slice(0,4),total=selected.reduce((sum,[,w])=>sum+w,0);
    for(let k=0;k<4;k++){indices[i*4+k]=selected[k]?.[0]||0;weights[i*4+k]=selected[k]?selected[k][1]/total:0}strength[i]=amount;changed++;
  }
  const geometry=new THREE.BufferGeometry();for(const[name,attribute]of Object.entries(current.attributes))geometry.setAttribute(name,attribute);
  geometry.setAttribute('skinIndex',new THREE.Uint16BufferAttribute(indices,4));geometry.setAttribute('skinWeight',new THREE.Float32BufferAttribute(weights,4));geometry.setIndex(current.index);
  geometry.groups=current.groups.map(group=>({...group}));geometry.morphAttributes=current.morphAttributes;geometry.morphTargetsRelative=current.morphTargetsRelative;
  geometry.boundingBox=current.boundingBox?.clone()||null;geometry.boundingSphere=current.boundingSphere?.clone()||null;mesh.geometry=geometry;
  const boundaryFaces=[];for(let at=0;at<source.index.count;at+=3){const tri=[source.index.getX(at),source.index.getX(at+1),source.index.getX(at+2)],count=tri.reduce((n,i)=>n+target[i],0);if(count>0&&count<3)boundaryFaces.push(tri)}
  return{roi,targets:roi,target,strength,changed,footVertices,trueFootVertices,boundaryFaces};
}
