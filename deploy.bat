@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion

echo 🚀 订餐系统自动部署脚本 (Windows)
echo ================================

REM 服务器信息
set SERVER_USER=root
set SERVER_HOST=172.16.74.75
set SERVER_PATH=/var/www/order-robot

echo 📡 服务器信息:
echo    地址: %SERVER_HOST%
echo    用户: %SERVER_USER%
echo    路径: %SERVER_PATH%
echo.

REM 检查必要工具
where scp >nul 2>&1
if %errorlevel% neq 0 (
    echo ❌ 需要安装 SCP 工具。请安装 Git for Windows 或 PuTTY
    pause
    exit /b 1
)

where ssh >nul 2>&1
if %errorlevel% neq 0 (
    echo ❌ 需要安装 SSH 工具。请安装 Git for Windows 或 OpenSSH
    pause
    exit /b 1
)

REM 确认部署
set /p confirm="🔄 确认开始部署到生产服务器？(y/N): "
if /i not "%confirm%"=="y" (
    echo ❌ 部署已取消
    pause
    exit /b 0
)

echo 📦 准备部署文件...

REM 创建排除文件列表
echo node_modules/ > .deployignore
echo .git/ >> .deployignore
echo logs/ >> .deployignore
echo *.log >> .deployignore
echo .env >> .deployignore
echo data/backup/ >> .deployignore
echo .DS_Store >> .deployignore
echo Thumbs.db >> .deployignore

echo 📁 创建服务器目录结构...

REM 使用 SSH 创建目录
ssh %SERVER_USER%@%SERVER_HOST% "mkdir -p /var/www/order-robot && mkdir -p /var/www/order-robot/logs && mkdir -p /var/www/order-robot/data && mkdir -p /var/www/order-robot/data/backup && mkdir -p /var/www/order-robot/database && mkdir -p /var/www/order-robot/config && mkdir -p /var/www/order-robot/scripts && mkdir -p /var/www/order-robot/nginx"

if %errorlevel% neq 0 (
    echo ❌ 无法连接到服务器或创建目录失败
    pause
    exit /b 1
)

echo 📤 上传项目文件...

REM 上传文件 (排除不需要的文件)
echo 正在上传核心文件...
scp server.js %SERVER_USER%@%SERVER_HOST%:%SERVER_PATH%/
scp package.json %SERVER_USER%@%SERVER_HOST%:%SERVER_PATH%/
scp ecosystem.config.js %SERVER_USER%@%SERVER_HOST%:%SERVER_PATH%/
scp feishu-config.js %SERVER_USER%@%SERVER_HOST%:%SERVER_PATH%/
scp .env.production %SERVER_USER%@%SERVER_HOST%:%SERVER_PATH%/

echo 正在上传配置文件...
scp config\database.js %SERVER_USER%@%SERVER_HOST%:%SERVER_PATH%/config/
scp database\schema.sql %SERVER_USER%@%SERVER_HOST%:%SERVER_PATH%/database/
scp scripts\migrate-data.js %SERVER_USER%@%SERVER_HOST%:%SERVER_PATH%/scripts/
scp nginx\order-robot.conf %SERVER_USER%@%SERVER_HOST%:%SERVER_PATH%/nginx/

echo 正在上传静态资源...
scp -r public %SERVER_USER%@%SERVER_HOST%:%SERVER_PATH%/

echo 正在上传数据文件 (如果存在)...
if exist "data" (
    scp -r data %SERVER_USER%@%SERVER_HOST%:%SERVER_PATH%/
) else (
    echo 数据目录不存在，跳过
)

if exist "菜单管理.csv" (
    scp "菜单管理.csv" %SERVER_USER%@%SERVER_HOST%:%SERVER_PATH%/
)

echo 🔧 在服务器上安装依赖和配置...

ssh %SERVER_USER%@%SERVER_HOST% "cd /var/www/order-robot && npm install --production && mkdir -p logs && chmod 755 logs && echo '✅ 服务器配置完成'"

if %errorlevel% neq 0 (
    echo ❌ 服务器配置失败
    pause
    exit /b 1
)

echo.
echo 🎉 文件上传完成！
echo.
echo 📋 接下来需要手动完成以下步骤:
echo.
echo 1. 🔐 SSH 连接到服务器:
echo    ssh %SERVER_USER%@%SERVER_HOST%
echo.
echo 2. 📊 配置数据库:
echo    - 安装 MySQL: apt install mysql-server -y
echo    - 创建数据库: mysql -u root -p
echo    - 执行以下SQL:
echo      CREATE DATABASE order_robot CHARACTER SET utf8mb4;
echo      CREATE USER 'order_robot'@'localhost' IDENTIFIED BY 'StrongPassword123!';
echo      GRANT ALL PRIVILEGES ON order_robot.* TO 'order_robot'@'localhost';
echo.
echo 3. 🌐 配置环境变量:
echo    cd /var/www/order-robot
echo    cp .env.production .env
echo    nano .env  # 编辑数据库密码等配置
echo.
echo 4. 📦 执行数据库迁移:
echo    npm run db:migrate
echo.
echo 5. 🚀 启动应用:
echo    npm install pm2 -g
echo    pm2 start ecosystem.config.js --env production
echo    pm2 save
echo    pm2 startup
echo.
echo 6. 🌐 配置 Nginx (可选):
echo    apt install nginx -y
echo    cp nginx/order-robot.conf /etc/nginx/sites-available/
echo    ln -s /etc/nginx/sites-available/order-robot /etc/nginx/sites-enabled/
echo    systemctl restart nginx
echo.
echo 7. 🔑 更新飞书回调URL:
echo    在飞书开放平台添加: http://%SERVER_HOST%/auth/feishu/callback
echo.
echo 📖 详细部署说明请参考 DEPLOYMENT.md 文件
echo.
echo 🎯 访问地址: http://%SERVER_HOST%
echo ✨ 部署完成！

REM 清理临时文件
if exist .deployignore del .deployignore

pause