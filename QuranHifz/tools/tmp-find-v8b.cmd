@echo off
cd /d "d:\voidwave.com apps\Quran"
set OUT=%TEMP%\v8-find2.txt
del "%OUT%" 2>nul
echo == all onnx/crdownload/part in Downloads == >> "%OUT%"
dir /b "%USERPROFILE%\Downloads" | findstr /i "onnx crdownload part" >> "%OUT%" 2>&1
echo == last 15 files in Downloads == >> "%OUT%"
powershell -NoProfile -Command "Get-ChildItem ($env:USERPROFILE + '\Downloads') -File | Sort-Object LastWriteTime -Descending | Select-Object -First 15 | ForEach-Object { $_.LastWriteTime.ToString('MM-dd HH:mm') + '  ' + [math]::Round($_.Length/1MB,1) + ' MB  ' + $_.Name }" >> "%OUT%" 2>&1
type "%OUT%"
