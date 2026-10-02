"""Measure the real production animation loop, not debugAdvance simulation FPS."""
import argparse
import json
from pathlib import Path
from playwright.sync_api import sync_playwright

p=argparse.ArgumentParser();p.add_argument('base');p.add_argument('output',type=Path);p.add_argument('--seconds',type=float,default=5);p.add_argument('--only',default='');a=p.parse_args();a.output.mkdir(parents=True,exist_ok=True)
reports=[]
cases=[(f'story-{chapter}-{quality}','story',chapter,quality,1280,720,2)for chapter in range(3)for quality in ['high','low']]
cases += [('mirror-guard-high','training',0,'high',1280,720,2),('mirror-guard-low-phone','training',0,'low',390,844,3)]
with sync_playwright() as pw:
    browser=pw.chromium.launch(channel='chrome',headless=True,args=['--ignore-gpu-blocklist','--enable-gpu','--use-angle=metal','--mute-audio'])
    for label,mode,chapter,quality,width,height,dpr in cases:
        if a.only and label not in a.only.split(','):continue
        ctx=browser.new_context(viewport={'width':width,'height':height},device_scale_factor=dpr,is_mobile=width<600,has_touch=width<600)
        page=ctx.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
        settings=dict(attract=False,quality=quality,autoQuality=False,shake=False,bob=False,voice=0)
        page.add_init_script("localStorage.setItem('glory.seenHelp','true');localStorage.setItem('glory.storyProgress',JSON.stringify({cleared:['first-night','clocktower','frostbridge']}));localStorage.setItem('glory.settings',"+json.dumps(json.dumps(settings))+");")
        page.goto(a.base+f'/index.html?auto={mode}&chapter={chapter}&acc=yysf&view=fp',wait_until='domcontentloaded')
        page.wait_for_function('window.__glory?.game?.player && !window.__glory._loadingMode',timeout=90000);page.wait_for_load_state('networkidle')
        setup=page.evaluate('''async(mode)=>{
          const app=window.__glory,g=app.game,m=app.mode,p=g.player;g.manual=false;g.paused=false;g.inputFrozen=true;g.cinematic=null;g.autoPlayer=false;
          const {input}=await import('./src/engine/input.js');input.cursorMode=false;
          if(mode==='story'){
            m.lines=null;m.dialogueRoot.style.display='none';document.body.classList.remove('story-speaking');m.beginEncounter();m.freeze(false);g.inputFrozen=true;
            const {ACCOUNTS}=await import('./src/data/classes.js');
            while(g.fighters.length<4)m.spawnHero(ACCOUNTS.find(a=>a.id==='myc'),1,[m.encounter.x+3,0,m.encounter.z+4,Math.PI],false,'hard');
            p.pos.set(m.encounter.x,g.world.floorHeight(m.encounter.x,m.encounter.z+6),m.encounter.z+6);p.yaw=Math.PI;g.viewYaw=p.yaw;g.viewPitch=.06;
            for(const f of g.fighters){f.maxHp=999999;f.hp=f.maxHp;f.wantGuard=f===p;}
          }else{
            const mirror=g.scene.getObjectByName('mirror');p.resetState();p.pos.set(mirror.position.x+1.8,0,mirror.position.z);p.yaw=-Math.PI/2;p.pitch=-.35;g.viewYaw=p.yaw;g.viewPitch=p.pitch;p.wantGuard=true;g.aiFrozen=true;
          }
          g.timeScale=1;g.resize();return {level:g.level.id,actors:g.fighters.length,manual:g.manual,quality:g.settings.quality,dpr:devicePixelRatio,pixelRatio:g.renderer.getPixelRatio(),canvas:[g.canvas.width,g.canvas.height],models:g.fighters.map(f=>({cls:f.clsId,key:f.modelKey,mocap:!!f.mocapBody})),modelRequests:performance.getEntriesByType('resource').map(r=>r.name).filter(url=>url.includes('/models/')&&new URL(url).pathname.endsWith('.glb'))};
        }''',mode)
        assert not setup['manual'] and setup['actors']==4,setup
        assert all(m['mocap']for m in setup['models']) if mode=='story' else setup['models'][0]['mocap'],setup
        assert any('/models/optimized/'in url for url in setup['modelRequests']),('optimized assets not enabled',setup)
        assert not any('/models/rigged/'in url for url in setup['modelRequests']),('an optimized asset fell back to the original',setup)
        page.wait_for_timeout(1000)
        measurement=page.evaluate('''seconds=>new Promise(resolve=>{
          const g=window.__glory.game,start=performance.now(),frames=[],renders=[],ticks=[],calls=[],triangles=[];let previous=start;
          const originalRender=g.render,originalTick=g.tick,originalAutoReset=g.renderer.info.autoReset;g.renderer.info.autoReset=false;
          g.render=function(...args){const t=performance.now();g.renderer.info.reset();const r=originalRender.apply(g,args);renders.push(performance.now()-t);calls.push(g.renderer.info.render.calls);triangles.push(g.renderer.info.render.triangles);return r;};
          g.tick=function(...args){const t=performance.now();const r=originalTick.apply(g,args);ticks.push(performance.now()-t);return r;};
          const summary=list=>{const sorted=[...list].sort((a,b)=>a-b),n=list.length;return {samples:n,mean:n?list.reduce((a,b)=>a+b,0)/n:0,p50:sorted[Math.floor(n*.5)]||0,p95:sorted[Math.floor(n*.95)]||0,max:sorted.at(-1)||0};};
          const sample=now=>{frames.push(now-previous);previous=now;if(now-start<seconds*1000){requestAnimationFrame(sample);return;}
            g.render=originalRender;g.tick=originalTick;g.renderer.info.autoReset=originalAutoReset;const elapsed=(now-start)/1000,gl=g.renderer.getContext(),ext=gl.getExtension('WEBGL_debug_renderer_info');
            resolve({elapsed,rafFPS:frames.length/elapsed,actualRenderFPS:renders.length/elapsed,rafMs:summary(frames),renderCpuMs:summary(renders),tickCpuMs:summary(ticks),drawCalls:summary(calls),triangles:summary(triangles),memory:g.renderer.info.memory,vfx:g.vfx.getStats(),degraded:!!g.degraded,guard:g.player.guarding,manual:g.manual,renderer:ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER)});
          };requestAnimationFrame(sample);
        })''',a.seconds)
        assert measurement['actualRenderFPS']>0 and not measurement['manual'] and not measurement['degraded'],measurement
        if mode=='training':assert measurement['guard'],('mirror capture is not guarding',measurement)
        assert not errors,errors
        page.screenshot(path=str(a.output/f'{label}.jpg'),type='jpeg',quality=85)
        cleanup=page.evaluate('()=>{const app=window.__glory,g=app.game;app.quit();return {fighters:g.fighters.length,items:g.vfx.getStats().items,particles:g.vfx.getStats().particles,level:g.level?.id||null}}')
        assert cleanup==dict(fighters=0,items=0,particles=0,level=None),cleanup
        reports.append(dict(case=label,setup=setup,measurement=measurement,cleanup=cleanup,errors=errors));print(label,json.dumps(dict(fps=round(measurement['actualRenderFPS'],1),rafP95=round(measurement['rafMs']['p95'],1),renderCpuP95=round(measurement['renderCpuMs']['p95'],1),pixelRatio=setup['pixelRatio'])),flush=True)
        (a.output/'results.json').write_text(json.dumps(reports,ensure_ascii=False,indent=2))
        ctx.close()
    browser.close()
(a.output/'results.json').write_text(json.dumps(reports,ensure_ascii=False,indent=2));print(json.dumps(dict(cases=len(reports),errors=[e for r in reports for e in r['errors']]),ensure_ascii=False))
