@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Instale Node.js 22.17 ou mais recente e tente novamente.
  pause
  exit /b 1
)
echo Iniciando Agenda Inteligente...
set OPEN_BROWSER=true
node server.js
pause
