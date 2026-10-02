"""Check physical contacts against the actual animated class models on Mini."""
import argparse
import json
from pathlib import Path
from playwright.sync_api import sync_playwright

ap = argparse.ArgumentParser()
ap.add_argument('base')
ap.add_argument('output', type=Path)
a = ap.parse_args()
a.output.mkdir(parents=True, exist_ok=True)

with sync_playwright() as pw:
    browser = pw.chromium.launch(channel='chrome', headless=True, args=[
        '--ignore-gpu-blocklist', '--enable-gpu', '--use-angle=metal', '--mute-audio'])
    page = browser.new_page(viewport={'width': 1280, 'height': 720})
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.goto(a.base.rstrip('/') + '/index.html?auto=training&acc=yysf&manual=1&view=tp')
    page.wait_for_function('window.__glory?.game?.player && !window.__glory.game.inputFrozen', timeout=120000)
    page.wait_for_load_state('networkidle')
    report = page.evaluate('''async()=>{
      const {CLASSES}=await import('/src/data/classes.js');
      const {hurtCapsules,attackSegments,segmentDistance,sweptMeleeContact}=await import('/src/game/combat-volumes.js');
      const g=window.__glory.game;
      const originalFighters=g.fighters,originalBounds=g.world.bounds,originalCols=g.world.colliders;
      g.aiFrozen=true;g.manual=true;g.settings.shake=false;g.settings.bob=false;
      g.world.colliders=[];g.world.bounds={minX:-50,maxX:50,minZ:-50,maxZ:50};
      const target=g.spawn({cls:CLASSES.swordmaster,clsId:'swordmaster',kind:'dummy',team:2,pos:[0,0,1.25]});
      const hits=[], originalHit=g.onHit.bind(g);
      g.onHit=(att,t,res,h,def,...rest)=>{if(t===target)hits.push({res,region:h.contact?.region,point:h.contact?.point?.toArray(),name:def?.name});originalHit(att,t,res,h,def,...rest)};
      const results=[];
      for(const [id,cls] of Object.entries(CLASSES)){
        const att=g.spawn({cls,clsId:id,team:1,pos:[0,0,0]});att.isPlayer=true;
        g.fighters=[att,target];
        const normalRange={swordmaster:2,battlemage:2.8,berserker:2.2,assassin:1.7,thug:1.8,striker:1.25,
          unspecialized:1.8}[id]||3;
        for(let chain=0;chain<att.chain.length;chain++){
          const def=att.chain[chain];
          for(const scenario of [{name:'front',pos:[0,0,normalRange]},{name:'close',pos:[0,0,1.25]},
            {name:'overhead',pos:[0,4.5,normalRange]},{name:'side',pos:[1.8,0,normalRange]}]){
            att.resetState();target.resetState();target.hp=target.maxHp;att.pos.set(0,0,0);att.yaw=0;att.pitch=0;att.aimDir.set(0,0,1);att.target=null;
            target.pos.set(...scenario.pos);target.yaw=Math.PI;target.onGround=scenario.pos[1]===0;
            g.combat.clear();g.vfx.clear?.();hits.length=0;
            for(let i=0;i<20;i++){att.updateModel(1/60);target.updateModel(1/60)}
            if(def.proj||def.beam){
              const torso=hurtCapsules(target).find(c=>c.region==='torso');
              const wanted=torso.a.clone().lerp(torso.b,.5).sub(target.pos).add(target.pos.clone().set(0,0,scenario.name==='close'?1.25:normalRange));
              att.aimDir.copy(wanted).sub(att.eyePos()).normalize();att.pitch=Math.asin(att.aimDir.y);att.yaw=Math.atan2(att.aimDir.x,att.aimDir.z);
            }
            att.startAction(def,'atk',{chainIdx:chain});
            const positions=[];let badVolume=false;
            for(let step=0;step<Math.ceil((def.wind+def.active+def.recover+250)/1000*120);step++){
              g.time+=1/120;att.update(1/120);target.updateModel(1/120);g.separate();
              g.combat.updateMelee(1/120);g.combat.updateProjectiles(1/120);g.combat.updateAoes(1/120);g.vfx.update(1/120);
              if(att.action?.stage==='active'){
                const s=attackSegments(att,def.hits?.[0]||{},def);
                const entry={root:att.pos.toArray(),tip:s[0]?.b.toArray()};
                if(id==='swordmaster'&&scenario.name==='front'){
                  const caps=hurtCapsules(target), previous=positions[positions.length-1];
                  entry.base=s[0]?.a.toArray();entry.active=att.action.t;entry.window=g.combat.meleeWindows.map(w=>({duration:w.duration,start:w.start,uid:w.uid}));
                  entry.nearest=Math.min(...caps.map(c=>segmentDistance(s[0].a,s[0].b,c.a,c.b).distance-c.radius-s[0].radius));
                  entry.rawContact=sweptMeleeContact(s,s,target)?.point.toArray();
                  if(!positions.length)entry.caps=caps.map(c=>({region:c.region,a:c.a.toArray(),b:c.b.toArray(),radius:c.radius}));
                }
                positions.push(entry);
              }
              badVolume ||= hurtCapsules(target).some(c=>![...c.a.toArray(),...c.b.toArray(),c.radius].every(Number.isFinite));
            }
            results.push({id,chain,anim:def.anim,scenario:scenario.name,hits:hits.slice(),badVolume,
              distance:normalRange,activeSamples:positions.length,debug:(id==='swordmaster'&&scenario.name==='front')?positions:undefined,tipBounds:positions.length?{
                x:[Math.min(...positions.map(p=>p.tip[0])),Math.max(...positions.map(p=>p.tip[0]))],
                y:[Math.min(...positions.map(p=>p.tip[1])),Math.max(...positions.map(p=>p.tip[1]))],
                z:[Math.min(...positions.map(p=>p.tip[2])),Math.max(...positions.map(p=>p.tip[2]))]}:null});
          }
        }
        g.fighters=[...originalFighters,att,target];g.removeFighter(att);
      }
      g.fighters=[...originalFighters,target];g.removeFighter(target);
      g.world.bounds=originalBounds;g.world.colliders=originalCols;g.fighters=originalFighters;g.onHit=originalHit;
      return {results,errors:window.__errs,finite:!results.some(r=>r.badVolume),
        overheadMeleeMiss:results.filter(r=>r.scenario==='overhead'&&r.tipBounds&&r.id!=='sharpshooter'&&r.id!=='launcher'&&!['warlock','cleric','frostcaster','witch'].includes(r.id)).every(r=>!r.hits.length),
        frontHits:results.filter(r=>r.scenario==='front'&&r.hits.length).length,
        frontMisses:results.filter(r=>r.scenario==='front'&&!r.hits.length).map(r=>[r.id,r.chain,r.anim]),
        closeHits:results.filter(r=>r.scenario==='close'&&r.hits.length).length,
        closeMisses:results.filter(r=>r.scenario==='close'&&!r.hits.length).map(r=>[r.id,r.chain,r.anim])};
    }''')
    report['pageErrors'] = errors
    (a.output / 'results.json').write_text(json.dumps(report, ensure_ascii=False, indent=2))
    page.screenshot(path=str(a.output / 'training-after-contacts.jpg'), type='jpeg', quality=90)
    print(json.dumps({k:v for k,v in report.items() if k != 'results'}, ensure_ascii=False))
    browser.close()
