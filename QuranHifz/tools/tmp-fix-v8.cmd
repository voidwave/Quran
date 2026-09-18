@echo off
cd /d "d:\voidwave.com apps\Quran"
set OUT=%TEMP%\v8-fix.txt
del "%OUT%" 2>nul
echo == wrong folder contents == >> "%OUT%"
dir /b /s "QuranHifz\tools\asr-models\fasterconformer-quran-v8" >> "%OUT%" 2>&1
echo == rename == >> "%OUT%"
if exist "QuranHifz\tools\asr-models\fastconformer-quran-v8" (
    echo target already exists - merging >> "%OUT%"
    move /y "QuranHifz\tools\asr-models\fasterconformer-quran-v8\*" "QuranHifz\tools\asr-models\fastconformer-quran-v8\" >> "%OUT%" 2>&1
    rmdir /s /q "QuranHifz\tools\asr-models\fasterconformer-quran-v8" >> "%OUT%" 2>&1
) else (
    move "QuranHifz\tools\asr-models\fasterconformer-quran-v8" "QuranHifz\tools\asr-models\fastconformer-quran-v8" >> "%OUT%" 2>&1
)
echo == after == >> "%OUT%"
dir /b /s "QuranHifz\tools\asr-models\fastconformer-quran-v8" >> "%OUT%" 2>&1
type "%OUT%"
