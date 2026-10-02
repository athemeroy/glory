"""Exercise the real client lobby, account preparation and saved choices on Mini Chrome/Metal."""
import argparse,json
from pathlib import Path
from playwright.sync_api import sync_playwright
ap=argparse.ArgumentParser();ap.add_argument('base');ap.add_argument('output',type=Path);args=ap.parse_args();args.output.mkdir(parents=True,exist_ok=True)
reports=[]
with sync_playwright() as pw:
 b=pw.chromium.launch(channel='chrome',headless=True,args=['--ignore-gpu-blocklist','--enable-gpu','--use-angle=metal','--mute-audio'])
 for w,h,mobile in [(1440,900,False),(390,844,True),(844,390,True),(360,740,True)]:
  c=b.new_context(viewport={'width':w,'height':h},is_mobile=mobile,has_touch=mobile,device_scale_factor=1)
  page=c.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
  page.goto(args.base.rstrip('/')+'/');page.wait_for_load_state('networkidle');page.wait_for_function('window.__glory?.menu')
  page.click('#enter');page.wait_for_selector('.lobby-screen');page.evaluate('window.__glory.game.preload()');page.wait_for_timeout(400)
  assert page.locator('.lobby-mode').count()==7
  assert page.locator('.lobby-viewer canvas').count()==1
  page.screenshot(path=str(args.output/f'lobby-{w}.jpg'),type='jpeg',quality=92)
  page.locator('[data-mode="duel"]').click();assert page.locator('.lobby-play h2').inner_text()=='个人赛'
  page.click('#configure');page.wait_for_selector('.selection-screen')
  page.get_by_role('button',name='法师',exact=True).click();page.locator('.roster-panel [data-account="wblx"]').click()
  assert page.locator('.selection-summary').inner_text().find('王不留行')>=0
  assert page.locator('.selection-detail .viewer-tag').inner_text().find('灭绝星尘')>=0
  page.locator('.skill-details summary').click();assert page.locator('.skill-details').get_attribute('open') is not None
  page.locator('.viewer-demo').click();assert page.locator('.viewer-demo').get_attribute('aria-pressed')=='true'
  page.locator('.viewer-demo').click();assert page.locator('.viewer-demo').get_attribute('aria-pressed')=='false'
  page.locator('.skill-details summary').click();page.wait_for_timeout(250)
  page.screenshot(path=str(args.output/f'selection-{w}.jpg'),type='jpeg',quality=92)
  layout=page.evaluate('''()=>{const all=[...document.querySelectorAll('.setup-head,.setup-foot,.setup-body')].map(e=>({cls:e.className,x:e.getBoundingClientRect().x,right:e.getBoundingClientRect().right,bottom:e.getBoundingClientRect().bottom}));return {overflow:document.documentElement.scrollWidth>innerWidth,regions:all,go:document.querySelector('#go').getBoundingClientRect().toJSON()};}''')
  assert not layout['overflow'] and layout['go']['right']<=w+1 and layout['go']['bottom']<=h+1,layout
  page.click('#back');assert '王不留行' in page.locator('.lobby-identity').inner_text()
  page.click('#set');page.wait_for_selector('.settings-box');assert page.locator('#setting-aimAssist').count()==1
  assert page.get_by_role('tab').count()==3
  page.locator('#setting-aimAssist').check();assert page.evaluate('window.__glory.game.settings.aimAssist') is True
  page.locator('#setting-aimAssist').uncheck()
  page.get_by_role('tab',name='画面',exact=True).click();assert page.locator('#setting-quality').is_visible()
  assert not page.locator('#setting-aimAssist').is_visible()
  page.get_by_role('tab',name='声音',exact=True).click();assert page.locator('#setting-music').is_visible()
  page.screenshot(path=str(args.output/f'settings-{w}.jpg'),type='jpeg',quality=90)
  page.get_by_role('button',name='完成',exact=True).click()
  page.click('#help');assert page.locator('.handbook-nav button').count()==5
  for topic in ['start','awareness','status','team','classes']:
   page.locator(f'[data-topic="{topic}"]').click()
   assert page.locator(f'[data-topic="{topic}"]').get_attribute('aria-pressed')=='true'
   assert '{special}' not in page.locator('.handbook-article').inner_text()
  page.screenshot(path=str(args.output/f'handbook-{w}.jpg'),type='jpeg',quality=92)
  page.click('#guide-back')
  if not mobile:
   page.locator('[data-mode="team"]').click();page.click('#configure')
   original=page.locator('select[aria-label="我方第1位"]').input_value()
   second=page.locator('select[aria-label="我方第2位"]').input_value()
   page.locator('select[aria-label="我方第2位"]').select_option(original)
   team=page.evaluate('window.__glory.menu.sel')
   assert len(set(team['teamA']))==3 and team['account']==team['teamA'][0]==second,team
   page.click('#back');page.locator('[data-mode="story"]').click();page.click('#configure')
   assert page.locator('.story-chapter:disabled').count()==2
   page.click('#back');page.locator('[data-mode="training"]').click();page.click('#configure')
   page.get_by_role('button',name='法师',exact=True).click();page.locator('.roster-panel [data-account="wblx"]').click();page.click('#back')
  if not mobile:
   page.locator('[data-mode="training"]').click();page.click('#play-now');page.wait_for_function('window.__glory.game.player && !window.__glory._loadingMode',timeout=90000)
   assert page.evaluate('window.__glory.game.player.clsId')=='witch'
   assert page.evaluate("window.__glory.mode.goals.some(g=>g.id==='flight')")
   assert page.locator('.goal-box .g').count()==3
   page.wait_for_timeout(500);page.screenshot(path=str(args.output/f'training-{w}.jpg'),type='jpeg',quality=92)
   page.evaluate('window.__glory.quit()');page.wait_for_selector('.lobby-screen');assert page.locator('.lobby-viewer canvas').count()==1
   page.click('#help');page.locator('[data-topic="classes"]').click();page.locator('.guide-practice[data-account="mg"]').first.click()
   page.wait_for_function("window.__glory.game.player?.clsId==='summoner' && !window.__glory._loadingMode",timeout=90000)
   assert page.evaluate("window.__glory.mode.goals.some(g=>g.id==='formation')")
   profiles=page.evaluate("""async()=>{const {trainingGoals}=await import('./src/data/training.js');const {ACCOUNTS,CLASSES}=await import('./src/data/classes.js');const {HANDBOOK}=await import('./src/data/handbook.js');return {profiles:ACCOUNTS.map(a=>({cls:a.cls,goals:trainingGoals({clsId:a.cls,cls:CLASSES[a.cls]}).map(g=>g.id)})),invalid:HANDBOOK.flatMap(t=>[t.practice,...t.cards.map(c=>c[2])]).filter(id=>id&&!ACCOUNTS.some(a=>a.id===id))}}""")
   assert not profiles['invalid'],profiles
   assert len(profiles['profiles'])==13 and all('basic' in p['goals'] for p in profiles['profiles'])
   page.evaluate('window.__glory.quit()');page.wait_for_selector('.lobby-screen')
  assert not errors,errors
  reports.append({'viewport':[w,h],'mobile':mobile,'layout':layout,'errors':errors,'selectionPersisted':True,'modes':7});c.close()
 b.close()
(args.output/'results.json').write_text(json.dumps(reports,ensure_ascii=False,indent=2));print(json.dumps(reports,ensure_ascii=False))
