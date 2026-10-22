@echo off
cd /d "%~dp0"
powershell.exe -Sta -NoProfile -ExecutionPolicy Bypass -File "%~dp0overlay.ps1"
