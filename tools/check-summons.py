"""Actual GLB, Fighter skill lifecycle and two-peer LAN summon smoke check."""
import argparse,json,pathlib
from playwright.sync_api import sync_playwright
ap=argparse.ArgumentParser();ap.add_argument('base');ap.add_argument('output',type=pathlib.Path);a=ap.parse_args();a.output.mkdir(parents=True,exist_ok=True)
with sync_playwright()as pw:
 b=pw.chromium.launch(channel='chrome',headless=True,args=['--ignore-gpu-blocklist','--enable-gpu','--use-angle=metal','--mute-audio'])
 contexts=[b.new_context(viewport={'width':1280,'height':720})for _ in range(2)];pages=[c.new_page()for c in contexts];host,guest=pages;errors=[]
 for i,(page,acc)in enumerate(zip(pages,['mg','yysf'])):
  page.on('pageerror',lambda e,i=i:errors.append(f'{i}: {e}'));page.add_init_script("localStorage.setItem('glory.seenHelp','true');localStorage.setItem('glory.settings',JSON.stringify({attract:false,quality:'low',shake:false}));")
  page.goto(a.base+f'/index.html?auto=training&manual=1&acc={acc}&view=tp',wait_until='networkidle');page.wait_for_function('window.__glory?.game?.player && !window.__glory.game.inputFrozen',timeout=90000)
 checks=host.evaluate('''()=>{const g=window.__glory.game,p=g.player,out=[];g.inputFrozen=true;g.aiFrozen=true;const test=(name,ok,data)=>{out.push({name,passed:!!ok,data});if(!ok)throw Error(name+':'+JSON.stringify(data));};test('summoner loaded rig',p.clsId==='summoner'&&!!p.mocapBody,{model:p.modelKey});p.mp=p.maxMp;p.cd={};let before=p.mp;test('summon begins',p.tryUse('s1'));test('cost charged once',Math.abs(p.mp-before+p.cls.skills.s1.mp)<.01);g.debugAdvance(.2);test('no pet during chant',g.summons.units.length===0);p.interrupt(300);g.debugAdvance(.7);test('interrupted chant stays empty',g.summons.units.length===0);p.resetState();p.mp=p.maxMp;p.cd={};for(const slot of ['s1','s2','s3','s4']){p.mp=p.maxMp;p.cd[slot]=0;test('cast '+slot,p.tryUse(slot));g.debugAdvance(1.2);}test('four real beasts',g.summons.units.length===4,g.summons.summary(p));const hp=g.fighters.filter(f=>f.team!==p.team).reduce((s,f)=>s+f.hp,0);g.debugAdvance(3);test('pets cause real damage',g.fighters.filter(f=>f.team!==p.team).reduce((s,f)=>s+f.hp,0)<hp);g.summons.cast(p,{command:'follow'});p.mp=p.maxMp;p.cd.ult=0;test('four-beast ultimate',p.tryUse('ult'));g.debugAdvance(1.3);test('formation seals summon before MP cost',!p.tryUse('s1')&&g.summons.order(p).formation>0);g.debugAdvance(12.1);test('formation expires all pets',g.summons.units.length===0);for(const kind of ['cat','wolf','eagle','dragon'])g.summons.cast(p,{kind});g.summons.cast(p,{command:'follow'});g.debugAdvance(.3);return out;}''')
 host.evaluate('()=>{const g=window.__glory.game;g.camera.position.set(6,4,8);g.camera.lookAt(0,1,0);g.render();}');host.screenshot(path=str(a.output/'four-beasts.jpg'),quality=90,type='jpeg')
 for page,acc in zip(pages,['mg','yysf']):
  page.evaluate('acc=>{const app=window.__glory;app.endMode();app.menu.sel.account=acc;app.openNet()}',acc);page.wait_for_selector('#create')
 host.fill('.pw-new','summon-test');host.click('#create');host.wait_for_selector('.net-room b.big-code',timeout=15000);code=host.inner_text('.net-room b.big-code');guest.fill('.code-in',code);guest.fill('.pw-join','summon-test');guest.click('#join');host.wait_for_selector('#start',timeout=30000);host.click('#start')
 for page in pages:
  page.wait_for_function('window.__glory?.mode?.player && window.__glory.game.mode && !window.__glory._loadingMode',timeout=90000);page.wait_for_load_state('networkidle');page.evaluate('()=>{const g=window.__glory.game;g.manual=false;g.paused=false;g.inputFrozen=true;g.cinematic=null;g.aiFrozen=true;}')
 guest.wait_for_function('window.__glory.mode.snaps?.length>0',timeout=10000)
 host.evaluate('()=>{const g=window.__glory.game,m=g.mode;for(const f of g.fighters){f.resetState();f.hp=f.maxHp=999999;}m.player.pos.set(0,0,5);m.enemy.pos.set(0,0,-5);for(const kind of ["cat","wolf","eagle","dragon"])g.summons.cast(m.player,{kind});}')
 guest.wait_for_function('window.__glory.game.summons.units.length===4',timeout=10000);guest.wait_for_timeout(1200)
 lan=guest.evaluate('()=>{const g=window.__glory.game;return{pets:g.summons.units.map(p=>({kind:p.beastKind,hp:p.hp,position:p.pos.toArray(),visible:!!p.rig.root.parent})),state:g.mode.enemy.summonState,errors:g.mode.replayErrors}}');assert len(lan['pets'])==4 and not lan['errors'],lan
 guest.screenshot(path=str(a.output/'lan-four-beasts.jpg'),quality=88,type='jpeg')
 host.evaluate('()=>{const g=window.__glory.game;for(const p of g.summons.units)p.hp=1;g.combat.explode(g.mode.enemy,g.summons.units[0].center(),{radius:30,dmg:9999},{});}');guest.wait_for_function('window.__glory.game.summons.units.length===0',timeout=10000);guest.wait_for_timeout(350)
 tail=guest.evaluate('window.__glory.mode.replayErrors');assert not tail,tail
 cleanup=[]
 for page in pages:
  r=page.evaluate('()=>{const app=window.__glory,g=app.game;app.quit();return{pets:g.summons.units.length,owners:g.summons.orders.size,fighters:g.fighters.length}}');assert r==dict(pets=0,owners=0,fighters=0),r;cleanup.append(r)
 assert not errors,errors
 report=dict(checks=checks,lan=lan,cleanup=cleanup,errors=errors);(a.output/'results.json').write_text(json.dumps(report,ensure_ascii=False,indent=2));print(json.dumps(report,ensure_ascii=False));b.close()
