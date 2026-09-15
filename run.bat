@echo off
setlocal
cd /d "%~dp0"

echo Syncing Hyperact with origin/main...
git fetch origin main || goto :error
git reset --hard origin/main || goto :error

echo Starting Hyperact...
cargo tauri dev || goto :error
exit /b 0

:error
echo.
echo Hyperact failed to start.
pause
exit /b 1
