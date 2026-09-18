@echo off
cd /d "d:\voidwave.com apps\Quran"
set OUT=%TEMP%\spm-parse.txt
del "%OUT%" 2>nul
echo == file check == >> "%OUT%"
for %%F in ("QuranHifz\tools\asr-models\fastconformer-quran-v8\tokenizer.model") do >> "%OUT%" echo %%~nxF = %%~zF bytes
echo == parse == >> "%OUT%"
node QuranHifz\tools\parse-spm-model.mjs >> "%OUT%" 2>&1
echo EXIT=%ERRORLEVEL% >> "%OUT%"
type "%OUT%"
