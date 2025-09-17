@echo off
echo 正在检查端口3000是否被占用...

:: 查找占用端口3000的进程
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :3000') do (
    set pid=%%a
    goto :found
)

echo 端口3000未被占用
goto :end

:found
echo 发现进程 %pid% 占用端口3000
echo 正在终止进程...
taskkill /PID %pid% /F
if %errorlevel% == 0 (
    echo 进程已成功终止
) else (
    echo 终止进程失败
)

:end
pause