@echo off
setlocal EnableExtensions
powershell.exe -NoProfile -File "%~dp0..\start-helper.ps1" -Edition DeepSeek
set "PMS_EXIT=%errorlevel%"
if not "%PMS_EXIT%"=="0" pause
exit /b %PMS_EXIT%
