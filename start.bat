@echo off
cd /d "%~dp0"
where node >nul 2>nul || (
  echo Node.js fehlt. Bitte von https://nodejs.org installieren.
  pause
  exit /b 1
)
if not exist node_modules (
  echo npm install...
  call npm install
)
echo Starte NetPulse auf http://localhost:8080
call npm run dev
