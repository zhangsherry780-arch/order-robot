#!/bin/bash

# 订餐系统自动部署脚本
# 使用方法: ./deploy.sh

set -e

echo "🚀 订餐系统自动部署脚本"
echo "========================="

# 检查必要的工具
command -v scp >/dev/null 2>&1 || { echo "❌ 需要安装 scp"; exit 1; }
command -v ssh >/dev/null 2>&1 || { echo "❌ 需要安装 ssh"; exit 1; }

# 服务器信息
SERVER_USER="root"
SERVER_HOST="172.16.74.75"
SERVER_PATH="/var/www/order-robot"
LOCAL_PATH="."

echo "📡 服务器信息:"
echo "   地址: $SERVER_HOST"
echo "   用户: $SERVER_USER"
echo "   路径: $SERVER_PATH"
echo ""

# 确认部署
read -p "🔄 确认开始部署到生产服务器？(y/N): " confirm
if [[ $confirm != [yY] ]]; then
    echo "❌ 部署已取消"
    exit 0
fi

echo "📦 准备部署文件..."

# 创建临时排除文件
cat > .deployignore << EOF
node_modules/
.git/
logs/
*.log
.env
data/backup/
.DS_Store
Thumbs.db
EOF

# 1. 创建服务器目录结构
echo "📁 创建服务器目录结构..."
ssh $SERVER_USER@$SERVER_HOST << 'ENDSSH'
mkdir -p /var/www/order-robot
mkdir -p /var/www/order-robot/logs
mkdir -p /var/www/order-robot/data
mkdir -p /var/www/order-robot/data/backup
mkdir -p /var/www/order-robot/database
mkdir -p /var/www/order-robot/config
mkdir -p /var/www/order-robot/scripts
mkdir -p /var/www/order-robot/nginx
ENDSSH

# 2. 上传项目文件
echo "📤 上传项目文件..."
rsync -avz --exclude-from=.deployignore \
    --exclude='node_modules' \
    --exclude='.git' \
    --exclude='logs' \
    --exclude='*.log' \
    --exclude='.env' \
    ./ $SERVER_USER@$SERVER_HOST:$SERVER_PATH/

# 3. 安装依赖并配置
echo "🔧 在服务器上安装依赖和配置..."
ssh $SERVER_USER@$SERVER_HOST << 'ENDSSH'
cd /var/www/order-robot

# 安装 Node.js 依赖
npm install --production

# 创建日志目录
mkdir -p logs
chmod 755 logs

# 设置文件权限
chown -R www-data:www-data /var/www/order-robot
chmod -R 755 /var/www/order-robot

echo "✅ 服务器配置完成"
ENDSSH

# 4. 提示后续步骤
echo ""
echo "🎉 文件上传完成！"
echo ""
echo "📋 接下来需要手动完成以下步骤:"
echo ""
echo "1. 🔐 SSH 连接到服务器:"
echo "   ssh $SERVER_USER@$SERVER_HOST"
echo ""
echo "2. 📊 配置数据库:"
echo "   - 安装 MySQL: apt install mysql-server -y"
echo "   - 创建数据库: mysql -u root -p"
echo "   - 执行以下SQL:"
echo "     CREATE DATABASE order_robot CHARACTER SET utf8mb4;"
echo "     CREATE USER 'order_robot'@'localhost' IDENTIFIED BY 'StrongPassword123!';"
echo "     GRANT ALL PRIVILEGES ON order_robot.* TO 'order_robot'@'localhost';"
echo ""
echo "3. 🌐 配置环境变量:"
echo "   cd /var/www/order-robot"
echo "   cp .env.production .env"
echo "   nano .env  # 编辑数据库密码等配置"
echo ""
echo "4. 📦 执行数据库迁移:"
echo "   npm run db:migrate"
echo ""
echo "5. 🚀 启动应用:"
echo "   npm install pm2 -g"
echo "   pm2 start ecosystem.config.js --env production"
echo "   pm2 save"
echo "   pm2 startup"
echo ""
echo "6. 🌐 配置 Nginx (可选):"
echo "   apt install nginx -y"
echo "   cp nginx/order-robot.conf /etc/nginx/sites-available/"
echo "   ln -s /etc/nginx/sites-available/order-robot /etc/nginx/sites-enabled/"
echo "   systemctl restart nginx"
echo ""
echo "7. 🔑 更新飞书回调URL:"
echo "   在飞书开放平台添加: http://$SERVER_HOST/auth/feishu/callback"
echo ""
echo "📖 详细部署说明请参考 DEPLOYMENT.md 文件"
echo ""

# 清理临时文件
rm -f .deployignore

echo "🎯 访问地址: http://$SERVER_HOST"
echo "✨ 部署完成！"