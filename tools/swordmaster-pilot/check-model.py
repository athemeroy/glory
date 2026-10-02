"""Capture the live comparison and measure finite skinning over motion cycles."""
import argparse
import json
from pathlib import Path
from playwright.sync_api import sync_playwright
p=argparse.ArgumentParser();p.add_argument('base');p.add_argument('output',type=Path);p.add_argument('--full',action='store_true');a=p.parse_args();a.output.mkdir(parents=True,exist_ok=True)
with sync_playwright() as pw:
    b=pw.chromium.launch(channel='chrome',headless=True,args=['--ignore-gpu-blocklist','--enable-gpu','--use-angle=metal'])
    page=b.new_page(viewport={'width':1600,'height':1000});errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
    page.goto(a.base+'/tools/swordmaster-pilot/compare.html?freeze=1',wait_until='domcontentloaded')
    page.wait_for_function('window.__ready',timeout=90000);page.wait_for_load_state('networkidle')
    page.screenshot(path=str(a.output/'models.png'))
    reports=[]
    for pose in ['run','pilotRise','pilotSweep','pilotChop']:
        report=page.evaluate('''({pose,full})=>{
            const c=window.__compare;c.setPose(pose);let nonfinite=0,maxEdge=0,maxDelta=0,worst=null;
            const mesh=c.actors[1].body.meshes[0],v=c.camera.position.clone(),w=v.clone();
            const index=mesh.geometry.index.array,position=mesh.geometry.attributes.position,restPositions=c.actors[1].restPositions;
            let original=0;
            for(let i=0;i<index.length;i+=3)for(let j=0;j<3;j++){
                v.fromArray(restPositions,index[i+j]*3);w.fromArray(restPositions,index[i+(j+1)%3]*3);original=Math.max(original,v.distanceTo(w));
            }
            const selected=[];for(let i=0;i<index.length;i+=full?3:51)selected.push([index[i],index[i+1],index[i+2]]);
            const skinned=new Float32Array(position.count*3);
            for(let f=0;f<64;f++){
                c.step(2.1/64);mesh.skeleton.update();
                if(full)for(let i=0;i<position.count;i++)mesh.getVertexPosition(i,v).applyMatrix4(mesh.matrixWorld).toArray(skinned,i*3);
                for(const tri of selected)for(let j=0;j<3;j++){
                    if(full){v.fromArray(skinned,tri[j]*3);w.fromArray(skinned,tri[(j+1)%3]*3)}
                    else{mesh.getVertexPosition(tri[j],v).applyMatrix4(mesh.matrixWorld);mesh.getVertexPosition(tri[(j+1)%3],w).applyMatrix4(mesh.matrixWorld)}
                    const edge=v.distanceTo(w);maxEdge=Math.max(maxEdge,edge);
                    if(!Number.isFinite(edge))nonfinite++;
                    const rest=v.fromArray(restPositions,tri[j]*3).distanceTo(w.fromArray(restPositions,tri[(j+1)%3]*3));
                    if(edge-rest>maxDelta){maxDelta=edge-rest;worst={indices:[tri[j],tri[(j+1)%3]],rest:[v.toArray(),w.toArray()]}};
                }
            }
            return {pose,fullMesh:full,frames:64,trianglesPerFrame:selected.length,nonfinite,maxSampleEdge:maxEdge,maxSampleStretch:maxDelta,sourceMaxEdge:original,worst};
        }''',dict(pose=pose,full=a.full))
        reports.append(report)
        page.screenshot(path=str(a.output/(pose+'.png')))
    page.evaluate('''()=>{const c=window.__compare;c.setPose('idle');c.step(.5);const head=c.actors[1].body.bones.Head.getWorldPosition(c.camera.position.clone());c.camera.position.copy(head).add({x:0,y:.02,z:.65});c.camera.lookAt(head);c.renderer.render(c.scene,c.camera)}''')
    page.screenshot(path=str(a.output/'face.png'))
    b.close()
result=dict(errors=errors,poses=reports);(a.output/'results.json').write_text(json.dumps(result,indent=2));print(json.dumps(result))
