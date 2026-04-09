@echo off
setlocal

set "PORT=3000"
set "ROOT=%~dp0"
set "PS1=%ROOT%start-server.ps1"
set "PS_EXE=%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe"

if not exist "%PS_EXE%" (
  where pwsh >nul 2>nul
  if %errorlevel%==0 (
    set "PS_EXE=pwsh"
  ) else (
    echo Could not find Windows PowerShell or pwsh.
    pause
    exit /b 1
  )
)

echo Starting RetiFlux server (preferred port %PORT%)...
echo.
echo A PowerShell window will stay open and show server logs/errors.
echo The server window will auto-open the correct localhost URL after it binds.
echo.
start "RetiFlux Server" "%PS_EXE%" -NoExit -NoProfile -ExecutionPolicy Bypass -Command "& { Set-Location -LiteralPath '%ROOT%'; & '%PS1%' -Port %PORT% -Root '%ROOT%' }"
exit /b 0

endlocal
