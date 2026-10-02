"""Real LAN room, local witch flight and remote battlemage chaser input."""
import argparse, json
from pathlib import Path
from playwright.sync_api import sync_playwright

ap=argparse.ArgumentParser();ap.add_argument('base');ap.add_argument('output',type=Path);args=ap.parse_args();args.output.mkdir(parents=True,exist_ok=True)
with sync_playwright() as pw:
    browser=pw.chromium.launch(channel='chrome',headless=True,args=['--ignore-gpu-blocklist','--enable-gpu','--use-angle=metal','--mute-audio'])
    contexts=[browser.new_context(viewport={'width':1280,'height':720})for _ in range(2)];host,guest=[c.new_page()for c in contexts];errors=[]
    for i,(page,acc)in enumerate([(host,'wblx'),(guest,'yyzq')]):
        page.on('pageerror',lambda e,i=i:errors.append(f'{i}: {e}'))
        page.add_init_script("localStorage.setItem('glory.seenHelp','true');localStorage.setItem('glory.binds','{}');localStorage.setItem('glory.settings',JSON.stringify({attract:false,quality:'medium',shake:false}));")
        page.goto(args.base+f'/index.html?auto=training&manual=1&acc={acc}&view=tp',wait_until='networkidle',timeout=90000)
        page.wait_for_function('window.__glory?.game?.player&&!window.__glory.game.inputFrozen',timeout=90000)
        page.evaluate('acc=>{const app=window.__glory;app.endMode();app.menu.sel.account=acc;app.openNet()}',acc);page.wait_for_selector('#create')
    host.fill('.pw-new','class-mechanics');host.click('#create');host.wait_for_selector('.net-room b.big-code',timeout=15000)
    code=host.inner_text('.net-room b.big-code');guest.fill('.code-in',code);guest.fill('.pw-join','class-mechanics');guest.click('#join');host.wait_for_selector('#start',timeout=30000);host.click('#start')
    for page in [host,guest]:
        page.wait_for_function('window.__glory?.mode?.player&&window.__glory.game.mode&&!window.__glory._loadingMode',timeout=90000)
        page.wait_for_load_state('networkidle');page.evaluate('()=>{const g=window.__glory.game;g.manual=false;g.paused=false;g.aiFrozen=true;g.inputFrozen=false;g.cinematic=null;}')
    guest.wait_for_function('window.__glory.mode.snaps?.length>0',timeout=10000)
    host.evaluate('''()=>{const m=window.__glory.mode,g=m.game;for(const f of [m.player,m.enemy]){f.resetState();f.hp=f.maxHp;f.mp=f.maxMp;}m.player.pos.set(-5,0,0);m.enemy.pos.set(5,0,0);g.viewYaw=Math.PI/2;g.viewPitch=0;}''')
    host.keyboard.press('Space');host.wait_for_timeout(100);host.keyboard.down('Space')
    host.wait_for_function('window.__glory.mode.player.flightActive',timeout=5000)
    guest.wait_for_function('window.__glory.mode.enemy.flightActive&&window.__glory.mode.enemy.pos.y>.5',timeout=5000)
    host.wait_for_timeout(500)
    flightHost=host.evaluate('()=>{const f=window.__glory.mode.player;return {active:f.flightActive,y:f.pos.y,sp:f.stamina}}')
    flightGuest=guest.evaluate('()=>{const f=window.__glory.mode.enemy;return {active:f.flightActive,y:f.pos.y,sp:f.stamina}}')
    assert flightHost['active']and flightGuest['active']and abs(flightHost['y']-flightGuest['y'])<.65,(flightHost,flightGuest)
    guest.screenshot(path=str(args.output/'guest-sees-witch-flight.jpg'),type='jpeg',quality=88)
    host.keyboard.up('Space');host.keyboard.press('Shift')
    guest.wait_for_function('!window.__glory.mode.enemy.flightActive',timeout=5000)
    host.wait_for_function('window.__glory.mode.player.onGround',timeout=5000)
    host.evaluate('''()=>{const m=window.__glory.mode,g=m.game;g.combat.clear();g.vfx.clear();for(const f of [m.player,m.enemy]){f.resetState();f.hp=f.maxHp;f.mp=f.maxMp;}m.enemy.pos.set(0,0,0);m.player.pos.set(0,0,2);m.enemy.yaw=0;m.player.yaw=Math.PI;g.viewYaw=Math.PI;g.viewPitch=0;}''')
    guest.evaluate('()=>{const g=window.__glory.game;g.viewYaw=0;g.viewPitch=0;}');guest.wait_for_timeout(200);guest.keyboard.press('c')
    host.wait_for_function('window.__glory.mode.enemy.chasers.some(c=>c.type==="ice")',timeout=5000)
    guest.wait_for_function('window.__glory.mode.player.chasers.some(c=>c.bornHit<window.__glory.mode.player.chaserHitSerial)&&window.__glory.mode.player.chaserWindow>0',timeout=5000)
    ready=guest.evaluate('()=>{const f=window.__glory.mode.player;return {chasers:f.chasers,window:f.chaserWindow,hitSerial:f.chaserHitSerial}}')
    guest.screenshot(path=str(args.output/'guest-chaser-ready.jpg'),type='jpeg',quality=88)
    guest.evaluate('async()=>{const {input}=await import("./src/engine/input.js");input._press(input.binds.special)}')
    try:
        host.wait_for_function('window.__glory.mode.enemy.hasEffect("chaserIce")',timeout=5000)
    except Exception:
        print('HOST_DEBUG',host.evaluate('()=>{const m=window.__glory.mode,g=m.game,f=m.enemy;return {state:f.state,pos:f.pos.toArray(),chasers:f.chasers,window:f.chaserWindow,cd:f.chaserCd,hitSerial:f.chaserHitSerial,want:f.wantChaser,effects:f.effects.map(e=>e.type),input:m.remoteIn,target:f.chaserTarget?.pos.toArray(),projectiles:g.combat.projectiles.map(p=>({kind:p.p.kind,chaser:p.p.chaser,pos:p.pos.toArray()}))}}'))
        print('READY',ready)
        raise
    guest.wait_for_function('window.__glory.mode.player.hasEffect("chaserIce")&&window.__glory.mode.player.chasers.length===0',timeout=5000)
    firedHost=host.evaluate('()=>{const m=window.__glory.mode,f=m.enemy;return {chasers:f.chasers.length,effects:f.effects.map(e=>e.type),targetHp:m.player.hp}}')
    firedGuest=guest.evaluate('()=>{const m=window.__glory.mode,f=m.player;return {chasers:f.chasers.length,effects:f.effects.map(e=>e.type),targetHp:m.enemy.hp,replayErrors:m.replayErrors}}')
    assert firedHost['chasers']==firedGuest['chasers']==0 and 'chaserIce'in firedGuest['effects']and not firedGuest['replayErrors'],(firedHost,firedGuest)
    guest.screenshot(path=str(args.output/'guest-chaser-buff.jpg'),type='jpeg',quality=88)
    cleanup=[]
    for page in [host,guest]:
        data=page.evaluate('()=>{const app=window.__glory,g=app.game;app.quit();return {fighters:g.fighters.length,items:g.vfx.getStats().items,particles:g.vfx.getStats().particles}}');cleanup.append(data);assert data==dict(fighters=0,items=0,particles=0),data
    report=dict(flightHost=flightHost,flightGuest=flightGuest,ready=ready,firedHost=firedHost,firedGuest=firedGuest,cleanup=cleanup,errors=errors)
    (args.output/'results.json').write_text(json.dumps(report,ensure_ascii=False,indent=2));print(json.dumps(report,ensure_ascii=False));browser.close();assert not errors,errors
