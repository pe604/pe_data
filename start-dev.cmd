@echo off
rem Starts the app (database: the Postgres server in .env) and opens the browser.
cd /d "%~dp0"
set "PATH=%LOCALAPPDATA%\Programs\nodejs;%LOCALAPPDATA%\Programs\mingit\cmd;%PATH%"
start "Pipeline app" cmd /k npm run dev
echo Waiting for the app to start...
timeout /t 20 /nobreak >nul
start "" http://localhost:3000
