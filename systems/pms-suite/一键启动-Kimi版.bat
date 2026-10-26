@echo off
setlocal EnableExtensions
powershell.exe -NoProfile -File "%~dp0start-helper.ps1" -Edition Kimi
set "PMS_EXIT=%errorlevel%"
if not "%PMS_EXIT%"=="0" pause
exit /b %PMS_EXIT%
