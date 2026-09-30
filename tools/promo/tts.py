#!/usr/bin/env python3
"""Gemini 3.8 Flash TTS（Interactions API，在 Mini 上跑）。用法：tts.py lines.json 输出目录
旁白：vo-lines.json → remotion/public/vo/；大招喊招：ult-lines.json（音色按原著人物匹配）→ 转 mp3 后放 assets/voice/。
Tier 1 限速每分钟 10 次，脚本每次请求间隔 6.5 秒。
lines.json: [{"id":"vo01","text":"...","voice":"Orus","style":"..."}]；密钥由 ~/.glory-tts-keycmd 现取，不落盘。"""
import sys, os, json, base64, subprocess, time, urllib.request
URL = 'https://generativelanguage.googleapis.com/v1beta/interactions'
MODEL = os.environ.get('TTS_MODEL', 'gemini-3.8-flash-tts')
cmd = open(os.path.expanduser('~/.glory-tts-keycmd')).read().strip()
out = subprocess.run(['zsh', '-lc', cmd], capture_output=True, text=True, timeout=60).stdout.strip()
KEY = json.loads(out)['keyString'] if out.startswith('{') else out
lines = json.load(open(sys.argv[1])); od = sys.argv[2]; os.makedirs(od, exist_ok=True)
for ln in lines:
    path = os.path.join(od, ln['id'] + '.wav')
    if os.path.exists(path) and not os.environ.get('FORCE'): print('skip', ln['id']); continue
    body = {'model': MODEL, 'input': [{'type': 'user_input', 'content': [{'type': 'text', 'text': ln['text'],
            'annotations': [{'type': 'speech_metadata', 'style': ln.get('style', '')}]}]}],
            'response_format': {'type': 'audio'}, 'generation_config': {'speech_config': [{'voice': ln.get('voice', 'Orus')}]}}
    for attempt in range(4):
        try:
            req = urllib.request.Request(URL, data=json.dumps(body).encode(), headers={'x-goog-api-key': KEY, 'Content-Type': 'application/json'})
            d = json.load(urllib.request.urlopen(req, timeout=120))
            audio = [it for st in d.get('steps', []) for it in st.get('content', []) if it.get('type') == 'audio']
            if not audio: raise RuntimeError('no audio: ' + json.dumps(d)[:200])
            open(path, 'wb').write(base64.b64decode(audio[0]['data'])); print('ok', ln['id'], os.path.getsize(path), audio[0].get('mime_type', '')); time.sleep(6.5); break
        except Exception as e:
            msg = str(e)
            if hasattr(e, 'read'): msg += ' ' + e.read().decode(errors='ignore')[:300]
            print('retry', ln['id'], msg[:300]); time.sleep(20 if '429' in msg else 3 * (attempt + 1))
