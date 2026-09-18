@echo off
cd /d "d:\voidwave.com apps\Quran"
set OUT=%TEMP%\tok-find.txt
del "%OUT%" 2>nul
echo == workspace == >> "%OUT%"
dir /b /s "tokenizer.model" >> "%OUT%" 2>&1
echo == downloads == >> "%OUT%"
if exist "%USERPROFILE%\Downloads\tokenizer.model" (echo FOUND in Downloads>> "%OUT%") else (echo not in Downloads>> "%OUT%")
echo == v8 folder full == >> "%OUT%"
dir /b "QuranHifz\tools\asr-models\fastconformer-quran-v8" >> "%OUT%" 2>&1
type "%OUT%"
