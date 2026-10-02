@echo off
cd /d D:\trellis2\code
set PYTHONHOME=D:\trellis2\tools\python
set PYTHONNOUSERSITE=1
set PATH=D:\trellis2\tools\python;D:\trellis2\tools\python\Scripts;D:\trellis2\tools\git\mingw64\bin;%PATH%
set HF_HUB_CACHE=D:\trellis2\code\models\hub
set HF_HUB_OFFLINE=1
D:\trellis2\venv\Scripts\python.exe glory-pilot-gen.py D:\trellis2\swordmaster-pilot\front.png D:\trellis2\swordmaster-pilot\static.glb 23 4096
if errorlevel 1 exit /b 1
echo PILOT_MODEL_DONE
