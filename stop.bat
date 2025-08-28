@echo off
chcp 65001 >nul
echo Closing order system...

for /f "tokens=5" %%a in ('netstat -aon ^| findstr :3000') do (
    echo Found process ID: %%a
    taskkill /f /pid %%a
)

echo Order system closed
pause