@echo off
cd /d "d:\voidwave.com apps\Quran"
powershell -NoProfile -Command "Get-ChildItem 'd:\voidwave.com apps\Quran\QuranHifz\tools\asr-models' -Recurse -File | ForEach-Object { $_.FullName + ' | ' + [math]::Round($_.Length/1MB,1) + ' MB' } | Out-File -Encoding utf8 ($env:TEMP + '\asr-list.txt'); (Get-Process node -ErrorAction SilentlyContinue | Measure-Object).Count.ToString() + ' node processes' | Out-File -Append -Encoding utf8 ($env:TEMP + '\asr-list.txt')"
type "%TEMP%\asr-list.txt"
