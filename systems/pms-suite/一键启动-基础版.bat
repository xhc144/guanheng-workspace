@echo off
title One-Click Start - Basic Edition
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-helper.ps1" -Edition Basic
exit /b %errorlevel%
