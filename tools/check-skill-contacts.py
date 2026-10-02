"""Verify actual AI skill contacts and health effects using real animated bodies."""
import argparse
import json
from pathlib import Path
from playwright.sync_api import sync_playwright

ap = argparse.ArgumentParser()
ap.add_argument('base')
ap.add_argument('output', type=Path)
ap.add_argument('--only', default='', help='comma separated class ids for focused reruns')
a = ap.parse_args()
a.output.mkdir(parents=True, exist_ok=True)

with sync_playwright() as pw:
    browser = pw.chromium.launch(channel='chrome', headless=True, args=[
        '--ignore-gpu-blocklist', '--enable-gpu', '--use-angle=metal', '--mute-audio'])
    page = browser.new_page(viewport={'width': 960, 'height': 540})
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.goto(a.base.rstrip('/') + '/index.html?auto=training&acc=yysf&manual=1&view=tp')
    page.wait_for_function('window.__glory?.game?.player && !window.__glory.game.inputFrozen', timeout=120000)
    page.wait_for_load_state('networkidle')
    report = page.evaluate('''async(only)=>{
      const {CLASSES,SKILLS,SKILL_CHOICES}=await import('/src/data/classes.js');
      const {MOBS,BOSS}=await import('/src/data/enemies.js');
      const {hurtCapsules,attackSegments,segmentDistance}=await import('/src/game/combat-volumes.js');
      const g=window.__glory.game;
      const saved={fighters:g.fighters,bounds:g.world.bounds,colliders:g.world.colliders,onHit:g.onHit};
      g.aiFrozen=true;g.manual=true;g.settings.shake=false;g.world.colliders=[];
      g.world.bounds={minX:-50,maxX:50,minZ:-50,maxZ:50};
      const target=g.spawn({cls:CLASSES.swordmaster,clsId:'swordmaster',team:2,pos:[0,0,2]});
      target.maxHp=100000;target.hp=100000;
      const hits=[];g.onHit=(att,t,res,h,def,...rest)=>{
        if(t===target)hits.push({res,region:h.contact?.region,name:def?.name,t:h.t||0,
          source:h.kind?'projectile':h.at?'area':def?.beam?'beam':'melee',effect:h.effect,effects:h.effects});
        saved.onHit.call(g,att,t,res,h,def,...rest);
      };
      const results=[];
      const near={unspecialized:1.75,swordmaster:1.65,battlemage:2.55,striker:1.05,berserker:1.9,assassin:1.15,thug:1.25,skeleton:1.7,boss:2.8};
      const definitions={...CLASSES,...MOBS,boss:BOSS};
      for(const [id,cls]of Object.entries(definitions)){
        if(only.length&&!only.includes(id))continue;
        const att=g.spawn({cls,clsId:id,kind:id==='boss'?'boss':MOBS[id]?'mob':'hero',team:1,pos:[0,0,0],scale:id==='boss'?1.5:1});
        att.phase=2;
        g.fighters=[att,target];
        const skills={...(att.cls.skills||{})};
        const attacks=[...(att.chain||[]).map((def,i)=>({slot:'atk',def,chain:i})),
          ...Object.entries(skills).map(([slot,def])=>({slot,def}))];
        for(const [slot,choices]of Object.entries(SKILL_CHOICES[id]||{}))for(const key of choices){
          if(SKILLS[key]!==skills[slot])attacks.push({slot,def:SKILLS[key]});
        }
        const charge=att.chargeDef();
        if(charge)attacks.push({slot:'charge',def:charge});
        if(att.cls.counter)attacks.push({slot:'counter',def:att.cls.counter});
        for(const {slot,def,chain}of attacks){
          if(chain===undefined&&slot!=='charge'&&slot!=='counter')att.cls.skills[slot]=def;
          const min=def.ai?.range?.[0]||0,max=def.ai?.range?.[1]||3;
          const atHand=/palm|grab|punch|uppercut|stomp|kick|lowSweep/i.test(def.anim||'');
          const meleeNear=atHand?1.05:(near[id]||1.75);
          const kind=def.hits?.length&&def.proj?.length?'hybrid':def.proj||def.beam?'ranged':def.aoe?'area':def.hits||def.stageDefs?'melee':'support';
          const distances=kind==='hybrid'?[meleeNear,Math.min(max-.3,8)]:kind==='ranged'?[Math.max(min,2.5),Math.min(max-0.3,8)]:kind==='area'?[Math.max(min,2.5),Math.min(max-0.3,7)]:
            def.dash||def.flyDash||def.leap||def.blink?[Math.max(min,meleeNear),Math.min(max-0.3,4.5)]:
            kind==='melee'?[meleeNear,(atHand||id==='assassin') ? .75 : id==='battlemage' ? 2.05 : id==='boss' ? 2.3 : 1.25]:[meleeNear];
          for(const dist of [...new Set(distances.filter(d=>d>0))]){
            att.resetState();target.resetState();att.pos.set(0,0,0);att.yaw=0;att.pitch=0;att.aimDir.set(0,0,1);
            att.moveInput.set(0,0);target.moveInput.set(0,0);
            target.pos.set(0,0,dist);target.yaw=Math.PI;target.onGround=true;target.hp=target.maxHp;
            att.target=target;att.targetVisible=true;att.mp=att.maxMp;att.hp=att.maxHp*.45;
            if(def.otg||def.ai?.role==='otg'){target.state='down';target.downT=10000;target.stateT=.3;}
            g.combat.clear();g.vfx.clear?.();hits.length=0;
            for(let i=0;i<20;i++){att.updateModel(1/60);target.updateModel(1/60);}
            const before=att.hp;
            const started=slot==='charge'?att.startCharge():slot==='counter'?att.startAction(def,'counter'):
              chain!==undefined?att.startAction(def,'atk',{chainIdx:chain}):att.tryUse(slot);
            let bad=false,active=0;const closest=[];
            for(let i=0;i<Math.ceil(Math.max(3000,(def.wind||0)+(def.active||0)+(def.recover||0)+1800)/1000*120);i++){
              if(slot==='charge'&&i>=78)att.charging=false;
              g.time+=1/120;att.update(1/120);target.update(1/120);g.separate();
              g.combat.updateMelee(1/120);g.combat.updateProjectiles(1/120);g.combat.updateAoes(1/120);g.vfx.update(1/120);
              if(def.stageDefs&&att.stageInfo&&(!att.action||att.action.stage==='recover'))att.tryUse(slot);
              if(att.action?.stage==='active')active++;
              if(att.action?.stage==='active'&&['melee','hybrid'].includes(kind)){
                const caps=hurtCapsules(target),h=att.action.def.hits?.[0]||{},segments=attackSegments(att,h,att.action.def);
                let best=null;
                for(const seg of segments)for(const cap of caps){
                  const near=segmentDistance(seg.a,seg.b,cap.a,cap.b),gap=near.distance-seg.radius-cap.radius;
                  if(!best||gap<best.gap)best={gap,region:cap.region,weapon:[seg.a.toArray(),seg.b.toArray()],
                    contact:near.b.toArray(),relativeHeight:near.b.y-att.pos.y,angle:Math.atan2(near.b.x-att.pos.x,near.b.z-att.pos.z)-att.action.aimYaw,
                    active:att.action.t,root:att.pos.toArray(),target:target.pos.toArray(),window:g.combat.meleeWindows.map(w=>[w.start,w.duration])};
                }
                if(best){closest.push(best);closest.sort((a,b)=>a.gap-b.gap);if(closest.length>8)closest.length=8;}
              }
              bad||=hurtCapsules(target).some(c=>![...c.a.toArray(),...c.b.toArray(),c.radius].every(Number.isFinite));
            }
            results.push({id,slot,chain,name:def.name||'普通攻击',anim:def.anim,kind,dist,started:!!started,
              hitCount:hits.length,hits:hits.slice(),finite:!bad,healthGain:att.hp-before,
              shield:att.effects.find(e=>e.type==='shield')?.amount||0,activeFrames:active,closest});
          }
        }
        g.fighters=[...saved.fighters,att,target];g.removeFighter(att);
      }
      g.fighters=[...saved.fighters,target];g.removeFighter(target);
      Object.assign(g.world,{bounds:saved.bounds,colliders:saved.colliders});g.fighters=saved.fighters;g.onHit=saved.onHit;
      const offensive=results.filter(r=>r.kind!=='support'),groups=new Map();
      for(const r of offensive){const key=r.id+':'+r.slot+':'+r.chain+':'+r.name;if(!groups.has(key))groups.set(key,[]);groups.get(key).push(r);}
      return {results,finite:results.every(r=>r.finite),offensiveCases:groups.size,
        allDistanceMisses:[...groups.values()].filter(list=>list.every(r=>!r.hitCount)).map(list=>({id:list[0].id,slot:list[0].slot,
          chain:list[0].chain,name:list[0].name,anim:list[0].anim,distances:list.map(r=>r.dist)}))};
    }''', a.only.split(',') if a.only else [])
    report['pageErrors'] = errors
    (a.output / 'results.json').write_text(json.dumps(report, ensure_ascii=False, indent=2))
    print(json.dumps({k:v for k,v in report.items() if k != 'results'}, ensure_ascii=False))
    browser.close()
