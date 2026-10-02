"""A real guest leaves its LAN room by opening a handbook training exercise."""
import argparse,json,pathlib
from playwright.sync_api import sync_playwright
ap=argparse.ArgumentParser();ap.add_argument('base');ap.add_argument('output',type=pathlib.Path);a=ap.parse_args();a.output.mkdir(parents=True,exist_ok=True)
with sync_playwright()as pw:
 b=pw.chromium.launch(channel='chrome',headless=True,args=['--ignore-gpu-blocklist','--enable-gpu','--use-angle=metal','--mute-audio']);contexts=[b.new_context(viewport={'width':1280,'height':720})for _ in range(2)];host,guest=[c.new_page()for c in contexts];errors=[]
 for i,(page,acc)in enumerate([(host,'wblx'),(guest,'yyzq')]):
  page.on('pageerror',lambda e,i=i:errors.append(f'{i}: {e}'));page.add_init_script("localStorage.setItem('glory.seenHelp','true');localStorage.setItem('glory.settings',JSON.stringify({attract:false,quality:'medium',shake:false}));")
  page.goto(a.base+f'/?auto=training&manual=1&acc={acc}',wait_until='networkidle',timeout=90000);page.wait_for_function('window.__glory?.game?.player&&!window.__glory._loadingMode',timeout=90000)
  page.evaluate('''async acc=>{const app=__glory,{net}=await import('./src/engine/net.js');window.testNet=net;window.leftEvents=0;net.on('left',()=>leftEvents++);window.captureOff=net.on('relay',d=>{if(d.k==='go')window.oldGo=structuredClone(d)});app.endMode();app.menu.sel.account=acc;app.openNet()}''',acc);page.wait_for_selector('#create')
 host.fill('.pw-new','handbook-exit');host.click('#create');host.wait_for_selector('.net-room b.big-code',timeout=15000);code=host.inner_text('.net-room b.big-code');guest.fill('.code-in',code);guest.fill('.pw-join','handbook-exit');guest.click('#join');host.wait_for_selector('#start',timeout=30000);host.click('#start')
 for page in [host,guest]:page.wait_for_function('window.__glory?.mode?.player&&!window.__glory._loadingMode',timeout=90000);page.wait_for_load_state('networkidle')
 guest.wait_for_function('window.__glory.modeId==="netguest"&&window.oldGo',timeout=10000)
 guest.evaluate('captureOff()');before=guest.evaluate('({role:testNet.role,room:testNet.room,guestOff:!!__glory._guestOff,netGuest:__glory.game.netGuest})');assert before['role']=='guest'and before['guestOff']and before['netGuest'],before
 guest.keyboard.press('Escape');guest.get_by_role('button',name='荣耀手册',exact=True).click();guest.locator('[data-topic="classes"]').click();guest.locator('[data-account="mg"]').first.click()
 guest.wait_for_function('__glory.modeId==="training"&&__glory.game.player?.clsId==="summoner"&&!__glory._loadingMode',timeout=90000);host.wait_for_function('window.leftEvents>0',timeout=10000)
 after=guest.evaluate('({role:testNet.role,room:testNet.room,guestOff:!!__glory._guestOff,netGuest:__glory.game.netGuest,connected:testNet.connected,mode:__glory.modeId,account:__glory.mode.opts.account.id,cls:__glory.game.player.clsId,paused:__glory.game.paused})')
 assert after['role']is None and after['room']is None and not after['guestOff']and not after['netGuest']and not after['connected']and after['cls']=='summoner'and not after['paused'],after
 guest.evaluate('testNet.emit("relay",oldGo)');guest.wait_for_timeout(500);stale=guest.evaluate('({mode:__glory.modeId,cls:__glory.game.player.clsId,loading:__glory._loadingMode})');assert stale==dict(mode='training',cls='summoner',loading=False),stale
 peer=host.evaluate('({leftEvents,connected:testNet.connected,peerGone:testNet.peerGone})');assert peer['leftEvents']>=1 and not peer['connected'],peer
 guest.screenshot(path=str(a.output/'guest-practicing-summoner.jpg'),type='jpeg',quality=88)
 guest.keyboard.press('Escape');guest.get_by_role('button',name='切换账号卡 / 职业',exact=True).click();guest.locator('[data-account="xsbl"]').click();guest.wait_for_function('__glory.modeId==="training"&&__glory.game.player?.clsId==="cleric"&&!__glory._loadingMode',timeout=90000)
 beforeLoadout=guest.evaluate('({saved:localStorage.getItem("glory.skillLoadouts"),name:__glory.game.player.cls.skills.s2.name})')
 guest.keyboard.press('Escape');guest.get_by_role('button',name='调整招式配置',exact=True).click();guest.locator('.skill-choice select').first.select_option('chengjie');guest.keyboard.press('Escape')
 cancelled=guest.evaluate('({saved:localStorage.getItem("glory.skillLoadouts"),name:__glory.game.player.cls.skills.s2.name})');assert cancelled==beforeLoadout,(beforeLoadout,cancelled)
 guest.keyboard.press('Escape');guest.get_by_role('button',name='调整招式配置',exact=True).click();guest.locator('.skill-choice select').first.select_option('chengjie');guest.get_by_role('button',name='应用并继续',exact=True).click()
 applied=guest.evaluate('({saved:JSON.parse(localStorage.getItem("glory.skillLoadouts")),name:__glory.game.player.cls.skills.s2.name,selection:__glory.game.player.cls.skillSelection.s2,paused:__glory.game.paused,goals:__glory.mode.goals.map(g=>g.id)})');assert applied['saved']['cleric']['s2']==applied['selection']=='chengjie'and applied['name']=='惩戒'and not applied['paused'],applied
 guest.screenshot(path=str(a.output/'cleric-loadout-applied.jpg'),type='jpeg',quality=88)
 loadout=dict(before=beforeLoadout,cancelled=cancelled,applied=applied)
 for page in [host,guest]:page.evaluate('__glory.quit()')
 report=dict(before=before,after=after,staleGo=stale,host=peer,loadout=loadout,errors=errors);(a.output/'results.json').write_text(json.dumps(report,ensure_ascii=False,indent=2));print(json.dumps(report,ensure_ascii=False));b.close();assert not errors,errors
