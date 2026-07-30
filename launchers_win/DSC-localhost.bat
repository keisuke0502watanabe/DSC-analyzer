@echo off
setlocal EnableDelayedExpansion
REM =====================================================================
REM  DSC Analyzer - open on http://localhost  (Windows)
REM
REM  Run: double-click this file, or run it from a terminal:
REM       DSC-localhost.bat
REM
REM  Keep this file in the "launchers_win" folder inside the DSC-analyzer
REM  repo, so that "cd .." lands on the repo root where webapp/ lives.
REM
REM  Why http://localhost instead of file:// : a real origin lets the
REM  browser keep your IndexedDB data (DB / projects) far more reliably.
REM  Requires Python 3 (from python.org or the Microsoft Store).
REM =====================================================================

set "PORT=8754"
set "FILE=webapp/dsc_analyzer_v9.html"

REM Move to the repo root (one level up from this script's folder)
cd /d "%~dp0.."

if not exist "%FILE%" (
    echo [ERROR] Cannot find "%FILE%" in:
    echo         "%CD%"
    echo Make sure this launcher stays inside the repo's launchers_win folder.
    echo.
    pause
    exit /b 1
)

REM ---- Find a Python that actually runs -------------------------------
REM  Prefer the "py" launcher, then "python". We verify each really works
REM  (the Microsoft Store aliases can be present but non-functional).
set "PY="
py -3 --version >nul 2>&1 && set "PY=py -3"
if not defined PY ( python --version >nul 2>&1 && set "PY=python" )
if not defined PY ( py --version   >nul 2>&1 && set "PY=py" )

if not defined PY (
    echo [ERROR] Python 3 was not found on this PC.
    echo.
    echo Install it from https://www.python.org/downloads/ and tick
    echo "Add python.exe to PATH" during setup, then run this launcher again.
    echo.
    echo If you see a Microsoft Store page when you type "python", open
    echo   Settings ^> Apps ^> Advanced app settings ^> App execution aliases
    echo and turn OFF the "python.exe" / "python3.exe" aliases.
    echo.
    pause
    exit /b 1
)
echo Using Python command: %PY%

REM ---- Is OUR file already served correctly on this port? ------------
REM  Note: use curl -f so an HTTP 404 counts as failure, not success.
REM  A plain "curl -s" returns exit 0 even on 404 (it connected fine).
curl -sf -o nul "http://127.0.0.1:%PORT%/%FILE%"
if %errorlevel%==0 (
    echo Server already running correctly on http://localhost:%PORT%
    goto open
)

REM ---- Free the port if a WRONG server is holding it -----------------
REM  (e.g. a leftover "python -m http.server" rooted in another folder,
REM  which would answer with 404 for our file.)
for /f "tokens=5" %%p in ('netstat -ano ^| findstr /r /c:":%PORT% .*LISTENING"') do (
    echo Port %PORT% is busy with the wrong server ^(PID %%p^) - stopping it...
    taskkill /f /pid %%p >nul 2>&1
)

REM ---- Start the server ----------------------------------------------
echo Starting local server on http://localhost:%PORT% ...
start "DSC Analyzer Server" /min cmd /c "%PY% -m http.server %PORT%"

REM ---- Wait until OUR file is actually reachable (up to ~15 seconds) --
set "READY="
for /l %%i in (1,1,30) do (
    if not defined READY (
        curl -sf -o nul "http://127.0.0.1:%PORT%/%FILE%"
        if !errorlevel!==0 (
            set "READY=1"
        ) else (
            timeout /t 1 /nobreak >nul
        )
    )
)

if not defined READY (
    echo.
    echo [ERROR] The server did not come up on port %PORT%.
    echo Possible causes: port already in use, Python blocked by firewall,
    echo or Python failed to start. Try closing other apps or changing PORT
    echo at the top of this file, then run it again.
    echo.
    pause
    exit /b 1
)

:open
set "URL=http://localhost:%PORT%/%FILE%"
echo Opening %URL%
start "" "%URL%"

echo.
echo A minimized server window is running - keep it open while you use the app.
echo Close that window (or this one) when you're done to stop the server.
pause
