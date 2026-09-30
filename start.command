#!/bin/bash
# 双击启动《荣耀》：启动本地/局域网服务器并打开浏览器（需要 Node 18+）
cd "$(dirname "$0")"
PORT=${PORT:-8780}
if ! command -v node >/dev/null 2>&1; then
  echo "未找到 Node。请安装 Node 18+（https://nodejs.org），或改用：python3 -m http.server $PORT（单机模式，无联机）"
  read -r -p "按回车退出"; exit 1
fi
( sleep 1; open "http://localhost:$PORT/" 2>/dev/null || xdg-open "http://localhost:$PORT/" 2>/dev/null ) &
node server/server.mjs "$PORT"
