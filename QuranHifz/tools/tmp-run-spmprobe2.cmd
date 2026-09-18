@echo off
cd /d "d:\voidwave.com apps\Quran"
set OUT=%TEMP%\spm-probe2.txt
del "%OUT%" 2>nul
set PY=%LOCALAPPDATA%\Programs\Python\Python312\python.exe
"%PY%" -X utf8 "QuranHifz\tools\tmp-spm-probe2.py" > "%OUT%" 2>&1
echo EXIT=%ERRORLEVEL% >> "%OUT%"
type "%OUT%"
