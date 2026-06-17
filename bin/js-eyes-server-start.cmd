@echo off
REM js-eyes-server-start.cmd — start the JS Eyes WebSocket/HTTP server locally.
REM
REM Unlike `npx js-eyes server start`, this script never contacts the npm
REM registry or downloads anything: it shells out to the repo-local CLI using
REM the currently-checked-out tree.
REM
REM Usage:
REM   bin\js-eyes-server-start.cmd [--host localhost] [--port 18080]
REM
REM Extra arguments are forwarded to `js-eyes server start` verbatim.
REM `--foreground` is always included so the server runs in the current window.

setlocal EnableExtensions

set "SCRIPT_DIR=%~dp0"
set "REPO_ROOT=%SCRIPT_DIR%.."
for %%I in ("%REPO_ROOT%") do set "REPO_ROOT=%%~fI"
set "CLI_ENTRY=%REPO_ROOT%\apps\cli\bin\js-eyes.js"

if not exist "%CLI_ENTRY%" (
  echo [js-eyes] CLI entry not found at %CLI_ENTRY%
  echo [js-eyes] Run this script from a checked-out js-eyes repository.
  exit /b 1
)

cd /d "%REPO_ROOT%"
node "%CLI_ENTRY%" server start --foreground %*
exit /b %ERRORLEVEL%
