@echo off
cd /d "d:\voidwave.com apps\Quran"
set OUT=%TEMP%\spm-dump.txt
del "%OUT%" 2>nul
set PY=%LOCALAPPDATA%\Programs\Python\Python312\python.exe
echo == install sentencepiece == >> "%OUT%"
"%PY%" -m pip install --quiet sentencepiece >> "%OUT%" 2>&1
echo pip exit=%ERRORLEVEL% >> "%OUT%"
echo == dump == >> "%OUT%"
"%PY%" "QuranHifz\tools\tmp-spm-dump.py" >> "%OUT%" 2>&1
echo EXIT=%ERRORLEVEL% >> "%OUT%"
type "%OUT%"
