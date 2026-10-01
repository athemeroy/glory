#!/bin/bash
# 组装 Vercel 部署目录 dist/：
#   /            宣传首页（site/，只带 22MB 版宣传片）
#   /play/       游戏本体
#   /api/sig     联机牵线函数（server/sig-core.mjs）
# 部署：tools/vercel/build.sh && (cd dist && NODE_USE_ENV_PROXY=1 vercel deploy --prod --yes)
set -euo pipefail
cd "$(dirname "$0")/../.."
rm -rf dist && mkdir -p dist/play dist/media dist/api dist/server dist/.vercel
# 关联的 Vercel 项目（vercel link 生成，ID 不含密钥）
[ -f tools/vercel/link/project.json ] && cp tools/vercel/link/project.json dist/.vercel/
printf '.env*\n.vercel\n' > dist/.vercelignore
rsync -a site/img site/fonts dist/
# 首页：去掉 1080p 下载按钮（大文件不放 Vercel）
sed -e '/glory-promo-1080p\.mp4/d' site/index.html > dist/index.html
cp media/glory-promo-small.mp4 dist/media/glory-promo.mp4
rsync -a index.html style.css src vendor assets dist/play/
cp api/sig.js dist/api/ && cp server/sig-core.mjs dist/server/
cp tools/vercel/vercel.json dist/
printf '{ "private": true, "type": "module" }\n' > dist/package.json
du -sh dist
