@echo off
echo.
echo ==========================================
echo        公司订餐系统启动脚本
echo ==========================================
echo.

REM 检查Node.js是否安装
node --version >nul 2>&1
if errorlevel 1 (
    echo [错误] 未检测到Node.js，请先安装Node.js
    echo 下载地址: https://nodejs.org/
    pause
    exit /b 1
)

REM 显示Node.js版本
echo [信息] Node.js版本:
node --version
echo.

REM 检查是否已安装依赖
if not exist "node_modules" (
    echo [信息] 检测到未安装依赖，正在安装...
    call npm install
    echo.
)

REM 创建数据目录
if not exist "data" (
    echo [信息] 创建数据目录...
    mkdir data
)

REM 创建日志目录
if not exist "logs" (
    mkdir logs
)

echo [信息] 正在启动订餐系统...
echo [信息] 用户端访问地址: http://localhost:3000
echo [信息] 管理后台地址: http://localhost:3000/admin.html
echo [信息] 按 Ctrl+C 停止服务
echo.
echo ==========================================
echo              系统启动中...
echo ==========================================
echo.

REM 启动服务器
node server.js

pause