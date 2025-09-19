@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion
echo Checking ports 3000-3010...
echo.

:: Check ports 3000-3010
for %%p in (3000 3001 3002 3003 3004 3005 3006 3007 3008 3009 3010) do (
    echo Checking port %%p...
    set "found=false"

    :: Find processes using this port
    for /f "tokens=5" %%a in ('netstat -aon ^| findstr :%%p 2^>nul') do (
        echo   Found process %%a using port %%p
        echo   Terminating process...
        taskkill /PID %%a /F >nul 2>&1
        if !errorlevel! == 0 (
            echo   Process terminated successfully
        ) else (
            echo   Failed to terminate process
        )
        set "found=true"
    )

    if "!found!" == "false" (
        echo   Port %%p is free
    )
    echo.
)

echo All ports checked
pause