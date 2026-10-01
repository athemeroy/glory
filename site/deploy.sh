#!/bin/bash
# 部署宣传首页到 NAS（Traefik 静态站）：http://glory.naszqun.com:47080/
#   /           site/index.html + img/ + fonts/
#   /media/     宣传片（默认 22MB 版，另附 1080p 高码率版）
#   /play/      游戏本体（单机可玩；联机需要本地 server/server.mjs）
# 首次部署另需 NAS 上 /volume2/docker/glory/{docker-compose.yml,nginx.conf}（见 site/nas/）。
set -euo pipefail
cd "$(dirname "$0")/.."
DEST=/volume2/docker/glory/html
ssh nas "mkdir -p $DEST/media $DEST/play"
rsync -a --delete site/img/ "nas:$DEST/img/"
rsync -a --delete site/fonts/ "nas:$DEST/fonts/"
rsync -a site/index.html "nas:$DEST/"
rsync -a media/glory-promo-small.mp4 "nas:$DEST/media/glory-promo.mp4"
rsync -a media/glory-promo.mp4 "nas:$DEST/media/glory-promo-1080p.mp4"
rsync -a --delete index.html style.css src vendor assets "nas:$DEST/play/"
echo "已部署：http://glory.naszqun.com:47080/"
