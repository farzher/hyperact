@echo off
setlocal EnableExtensions EnableDelayedExpansion
cd /d "%~dp0"

rem Running the app must never discard local source changes.
set "DIRTY="
git diff --quiet || set "DIRTY=1"
git diff --cached --quiet || set "DIRTY=1"
for /f "delims=" %%F in ('git ls-files --others --exclude-standard') do set "DIRTY=1"

echo Checking for Hyperact updates...
git fetch origin main >nul 2>&1
if errorlevel 1 (
  echo Update check failed; starting the local version.
) else (
  set "REMOTE_CHANGES=0"
  for /f "delims=" %%N in ('git rev-list --count HEAD..origin/main') do set "REMOTE_CHANGES=%%N"

  if not "!REMOTE_CHANGES!"=="0" (
    echo.
    echo ================================================================
    echo =                                                              =
    echo =              HYPERACT REMOTE UPDATE AVAILABLE                =
    echo =                                                              =
    echo ================================================================
    echo !REMOTE_CHANGES! remote commit^(s^) have not been pulled.
    echo.

    if defined DIRTY (
      echo UPDATE NOT INSTALLED: local changes are present.
      echo Commit or stash them, then run Hyperact again to update.
      echo.
    ) else (
      echo Installing the update...
      git merge --ff-only origin/main >nul 2>&1
      if errorlevel 1 (
        echo UPDATE NOT INSTALLED: the local branch cannot fast-forward.
        echo.
      ) else (
        echo Hyperact was updated successfully.
        echo.
      )
    )
  ) else if defined DIRTY (
    echo Local changes found; the automatic update is already current.
  ) else (
    echo Hyperact is up to date.
  )
)

echo Stopping any existing Hyperact instance...
taskkill /F /IM hyperact.exe >nul 2>&1

echo Starting Hyperact...
cargo tauri dev || goto :error
exit /b 0

:error
echo.
echo Hyperact failed to start.
pause
exit /b 1
