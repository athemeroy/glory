@echo off
cd /d D:\kimodo
set HF_ENDPOINT=https://hf-mirror.com
set HF_HOME=D:\kimodo\hf
set TEXT_ENCODERS_DIR=D:\kimodo\text_encoders
set PYTHONPATH=D:\kimodo\kimodo;D:\kimodo\kimodo\MotionCorrection\python
set PY=D:\kimodo\venv\Scripts\python.exe
mkdir out\swordmaster-pilot 2>nul
%PY% -m kimodo.scripts.generate "A swordsman in a low balanced fighting stance draws his right hand beside his right hip then performs one forceful diagonal upward sword cut with his right hand, rotating his hips and shoulders and stepping forward with his left foot, then settles into a ready guard" --model Kimodo-SOMA-RP-v1.1 --duration 2.0 --seed 51 --output D:\kimodo\out\swordmaster-pilot\rising
if errorlevel 1 exit /b 1
%PY% -m kimodo.scripts.generate "A swordsman in a balanced fighting stance winds his right hand across to his left side then performs one broad horizontal backhand sword cut with his right hand from left to right at chest height, rotating his hips and shoulders and shifting weight onto his front foot, then settles into a ready guard" --model Kimodo-SOMA-RP-v1.1 --duration 2.0 --seed 52 --output D:\kimodo\out\swordmaster-pilot\sweep
if errorlevel 1 exit /b 1
%PY% -m kimodo.scripts.generate "A swordsman in a balanced fighting stance raises his right hand holding a sword above his head then performs one powerful vertical downward sword chop, stepping forward and bending his knees with a full body follow through, then settles into a ready guard" --model Kimodo-SOMA-RP-v1.1 --duration 2.0 --seed 53 --output D:\kimodo\out\swordmaster-pilot\chop
if errorlevel 1 exit /b 1
echo PILOT_MOTIONS_DONE
