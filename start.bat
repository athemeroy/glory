@echo off
cd /d %~dp0
where node >nul 2>nul || (echo 未找到 Node，请先安装 Node 18+ https://nodejs.org & pause & exit /b 1)
start "" http://localhost:8780/
node server\server.mjs 8780
