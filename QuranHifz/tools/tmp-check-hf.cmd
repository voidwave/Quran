@echo off
cd /d "d:\voidwave.com apps\Quran"
set OUT=%TEMP%\hf-check.txt
del "%OUT%" 2>nul
echo == local v8 folder == >> "%OUT%"
dir /b /s "QuranHifz\tools\asr-models\fastconformer-quran-v8" >> "%OUT%" 2>&1
echo == hf token cache == >> "%OUT%"
if exist "%USERPROFILE%\.cache\huggingface\token" (echo TOKEN FOUND >> "%OUT%") else (echo no token >> "%OUT%")
echo == python + huggingface_hub == >> "%OUT%"
if exist "%LOCALAPPDATA%\Programs\Python\Python312\python.exe" (
    "%LOCALAPPDATA%\Programs\Python\Python312\python.exe" -c "import huggingface_hub, sys; print('hub', huggingface_hub.__version__)" >> "%OUT%" 2>&1
    dir /b "%LOCALAPPDATA%\Programs\Python\Python312\Scripts\huggingface-cli.exe" >> "%OUT%" 2>&1
    dir /b "%LOCALAPPDATA%\Programs\Python\Python312\Scripts\hf.exe" >> "%OUT%" 2>&1
) else (
    echo no python312 >> "%OUT%"
)
type "%OUT%"
