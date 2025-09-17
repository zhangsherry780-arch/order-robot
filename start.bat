@echo off
setlocal enabledelayedexpansion
echo 启动订餐系统...

:: 检查并杀死占用端口3000的进程
echo 正在检查端口3000是否被占用...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :3000') do (
    set pid=%%a
    echo 发现进程 !pid! 占用端口3000，正在终止...
    taskkill /PID !pid! /F >nul 2>&1
    goto :start_server
)

echo 端口3000未被占用

:start_server
echo 启动服务器...
node server.js
