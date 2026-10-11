@echo off
setlocal enabledelayedexpansion

echo.
echo ============================================================
echo   TRIVIA NIGHT BUZZER — Starting up...
echo ============================================================
echo.

:: Check for Node.js
where node >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo ERROR: Node.js is not installed or not on PATH.
    echo.
    echo Please install Node.js from: https://nodejs.org
    echo Choose the LTS version. Then run this script again.
    echo.
    pause
    exit /b 1
)

:: Print Node version
for /f "tokens=*" %%v in ('node --version') do set NODEVERSION=%%v
echo Node.js found: %NODEVERSION%

:: Install dependencies if node_modules is missing
if not exist "node_modules\" (
    echo.
    echo Installing dependencies for the first time...
    echo This may take a minute.
    echo.
    call npm install
    if %ERRORLEVEL% neq 0 (
        echo.
        echo ERROR: npm install failed. Check your internet connection.
        echo (You only need internet for this first-time setup.)
        echo.
        pause
        exit /b 1
    )
    echo.
    echo Dependencies installed successfully!
    echo.
)

:: Find local IP addresses
echo Your local network addresses:
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /R /C:"IPv4 Address"') do (
    set "ip=%%a"
    :: Trim leading space
    set "ip=!ip: =!"
    echo   http://!ip!:3000
)
echo.
echo Share one of these addresses with your players.
echo.
echo ============================================================
echo   Starting server... (Press Ctrl+C to stop)
echo ============================================================
echo.

node server.js

pause
