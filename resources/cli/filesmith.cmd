@echo off
rem Filesmith command line (spec 7.1). Runs the app's own Electron as plain
rem Node, so the app's single-instance lock is never involved and the app can
rem stay open. A .cmd makes cmd and PowerShell wait and pass the exit code back.
setlocal
set ELECTRON_RUN_AS_NODE=1
rem Downloads in `filesmith setup` follow HTTPS_PROXY and trust the Windows
rem certificate store, like the app's own downloader.
set NODE_USE_ENV_PROXY=1
"%~dp0..\..\Filesmith.exe" --use-system-ca "%~dp0..\app.asar\out\main\cli.js" %*
exit /b %ERRORLEVEL%
