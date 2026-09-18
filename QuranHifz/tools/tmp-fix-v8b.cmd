@echo off
cd /d "d:\voidwave.com apps\Quran"
set OUT=%TEMP%\v8-int32.txt
del "%OUT%" 2>nul
echo == int32 folder == >> "%OUT%"
dir /b /s "QuranHifz\tools\asr-models\fastconformer-quran-int32" >> "%OUT%" 2>&1
echo == move == >> "%OUT%"
if exist "QuranHifz\tools\asr-models\fastconformer-quran-int32" (
    move /y "QuranHifz\tools\asr-models\fastconformer-quran-int32\*" "QuranHifz\tools\asr-models\fastconformer-quran-v8\" >> "%OUT%" 2>&1
    rmdir /s /q "QuranHifz\tools\asr-models\fastconformer-quran-int32" >> "%OUT%" 2>&1
) else (
    echo no such folder >> "%OUT%"
)
echo == v8 folder now == >> "%OUT%"
for %%F in ("QuranHifz\tools\asr-models\fastconformer-quran-v8\*") do >> "%OUT%" echo %%~nxF = %%~zF bytes
type "%OUT%"
