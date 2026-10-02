import argparse, json, pathlib
from playwright.sync_api import sync_playwright

ap = argparse.ArgumentParser(); ap.add_argument('base'); ap.add_argument('output', type=pathlib.Path)
args = ap.parse_args(); args.output.mkdir(parents=True, exist_ok=True)
with sync_playwright() as pw:
    browser = pw.chromium.launch(channel='chrome', headless=True, args=['--ignore-gpu-blocklist', '--enable-gpu', '--use-angle=metal', '--mute-audio'])
    page = browser.new_page(viewport={'width': 1280, 'height': 720}); errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.goto(args.base.rstrip('/') + '/index.html?auto=training&acc=wblx&manual=1&view=tp', wait_until='networkidle', timeout=90000)
    page.wait_for_function('window.__glory?.game?.player && !window.__glory.game.inputFrozen', timeout=90000)
    report = page.evaluate("async()=>{const {checkWitchFlight}=await import('./tools/check-witch-flight.js');return checkWitchFlight(window.__glory)}")
    report['browserErrors'] = errors
    page.evaluate('''()=>{const g=window.__glory.game,f=g.player;for(const o of g.fighters)if(o!==f)o.rig.root.visible=false;f.resetState();f.pos.set(0,0,-2);f.yaw=0;f.jumpHeld=true;f.wantJump=true;f.update(1/60);f.wantJump=true;for(let i=0;i<70;i++)f.update(1/60);f.moveInput.set(.3,1);g.hud.show(false);g.camHook=cam=>{cam.position.set(3,f.pos.y+1.5,f.pos.z+4);cam.lookAt(f.pos.x,f.pos.y+.8,f.pos.z);};g.render();}''')
    page.screenshot(path=str(args.output / 'witch-broom-flight.png'))
    (args.output / 'results.json').write_text(json.dumps(report, ensure_ascii=False, indent=2)); print(json.dumps(report, ensure_ascii=False))
    browser.close()
    assert not report['errors'] and not errors, report
