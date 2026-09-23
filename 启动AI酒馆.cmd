@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  if exist "%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" (
    set "PATH=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin;%PATH%"
  ) else (
    echo Please install Node.js 22.13 or newer from https://nodejs.org/ and try again.
    pause
    exit /b 1
  )
)
node "%~dp0scripts\start-local.mjs"
if errorlevel 1 pause
