@echo off
set OUT=%TEMP%\v8-find4.txt
del "%OUT%" 2>nul
echo == downloads root (all) == >> "%OUT%"
dir "%USERPROFILE%\Downloads" /b >> "%OUT%" 2>&1
echo == onnx anywhere under Downloads == >> "%OUT%"
where /r "%USERPROFILE%\Downloads" *.onnx >> "%OUT%" 2>&1
echo == candidate sizes == >> "%OUT%"
for %%F in (tokens.txt tokenizer.model model_with_encoder.q8.onnx model.q8.onnx) do @if exist "%USERPROFILE%\Downloads\%%F" for %%S in ("%USERPROFILE%\Downloads\%%F") do >> "%OUT%" echo %%F = %%~zS bytes
type "%OUT%"
