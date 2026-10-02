"""GPU recording on Mini; same camera/input sequence for before and after."""
import argparse
import json
from pathlib import Path
import subprocess
from playwright.sync_api import sync_playwright

p = argparse.ArgumentParser()
p.add_argument('base')
p.add_argument('output', type=Path)
p.add_argument('--pilot', action='store_true')
p.add_argument('--fps', type=int, default=24)
a = p.parse_args()
a.output.mkdir(parents=True, exist_ok=True)
results = []
with sync_playwright() as pw:
    browser = pw.chromium.launch(channel='chrome', headless=True,
        args=['--ignore-gpu-blocklist', '--enable-gpu', '--use-angle=metal', '--mute-audio'])
    for view in ['tp', 'fp']:
        page = browser.new_page(viewport={'width': 1280, 'height': 720})
        errors = []
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.goto(a.base + '?auto=training&acc=yysf&manual=1&view=' + view +
                  ('&swordpilot=1' if a.pilot else ''), wait_until='domcontentloaded')
        page.wait_for_function('window.__glory?.game?.player && window.__glory.game.level', timeout=90000)
        page.wait_for_function('!window.__glory.game.inputFrozen', timeout=20000)
        page.wait_for_load_state('networkidle')
        page.evaluate('''() => {
            const g=window.__glory.game, p=g.player;
            p.pos.set(0,0,0); p.yaw=0; g.viewYaw=0; g.viewPitch=0;
            g.settings.shake=false; g.settings.bob=false;
            if(g.post) g.post.pulseAmt=0;
            if(g.mode?.dummy) g.mode.dummy.invuln=999999;
            if(g.viewMode==='tp') g.camHook=(cam,g)=>{
                cam.position.set(g.player.pos.x+2.4,1.45,g.player.pos.z+3.0);
                cam.lookAt(g.player.pos.x,1.0,g.player.pos.z);
            };
            g.debugAdvance(1);
        }''')
        frames = a.output / view
        frames.mkdir(exist_ok=True)
        states = []
        for frame in range(a.fps * 5):
            state = page.evaluate('''dt => {
                const g=window.__glory.game,p=g.player;
                if (!p.action || (p.action.stage==='recover' && p.action.t>=p.action.def.recover*.4)) p.tryUse('atk');
                p.pos.set(0,0,0);
                g.debugAdvance(dt);
                return {clip:p.action?.def.anim,stage:p.action?.stage,chain:p.action?.chainIdx,
                        mocap:p.mocap?.curName};
            }''', 1/a.fps)
            states.append(state)
            page.screenshot(path=str(frames / f'{frame:04d}.jpg'), type='jpeg', quality=88)
        results.append(dict(view=view, errors=errors, states=states))
        page.close()
        subprocess.run(['ffmpeg','-loglevel','error','-y','-framerate',str(a.fps),
            '-i',str(frames/'%04d.jpg'),'-c:v','h264_videotoolbox','-b:v','6M',
            '-pix_fmt','yuv420p',str(a.output/f'{view}.mp4')], check=True)
    browser.close()
(a.output/'results.json').write_text(json.dumps(results, ensure_ascii=False, indent=2))
print(json.dumps([dict(view=r['view'],errors=r['errors'], clips=sorted(set(s['clip'] for s in r['states'] if s.get('clip')))) for r in results]))
