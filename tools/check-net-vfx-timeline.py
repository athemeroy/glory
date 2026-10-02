"""One real LAN room: delayed melee callback dedupe and paused area recovery."""
import argparse
import json
from pathlib import Path
from playwright.sync_api import sync_playwright

p=argparse.ArgumentParser();p.add_argument('base');p.add_argument('output',type=Path);a=p.parse_args();a.output.mkdir(parents=True,exist_ok=True)
with sync_playwright()as pw:
    browser=pw.chromium.launch(channel='chrome',headless=True,args=['--ignore-gpu-blocklist','--enable-gpu','--use-angle=metal','--mute-audio'])
    contexts=[browser.new_context(viewport={'width':960,'height':540})for _ in range(2)];host,guest=[c.new_page()for c in contexts];errors=[]
    for i,(page,acc)in enumerate([(host,'bzrq'),(guest,'skse')]):
        page.on('pageerror',lambda e,i=i:errors.append(f'{i}: {e}'));page.add_init_script("localStorage.setItem('glory.seenHelp','true');localStorage.setItem('glory.settings',JSON.stringify({attract:false,quality:'medium',shake:false}));")
        page.goto(a.base+f'/index.html?auto=training&manual=1&acc={acc}&view=tp',wait_until='domcontentloaded');page.wait_for_function('window.__glory?.game?.player && !window.__glory.game.inputFrozen',timeout=90000);page.wait_for_load_state('networkidle')
        page.evaluate('acc=>{const app=window.__glory;app.endMode();app.menu.sel.account=acc;app.openNet()}',acc);page.wait_for_selector('#create')
    host.fill('.pw-new','timeline-test');host.click('#create');host.wait_for_selector('.net-room b.big-code',timeout=15000)
    code=host.inner_text('.net-room b.big-code');guest.fill('.code-in',code);guest.fill('.pw-join','timeline-test');guest.click('#join');host.wait_for_selector('#start',timeout=30000);host.click('[data-l="clocktower"]');host.click('#start')
    for page in [host,guest]:
        page.wait_for_function('window.__glory?.mode?.player && window.__glory.game.mode && !window.__glory._loadingMode',timeout=90000);page.wait_for_load_state('networkidle');page.evaluate('()=>{const g=window.__glory.game;g.manual=false;g.paused=false;g.inputFrozen=true;g.cinematic=null;g.aiFrozen=true;}')
    guest.wait_for_function('window.__glory.mode.snaps?.length>0',timeout=10000)
    host.evaluate('''()=>{
      const m=window.__glory.mode,g=m.game;g.combat.clear();g.vfx.clear();for(const f of [m.player,m.enemy]){f.resetState();f.maxHp=999999;f.hp=f.maxHp;f.mp=f.maxMp;f.cd={};}
      m.player.pos.set(-3,0,-12);m.enemy.pos.set(3,0,-12);m.player.yaw=Math.PI/2;m.enemy.yaw=-Math.PI/2;m.player.aimDir.set(1,0,0);m.enemy.aimDir.set(-1,0,0);g.viewYaw=m.player.yaw;g.viewPitch=0;
      window.__sentEffects=[];const send=m.net.relay;m.net.relay=function(packet){if(packet.k==='snap')for(const e of packet.ev||[])window.__sentEffects.push(e);return send.call(this,packet);};
    }''')
    guest.evaluate('''()=>{
      const g=window.__glory.game;g.viewYaw=-Math.PI/2;g.viewPitch=0;g.vfx.clear();window.__effectCalls={burst:0,slash:0};
      for(const name of ['burst','slash']){const original=g.vfx[name];g.vfx[name]=function(...args){window.__effectCalls[name]++;return original.apply(this,args);};}
    }''')
    guest.wait_for_timeout(250);host.evaluate('window.__glory.mode.player.startAction(window.__glory.mode.player.cls.skills.s6,"s6")');guest.wait_for_function('window.__effectCalls.burst===1',timeout=3000)
    guest.screenshot(path=str(a.output/'delayed-low-sweep-lan.jpg'),quality=85,type='jpeg');guest.wait_for_timeout(450)
    calls=guest.evaluate('window.__effectCalls');assert calls==dict(burst=1,slash=0),calls
    wire=host.evaluate('window.__sentEffects');duplicate=[e for e in wire if e[0]=='V'and e[1]in ['burst','slash']];assert not duplicate,duplicate
    guest.evaluate('()=>{const g=window.__glory.game,m=window.__glory.mode;g.manual=true;g.vfx.clear();m.areaVisuals.clear();}')
    host.evaluate('()=>{const m=window.__glory.mode,g=m.game;g.combat.clear();g.vfx.clear();for(const f of [m.player,m.enemy]){f.resetState();f.cd={};f.mp=f.maxMp;}m.enemy.startAction(m.enemy.cls.skills.s3,"s3");}')
    guest.wait_for_timeout(1600);guest.evaluate('window.__glory.game.manual=false');guest.wait_for_function('window.__glory.game.vfx.getStats().zones===1 && window.__glory.mode.pendingEvents.length===0',timeout=5000)
    restored=guest.evaluate('()=>{const g=window.__glory.game,m=window.__glory.mode;return {zones:g.vfx.getStats().zones,errors:m.replayErrors,pending:m.pendingEvents.length,named:g.scene.getObjectByName("skill-zone-confusion-rain")?.name}}');assert restored['zones']==1 and restored['named']=='skill-zone-confusion-rain'and not restored['errors'],restored
    guest.screenshot(path=str(a.output/'paused-rain-recovered.jpg'),quality=85,type='jpeg')
    cleanup=[]
    for page in [host,guest]:
        data=page.evaluate('()=>{const app=window.__glory,g=app.game;app.quit();return {actors:g.fighters.length,items:g.vfx.getStats().items,particles:g.vfx.getStats().particles}}');assert data==dict(actors=0,items=0,particles=0),data;cleanup.append(data)
    assert not errors,errors
    report=dict(calls=calls,wire=wire,restored=restored,cleanup=cleanup,errors=errors);(a.output/'results.json').write_text(json.dumps(report,ensure_ascii=False,indent=2));print(json.dumps(dict(calls=calls,duplicateWire=len(duplicate),restored=restored,errors=errors),ensure_ascii=False));browser.close()
