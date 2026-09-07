@echo off
title Speed AI - Reading Trainer
cd /d "%~dp0"

echo.
echo   Speed AI - Reading Trainer
echo   ==========================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo   Node.js is not installed. Get it from https://nodejs.org and run this again.
  echo.
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo   First run - installing dependencies. This takes a minute...
  echo.
  call npm install || goto :failed
)

echo   Building...
call npm run build || goto :failed

echo.
echo   Starting. Your browser will open in a moment.
echo   Keep this window open while you train; close it to stop.
echo.
call npm run preview -- --open
goto :eof

:failed
echo.
echo   Something went wrong above. Copy the message and send it over.
echo.
pause
exit /b 1
