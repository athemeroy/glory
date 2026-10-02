import argparse,json
from pathlib import Path
from playwright.sync_api import sync_playwright
ap=argparse.ArgumentParser();ap.add_argument('base');ap.add_argument('output',type=Path);args=ap.parse_args();args.output.mkdir(parents=True,exist_ok=True)
with sync_playwright() as pw:
    browser=pw.chromium.launch(channel='chrome',headless=True,args=['--ignore-gpu-blocklist','--enable-gpu','--use-angle=metal','--mute-audio']);reports=[]
    for w,h,touch in [(1440,900,False),(390,844,True)]:
        context=browser.new_context(viewport={'width':w,'height':h},has_touch=touch,is_mobile=touch);page=context.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
        page.goto(args.base.rstrip('/')+'/',wait_until='networkidle');page.wait_for_function('window.__glory?.menu');page.click('#enter');page.evaluate('window.__glory.game.preload()')
        page.click('#choose-account');page.get_by_role('button',name='法师',exact=True).click();page.locator('.roster-panel [data-account="mg"]').click();page.wait_for_load_state('networkidle')
        assert page.evaluate("window.__glory.menu.viewer.modelKey==='warlock' && !!window.__glory.menu.viewer.body")
        assert 'avatars/summoner.png' in page.locator('.roster-panel [data-account="mg"] .ac-portrait').get_attribute('style')
        page.screenshot(path=str(args.output/f'summoner-selection-{w}.jpg'),type='jpeg',quality=92)
        page.click('#go');page.wait_for_function("window.__glory.game.player?.clsId==='summoner'&&!window.__glory._loadingMode",timeout=90000)
        page.evaluate('window.__glory._closeHelp?.(true)');page.wait_for_timeout(600)
        assert 'avatars/summoner.png' in page.locator('.sf-portrait').get_attribute('style')
        assert page.locator('.sf-portrait').bounding_box()['width']>=28
        page.screenshot(path=str(args.output/f'summoner-training-{w}.jpg'),type='jpeg',quality=92)
        assert not errors,errors
        reports.append({'viewport':[w,h],'source':'warlock','summonerPreviewRigged':True,'avatarLoaded':True,'errors':errors});context.close()
    browser.close();(args.output/'results.json').write_text(json.dumps(reports,ensure_ascii=False,indent=2));print(json.dumps(reports))
