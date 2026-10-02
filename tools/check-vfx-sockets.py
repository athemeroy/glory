"""Capture limb effects on real animated GLB models after socket changes."""
import argparse
import json
from pathlib import Path
from playwright.sync_api import sync_playwright

p=argparse.ArgumentParser();p.add_argument('base');p.add_argument('output',type=Path);a=p.parse_args();a.output.mkdir(parents=True,exist_ok=True)
cases=[('battlemage','s4',50,'LeftHand',None),('striker','s2',90,'LeftHand',None),('striker','s4',160,'LeftFoot',None),('thug','s6',100,'RightFoot',None),('thug','ult',300,'RightFoot',2),('unspecialized','s6',50,'LeftHand',None),('boss','s2',100,'shield',None),('launcher','s1',50,'muzzle',None)]
results=[]
with sync_playwright()as pw:
    browser=pw.chromium.launch(channel='chrome',headless=True,args=['--ignore-gpu-blocklist','--enable-gpu','--use-angle=metal','--mute-audio'])
    page=browser.new_page(viewport={'width':1280,'height':720});errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
    page.add_init_script("localStorage.setItem('glory.seenHelp','true');localStorage.setItem('glory.settings',JSON.stringify({attract:false,quality:'high',shake:false}));")
    page.goto(a.base+'/index.html?auto=training&manual=1&acc=yysf&view=tp',wait_until='domcontentloaded');page.wait_for_function('window.__glory?.game?.player && !window.__glory.game.inputFrozen',timeout=90000);page.wait_for_load_state('networkidle')
    for cls,slot,at,bone,index in cases:
        result=page.evaluate('''async([cls,slot,at,bone,index])=>{
          const {CLASSES}=await import('/src/data/classes.js'),{BOSS}=await import('/src/data/enemies.js'),T=await import('/vendor/three.module.js');
          const g=window.__glory.game;window.__glory.hud.show(false);g.aiFrozen=true;g.manual=true;g.inputFrozen=true;g.clearFighters();g.combat.clear();
          const f=g.spawn({cls:cls==='boss'?BOSS:CLASSES[cls],clsId:cls,kind:cls==='boss'?'boss':'hero',team:1,pos:[0,0,0],yaw:0,scale:cls==='boss'?1.5:1});
          g.player=f;g.firstPerson=false;g._viewMode='tp';g.cinematic=null;f.startAction(f.cls.skills[slot],slot);
          const d=f.action.def;f.action.stage='active';f.action.t=at;f.action.animIdx=index??0;
          for(let i=0;i<12;i++)f.updateModel(1/120);
          const expected=bone==='shield'?f.leftWeapon.localToWorld(new T.Vector3(0,.1,.1)):bone==='muzzle'?f.weapon.muzzle.getWorldPosition(new T.Vector3()):f.mocapBody.bones[bone].getWorldPosition(new T.Vector3());
          g.vfx.clear();if(bone==='muzzle')g.vfx.fire(f,d.proj[0],d,expected,new T.Vector3(0,0,1));else g.vfx.skillEvent(f,'active',{def:d,slot,deferred:true});g.vfx.update(.025);
          const error=Math.min(...g.vfx.items.map(it=>it.obj.position.distanceTo(expected)));
          g.camera.fov=40;g.camera.updateProjectionMatrix();g.camHook=cam=>{const s=f.scale||1;cam.position.set(2.8*s,2.2*s,3.6*s);cam.lookAt(0,(f.height||1.8)*.5,0);cam.updateMatrixWorld(true);};g.scene.updateMatrixWorld(true);g.render();
          return {cls,slot,name:d.name,clip:d.altAnims?.[f.action.animIdx]||d.anim,bone,expected:expected.toArray(),nearestEffectError:error,mocap:!!f.mocapBody,stats:g.vfx.getStats()};
        }''',[cls,slot,at,bone,index])
        assert result['mocap'] and result['nearestEffectError']<1e-6,result
        results.append(result);page.screenshot(path=str(a.output/f'{cls}-{slot}.jpg'),quality=85,type='jpeg')
        if cls=='launcher':
            page.evaluate('''()=>{const g=window.__glory.game,h=g.player.mocapBody.bones.Head.getWorldPosition(g.player.pos.clone());g.camera.fov=35;g.camera.updateProjectionMatrix();g.camHook=cam=>{cam.position.set(h.x,h.y+.06,h.z+1.05);cam.lookAt(h.x,h.y+.06,h.z);cam.updateMatrixWorld(true);};g.render();}''');page.screenshot(path=str(a.output/'launcher-v6-face.jpg'),quality=85,type='jpeg')
    turn=page.evaluate('''async()=>{
      const T=await import('/vendor/three.module.js'),{CLASSES}=await import('/src/data/classes.js'),g=window.__glory.game;g.clearFighters();
      const f=g.spawn({cls:CLASSES.swordmaster,clsId:'swordmaster',team:1,pos:[0,0,0],yaw:0});g.player=f;
      f.startAction(f.chain[0],'atk');f.action.stage='active';f.action.t=40;f.updateModel(1/60);g.vfx.clear();g.vfx.slash(f,'slashR','#84bbcf',2.4,1);
      f.yaw=Math.PI/2;f.pitch=.3;f.updateModel(1/60);g.vfx.update(.04);
      const dir=new T.Vector3(0,0,1).applyQuaternion(g.vfx.items[0].obj.quaternion);g.camHook=cam=>{cam.position.set(2.8,2.2,3.6);cam.lookAt(0,1,0);cam.updateMatrixWorld(true);};g.render();
      return {yaw:f.yaw,oldAim:f.action.aimYaw,dir:dir.toArray()};
    }''');assert turn['dir'][0]>.95 and turn['dir'][1]>.29,turn
    page.screenshot(path=str(a.output/'swordmaster-mid-strike-turn.jpg'),quality=85,type='jpeg')
    cleanup=page.evaluate('()=>{const app=window.__glory,g=app.game;app.quit();return {fighters:g.fighters.length,stats:g.vfx.getStats()}}');assert cleanup['fighters']==0 and cleanup['stats']['items']==0 and cleanup['stats']['particles']==0,cleanup
    assert not errors,errors
    report=dict(results=results,turn=turn,cleanup=cleanup,errors=errors);(a.output/'results.json').write_text(json.dumps(report,ensure_ascii=False,indent=2));print(json.dumps(dict(cases=len(results)+1,errors=errors),ensure_ascii=False));browser.close()
