# 🚀 安装部署指南

## 快速部署(3分钟上手)

### Windows系统
1. 确保已安装 Node.js (https://nodejs.org/)
2. 双击运行 `start.bat`
3. 访问 http://localhost:3000

### Linux/macOS系统
```bash
# 1. 安装Node.js (如未安装)
# Ubuntu: sudo apt install nodejs npm
# CentOS: sudo yum install nodejs npm  
# macOS: brew install node

# 2. 启动系统
chmod +x start.sh
./start.sh
```

## 详细部署步骤

### 1. 环境准备
确保系统已安装:
- Node.js >= 16.0
- npm (通常随Node.js安装)

### 2. 项目部署
```bash
# 进入项目目录
cd order-robot

# 安装依赖
npm install

# 启动服务
npm start
```

### 3. 访问地址
- 用户端: http://localhost:3000
- 管理后台: http://localhost:3000/admin.html
- API文档: http://localhost:3000/api

### 4. 初始化设置
1. 访问管理后台 `/admin.html`
2. 在"菜品管理"中添加菜品
3. 在"系统设置"中配置公司总人数
4. 点击"重新生成本周菜单"

## 生产环境部署

### 使用PM2(推荐)
```bash
# 安装PM2
npm install -g pm2

# 启动服务
pm2 start server.js --name "order-robot"

# 设置开机自启
pm2 startup
pm2 save

# 查看状态
pm2 status
pm2 logs order-robot
```

### Nginx反向代理
```nginx
server {
    listen 80;
    server_name your-domain.com;
    
    location / {
        proxy_pass http://localhost:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}
```

### Docker部署
```bash
# 构建镜像
docker build -t order-robot .

# 运行容器
docker run -d -p 3000:3000 -v ./data:/app/data --name order-robot order-robot
```

## 常见问题

### Q: 端口被占用怎么办?
A: 修改 `server.js` 中的 `PORT` 变量或设置环境变量:
```bash
PORT=8080 node server.js
```

### Q: 数据文件权限问题?
A: 确保程序对data目录有读写权限:
```bash
chmod 755 data
chown -R your-user:your-group data
```

### Q: 定时任务不执行?
A: 检查系统时间是否正确，确认cron表达式格式

## 数据备份
建议定期备份 `data/` 目录:
```bash
# 手动备份
tar -czf backup_$(date +%Y%m%d).tar.gz data/

# 自动备份脚本(加入cron)
0 2 * * * cd /path/to/order-robot && tar -czf backup_$(date +\%Y\%m\%d).tar.gz data/
```

## 监控告警
可集成以下监控:
- PM2监控面板
- Node.js性能监控
- 磁盘空间监控
- API接口可用性监控