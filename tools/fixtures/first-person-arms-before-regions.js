// 冻结b2c7d12的两阶段源骨分类，仅用于原行为参考，不由生产代码引用。
// 输入必须是GLB完整原index；不能用已剔Hand后的FP index反推原可见面。
export function referenceFirstPersonArms(mesh, sourceIndex) {
  const {skinIndex:si,skinWeight:sw}=mesh.geometry.attributes,names=mesh.skeleton.bones.map(b=>b.name);
  const bone=index=>{let best=0,weight=-1;for(let k=0;k<4;k++){const w=sw.getComponent(index,k);if(w>weight){weight=w;best=si.getComponent(index,k)}}return names[best]||''};
  const region=index=>{const name=bone(index);return /head|neck/i.test(name)?'head':/Arm|Hand|Shoulder/.test(name)?'arms':'body'};
  const detail=index=>{const name=bone(index);return /Shoulder/.test(name)?'shoulder':/Hand/.test(name)?'hand':'arm'};
  const keep=[];
  for(let at=0;at<sourceIndex.count;at+=3){
    const a=sourceIndex.getX(at),b=sourceIndex.getX(at+1),c=sourceIndex.getX(at+2),ca=region(a),cb=region(b),cc=region(c);
    const majority=ca===cb||ca===cc?ca:cb===cc?cb:'body';if(majority!=='arms')continue;
    const regions=[detail(a),detail(b),detail(c)];if(regions.every(r=>r==='shoulder')||regions.filter(r=>r==='hand').length>=2)continue;
    keep.push(a,b,c);
  }
  return keep;
}
