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
if [ -f media/glory-promo-small.mp4 ]; then
  cp media/glory-promo-small.mp4 dist/media/glory-promo.mp4
else
  # 视频只随NAS同步；干净检出用已有海报，首页与游戏仍可独立构建。
  awk '
    /<video[ >]/ { print "        <img src=\"img/poster.jpg\" alt=\"荣耀第一人称战斗画面\" width=\"1280\" height=\"720\">"; skip=1 }
    /<\/video>/ { skip=0; next }
    !skip {
      gsub(">宣传片</a>", ">游戏画面</a>")
      sub("宣传片约 1 分钟，全部是第一人称的游戏画面与原声。", "")
      print
    }
  ' dist/index.html > dist/index.html.tmp
  mv dist/index.html.tmp dist/index.html
fi
rsync -a --exclude='/assets/models/_cmp/' index.html style.css styles src vendor assets dist/play/
cp api/sig.js api/ice.js dist/api/ && cp server/sig-core.mjs server/ice-config.mjs dist/server/
cp tools/vercel/vercel.json dist/
printf '{ "private": true, "type": "module" }\n' > dist/package.json
# 将当前提交写入部署，方便核对 GitHub 与线上版本。
node --input-type=module - <<'JS'
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
const commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const dirty = execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim().length > 0;
const version = JSON.stringify({ commit, dirty, builtAt: new Date().toISOString() }) + '\n';
writeFileSync('dist/version.json', version);
writeFileSync('dist/play/version.json', version);
JS
du -sh dist
