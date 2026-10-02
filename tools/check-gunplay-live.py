import argparse,json,pathlib
from playwright.sync_api import sync_playwright
ap=argparse.ArgumentParser();ap.add_argument('base');ap.add_argument('output',type=pathlib.Path);a=ap.parse_args();a.output.mkdir(parents=True,exist_ok=True)
with sync_playwright() as pw:
 b=pw.chromium.launch(channel='chrome',headless=True,args=['--ignore-gpu-blocklist','--enable-gpu','--use-angle=metal','--mute-audio']);errors=[]
 p=b.new_page(viewport={'width':1280,'height':720});p.on('pageerror',lambda e:errors.append(str(e)));p.goto(a.base+'/?auto=training&manual=1&acc=myc&view=fp',wait_until='networkidle',timeout=90000);p.wait_for_function('window.__glory?.game?.player&&!window.__glory.game.inputFrozen',timeout=90000)
 report=p.evaluate('async()=>{const {checkGunplayLive}=await import("./tools/check-gunplay-live.js");return checkGunplayLive(__glory)}');report['browserErrors']=errors
 p.evaluate('()=>{const g=__glory.game,p=g.player;g.inputFrozen=true;p.resetState();p.pos.set(0,1,-2);p.onGround=false;p.state="jump";p.pitch=-.25;p.aimDir.set(0,Math.sin(-.25),Math.cos(-.25));g.viewYaw=0;g.viewPitch=-.25;p.startAction(p.chain[0],"atk",{chainIdx:0});g.debugAdvance(.2)}');p.screenshot(path=str(a.output/'actual-cannon-flight.png'));p.close()
 # Two real LAN peers, including the guest's own camera recoil and host-only impulse.
 contexts=[b.new_context(viewport={'width':960,'height':540})for _ in range(2)];host,guest=[c.new_page()for c in contexts]
 for page,acc in [(host,'myc'),(guest,'yqcy')]:
  page.on('pageerror',lambda e:errors.append(str(e)));page.goto(a.base+f'/?auto=training&manual=1&acc={acc}',wait_until='networkidle',timeout=90000);page.wait_for_function('window.__glory?.game?.player&&!window.__glory.game.inputFrozen',timeout=90000);page.evaluate('acc=>{const a=__glory;a.endMode();a.menu.sel.account=acc;a.openNet()}',acc);page.wait_for_selector('#create')
 host.fill('.pw-new','gunplay-test');host.click('#create');host.wait_for_selector('.net-room b.big-code');code=host.inner_text('.net-room b.big-code');guest.fill('.code-in',code);guest.fill('.pw-join','gunplay-test');guest.click('#join');host.wait_for_selector('#start');host.click('#start')
 for page in [host,guest]:
  page.wait_for_function('window.__glory?.mode?.player&&window.__glory.game.mode&&!window.__glory._loadingMode',timeout=90000);page.evaluate('()=>{const g=__glory.game;g.manual=false;g.paused=false;g.inputFrozen=true;g.cinematic=null;g.aiFrozen=true}')
 guest.wait_for_function('window.__glory.mode.snaps?.length>0')
 host.evaluate('''()=>{const g=__glory.game,m=__glory.mode;g.combat.clear();for(const f of [m.player,m.enemy]){f.resetState();f.hp=f.maxHp;f.cd={};f.pos.set(f===m.player?-4:4,0,0);f.yaw=0;f.pitch=0;f.aimDir.set(0,0,1);}window.__wire=[];const send=m.net.relay;m.net.relay=function(p){if(p.k==='snap')__wire.push(...(p.ev||[]));return send.call(this,p)}}''')
 guest.evaluate('()=>{__glory.game.viewPitch=0;__glory.game.viewYaw=0}');guest.wait_for_timeout(250)
 host.evaluate('()=>{const g=__glory.game,p=__glory.mode.enemy;p.pos.y=2;p.onGround=false;p.state="jump";p.startAction(p.chain[0],"atk",{chainIdx:0})}');guest.wait_for_function('__glory.game.viewPitch>0',timeout=3000)
 lan={'guest':guest.evaluate('({pitch:__glory.game.viewPitch,heat:__glory.game.shotHeat,knock:__glory.game.player.knockVel.length(),errors:__glory.mode.replayErrors})'),'host':host.evaluate('({impulse:__glory.mode.enemy.knockVel.z,events:__wire.filter(e=>e[0]==="G"&&e[1]==="onFire").length})')}
 assert lan['guest']['pitch']>0 and lan['guest']['knock']==0 and not lan['guest']['errors'] and lan['host']['impulse']<0 and lan['host']['events']==1,lan
 guest.screenshot(path=str(a.output/'lan-guest-gun-feedback.png'))
 for page in [host,guest]:page.evaluate('__glory.quit()')
 report['lan']=lan;report['browserErrors']=errors;(a.output/'results.json').write_text(json.dumps(report,ensure_ascii=False,indent=2));print(json.dumps(report,ensure_ascii=False));b.close();assert not report['errors'] and not errors,report
