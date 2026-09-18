@echo off
set OUT=%TEMP%\v8-find3.txt
del "%OUT%" 2>nul
powershell -NoProfile -Command "$dirs = @($env:USERPROFILE + '\Downloads', $env:USERPROFILE + '\Desktop', $env:USERPROFILE + '\Documents', 'D:\voidwave.com apps'); foreach ($d in $dirs) { if (Test-Path $d) { Get-ChildItem $d -Recurse -File -ErrorAction SilentlyContinue | Where-Object { $_.Name -match 'model_with_encoder|model\.q8|tokens\.txt|tokenizer\.model|pronunciation_head' } | ForEach-Object { $_.FullName + ' | ' + [math]::Round($_.Length/1MB,2) + ' MB | ' + $_.LastWriteTime.ToString('MM-dd HH:mm') } } }" >> "%OUT%" 2>&1
type "%OUT%"
