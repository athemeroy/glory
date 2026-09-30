#!/bin/bash
# 生成 assets/models/manifest.json（列出现有的角色精模）
cd "$(dirname "$0")/../assets/models" || exit 1
ls *.glb 2>/dev/null | sed 's/\.glb$//' | python3 -c 'import sys,json; print(json.dumps([l.strip() for l in sys.stdin if l.strip()]))' > manifest.json
cat manifest.json
