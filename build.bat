@echo off
setlocal
cd /d "%~dp0"

echo Stopping any existing Hyperact instance...
taskkill /F /IM hyperact.exe >nul 2>&1

echo Building Hyperact release...
cargo tauri build || goto :error

echo.
echo Build complete.
echo.
echo Portable executable:
echo   %CD%\src-tauri\target\release\hyperact.exe

echo.
echo Installer:
for %%F in ("src-tauri\target\release\bundle\nsis\*.exe") do echo   %%~fF

echo.
explorer "%CD%\src-tauri\target\release\bundle\nsis"
exit /b 0

:error
echo.
echo Hyperact release build failed.
pause
exit /b 1
