#!/bin/bash
# 重新生成标题字体子集（思源宋体 Black，SIL OFL 1.1）。需要：pip install fonttools brotli；源字体 NotoSerifSC-Black.otf 路径作为参数。
set -e
cd "$(dirname "$0")/.."
SRC=${1:?用法: tools/make-font.sh /path/to/NotoSerifSC-Black.otf}
python3 - <<'PY'
import re, glob
chars=set()
for f in glob.glob('src/**/*.js', recursive=True)+['index.html']:
    chars |= set(re.findall(r'[　-鿿＀-￯]', open(f, encoding='utf-8').read()))
chars |= set('0123456789:：·—“”「」《》！？、，。ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz%+-×/. ')
open('assets/fonts/serif-chars.txt','w',encoding='utf-8').write(''.join(sorted(chars)))
PY
python3 -m fontTools.subset "$SRC" --text-file=assets/fonts/serif-chars.txt --flavor=woff2 --output-file=assets/fonts/glory-serif.woff2 --layout-features='*'
ls -la assets/fonts/glory-serif.woff2
