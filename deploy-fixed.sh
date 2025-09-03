#!/bin/bash

# 修复版订餐系统部署脚本
# 解决权限问题，支持多种部署路径

set -e

echo "🚀 订餐系统部署脚本 (修复版)"
echo "================================"

# 服务器信息
SERVER_USER="root"
SERVER_HOST="172.16.74.75"

# 尝试多个可能的部署路径
POSSIBLE_PATHS=(
    "/var/www/order-robot"
    "/opt/order-robot"
    "/usr/local/order-robot"
    "/home/root/order-robot"
    "/root/order-robot"
)

echo "📡 服务器信息:"
echo "   地址: $SERVER_HOST"
echo "   用户: $SERVER_USER"
echo ""

# 确认部署
read -p "🔄 确认开始部署到生产服务器？(y/N): " confirm
if [[ $confirm != [yY] ]]; then
    echo "❌ 部署已取消"
    exit 0
fi

echo "🔍 正在检查服务器环境和权限..."

# 在服务器上运行环境检查和目录创建
SERVER_PATH=$(ssh $SERVER_USER@$SERVER_HOST << 'EOF'
#!/bin/bash

# 尝试的路径列表
PATHS=(
    "/var/www/order-robot"
    "/opt/order-robot" 
    "/usr/local/order-robot"
    "/home/root/order-robot"
    "/root/order-robot"
)

echo "🔍 检查系统状态..."

# 检查磁盘空间
DISK_USAGE=$(df / | tail -1 | awk '{print $5}' | sed 's/%//')
if [ "$DISK_USAGE" -gt 90 ]; then
    echo "⚠️ 警告：磁盘使用率 ${DISK_USAGE}%，空间不足可能导致创建目录失败"
fi

# 检查文件系统是否只读
if mount | grep " / " | grep -q ro; then
    echo "❌ 错误：根文件系统是只读模式，尝试重新挂载..."
    mount -o remount,rw / 2>/dev/null || echo "⚠️ 无法重新挂载为读写模式"
fi

# 确保以真正的root身份运行
if [ "$EUID" -ne 0 ]; then
    echo "❌ 错误：未以root身份运行，当前用户：$(whoami)"
    exit 1
fi

echo "✅ 当前用户：$(whoami) (UID: $EUID)"

# 尝试创建目录
SELECTED_PATH=""
for path in "${PATHS[@]}"; do
    echo "📁 尝试创建目录：$path"
    
    # 先创建父目录
    parent_dir=$(dirname "$path")
    if [ ! -d "$parent_dir" ]; then
        echo "   创建父目录：$parent_dir"
        if mkdir -p "$parent_dir" 2>/dev/null; then
            echo "   ✅ 父目录创建成功"
        else
            echo "   ❌ 父目录创建失败"
            continue
        fi
    fi
    
    # 创建目标目录
    if mkdir -p "$path" 2>/dev/null; then
        echo "   ✅ 成功创建：$path"
        SELECTED_PATH="$path"
        break
    else
        echo "   ❌ 失败：$path"
        # 显示详细错误
        mkdir -p "$path" 2>&1 | head -1
    fi
done

if [ -z "$SELECTED_PATH" ]; then
    echo "❌ 所有路径都无法创建，部署失败"
    echo "🛠️ 请尝试以下解决方案："
    echo "1. 检查磁盘空间：df -h"
    echo "2. 检查文件系统权限：mount | grep ' / '"
    echo "3. 手动创建目录：mkdir -p /var/www/order-robot"
    echo "4. 检查 SELinux/AppArmor 状态"
    exit 1
fi

echo "$SELECTED_PATH"
EOF
)

# 检查服务器执行结果
if [ $? -ne 0 ] || [ -z "$SERVER_PATH" ]; then
    echo "❌ 服务器环境检查失败，请登录服务器手动排查："
    echo "   ssh $SERVER_USER@$SERVER_HOST"
    echo "   然后运行诊断脚本：./debug-server.sh"
    exit 1
fi

echo "✅ 选定部署路径：$SERVER_PATH"

# 创建完整的目录结构
echo "📁 创建完整目录结构..."
ssh $SERVER_USER@$SERVER_HOST << EOF
mkdir -p $SERVER_PATH/{logs,data,data/backup,database,config,scripts,nginx,public}
chmod -R 755 $SERVER_PATH
echo "✅ 目录结构创建完成"
EOF

# 上传项目文件
echo "📤 上传项目文件..."

# 创建临时排除文件
cat > .deployignore << 'DEPLOYIGNORE'
node_modules/
.git/
logs/
*.log
.env
data/backup/
.DS_Store
Thumbs.db
debug-server.sh
deploy-fixed.sh
.deployignore
DEPLOYIGNORE

# 使用 rsync 上传文件
rsync -avz --exclude-from=.deployignore \
    --progress \
    ./ $SERVER_USER@$SERVER_HOST:$SERVER_PATH/

if [ $? -ne 0 ]; then
    echo "❌ 文件上传失败"
    rm -f .deployignore
    exit 1
fi

echo "✅ 文件上传成功"

# 在服务器上设置环境
echo "🔧 配置服务器环境..."
ssh $SERVER_USER@$SERVER_HOST << EOF
cd $SERVER_PATH

# 安装依赖
echo "📦 安装Node.js依赖..."
npm install --production --no-optional

# 创建环境配置文件
if [ ! -f .env ]; then
    echo "📝 创建环境配置文件..."
    cp .env.production .env
    echo "⚠️ 请编辑 .env 文件配置数据库密码等信息"
fi

# 设置文件权限
chmod -R 755 .
chmod +x deploy.sh debug-server.sh 2>/dev/null || true

# 创建systemd服务文件 (如果不使用PM2)
cat > /etc/systemd/system/order-robot.service << 'SERVICE'
[Unit]
Description=Order Robot - Company Food Ordering System
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=$SERVER_PATH
Environment=NODE_ENV=production
Environment=PORT=3000
ExecStart=/usr/bin/node server.js
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
SERVICE

systemctl daemon-reload

echo "✅ 服务器配置完成"
EOF

# 清理临时文件
rm -f .deployignore

echo ""
echo "🎉 部署文件上传完成！"
echo "📍 部署路径：$SERVER_PATH"
echo ""
echo "📋 接下来需要完成以下步骤:"
echo ""
echo "1. 🔐 SSH 连接到服务器:"
echo "   ssh $SERVER_USER@$SERVER_HOST"
echo ""
echo "2. 📊 安装和配置 MySQL:"
echo "   apt update && apt install mysql-server -y"
echo "   mysql_secure_installation"
echo "   mysql -u root -p"
echo "   然后执行SQL："
echo "   CREATE DATABASE order_robot CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
echo "   CREATE USER 'order_robot'@'localhost' IDENTIFIED BY 'StrongPassword123!';"
echo "   GRANT ALL PRIVILEGES ON order_robot.* TO 'order_robot'@'localhost';"
echo "   FLUSH PRIVILEGES;"
echo "   EXIT;"
echo ""
echo "3. 🌐 配置环境变量:"
echo "   cd $SERVER_PATH"
echo "   nano .env  # 编辑数据库密码等配置"
echo ""
echo "4. 📦 执行数据库迁移:"
echo "   npm run db:migrate"
echo ""
echo "5. 🚀 启动应用 (选择其中一种方式):"
echo ""
echo "   方式A - 使用PM2 (推荐):"
echo "   npm install pm2 -g"
echo "   pm2 start ecosystem.config.js --env production"
echo "   pm2 save && pm2 startup"
echo ""
echo "   方式B - 使用systemd:"
echo "   systemctl enable order-robot"
echo "   systemctl start order-robot"
echo "   systemctl status order-robot"
echo ""
echo "6. 🌐 配置 Nginx (可选但推荐):"
echo "   apt install nginx -y"
echo "   cp $SERVER_PATH/nginx/order-robot.conf /etc/nginx/sites-available/"
echo "   ln -s /etc/nginx/sites-available/order-robot /etc/nginx/sites-enabled/"
echo "   nginx -t && systemctl restart nginx"
echo ""
echo "7. 🔑 更新飞书回调URL:"
echo "   在飞书开放平台添加: http://$SERVER_HOST/auth/feishu/callback"
echo ""
echo "8. 🧪 测试访问:"
echo "   curl http://$SERVER_HOST"
echo "   或在浏览器打开：http://$SERVER_HOST"
echo ""
echo "📖 详细部署说明请参考 DEPLOYMENT.md 文件"
echo "🎯 部署完成！"