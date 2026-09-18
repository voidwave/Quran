@echo off
"C:\Program Files\nodejs\node.exe" "d:\voidwave.com apps\Quran\QuranHifz\tools\test-memorize-core.mjs" > "C:\Users\majed\AppData\Local\Temp\core-test.txt" 2>&1
echo EXITCODE=%ERRORLEVEL%>> "C:\Users\majed\AppData\Local\Temp\core-test.txt"
