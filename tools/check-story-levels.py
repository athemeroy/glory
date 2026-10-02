"""Real GPU level views, capsule walk routes, cover occlusion and disposal."""
import argparse
import json
from pathlib import Path
from playwright.sync_api import sync_playwright

p=argparse.ArgumentParser();p.add_argument('base');p.add_argument('output',type=Path);a=p.parse_args();a.output.mkdir(parents=True,exist_ok=True)
report=[]
views={
    'clocktower': [None, '-10,4.02,7,-1,8,0', '11,7,18,-4,4,-2', '0,32,32,-1,0,-2', '0,1.62,-13,0,4,-22'],
    'frostbridge': [None, '0,3.42,8,0,2,-15', '-18,4,5,3,1,-6', '20,26,32,-3,0,-1', '0,1.62,-18,0,2,15'],
}
with sync_playwright() as pw:
    browser=pw.chromium.launch(channel='chrome',headless=True,args=['--ignore-gpu-blocklist','--enable-gpu','--use-angle=metal','--mute-audio'])
    page=browser.new_page(viewport={'width':1280,'height':720});errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
    for level,cameras in views.items():
        for index,cam in enumerate(cameras):
            url=a.base+f'/tools/level-preview.html?level={level}&quality=high&markers=1&frames=3'
            if cam:url+='&cam='+cam
            page.goto(url,wait_until='networkidle');page.wait_for_function('window.__ready',timeout=60000)
            stats=page.evaluate('()=>({hud:document.querySelector("#info").textContent,calls:__renderer.info.render.calls,triangles:__renderer.info.render.triangles,memory:__renderer.info.memory,colliders:__level.colliders.length})')
            page.screenshot(path=str(a.output/f'{level}-{index}.jpg'),type='jpeg',quality=90)
            if index==0:
                walk=page.evaluate('''async()=>{
                  const {World}=await import('../src/game/world.js'),T=await import('three'),L=__level,w=new World();w.setLevel(L);
                  const run=route=>{const f={pos:new T.Vector3(...route[0]),vel:new T.Vector3(),radius:.32,height:1.8,collisionHeight:1.8,onGround:true};const points=[];
                    for(let i=1;i<route.length;i++){const target=new T.Vector3(...route[i]);let frames=0,blocked=0;for(;frames<1500;frames++){
                      const d=new T.Vector3(target.x-f.pos.x,0,target.z-f.pos.z),len=d.length();if(len<.08&&Math.abs(f.pos.y-target.y)<.15)break;
                      if(len>.01)d.multiplyScalar(Math.min(len,3.5/60)/len);if(!f.onGround)f.vel.y-=18/60;else f.vel.y=0;
                      const r=w.resolve(f,f.pos.x+d.x,f.pos.y+f.vel.y/60,f.pos.z+d.z);f.pos.set(r.x,r.y,r.z);f.onGround=r.grounded;if(r.grounded)f.vel.y=0;if(r.wallHit)blocked++;
                      if(f.pos.y < -20)break;
                    }points.push({target:route[i],actual:f.pos.toArray(),frames,blocked,passed:f.pos.distanceTo(target)<.19});if(!points.at(-1).passed)break;}return points;};
                  const routes={main:run(L.markers.route)};if(L.markers.alternateRoute)routes.alternate=run(L.markers.alternateRoute);
                  const coverTests=(L.markers.covers||[]).map(([x,z])=>({cover:[x,z],blocked:w.blocked(new T.Vector3(x,.6,z+2),new T.Vector3(x,.6,z-2)),above:!w.blocked(new T.Vector3(x,2.6,z+2),new T.Vector3(x,2.6,z-2))}));
                  const floor=L.floorAt?{water:L.floorAt(7,0),bank:L.floorAt(7,18),bridge:w.floorHeight(0,0)}:null;
                  return {routes,coverTests,floor,spawns:L.spawns,story:L.markers.story};
                }''')
                assert all(s['passed'] for steps in walk['routes'].values() for s in steps),(level,walk)
                assert all(c['blocked'] and c['above'] for c in walk['coverTests']),(level,walk['coverTests'])
                if walk['floor']:assert walk['floor']=={'water':-30,'bank':0,'bridge':1.8},walk['floor']
                stats['walk']=walk
            report.append(dict(level=level,view=index,stats=stats))
        # Low settings keep the gameplay layout identical.
        page.goto(a.base+f'/tools/level-preview.html?level={level}&quality=low&frames=3',wait_until='networkidle');page.wait_for_function('window.__ready')
        low=page.evaluate('()=>({colliders:__level.colliders.length,memory:__renderer.info.memory,calls:__renderer.info.render.calls})')
        page.screenshot(path=str(a.output/f'{level}-low.jpg'),type='jpeg',quality=90)
        assert low['colliders']==report[-1]['stats']['colliders'],low
        clean=page.evaluate('()=>{__level.dispose();__renderer.render(__scene,__camera);return {children:__level.group.children.length,memory:__renderer.info.memory}}')
        assert clean['children']==0,clean
        report.append(dict(level=level,quality='low',stats=low,clean=clean))
    assert not errors,errors
    (a.output/'results.json').write_text(json.dumps(dict(levels=report,errors=errors),ensure_ascii=False,indent=2))
    print(json.dumps(dict(views=len(report),routes=sum(len(r['stats'].get('walk',{}).get('routes',{}))for r in report),errors=errors),ensure_ascii=False));browser.close()
