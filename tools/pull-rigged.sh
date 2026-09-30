#!/bin/bash
# 从 Mini 拉取 Tripo+Meshy 绑定模型：后处理（去动画、压贴图）→ 复制到 assets/models/rigged/ → 生成清单
set -e
cd "$(dirname "$0")/.."
ssh mini 'cd ~/glory-3d && ~/glory-test/venv/bin/python fixdl.py >/dev/null 2>&1; mkdir -p rigp1/final; for f in rigp1/*.glb; do b=$(basename $f); [ -s rigp1/final/$b ] && [ rigp1/final/$b -nt $f ] || node gt/postrig.mjs $f rigp1/final/$b >/dev/null 2>&1 || echo "post fail $b"; done; ls rigp1/final'
mkdir -p assets/models/rigged
scp -q 'mini:glory-3d/rigp1/final/*.glb' assets/models/rigged/
cd assets/models/rigged && ls *.glb | grep -v '^_' | sed 's/\.glb$//' | python3 -c 'import sys,json; print(json.dumps([l.strip() for l in sys.stdin if l.strip()]))' > manifest.json && cat manifest.json
