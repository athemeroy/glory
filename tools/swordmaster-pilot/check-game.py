"""Exercise sample combos, all camera modes, and mobile layouts on real GPU."""
import argparse
import json
from pathlib import Path
from playwright.sync_api import sync_playwright
p=argparse.ArgumentParser();p.add_argument('base');p.add_argument('output',type=Path);a=p.parse_args();a.output.mkdir(parents=True,exist_ok=True)
reports=[]
with sync_playwright() as pw:
    b=pw.chromium.launch(channel='chrome',headless=True,args=['--ignore-gpu-blocklist','--enable-gpu','--use-angle=metal','--mute-audio'])
    for width,height in [(1280,720),(390,844),(844,390)]:
        page=b.new_page(viewport={'width':width,'height':height},is_mobile=width<1000,has_touch=width<1000)
        errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
        page.goto(a.base+'?auto=training&acc=yysf&manual=1&swordpilot=1',wait_until='domcontentloaded')
        page.wait_for_function('window.__glory?.game?.player && !window.__glory.game.inputFrozen',timeout=90000)
        page.wait_for_load_state('networkidle')
        evidence=page.evaluate('''()=>{
            const g=window.__glory.game,p=g.player;p.resetState();p.pos.set(0,0,0);
            const clips=[];for(let i=0;i<3;i++){
                p.resetState();p.pos.set(0,0,0);p.startAction(p.chain[i],'atk',{chainIdx:i});
                g.debugAdvance(p.chain[i].wind/1000+.03);clips.push(p.mocap.curName);
            }
            p.resetState();p.pos.set(0,0,0);
            return {class:p.clsId,chain:p.chain.map(d=>d.anim),worldClips:clips,
                skillStages:p.cls.skills.s2.stageDefs.map(d=>d.anim),
                launcher:p.cls.skills.s2.stageDefs[2].hits[0].launch,
                horizontalOverflow:document.documentElement.scrollWidth>innerWidth};
        }''')
        assert evidence['chain']==['pilotRise','pilotSweep','pilotChop'],evidence
        assert evidence['worldClips']==['Sword_Pilot_Rising','Sword_Pilot_Sweep','Sword_Pilot_Chop'],evidence
        assert evidence['skillStages']==['pilotSweep','pilotChop','pilotRise'] and evidence['launcher']==8,evidence
        assert not evidence['horizontalOverflow'],evidence
        for view in ['fp','ots','tp']:
            page.evaluate('''view=>{const g=window.__glory.game;g.setViewMode(view);g.debugAdvance(.3)}''',view)
            page.screenshot(path=str(a.output/f'{width}x{height}-{view}.jpg'),type='jpeg',quality=85)
        assert not errors,errors
        reports.append(dict(viewport=[width,height],errors=errors,evidence=evidence));page.close()
    b.close()
(a.output/'results.json').write_text(json.dumps(reports,ensure_ascii=False,indent=2));print(json.dumps(reports,ensure_ascii=False))
