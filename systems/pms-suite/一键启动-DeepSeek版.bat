@echo off
title One-Click Start - DeepSeek Edition
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-helper.ps1" -Edition DeepSeek
exit /b %errorlevel%
