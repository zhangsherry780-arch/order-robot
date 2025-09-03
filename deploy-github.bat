@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion

echo 🚀 订餐系统 GitHub 部署脚本 (Windows)
echo ======================================

REM 服务器信息
set SERVER_USER=root
set SERVER_HOST=172.16.74.75
set GITHUB_REPO=https://github.com/zhangsherry780-arch/order-robot.git
set PROJECT_NAME=order-robot

echo 📡 部署信息:
echo    服务器: %SERVER_HOST%
echo    用户: %SERVER_USER%
echo    GitHub仓库: %GITHUB_REPO%
echo    部署路径: ~/%PROJECT_NAME% (当前用户目录)
echo.

REM 检查必要工具
where ssh >nul 2>&1
if %errorlevel% neq 0 (
    echo ❌ 需要安装 SSH 工具。请安装 Git for Windows 或 OpenSSH
    pause
    exit /b 1
)

REM 确认部署
set /p confirm="🔄 确认开始从GitHub部署？(y/N): "
if /i not "%confirm%"=="y" (
    echo ❌ 部署已取消
    pause
    exit /b 0
)

echo 🔄 开始 GitHub 部署流程...

REM 在服务器上执行部署
ssh %SERVER_USER%@%SERVER_HOST% "#!/bin/bash
set -e

echo '🖥️ 当前服务器环境：'
echo '   用户: '$(whoami)
echo '   当前目录: '$(pwd)
echo '   系统: '$(cat /etc/os-release | grep PRETTY_NAME | cut -d '\"' -f 2)
echo ''

# 1. 检查和安装必要工具
echo '🔧 检查必要工具...'

# 检查Git
if ! command -v git >/dev/null 2>&1; then
    echo '📦 安装 Git...'
    apt update && apt install -y git
    echo '✅ Git 安装完成'
else
    echo '✅ Git 已安装: '$(git --version)
fi

# 检查Node.js
if ! command -v node >/dev/null 2>&1; then
    echo '📦 安装 Node.js...'
    curl -fsSL https://deb.nodesource.com/setup_18.x | bash -
    apt-get install -y nodejs
    echo '✅ Node.js 安装完成'
else
    echo '✅ Node.js 已安装: '$(node --version)
fi

# 检查npm
if ! command -v npm >/dev/null 2>&1; then
    echo '❌ npm 未安装'
    exit 1
else
    echo '✅ npm 已安装: '$(npm --version)
fi

# 2. 克隆或更新项目
echo ''
echo '📦 处理项目代码...'

if [ -d \"%PROJECT_NAME%\" ]; then
    echo '📂 项目目录已存在，更新代码...'
    cd %PROJECT_NAME%
    
    # 停止现有服务 (如果在运行)
    if command -v pm2 >/dev/null 2>&1; then
        echo '⏹️ 停止现有PM2服务...'
        pm2 stop %PROJECT_NAME% || echo '服务未在运行'
    fi
    
    if systemctl is-active --quiet %PROJECT_NAME% 2>/dev/null; then
        echo '⏹️ 停止systemd服务...'
        systemctl stop %PROJECT_NAME%
    fi
    
    # 备份数据目录
    if [ -d \"data\" ]; then
        echo '💾 备份现有数据...'
        cp -r data data_backup_$(date +%%Y%%m%%d_%%H%%M%%S) || echo '备份失败，继续部署'
    fi
    
    # 更新代码
    git fetch origin
    git reset --hard origin/main
    echo '✅ 代码更新完成'
    
    # 恢复数据目录 (如果备份存在且当前data目录为空)
    if [ -d \"data_backup_*\" ] && [ ! \"$(ls -A data 2>/dev/null)\" ]; then
        echo '🔄 恢复数据文件...'
        LATEST_BACKUP=$(ls -td data_backup_* | head -1)
        cp -r \"$LATEST_BACKUP\"/* data/ 2>/dev/null || echo '无需恢复数据'
    fi
    
else
    echo '📥 克隆项目...'
    git clone %GITHUB_REPO% %PROJECT_NAME%
    cd %PROJECT_NAME%
    echo '✅ 项目克隆完成'
fi

# 3. 安装依赖
echo ''
echo '📦 安装项目依赖...'
npm install --production

# 4. 创建必要目录
echo '📁 创建项目目录结构...'
mkdir -p logs data/backup

# 5. 配置环境文件
echo ''
echo '⚙️ 配置环境...'
if [ ! -f .env ]; then
    echo '📝 创建环境配置文件...'
    cp .env.production .env
    
    # 自动替换服务器IP
    sed -i 's/SERVER_DOMAIN=.*/SERVER_DOMAIN=%SERVER_HOST%/' .env
    sed -i 's/your-server.com/%SERVER_HOST%/g' .env
    sed -i 's/123.456.789.123/%SERVER_HOST%/g' .env
    
    echo '⚠️ 环境文件已创建，请根据需要编辑 .env 文件'
else
    echo '✅ 环境文件已存在'
fi

# 6. 设置文件权限
chmod +x deploy*.sh debug-server.sh 2>/dev/null || true
chmod -R 755 logs data

echo ''
echo '✅ GitHub 部署完成!'
echo '📍 项目路径: '$(pwd)

# 显示项目信息
echo ''
echo '📋 项目信息:'
echo '   Git分支: '$(git branch --show-current)
echo '   最新提交: '$(git log --oneline -1)
echo '   项目大小: '$(du -sh . | cut -f1)
"

if %errorlevel% equ 0 (
    echo.
    echo 🎉 GitHub 部署成功完成！
    echo.
    echo 📋 接下来需要完成的步骤：
    echo.
    echo 1. 🔐 SSH 连接到服务器:
    echo    ssh %SERVER_USER%@%SERVER_HOST%
    echo.
    echo 2. 📂 进入项目目录:
    echo    cd %PROJECT_NAME%
    echo.
    echo 3. 🌐 检查环境配置 (可选):
    echo    cat .env  # 查看配置，通常无需修改
    echo.
    echo 4. 🚀 启动应用:
    echo.
    echo    方式A - 使用PM2 (推荐):
    echo    npm install -g pm2
    echo    pm2 start ecosystem.config.js --env production
    echo    pm2 save
    echo    pm2 startup
    echo.
    echo    方式B - 直接启动:
    echo    npm start
    echo.
    echo    方式C - 使用systemd:
    echo    # 创建systemd服务文件
    echo    sudo nano /etc/systemd/system/order-robot.service
    echo    # 然后启动服务
    echo    sudo systemctl enable order-robot
    echo    sudo systemctl start order-robot
    echo.
    echo 5. 🌐 配置 Nginx (可选):
    echo    sudo apt install nginx -y
    echo    sudo cp nginx/order-robot.conf /etc/nginx/sites-available/
    echo    sudo ln -s /etc/nginx/sites-available/order-robot /etc/nginx/sites-enabled/
    echo    sudo systemctl restart nginx
    echo.
    echo 6. 🔑 更新飞书回调URL (如果需要):
    echo    http://%SERVER_HOST%/auth/feishu/callback
    echo.
    echo ✅ 应用使用JSON文件存储，无需配置数据库
    echo 🎯 直接访问: http://%SERVER_HOST%:3000
    
) else (
    echo ❌ 部署失败，请检查错误信息
)

pause