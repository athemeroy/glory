"""Two independent browser contexts, actual LAN signaling/WebRTC and VFX snapshots."""
import argparse
import json
import time
from pathlib import Path
from playwright.sync_api import sync_playwright

p=argparse.ArgumentParser();p.add_argument('base');p.add_argument('output',type=Path);a=p.parse_args();a.output.mkdir(parents=True,exist_ok=True)
reports=[]
with sync_playwright() as pw:
    browser=pw.chromium.launch(channel='chrome',headless=True,args=['--ignore-gpu-blocklist','--enable-gpu','--use-angle=metal','--mute-audio'])
    for label,host_acc,guest_acc,cases in [
        ('brawl-shadow','bzrq','yr',[('host','s1','sand'),('host','s2','brick'),('host','s5','needle'),('guest','s6','knives')]),
        ('curse-holy','skse','xsbl',[('host','s3','confusion-rain'),('host','s6','shadow-fire'),('guest','s2','holy-hammer'),('guest','s5','cleanse'),('guest','s6','holy-edict')]),
        ('sleep-smoke','yr','xsbl',[('host','s4','smoke'),('guest','s2','sleep-curse')]),
        ('alchemy-artillery','wblx','myc',[('host','s2','ice-flask'),('host','s5','root-flask'),('guest','s1','heavy-shell')]),
    ]:
        contexts=[browser.new_context(viewport={'width':960,'height':540}) for _ in range(2)]
        pages=[ctx.new_page() for ctx in contexts];host,guest=pages;errors=[]
        for index,(page,acc) in enumerate(zip(pages,[host_acc,guest_acc])):
            page.on('pageerror',lambda e,index=index:errors.append(f'{index}: {e}'))
            page.add_init_script("localStorage.setItem('glory.seenHelp','true');localStorage.setItem('glory.settings',JSON.stringify({attract:false,quality:'medium',shake:false}));localStorage.setItem('glory.skillLoadouts',JSON.stringify({cleric:{s2:'"+('cuimian' if label=='sleep-smoke' else 'chengjie')+"',s5:'jinghua',s6:'shengjie'}}));")
            page.goto(a.base+f'/index.html?auto=training&manual=1&acc={acc}&view=tp',wait_until='domcontentloaded')
            page.wait_for_function('window.__glory?.game?.player && !window.__glory.game.inputFrozen',timeout=90000);page.wait_for_load_state('networkidle')
            page.evaluate('acc=>{const app=window.__glory;app.game.settings.attract=false;app.endMode();app.menu.sel.account=acc;app.openNet()}',acc)
            page.wait_for_selector('#create')
        host.fill('.pw-new','vfx-local-test');host.click('#create');host.wait_for_selector('.net-room b.big-code',timeout=15000)
        code=host.inner_text('.net-room b.big-code');guest.fill('.code-in',code);guest.fill('.pw-join','vfx-local-test');guest.click('#join')
        host.wait_for_selector('#start',timeout=30000)
        level={'curse-holy':'clocktower','sleep-smoke':'frostbridge'}.get(label,'courtyard')
        host.click(f'[data-l="{level}"]');host.click('#start')
        for page in pages:
            page.wait_for_function('window.__glory?.mode?.player && window.__glory.game.mode && !window.__glory._loadingMode',timeout=90000)
            page.wait_for_load_state('networkidle')
        for page in pages:page.evaluate('()=>{const g=window.__glory.game;g.manual=false;g.paused=false;g.inputFrozen=true;g.cinematic=null;g.settings.shake=false}')
        guest.wait_for_function('window.__glory.mode.snaps?.length>0',timeout=15000)
        loaded_levels=[page.evaluate('window.__glory.game.level.id')for page in pages]
        assert loaded_levels==[level,level],loaded_levels
        print('connected',label,flush=True)
        guest.wait_for_timeout(350)
        selection=guest.evaluate('()=>{const m=window.__glory.mode;return {host:m.enemy.cls.skillSelection,guest:m.player.cls.skillSelection}}')
        samples=[]
        for side,slot,expected in cases:
            guest.evaluate('()=>{const g=window.__glory.game;g.viewYaw=-Math.PI/2;g.viewPitch=0}')
            host.evaluate('([side,slot])=>{const app=window.__glory,g=app.game,m=app.mode;g.inputFrozen=true;g.vfx.clear();g.combat.clear();for(const f of g.fighters){f.resetState();f.maxHp=999999;f.hp=f.maxHp;f.mp=f.maxMp;f.cd={};f.stamina=f.maxStamina;}const p=m.player,e=m.enemy,z=g.level.id===\'clocktower\'?-12:g.level.id===\'frostbridge\'?-18:0;p.pos.set(-4,0,z);e.pos.set(4,0,z);p.yaw=Math.PI/2;e.yaw=-Math.PI/2;p.pitch=e.pitch=0;p.aimDir.set(1,0,0);e.aimDir.set(-1,0,0);g.viewYaw=p.yaw;g.viewPitch=0;g.timeScale=1;const f=side===\'host\'?p:e;f.updateModel(1/60);f.startAction(f.cls.skills[slot],slot)}',[side,slot])
            found=None;deadline=time.time()+3.8
            while time.time()<deadline:
                state=guest.evaluate('()=>{const m=window.__glory.mode,g=m.game;return {profiles:[...m.projs.values()].map(o=>o.userData.profile),projectiles:m.projs.size,zones:g.vfx.skills.zones.size,cleanse:!!g.scene.getObjectByName("skill-cleanse"),stats:g.vfx.getStats(),replayErrors:m.replayErrors}}')
                if expected in state['profiles'] or expected in ['confusion-rain','shadow-fire','smoke'] and state['zones']>0 or expected=='cleanse' and state['cleanse']:
                    found=state;break
                guest.wait_for_timeout(20)
            assert found is not None,(label,side,slot,expected,state)
            assert not found['replayErrors'],found
            samples.append(dict(side=side,slot=slot,expected=expected,evidence=found))
            print('sample',label,side,slot,expected,flush=True)
            guest.screenshot(path=str(a.output/f'{label}-{side}-{slot}.jpg'),quality=85,type='jpeg')
            guest.wait_for_timeout(250)
        delayed=None
        if label=='curse-holy':
            guest.evaluate('()=>{const g=window.__glory.game,m=window.__glory.mode;g.vfx.clear();m.areaVisuals.clear();g.manual=true}')
            host.evaluate('()=>{const m=window.__glory.mode,g=m.game;g.vfx.clear();g.combat.clear();m.player.resetState();m.player.cd={};m.player.mp=m.player.maxMp;m.player.startAction(m.player.cls.skills.s3,"s3")}')
            # Pause guest simulation past the original activation flash. Reliable
            # messages still arrive; current area snapshots restore the rain.
            guest.wait_for_timeout(1600);guest.evaluate('window.__glory.game.manual=false')
            guest.wait_for_function('!!window.__glory.game.scene.getObjectByName("skill-zone-confusion-rain")',timeout=5000)
            delayed=guest.evaluate('()=>({zones:window.__glory.game.vfx.getStats().zones,pending:window.__glory.mode.pendingEvents.length,errors:window.__glory.mode.replayErrors})')
            assert delayed['zones']==1 and not delayed['errors'],delayed
        host.evaluate('()=>{const m=window.__glory.mode,g=m.game;g.combat.clear();g.vfx.clear();m.player.resetState();m.enemy.resetState();m.player.stamina=42;m.player.staminaDelay=10000;for(const type of [\'frozen\',\'silence\',\'poison\',\'armorBreak\',\'confuse\'])m.enemy.addEffect({type,t:3000,debuff:true});m.player.addEffect({type:\'shield\',t:3000,amount:321});}')
        guest.wait_for_function("window.__glory.mode.enemy.stamina===42 && window.__glory.mode.player.effects.some(e=>e.type==='frozen') && window.__glory.mode.enemy.effects.some(e=>e.type==='shield'&&e.amount===321)",timeout=5000)
        ongoing=guest.evaluate('()=>{const m=window.__glory.mode;return {hostStamina:m.enemy.stamina,hostEffects:m.enemy.effects,guestEffects:m.player.effects,stats:m.game.vfx.getStats()}}')
        assert ongoing['stats']['statuses']>=6,ongoing
        guest.screenshot(path=str(a.output/f'{label}-ongoing-statuses.jpg'),quality=85,type='jpeg')
        host.evaluate('()=>{const m=window.__glory.mode;for(const f of [m.player,m.enemy])f.effects=[];}')
        guest.wait_for_function('window.__glory.game.vfx.getStats().statuses===0',timeout=5000)
        for page in pages:page.evaluate('window.__glory.quit()')
        clean=[]
        for page in pages:
            data=page.evaluate('()=>{const g=window.__glory.game;return {fighters:g.fighters.length,stats:g.vfx.getStats(),errors:window.__errs}}');assert data['fighters']==0 and data['stats']['items']==0 and data['stats']['particles']==0,data;clean.append(data)
        assert not errors,errors
        reports.append(dict(room=label,level=level,loaded_levels=loaded_levels,selection=selection,samples=samples,delayed=delayed,ongoing=ongoing,clean=clean,errors=errors))
        for ctx in contexts:ctx.close()
    browser.close()
(a.output/'results.json').write_text(json.dumps(reports,ensure_ascii=False,indent=2));print(json.dumps({'rooms':len(reports),'samples':sum(len(r['samples'])for r in reports),'errors':[e for r in reports for e in r['errors']]},ensure_ascii=False))
