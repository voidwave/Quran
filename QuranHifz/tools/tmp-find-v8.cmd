@echo off
cd /d "d:\voidwave.com apps\Quran"
set OUT=%TEMP%\v8-find.txt
del "%OUT%" 2>nul
echo == model files == >> "%OUT%"
for /r "%USERPROFILE%\Downloads" %%F in (model_with_encoder*.onnx tokens.txt tokenizer.model pronunciation_head*.pt) do echo %%F ^| %%~zF >> "%OUT%"
echo == wav files == >> "%OUT%"
for /r "%USERPROFILE%\Downloads" %%F in (*.wav) do echo %%F ^| %%~zF >> "%OUT%"
echo == project dir == >> "%OUT%"
dir /b "QuranHifz\tools\asr-models\fastconformer-quran-v8" >> "%OUT%" 2>&1
type "%OUT%"
