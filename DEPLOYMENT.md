# 订餐系统服务器部署指南

本指南将帮助你将订餐系统部署到生产服务器。

## 📋 部署概览

**服务器信息:**
- 服务器IP: `172.16.74.75`
- 用户: `root`
- 密码: `Dnyx@123`

**技术栈:**
- Node.js + Express
- MySQL 数据库
- Nginx 反向代理
- PM2 进程管理
- 飞书OAuth认证

## 🚀 部署步骤

### 1. 服务器环境准备

首先通过SSH连接到服务器：

```bash
ssh root@172.16.74.75
```

#### 1.1 更新系统
```bash
apt update && apt upgrade -y
```

#### 1.2 安装 Node.js
```bash
# 安装 Node.js 18.x LTS
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
apt-get install -y nodejs

# 验证安装
node --version
npm --version
```

#### 1.3 安装 MySQL
```bash
# 安装 MySQL 8.0
apt install mysql-server -y

# 启动 MySQL 服务
systemctl start mysql
systemctl enable mysql

# 安全配置 MySQL
mysql_secure_installation
```

#### 1.4 安装 Nginx
```bash
apt install nginx -y
systemctl start nginx
systemctl enable nginx
```

#### 1.5 安装 PM2
```bash
npm install pm2 -g
```

### 2. MySQL 数据库配置

#### 2.1 创建数据库和用户
```bash
# 登录 MySQL
mysql -u root -p

# 在 MySQL 命令行中执行：
CREATE DATABASE order_robot CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'order_robot'@'localhost' IDENTIFIED BY 'StrongPassword123!';
GRANT ALL PRIVILEGES ON order_robot.* TO 'order_robot'@'localhost';
FLUSH PRIVILEGES;
EXIT;
```

### 3. 代码部署

#### 3.1 创建应用目录
```bash
mkdir -p /var/www/order-robot
cd /var/www/order-robot
```

#### 3.2 上传代码
选择以下方式之一：

**方式1: 直接复制文件**
将本地项目文件通过 SCP 上传到服务器：

```bash
# 在本地执行
scp -r D:\git\order-robot/* root@172.16.74.75:/var/www/order-robot/
```

**方式2: 使用 Git (推荐)**
```bash
# 在服务器上执行
git clone https://github.com/yourname/order-robot.git /var/www/order-robot
cd /var/www/order-robot
```

#### 3.3 安装依赖
```bash
cd /var/www/order-robot
npm install --production
```

#### 3.4 创建必要目录
```bash
mkdir -p logs
mkdir -p data/backup
chmod 755 logs
chmod 755 data
```

### 4. 环境配置

#### 4.1 创建生产环境配置文件
```bash
# 创建 .env 文件
cat > .env << EOF
NODE_ENV=production
PORT=3000
HOST=0.0.0.0

# 数据库配置
DB_HOST=localhost
DB_USER=order_robot
DB_PASSWORD=StrongPassword123!
DB_NAME=order_robot

# 飞书OAuth配置
FEISHU_APP_ID=cli_a829a525a418500d
FEISHU_APP_SECRET=LfRLdJsosP9Pwx8hGqeTrpDwD67qVUki

# 服务器域名
SERVER_DOMAIN=172.16.74.75

# 会话密钥 (请更改为随机字符串)
SESSION_SECRET=your-super-secure-session-secret-change-this

# 安全配置
CORS_ORIGIN=http://172.16.74.75
EOF
```

#### 4.2 更新 ecosystem.config.js
编辑生产环境配置：

```bash
nano ecosystem.config.js
```

更新数据库密码等信息为实际配置。

### 5. 数据库迁移

#### 5.1 执行数据库架构迁移
```bash
npm run db:migrate
```

如果遇到错误，可以手动执行：
```bash
mysql -u order_robot -p order_robot < database/schema.sql
```

#### 5.2 导入现有数据 (可选)
如果你有现有的JSON数据需要迁移：
```bash
npm run migrate
```

### 6. Nginx 配置

#### 6.1 复制 Nginx 配置文件
```bash
cp nginx/order-robot.conf /etc/nginx/sites-available/order-robot
ln -s /etc/nginx/sites-available/order-robot /etc/nginx/sites-enabled/
```

#### 6.2 测试 Nginx 配置
```bash
nginx -t
```

#### 6.3 重启 Nginx
```bash
systemctl restart nginx
```

### 7. 防火墙配置

```bash
# 开放必要端口
ufw allow 22    # SSH
ufw allow 80    # HTTP
ufw allow 443   # HTTPS (如果使用)
ufw enable
```

### 8. 启动应用

#### 8.1 使用 PM2 启动
```bash
# 启动生产环境
pm2 start ecosystem.config.js --env production

# 保存 PM2 配置
pm2 save

# 设置开机自启
pm2 startup
# 按照提示执行生成的命令

# 查看应用状态
pm2 status
pm2 logs order-robot
```

### 9. 飞书配置更新

由于服务器IP地址改变，需要更新飞书应用配置：

1. 登录 [飞书开放平台](https://open.feishu.cn/app)
2. 找到你的应用 (ID: `cli_a829a525a418500d`)
3. 在"安全设置"中添加新的重定向URL：
   - `http://172.16.74.75/auth/feishu/callback`
4. 保存配置

### 10. 验证部署

#### 10.1 测试应用访问
```bash
# 测试本地访问
curl http://localhost:3000

# 测试Nginx代理
curl http://172.16.74.75
```

#### 10.2 检查日志
```bash
# PM2 应用日志
pm2 logs order-robot

# Nginx 访问日志
tail -f /var/log/nginx/order-robot.access.log

# Nginx 错误日志
tail -f /var/log/nginx/order-robot.error.log

# 系统日志
journalctl -u nginx -f
```

## 🔧 常用管理命令

### PM2 管理
```bash
# 查看状态
pm2 status

# 重启应用
pm2 restart order-robot

# 停止应用
pm2 stop order-robot

# 查看日志
pm2 logs order-robot --lines 50

# 监控
pm2 monit

# 重新加载配置
pm2 reload order-robot
```

### 数据库管理
```bash
# 备份数据库
mysqldump -u order_robot -p order_robot > backup_$(date +%Y%m%d_%H%M%S).sql

# 恢复数据库
mysql -u order_robot -p order_robot < backup_file.sql

# 连接数据库
mysql -u order_robot -p order_robot
```

### 应用更新
```bash
# 停止应用
pm2 stop order-robot

# 拉取最新代码 (如果使用Git)
git pull origin main

# 安装新依赖
npm install --production

# 运行数据库迁移 (如果有)
npm run db:migrate

# 重启应用
pm2 restart order-robot
```

## 🛡️ 安全建议

### 1. 数据库安全
- 定期更改数据库密码
- 限制数据库访问来源
- 定期备份数据库

### 2. 应用安全
- 定期更新依赖包
- 使用强随机会话密钥
- 启用 HTTPS (推荐)

### 3. 系统安全
- 定期更新系统
- 配置防火墙
- 监控系统日志

## 🔍 故障排查

### 常见问题

#### 1. 应用无法启动
```bash
# 检查端口占用
netstat -tlnp | grep :3000

# 查看PM2日志
pm2 logs order-robot --lines 100

# 检查配置文件
cat .env
```

#### 2. 数据库连接失败
```bash
# 测试数据库连接
mysql -u order_robot -p order_robot

# 检查MySQL状态
systemctl status mysql

# 查看MySQL日志
journalctl -u mysql -f
```

#### 3. Nginx 502 错误
```bash
# 检查应用是否运行
pm2 status

# 检查Nginx配置
nginx -t

# 查看Nginx错误日志
tail -f /var/log/nginx/order-robot.error.log
```

## 📞 支持联系

如果在部署过程中遇到问题，请检查：
1. 服务器环境是否正确安装
2. 数据库配置是否正确
3. 网络连接是否正常
4. 日志文件中的错误信息

## 🔄 备份策略

建议设置定时备份：

```bash
# 创建备份脚本
cat > /root/backup-order-robot.sh << 'EOF'
#!/bin/bash
BACKUP_DIR="/root/backups/order-robot"
DATE=$(date +%Y%m%d_%H%M%S)

mkdir -p $BACKUP_DIR

# 备份数据库
mysqldump -u order_robot -p'StrongPassword123!' order_robot > $BACKUP_DIR/db_$DATE.sql

# 备份应用文件
tar -czf $BACKUP_DIR/app_$DATE.tar.gz -C /var/www order-robot

# 删除7天前的备份
find $BACKUP_DIR -name "*.sql" -mtime +7 -delete
find $BACKUP_DIR -name "*.tar.gz" -mtime +7 -delete

echo "Backup completed: $DATE"
EOF

chmod +x /root/backup-order-robot.sh

# 设置定时任务 (每天凌晨2点备份)
echo "0 2 * * * /root/backup-order-robot.sh >> /root/backup.log 2>&1" | crontab -
```

部署完成后，你的订餐系统将在 `http://172.16.74.75` 可用！