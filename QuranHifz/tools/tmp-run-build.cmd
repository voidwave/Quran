@echo off
set PY=C:\Users\majed\AppData\Local\Programs\Python\Python312\python.exe
"%PY%" -u "d:\voidwave.com apps\Quran\QuranHifz\tools\build-quran-phonemes.py" > "C:\Users\majed\AppData\Local\Temp\qt-build-out.txt" 2>&1
echo EXITCODE=%ERRORLEVEL%>> "C:\Users\majed\AppData\Local\Temp\qt-build-out.txt"
