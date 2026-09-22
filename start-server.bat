@echo off
setlocal EnableExtensions DisableDelayedExpansion
title Real Landscape - Local Server
pushd "%~dp0" || (
  echo [ERROR] Cannot access project directory: %~dp0
  pause
  exit /b 1
)
set "NO_OPEN=0"
for %%A in (%*) do if /I "%%~A"=="--no-open" set "NO_OPEN=1"
if not exist "scripts\start-app.cjs" (
  echo [ERROR] Missing scripts\start-app.cjs. Restore the complete project folder.
  popd
  pause
  exit /b 1
)
where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js was not found. Install Node.js 18 or newer, then run this file again.
  pause
  popd
  exit /b 1
)
node -e "if (Number(process.versions.node.split('.')[0]) < 18) process.exit(1)"
if errorlevel 1 (
  echo [ERROR] Node.js 18 or newer is required. A maintained LTS release is recommended.
  pause
  popd
  exit /b 1
)
if "%NO_OPEN%"=="1" (
  echo Starting Real Landscape without opening a browser...
) else (
  echo Starting Real Landscape and opening the sign-in page...
)
node scripts\start-app.cjs %*
set "APP_EXIT=%ERRORLEVEL%"
popd
if not "%APP_EXIT%"=="0" if "%NO_OPEN%"=="0" pause
exit /b %APP_EXIT%
