# 🚀 订餐系统快速启动指南

## 📦 服务器信息
- **服务器**: `192.168.3.11`
- **用户**: `caikangbei`
- **GitHub仓库**: `https://github.com/zhangsherry780-arch/order-robot.git`
- **存储方式**: JSON文件（无需数据库）

## ⚡ 快速部署

### 1. 运行部署脚本
```bash
# Windows
deploy-github.bat

# Linux/Mac
chmod +x deploy-github.sh
./deploy-github.sh
```

### 2. SSH连接到服务器
```bash
ssh caikangbei@192.168.3.11
```

### 3. 进入项目目录
```bash
cd order-robot
```

### 4. 启动应用 (选择其中一种)

#### 方式A：直接启动 (推荐测试)
```bash
npm start
```

#### 方式B：使用PM2 (推荐生产)
```bash
# 安装PM2
npm install -g pm2

# 启动应用
pm2 start server.js --name order-robot

# 保存配置
pm2 save
pm2 startup

# 查看状态
pm2 status
```

#### 方式C：后台运行
```bash
# 使用nohup后台运行
nohup npm start > app.log 2>&1 &

# 查看日志
tail -f app.log
```

## 🎯 访问应用

- **直接访问**: `http://192.168.3.11:3000`
- **登录页面**: `http://192.168.3.11:3000/login`

## 🛠️ 常用管理命令

### PM2管理 (如果使用PM2)
```bash
pm2 list                # 查看所有进程
pm2 logs order-robot    # 查看日志
pm2 restart order-robot # 重启应用
pm2 stop order-robot    # 停止应用
pm2 delete order-robot  # 删除进程
```

### 项目更新
```bash
cd order-robot

# 停止服务 (如果使用PM2)
pm2 stop order-robot

# 更新代码
git pull origin main

# 安装新依赖 (如果有)
npm install

# 重启服务
pm2 restart order-robot
# 或直接启动
npm start
```

### 查看日志
```bash
# PM2日志
pm2 logs order-robot

# 应用日志 (如果存在)
tail -f logs/app.log

# 系统日志
tail -f /var/log/syslog
```

## 🔧 配置文件

### 环境配置 (.env)
```bash
# 查看当前配置
cat .env

# 编辑配置 (如果需要)
nano .env
```

主要配置项：
- `NODE_ENV=production`
- `PORT=3000`
- `SERVER_DOMAIN=192.168.3.11`

### 数据文件位置
```bash
ls -la data/
# employees.json          - 员工信息
# restaurants.json        - 餐厅信息
# dishes.json            - 菜品信息
# weekly-menus.json      - 周菜单
# daily-orders.json      - 每日订单
# ratings.json           - 评价数据
# restaurant-suggestions.json - 餐厅投稿
```

## 🚨 故障排查

### 1. 端口被占用
```bash
# 查看端口占用
netstat -tlnp | grep :3000

# 杀死进程
kill -9 <PID>
```

### 2. 权限问题
```bash
# 修复权限
chmod -R 755 ~/order-robot
chown -R caikangbei:caikangbei ~/order-robot
```

### 3. 模块缺失
```bash
# 重新安装依赖
rm -rf node_modules package-lock.json
npm install
```

### 4. 查看详细错误
```bash
# 查看完整错误信息
npm start 2>&1 | tee error.log
```

## 📱 飞书配置

如果需要使用飞书登录，更新回调URL为：
- `http://192.168.3.11:3000/auth/feishu/callback`

## ✅ 检查清单

部署完成后确认：

- [ ] 应用正常启动 (`npm start` 无错误)
- [ ] 可以访问 `http://192.168.3.11:3000`
- [ ] 登录页面正常显示
- [ ] 数据文件存在 (`ls data/`)
- [ ] 日志目录可写 (`ls logs/`)

## 🎉 完成！

现在你的订餐系统已经在 `http://192.168.3.11:3000` 运行了！