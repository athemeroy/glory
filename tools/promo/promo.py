#!/usr/bin/env python3
"""宣传片素材录制（在 Mini 上跑）：每个镜头逐帧确定性推进 + 截图，编码成 clips/<镜头>.mp4；
同时记录游戏发出的音效/喊招事件，用 mix.html 离线渲染成 sfx/<镜头>.wav，再渲染整段配乐 music.wav。
字幕、转场、标题卡、旁白与混音由 remotion/ 合成（见 remotion/src/data.js）。
用法：promo.py BASE_URL 输出目录      例：promo.py http://192.168.31.6:8780/ remotion/public/rec
环境变量：ONLY=镜头名,...（只重录部分）  RW/RH 分辨率（默认 1920x1080）"""
import sys, os, json, time, shutil, base64, subprocess
from playwright.sync_api import sync_playwright

BASE = sys.argv[1].rstrip('/') + '/'
OUT = sys.argv[2]
W, H = int(os.environ.get('RW', 1920)), int(os.environ.get('RH', 1080))
FPS = 30
TAIL = 0.6  # 每个镜头多录的秒数，给 Remotion 转场重叠用
ONLY = set(filter(None, os.environ.get('ONLY', '').split(',')))

# ---------------------------------------------------------------- 分镜
# kind=card：标题/片尾卡；kind=game：游戏镜头。
# step：每帧推进的模拟秒数（1/30 常速，1/60 半速慢动作）；cam：机位函数体，可用 cam g P E M f t（t=镜头内秒数）
CAM_SMOOTH = """
const S = window._cs || (window._cs = {});
const sm = (k, v, a) => { if (S[k] === undefined) S[k] = v; S[k] += (v - S[k]) * a; return S[k]; };
"""
SHOTS = [
    # 全部第一人称（2026-10-01 用户要求：直接放第一人称各场景，不要旁白）
    dict(kind='game', name='duel', sec=5.0, step=1 / 30, hud=True,
         qs='auto=duel&acc=jmx&enemy=yysf&bot=1&botdiff=god&diff=hard&view=fp', rwait=5200, warm=0.3, place=True),
    dict(kind='game', name='mirror', sec=4.5, step=1 / 30, hud=True,
         qs='auto=training&acc=jmx&view=fp', rwait=1800, warm=0.5, mirror=True,
         script=[(14, 'form:spear'), (30, 'atk'), (50, 'form:gun'), (74, 'form:shield'), (98, 'form:sword'), (112, 'atk')]),
    dict(kind='game', name='charge', sec=5.5, step=1 / 60, hud=True, aim=True,
         qs='auto=duel&acc=lt&enemy=yysf&diff=hard&view=fp', rwait=5200, warm=0.2, freezeEnemy=True, zhendao=True),
    dict(kind='game', name='juggle', sec=5.0, step=1 / 60, hud=True, aim=True,
         qs='auto=duel&acc=yyzq&enemy=lt&diff=hard&view=fp', rwait=5200, warm=0.2, freezeEnemy=True,
         script=[(4, 's1'), (38, 'atk'), (54, 'atk'), (70, 'atk'), (88, 's5'), (112, 'atk'), (128, 'atk')]),
    dict(kind='game', name='ult1', sec=4.5, step=1 / 60, hud=True, aim=True,
         qs='auto=duel&acc=yysf&enemy=dmgy&diff=hard&view=fp', rwait=5200, warm=0.2, freezeEnemy=True, ult=True),
    dict(kind='game', name='ult2', sec=4.5, step=1 / 60, hud=True, aim=True,
         qs='auto=duel&acc=yyzq&enemy=lt&diff=hard&view=fp', rwait=5200, warm=0.2, freezeEnemy=True, ult=True),
    dict(kind='game', name='gunner', sec=4.5, step=1 / 30, hud=True,
         qs='auto=duel&acc=yqcy&enemy=lt&bot=1&botdiff=god&diff=hard&view=fp', rwait=5200, warm=0.3, place=True),
    dict(kind='game', name='mobs', sec=5.0, step=1 / 30, hud=True,
         qs='auto=dungeon&acc=dmgy&bot=1&botdiff=god&view=fp', rwait=2500, warm=3.0),
    dict(kind='game', name='boss', sec=5.5, step=1 / 30, hud=True,
         qs='auto=dungeon&acc=yysf&bot=1&botdiff=god&view=fp', rwait=2500, warm=3.0, boss=True),
    dict(kind='game', name='team', sec=5.0, step=1 / 30, hud=True,
         qs='auto=team&bot=1&diff=hard&botdiff=god&view=fp&ta=yyzq,myc,xsbl&tb=yqcy,skse,lt', rwait=5200, warm=3.2),
]

# ---------------------------------------------------------------- 页面注入
OVERLAY_JS = """(o) => {
  const st = document.createElement('style');
  st.textContent = '.quick-help,.clickplay,.click-play{display:none!important}';
  document.head.appendChild(st);
  if (!o.hud) { for (const id of ['hud', 'menu']) { const e = document.getElementById(id); if (e) e.style.visibility = 'hidden'; } }
  return true;
}"""

HOOK_JS = """async () => {
  const { audio } = await import('./src/engine/audio.js');
  const { voice } = await import('./src/engine/voice.js');
  const { input } = await import('./src/engine/input.js');
  const held = input.held.bind(input);
  input.held = (k) => !!(window._hold && window._hold[k]) || held(k); // 脚本模拟按住（蓄力）
  const g = window.__glory.game; window._ev = [];
  const last = {};
  const log = (e) => { const k = e.t + e.n; if (last[k] !== undefined && e.f - last[k] < 2) return; last[k] = e.f; window._ev.push(e); };
  audio.play = (n, o = {}) => {
    if (/^ui_|^footstep/.test(n)) return;
    let gain = o.vol ?? 1;
    if (o.pos) { const p = Array.isArray(o.pos) ? o.pos : [o.pos.x, o.pos.y, o.pos.z]; const c = g.camera.position;
      const d = Math.hypot(p[0] - c.x, p[1] - c.y, p[2] - c.z); gain *= Math.min(1, 3 / Math.max(0.6, d)); }
    log({ f: window._pf | 0, t: 'sfx', n, g: gain, r: o.rate || 1 });
  };
  audio.loop = () => ({ stop() {}, setPos() {}, setVol() {} });
  voice.play = (n, gain = 1) => { if (/^ult_/.test(n)) log({ f: window._pf | 0, t: 'voice', n, g: gain }); };
  return true;
}"""

def setup_js(s):
    """镜头开拍前的摆位（在倒计时结束之后执行）"""
    parts = ["const g=window.__glory.game, m=window.__glory.mode, P=g.player, E=m.enemy||m.boss||(g.fighters.find(x=>x!==P));"]
    if s.get('place') or s.get('freezeEnemy') or s.get('ult'):
        parts.append("P.pos.set(0,0,0); P.yaw=0; g.viewYaw=0; g.viewPitch=-0.04; if(E){E.pos.set(0,0,2.6); E.yaw=Math.PI;}")
    if s.get('freezeEnemy'):
        parts.append("if(E){E.ai=null; E.moveInput&&E.moveInput.set(0,0); E.wantGuard=false;}")
    if s.get('ult'):
        parts.append("P.pos.set(0,0,3); E.pos.set(0,0,-0.4); P.yaw=Math.PI; E.yaw=0; g.viewYaw=Math.PI; P.mp=P.maxMp||P.mp;")
    if s.get('zhendao'):
        parts.append("E.pos.set(0,0,3.6);")
    if s.get('lineup'):
        parts.append("g.aiFrozen=true; g.inputFrozen=true; const order=%s;" % json.dumps(s['lineup']) +
                     "for(const f of g.fighters){ const i=order.indexOf(f.account&&f.account.id); if(i<0) continue;"
                     " f.pos.set(-3.9+i*1.56,0,0); f.yaw=0; f.vel&&f.vel.set(0,0,0); f.moveInput&&f.moveInput.set(0,0); f.ai=null; f.cheer=(i%2===0); }")
    if s.get('mirror'):
        parts.append("P.pos.set(-2.7,0,0.15); P.yaw=-Math.PI/2; g.viewYaw=-Math.PI/2;")
    if s.get('boss'):
        parts.append("for(const x of m.mobs){x.hp=0; x.die(null);} m.wave=9; g.debugAdvance(0.3); for(const p of m.party){p.pos.set(p.pos.x,0,6);} g.debugAdvance(0.8);")
    parts.append("g.debugAdvance(1/60);")
    if s.get('lineup'):
        parts.append("for(const f of g.fighters){ if(f.mocap) f.mocap.mixer.update(Math.random()*1.6); }")
    return "(()=>{" + "".join(parts) + "return 1})()"

def frame_js(s):
    """每帧：脚本化出招、振刀时机"""
    acts = []
    for fr, what in s.get('script', []):
        if what.startswith('form:'):
            acts.append(f"if(f==={fr}) P.setForm('{what[5:]}');")
        else:
            acts.append(f"if(f==={fr}) P.tryUse('{what}');")
    if s.get('ult'):
        acts.append("if(f===3) P.tryUse('ult');")
    if s.get('zhendao'):
        acts.append("window._hold={attack: f>=6 && f<100}; if(f===6) P.startCharge(); const a=P.action; if(E && a && a.slot==='charge' && a.stage==='wind' && a.t > (a.def.wind||900) - 170) E.wantGuard=true; if(f>120 && E) E.wantGuard=false;")
    if s.get('boss'):
        acts.append("const B=window.__glory.mode.boss; if(B && f===24) B.tryUse('s1');")
    if s.get('mirror'):
        acts.append("if(P.pos.x<-3.0) P.pos.x=-3.0; g.viewYaw=-Math.PI/2+Math.sin(f/40)*0.08; g.viewPitch=-0.06;")
    if s.get('aim'):
        acts.append("if(E){ const dx=E.pos.x-P.pos.x, dz=E.pos.z-P.pos.z, d=Math.hypot(dx,dz)||1; let dy=Math.atan2(E.pos.x-P.pos.x, E.pos.z-P.pos.z)-g.viewYaw; dy=Math.atan2(Math.sin(dy),Math.cos(dy)); g.viewYaw+=dy*0.3;"
                    " const ey=E.pos.y+1.15*(E.scale||1)-(P.pos.y+1.62); g.viewPitch+=(Math.max(-0.45,Math.min(1.0,Math.atan2(ey,d)))-g.viewPitch)*0.25; }")
    if not acts:
        return None
    return "(()=>{const f=window._pf|0, g=window.__glory.game, m=window.__glory.mode, P=g.player, E=m.enemy||m.boss||(g.fighters.find(x=>x!==P));" + "".join(acts) + "return 1})()"

def cam_js(s):
    if not s.get('cam'):
        return None
    fov = s.get('fov', 38)
    return ("(()=>{const g=window.__glory.game; window._cs={}; g.camHook=(cam,g)=>{const f=window._pf|0, t=f/30, m=window.__glory.mode, P=g.player,"
            " E=m.enemy||m.boss||(g.fighters.find(x=>x!==P)); " + s['cam'] +
            f" cam.fov={fov}; cam.updateProjectionMatrix(); }}; return 1}})()")

# ---------------------------------------------------------------- 主流程
def enc(frames_dir, out_mp4):
    subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', '-framerate', str(FPS), '-i', os.path.join(frames_dir, '%05d.jpg'),
                    '-c:v', 'h264_videotoolbox', '-b:v', '16M', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', out_mp4], check=True)

def main():
    for d in ('frames', 'clips', 'events', 'sfx'):
        os.makedirs(os.path.join(OUT, d), exist_ok=True)
    man_path = os.path.join(OUT, 'manifest.json')
    manifest = json.load(open(man_path)) if os.path.exists(man_path) else {}
    with sync_playwright() as p:
        b = p.chromium.launch(channel='chrome', headless=True, args=['--ignore-gpu-blocklist', '--enable-gpu', '--use-angle=metal', '--mute-audio'])
        for s in SHOTS:
            if ONLY and s['name'] not in ONLY:
                continue
            sec = s['sec'] + TAIL
            n = int(round(sec * FPS))
            fr_dir = os.path.join(OUT, 'frames', s['name'])
            shutil.rmtree(fr_dir, ignore_errors=True); os.makedirs(fr_dir)
            t0 = time.time()
            pg = b.new_page(viewport={'width': W, 'height': H})
            pg.goto(f"{BASE}index.html?{s['qs']}&manual=1", wait_until='domcontentloaded')
            pg.wait_for_function('window.__glory && window.__glory.game.player && window.__glory.game.level', timeout=90000)
            pg.wait_for_timeout(s.get('rwait', 3000))
            pg.evaluate(f"window.__glory.game.debugAdvance({s.get('warm', 0.5)})")
            pg.evaluate(HOOK_JS)
            pg.evaluate("window._pf=0")
            pg.evaluate(setup_js(s))
            cj = cam_js(s)
            if cj: pg.evaluate(cj)
            pg.evaluate(OVERLAY_JS, dict(hud=s.get('hud')))
            fj = frame_js(s)
            for i in range(n):
                pg.evaluate(f"window._pf={i}")
                if fj: pg.evaluate(fj)
                pg.evaluate(f"window.__glory.game.debugAdvance({s['step']})")
                pg.screenshot(path=os.path.join(fr_dir, f'{i:05d}.jpg'), type='jpeg', quality=92)
            events = pg.evaluate('window._ev')
            for e in events:
                e['time'] = e.pop('f') / FPS
            errs = pg.evaluate('window.__errs.slice(0,3)')
            pg.close()
            enc(fr_dir, os.path.join(OUT, 'clips', s['name'] + '.mp4'))
            json.dump(events, open(os.path.join(OUT, 'events', s['name'] + '.json'), 'w'), ensure_ascii=False)
            manifest[s['name']] = dict(sec=sec, frames=n, events=len(events))
            print(f"{s['name']:10s} frames {n} events {len(events):3d} {time.time() - t0:5.1f}s errs {errs}", flush=True)
        # 音效分轨与配乐：mix.html 在浏览器里离线渲染
        pg = b.new_page()
        pg.goto(f"{BASE}tools/promo/mix.html")
        pg.wait_for_function('window.mixReady === true', timeout=30000)
        for s in SHOTS:
            if ONLY and s['name'] not in ONLY:
                continue
            ev = json.load(open(os.path.join(OUT, 'events', s['name'] + '.json')))
            r = pg.evaluate('([ev, sec]) => window.renderStem(ev, sec)', [ev, manifest[s['name']]['sec']])
            open(os.path.join(OUT, 'sfx', s['name'] + '.wav'), 'wb').write(base64.b64decode(r['wav']))
            print('sfx', s['name'], 'kinds', r['kinds'], r['log'][:2], flush=True)
        if not ONLY or 'music' in ONLY or not os.path.exists(os.path.join(OUT, 'music.wav')):
            r = pg.evaluate('(sec) => window.renderMusicWav(sec)', 80)
            open(os.path.join(OUT, 'music.wav'), 'wb').write(base64.b64decode(r['wav']))
            print('music ok', flush=True)
        b.close()
    json.dump(manifest, open(man_path, 'w'), ensure_ascii=False, indent=1)

if __name__ == '__main__':
    main()
