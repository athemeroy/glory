"""Real two-browser lobby/ICE flow. Usage: python check-room-flow.py BASE OUT_DIR"""
import json,sys
from pathlib import Path
from playwright.sync_api import sync_playwright
base=sys.argv[1].rstrip('/')+'/'
out=Path(sys.argv[2]);out.mkdir(parents=True,exist_ok=True)
with sync_playwright() as pw:
    browser=pw.chromium.launch(channel='chrome',headless=True,args=['--ignore-gpu-blocklist','--enable-gpu','--use-angle=metal','--mute-audio'])
    contexts=[browser.new_context(viewport={'width':1280,'height':800}),browser.new_context(viewport={'width':390,'height':844},is_mobile=True,has_touch=True)]
    pages=[c.new_page() for c in contexts]; errors=[]
    for page in pages:
        page.set_default_timeout(45000)
        page.on('pageerror',lambda e:errors.append(str(e)))
        page.goto(base,wait_until='networkidle');page.click('#enter');page.evaluate('window.__glory.openNet()');page.wait_for_selector('#create')
        page.locator('.net-manual').evaluate('(e)=>e.open=true')
    host,guest=pages
    host.click('#mk-offer');host.wait_for_function("document.querySelector('.code-out').value.length > 20")
    assert '房主（1 / 2）' in host.locator('.net-room').inner_text()
    assert host.locator('#create').is_disabled() and host.locator('#join').is_disabled()
    assert host.locator('#leave-room').is_visible()
    offer=host.locator('.code-out').input_value()
    host.locator('.code-paste').fill(offer);host.click('#use-code')
    assert '请粘贴访客发回的回复码' in host.locator('.net-room').inner_text()
    assert host.locator('#use-code').is_enabled()
    host.screenshot(path=str(out/'host-waiting.jpg'))
    guest.locator('.code-paste').fill(offer);guest.click('#use-code')
    guest.wait_for_function("document.querySelector('.code-out').value.length > 20")
    answer=guest.locator('.code-out').input_value()
    assert '访客（等待确认）' in guest.locator('.net-room').inner_text()
    guest.screenshot(path=str(out/'guest-reply-mobile.jpg'))
    # Human transfer can take longer than the former 20-second timeout.
    guest.wait_for_timeout(25000)
    assert guest.locator('#leave-room').is_visible()
    host.locator('.code-paste').fill(answer);host.click('#use-code');host.wait_for_selector('#start')
    guest.wait_for_function("document.querySelector('.net-room').textContent.includes('等待房主开始')")
    host.screenshot(path=str(out/'host-connected.jpg'))
    for page in pages:
        page.click('#leave-room');assert page.locator('#create').is_enabled();assert not page.locator('#leave-room').is_visible()
    # Room-number path, including password errors followed by a valid retry.
    host.locator('.pw-new').fill('room-test');host.click('#create');host.wait_for_selector('.big-code');room=host.locator('.big-code').inner_text()
    guest.locator('.code-in').fill(room);guest.locator('.pw-join').fill('wrong');guest.click('#join')
    guest.wait_for_function("document.querySelector('.net-room').textContent.includes('密码不对')")
    guest.locator('.pw-join').fill('room-test');guest.click('#join');host.wait_for_selector('#start')
    guest.wait_for_function("document.querySelector('.net-room').textContent.includes('等待房主开始')")
    assert not errors,errors
    results={'manualTwoWayExchange':True,'hostRoomAndLockedActions':True,'offerAsAnswerRetry':True,'replyAfter25Seconds':True,'leaveAndRecreate':True,'roomNumberPasswordRetry':True,'desktopAndMobile':True,'errors':errors}
    (out/'results.json').write_text(json.dumps(results,ensure_ascii=False,indent=2));print(json.dumps(results))
    for c in contexts:c.close()
    browser.close()
