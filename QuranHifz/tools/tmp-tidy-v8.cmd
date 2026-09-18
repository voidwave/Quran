@echo off
cd /d "d:\voidwave.com apps\Quran"
set OUT=%TEMP%\v8-tidy.txt
del "%OUT%" 2>nul
echo == sizes == >> "%OUT%"
for %%S in ("QuranHifz\tools\asr-models\fastconformer-quran-v8\model_with_encoder.q8.onnx" "QuranHifz\tools\asr-models\fastconformer-quran-v8\tokens.txt") do >> "%OUT%" echo %%~nxS = %%~zS bytes
echo == tidy == >> "%OUT%"
if not exist "QuranHifz\tools\asr-models\fastconformer-quran-v8\tajweed" mkdir "QuranHifz\tools\asr-models\fastconformer-quran-v8\tajweed"
if exist "QuranHifz\tools\asr-models\fastconformer-quran-v8\gop_scorer.py" move "QuranHifz\tools\asr-models\fastconformer-quran-v8\gop_scorer.py" "QuranHifz\tools\asr-models\fastconformer-quran-v8\tajweed\" >> "%OUT%" 2>&1
if exist "%USERPROFILE%\Downloads\tokenizer.model" move /y "%USERPROFILE%\Downloads\tokenizer.model" "QuranHifz\tools\asr-models\fastconformer-quran-v8\" >> "%OUT%" 2>&1
echo == final layout == >> "%OUT%"
dir /b "QuranHifz\tools\asr-models\fastconformer-quran-v8" >> "%OUT%"
dir /b "QuranHifz\tools\asr-models\fastconformer-quran-v8\tajweed" >> "%OUT%"
type "%OUT%"
