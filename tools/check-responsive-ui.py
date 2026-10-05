#!/usr/bin/env python3
"""DOM-only responsive regression: production menu + HUD, no WebGL requirement.

Run against a local server: python tools/check-responsive-ui.py http://localhost:8780
Requires an existing Playwright/Chromium installation. Screenshots are explicitly
layout fixtures; this does not certify rendered character art or 3D gameplay.
"""
import argparse
import json
from pathlib import Path
from playwright.sync_api import sync_playwright
from browser_qa import confine_to_local

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('url')
parser.add_argument('--browser')
parser.add_argument('--output', type=Path, default=Path('/tmp/glory-responsive-ui'))
a = parser.parse_args()
a.output.mkdir(parents=True, exist_ok=True)
viewports = [(320, 568), (360, 740), (390, 844), (600, 700), (700, 635),
             (752, 688), (768, 1024), (841, 701), (1024, 768),
             (667, 375), (844, 390), (1280, 320), (1280, 400), (1440, 400), (1440, 900)]
reports = []


def check_regions(page, selectors, touch_targets=False):
    problems = page.evaluate('''({selectors, touchTargets}) => {
      const bad=[];
      for (const selector of selectors) for (const el of document.querySelectorAll(selector)) {
        const r=el.getBoundingClientRect();
        if (!el.getClientRects().length || getComputedStyle(el).visibility === 'hidden') continue;
        if (r.left < -.5 || r.top < -.5 || r.right > innerWidth+.5 || r.bottom > innerHeight+.5)
          bad.push('outside: '+selector+' '+JSON.stringify(r.toJSON()));
        if (touchTargets && (r.width<44 || r.height<44)) bad.push('small: '+selector);
        if (touchTargets && !el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))) bad.push('covered: '+selector);
      }
      return bad;
    }''', {'selectors': selectors, 'touchTargets': touch_targets})
    assert not problems, problems


def check_combat(page):
    return page.evaluate('''() => {
      const els=[...document.querySelectorAll('.skill-bar button,.form-bar button,#touch-controls button,.touch-stick')]
        .filter(e=>e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden');
      const bad=[];
      for (const e of els) {
        const r=e.getBoundingClientRect(), name=e.getAttribute('aria-label');
        if(r.left<-.5||r.top<-.5||r.right>innerWidth+.5||r.bottom>innerHeight+.5)bad.push('outside '+name);
        if(r.width<44||r.height<44)bad.push('small '+name);
        if(!e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)))bad.push('covered '+name);
      }
      for(let i=0;i<els.length;i++) for(let j=i+1;j<els.length;j++) {
        const x=els[i].getBoundingClientRect(),y=els[j].getBoundingClientRect();
        if(Math.min(x.right,y.right)-Math.max(x.left,y.left)>.5 && Math.min(x.bottom,y.bottom)-Math.max(x.top,y.top)>.5)
          bad.push('overlap '+els[i].getAttribute('aria-label')+' / '+els[j].getAttribute('aria-label'));
      }
      return bad;
    }''')


with sync_playwright() as pw:
    browser = pw.chromium.launch(headless=True, chromium_sandbox=True, args=['--disable-gpu'],
                                **({'executable_path': a.browser} if a.browser else {}))
    for width, height in viewports:
        mobile = width < 1200
        context = browser.new_context(viewport={'width': width, 'height': height}, has_touch=mobile,
                                      is_mobile=mobile, device_scale_factor=1)
        blocked = confine_to_local(context, a.url)
        page = context.new_page()
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.goto(a.url.rstrip('/')+'/tools/responsive-ui-fixture.html?touch='+str(int(mobile)))
        page.wait_for_function('window.__ready')
        page.evaluate('document.fonts.ready')
        check_regions(page, ['.lobby-header', '.lobby-body', '.lobby-character', '.lobby-play', '.lobby-launch'])
        check_regions(page, ['#play-now', '#configure', '#choose-account', '#help', '#set'], mobile)
        assert page.locator('.lobby-screen').evaluate('(e)=>e.scrollWidth<=e.clientWidth')
        page.screenshot(path=str(a.output/f'lobby-layout-{width}x{height}.png'))
        # Selecting a carousel item must preserve an actionable start button.
        page.locator('[data-mode="duel"]').click()
        check_regions(page, ['#play-now', '#configure'], mobile)
        page.locator('#configure').click()
        check_regions(page, ['.setup-head', '.setup-body', '.setup-foot'])
        check_regions(page, ['#go', '#back'], mobile)
        page.get_by_role('button', name='法师', exact=True).click()
        page.locator('.roster-panel [data-account="wblx"]').click()
        assert '王不留行' in page.locator('.selection-summary').inner_text()
        page.locator('.skill-details summary').click()
        assert page.locator('.skill-details').get_attribute('open') is not None
        assert page.locator('.setup-body').evaluate('(e)=>e.scrollWidth<=e.clientWidth')
        # Match options are reachable by normal scrolling, never clipped horizontally.
        page.get_by_role('button', name='霜桥遗迹', exact=True).click()
        check_regions(page, ['#go'], mobile)
        page.locator('#go').click()
        assert page.evaluate('__lastLaunch.mode === "duel" && __lastLaunch.account === "wblx"')
        page.locator('.setup-body').evaluate('(e)=>e.scrollTop=0')
        page.screenshot(path=str(a.output/f'selection-layout-{width}x{height}.png'))
        page.locator('#back').click()
        assert '王不留行' in page.locator('.lobby-identity').inner_text()
        page.locator('#choose-account').click()
        check_regions(page, ['#go'], mobile)
        page.locator('#back').click()
        # Safe areas and browser bars: primary action remains reachable on resize.
        if mobile:
            page.evaluate("for(const [k,v] of Object.entries({'--safe-top':'24px','--safe-bottom':'24px'}))document.documentElement.style.setProperty(k,v)")
            # 667×375 explicitly becomes 667×320 with 24px top/bottom insets.
            page.set_viewport_size({'width': width, 'height': max(320, height-100)})
            check_regions(page, ['#play-now', '#configure', '#choose-account'], True)
            page.locator('#configure').click()
            check_regions(page, ['#go', '#back'], True)
            page.evaluate('document.documentElement.removeAttribute("style")')
            page.set_viewport_size({'width': width, 'height': height})
            page.goto(a.url.rstrip('/')+'/tools/combat-ui-fixture.html')
            page.wait_for_function('window.__ready')
            bad = check_combat(page)
            assert not bad, ((width, height), bad)
            page.screenshot(path=str(a.output/f'combat-layout-{width}x{height}.png'))
            page.locator('[data-command="more"]').tap()
            assert not check_combat(page)
            page.locator('[data-command="more"]').tap()
            # Folding/rotation with a held action must release stale touch input.
            button = page.locator('[data-action="attack"]').bounding_box()
            cdp = context.new_cdp_session(page)
            cdp.send('Input.dispatchTouchEvent', {'type':'touchStart','touchPoints':[{'id':1,'x':button['x']+button['width']/2,'y':button['y']+button['height']/2}]})
            assert page.evaluate('__ui.input.held("attack")')
            page.set_viewport_size({'width': height, 'height': width})
            page.wait_for_function('__ui.touch.pointers.size===0 && !__ui.input.held("attack")')
            cdp.send('Input.dispatchTouchEvent', {'type':'touchCancel','touchPoints':[]})
            page.set_viewport_size({'width': width, 'height': height})
            assert not check_combat(page)
        assert not blocked, blocked
        assert not errors, errors
        reports.append({'viewport':[width,height], 'touch':mobile, 'result':'passed', 'evidence':'DOM layout only'})
        context.close()
    browser.close()
(a.output/'results.json').write_text(json.dumps(reports, ensure_ascii=False, indent=2))
print(json.dumps(reports, ensure_ascii=False))
