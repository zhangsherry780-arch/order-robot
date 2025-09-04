#!/bin/bash

# 本地上传部署脚本 - 订餐系统
# 从本地上传项目文件并部署到服务器

set -e

echo "🚀 订餐系统本地上传部署脚本"
echo "============================"

# 服务器信息
SERVER_USER="root"
SERVER_HOST="172.16.74.75"
PROJECT_NAME="order-robot"
LOCAL_PROJECT_DIR="$(pwd)"

echo "📡 部署信息:"
echo "   服务器: $SERVER_HOST"
echo "   用户: $SERVER_USER"
echo "   本地项目路径: $LOCAL_PROJECT_DIR"
echo "   服务器部署路径: ~/$PROJECT_NAME"
echo ""

# 检查本地项目文件
if [ ! -f "server.js" ] || [ ! -f "package.json" ]; then
    echo "❌ 当前目录不是有效的项目目录，请在项目根目录运行此脚本"
    exit 1
fi

# 确认部署
read -p "🔄 确认开始从本地上传部署？(y/N): " confirm
if [[ $confirm != [yY] ]]; then
    echo "❌ 部署已取消"
    exit 0
fi

echo "🔄 开始本地上传部署流程..."

# 1. 停止远程服务
echo "⏹️ 停止远程服务..."
ssh $SERVER_USER@$SERVER_HOST << 'EOF'
if command -v pm2 >/dev/null 2>&1; then
    pm2 stop order-robot 2>/dev/null || echo "PM2服务未运行"
fi

if systemctl is-active --quiet order-robot 2>/dev/null; then
    systemctl stop order-robot 2>/dev/null || echo "systemd服务未运行"
fi
EOF

# 2. 备份远程数据
echo "💾 备份远程数据..."
ssh $SERVER_USER@$SERVER_HOST << EOF
if [ -d "$PROJECT_NAME/data" ]; then
    echo "备份现有数据..."
    cp -r $PROJECT_NAME/data $PROJECT_NAME/data_backup_\$(date +%Y%m%d_%H%M%S) 2>/dev/null || echo "备份失败，继续部署"
fi
EOF

# 3. 上传项目文件
echo "📦 上传项目文件..."

# 创建临时目录用于复制要上传的文件
TEMP_DIR=$(mktemp -d)
echo "使用临时目录: $TEMP_DIR"

# 复制文件到临时目录，排除不需要的文件
cp -r . "$TEMP_DIR/upload"
cd "$TEMP_DIR/upload"

# 删除不需要的文件和目录
rm -rf node_modules/ logs/ data_backup_* .git/ *.log .env.local 2>/dev/null || true

# 使用scp上传文件
echo "开始上传文件..."
scp -r ./* $SERVER_USER@$SERVER_HOST:~/$PROJECT_NAME/

# 清理临时目录
cd "$LOCAL_PROJECT_DIR"
rm -rf "$TEMP_DIR"

echo "✅ 文件上传完成"

# 4. 在服务器上执行部署配置
echo "⚙️ 配置服务器环境..."
ssh $SERVER_USER@$SERVER_HOST << EOF
#!/bin/bash
set -e

cd $PROJECT_NAME

echo "🖥️ 当前服务器环境："
echo "   用户: \$(whoami)"
echo "   当前目录: \$(pwd)"
echo "   系统: \$(cat /etc/os-release | grep PRETTY_NAME | cut -d '\"' -f 2)"
echo ""

# 1. 检查和安装必要工具
echo "🔧 检查必要工具..."

# 检查Node.js
if ! command -v node >/dev/null 2>&1; then
    echo "📦 安装 Node.js..."
    curl -fsSL https://deb.nodesource.com/setup_18.x | bash -
    apt-get install -y nodejs
    echo "✅ Node.js 安装完成"
else
    echo "✅ Node.js 已安装: \$(node --version)"
fi

# 检查npm
if ! command -v npm >/dev/null 2>&1; then
    echo "📦 npm 未找到，尝试重新安装 Node.js..."
    # 重新安装 Node.js (通常会包含npm)
    curl -fsSL https://deb.nodesource.com/setup_18.x | bash -
    apt-get install -y nodejs
    
    # 再次检查npm
    if ! command -v npm >/dev/null 2>&1; then
        echo "❌ npm 安装失败，手动安装npm..."
        apt-get install -y npm
        
        # 最后检查
        if ! command -v npm >/dev/null 2>&1; then
            echo "❌ 无法安装npm，请手动安装后重试"
            echo "💡 尝试运行: apt update && apt install -y nodejs npm"
            exit 1
        fi
    fi
    echo "✅ npm 安装完成: \$(npm --version)"
else
    echo "✅ npm 已安装: \$(npm --version)"
fi

# 2. 安装依赖
echo ""
echo "📦 安装项目依赖..."
npm install --production

# 3. 创建必要目录
echo "📁 创建项目目录结构..."
mkdir -p logs data/backup

# 4. 配置环境文件
echo ""
echo "⚙️ 配置环境..."
if [ ! -f .env ]; then
    echo "📝 创建环境配置文件..."
    cp .env.production .env 2>/dev/null || echo "环境配置文件将使用默认值"
    
    # 自动替换服务器IP
    if [ -f .env ]; then
        sed -i "s/SERVER_DOMAIN=.*/SERVER_DOMAIN=$SERVER_HOST/" .env
        sed -i "s/your-server.com/$SERVER_HOST/g" .env
        sed -i "s/123.456.789.123/$SERVER_HOST/g" .env
    fi
    
    echo "⚠️ 环境文件已创建，请根据需要编辑 .env 文件"
else
    echo "✅ 环境文件已存在"
fi

# 5. 设置文件权限
chmod +x deploy*.sh debug-server.sh 2>/dev/null || true
chmod -R 755 logs data

echo ""
echo "✅ 本地上传部署完成!"
echo "📍 项目路径: \$(pwd)"

# 显示项目信息
echo ""
echo "📋 项目信息:"
echo "   项目大小: \$(du -sh . | cut -f1)"
echo "   文件列表: "
ls -la | head -10

EOF

# 检查部署结果
if [ $? -eq 0 ]; then
    echo ""
    echo "🎉 本地上传部署成功完成！"
    echo ""
    echo "📋 接下来需要完成的步骤："
    echo ""
    echo "1. 🔐 SSH 连接到服务器:"
    echo "   ssh $SERVER_USER@$SERVER_HOST"
    echo ""
    echo "2. 📂 进入项目目录:"
    echo "   cd $PROJECT_NAME"
    echo ""
    echo "3. 🌐 检查环境配置 (可选):"
    echo "   cat .env  # 查看配置，通常无需修改"
    echo ""
    echo "4. 🚀 启动应用:"
    echo ""
    echo "   方式A - 使用PM2 (推荐):"
    echo "   npm install -g pm2"
    echo "   pm2 start ecosystem.config.js --env production"
    echo "   pm2 save"
    echo "   pm2 startup"
    echo ""
    echo "   方式B - 直接启动:"
    echo "   npm start"
    echo ""
    echo "   方式C - 使用systemd:"
    echo "   # 创建systemd服务文件"
    echo "   sudo nano /etc/systemd/system/order-robot.service"
    echo "   # 然后启动服务"
    echo "   sudo systemctl enable order-robot"
    echo "   sudo systemctl start order-robot"
    echo ""
    echo "5. 🌐 配置 Nginx (可选):"
    echo "   sudo apt install nginx -y"
    echo "   sudo cp nginx/order-robot.conf /etc/nginx/sites-available/"
    echo "   sudo ln -s /etc/nginx/sites-available/order-robot /etc/nginx/sites-enabled/"
    echo "   sudo systemctl restart nginx"
    echo ""
    echo "6. 🔑 更新飞书回调URL (如果需要):"
    echo "   http://$SERVER_HOST/auth/feishu/callback"
    echo ""
    echo "✅ 应用使用JSON文件存储，无需配置数据库"
    echo "🎯 直接访问: http://$SERVER_HOST:3000"
    
else
    echo "❌ 部署失败，请检查错误信息"
    exit 1
fi