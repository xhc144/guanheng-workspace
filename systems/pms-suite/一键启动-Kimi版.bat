@echo off
title One-Click Start - Kimi Edition
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-helper.ps1" -Edition Kimi
exit /b %errorlevel%
