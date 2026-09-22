@echo off
setlocal EnableExtensions DisableDelayedExpansion
set "LAUNCHER=%~dp0ColorGradeStudio.ps1"
if not exist "%LAUNCHER%" (
  echo [ERROR] ColorGradeStudio.ps1 is missing. Restore the complete standalone package.
  pause
  exit /b 1
)
powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File "%LAUNCHER%" %*
exit /b %ERRORLEVEL%
