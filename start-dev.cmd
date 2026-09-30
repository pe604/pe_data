@echo off
rem Starts the local database and the app in two windows, then opens the browser.
cd /d "%~dp0"
set "PATH=%LOCALAPPDATA%\Programs\nodejs;%LOCALAPPDATA%\Programs\mingit\cmd;%PATH%"
start "Pipeline database" cmd /k npm run db:local
timeout /t 6 /nobreak >nul
start "Pipeline app" cmd /k npm run dev
echo Waiting for the app to start...
timeout /t 20 /nobreak >nul
start "" http://localhost:3000
