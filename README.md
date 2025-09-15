# 🍽️ 公司订餐系统

一个完整的公司内部订餐管理系统，支持智能菜单生成、订餐统计、员工评价等功能。

## 📋 功能特性

### 核心功能
- ✅ **智能菜单生成** - 每周一自动生成基于评分的智能菜单
- ✅ **订餐统计** - 实时统计午/晚餐订餐人数
- ✅ **员工评价** - 支持菜品打分(1-5)和建议反馈
- ✅ **不吃登记** - 每天10:00/16:00开放登记入口
- ✅ **管理后台** - 员工、菜品、系统配置管理
- ✅ **数据导出** - 支持各类数据导出
- ✅ **机器人接口** - JSON API供飞书/企业微信集成

### 定时任务
- 🕘 每周一 09:00 自动生成本周菜单
- 🕙 每天 10:00 开放午餐不吃登记
- 🕐 每天 16:00 开放晚餐不吃登记

## 🚀 快速开始

### 系统要求
- Node.js >= 16.0
- 无需数据库(使用JSON文件存储)

### 安装部署

1. **克隆项目**
```bash
# 如果是从GitHub克隆
git clone <repository-url>
cd order-robot

# 如果是解压文件包
cd order-robot
```

2. **安装依赖**
```bash
npm install
```

3. **启动服务**
```bash
# 开发环境
npm run dev

# 生产环境
npm start

# 或者直接使用Node.js启动
node server.js
```

4. **访问系统**
- 用户端: http://localhost:3000
- 管理后台: http://localhost:3000/admin.html
- 机器人API: http://localhost:3000/api/bot

## 🎮 服务控制命令

### 启动服务
```bash
# 方法1: 使用npm脚本
cd D:\git\order-robot
npm start

# 方法2: 直接使用Node.js
cd D:\git\order-robot
node server.js

# 方法3: 指定端口启动
cd D:\git\order-robot
set PORT=3001
npm start

# 方法4: 后台启动(使用PM2)
npm install -g pm2
pm2 start server.js --name "order-robot"
```

### 停止服务
```bash
# 方法1: 命令行按 Ctrl+C 停止

# 方法2: 杀掉Node.js进程(Windows)
taskkill //F //IM node.exe

# 方法3: 杀掉特定端口进程
# 先查找占用端口的进程ID
netstat -ano | findstr :3000
# 杀掉对应进程(替换PID为实际进程ID)
taskkill //F //PID <PID>

# 方法4: 停止PM2服务
pm2 stop order-robot
pm2 delete order-robot
```

### 重启服务
```bash
# 方法1: 先停止再启动
# 按Ctrl+C停止，然后运行npm start

# 方法2: PM2重启
pm2 restart order-robot

# 方法3: PM2重载(无停机重启)
pm2 reload order-robot
```

### 查看服务状态
```bash
# 检查端口占用情况
netstat -ano | findstr :3000

# 查看Node.js进程
tasklist | findstr node

# PM2状态查看
pm2 status
pm2 logs order-robot
```

### Docker方式启动/停止
```bash
# 构建镜像
docker build -t order-robot .

# 启动容器
docker run -d -p 3000:3000 --name order-robot-container order-robot

# 停止容器
docker stop order-robot-container

# 删除容器
docker rm order-robot-container

# 使用docker-compose
docker-compose up -d    # 后台启动
docker-compose down     # 停止并删除
docker-compose restart  # 重启服务
```

## 📱 使用说明

### 用户端功能

#### 🍽️ 用户点餐页面 (新功能)
1. **今日餐次展示** - 显示当天中餐和晚餐详细菜单
2. **吃/不吃切换** - 大按钮快速切换餐次偏好("✅ 吃饭" / "❌ 不吃")  
3. **展开本周菜单** - 一键展开查看完整周菜单
4. **未来餐次预订** - 可为未来日期设置餐次偏好
5. **时间限制控制** - 午餐11:00后、晚餐16:30后自动禁用修改
6. **状态智能提示** - 实时显示截止时间和操作状态

#### 🌟 其他功能页面
1. **菜品评价页面** - 点击菜品查看详细评价，支持打分和评论
2. **餐厅投稿墙** - 推荐新餐厅，支持投票和图片展示
3. **飞书登录集成** - 支持企业飞书账号一键登录
4. **实时统计展示** - 首页显示今日订餐人数统计

### 管理后台功能
1. **统计概览** - 今日订餐数据总览
2. **员工管理** - 增删改查员工信息
3. **菜品管理** - 管理菜品库，手动生成菜单
4. **系统设置** - 配置总人数、定时任务时间等
5. **数据导出** - 导出各类业务数据

### 机器人API接口
```bash
# 获取今日菜单
GET /api/bot/menu/today

# 获取今日统计
GET /api/bot/stats/today

# 示例响应
{
  "success": true,
  "data": {
    "lunch": [...],
    "dinner": [...],
    "date": "2024-01-15"
  }
}
```

## 🔧 配置说明

### 系统设置(可在管理后台修改)
- `totalEmployees`: 公司总人数 (默认50)
- `lunchOpenTime`: 午餐登记开放时间 (默认10:00)
- `dinnerOpenTime`: 晚餐登记开放时间 (默认16:00)
- `menuGenerateTime`: 菜单生成时间 (默认09:00)

### 数据文件结构
```
data/
├── employees.json        # 员工数据
├── dishes.json          # 菜品数据
├── weekly-menus.json    # 周菜单
├── daily-orders.json    # 每日订餐统计
├── no-eat-registrations.json  # 不吃登记
├── ratings.json         # 菜品评价
└── settings.json        # 系统设置
```

## 🔗 外部系统集成

### 飞书机器人集成示例
```javascript
// 获取今日菜单推送
const response = await fetch('http://your-server:3000/api/bot/menu/today');
const menuData = await response.json();

// 发送到飞书群
if (menuData.success) {
  const message = formatMenuMessage(menuData.data);
  await sendToFeishu(message);
}
```

### 企业微信机器人集成
```python
import requests

# 获取订餐统计
response = requests.get('http://your-server:3000/api/bot/stats/today')
stats = response.json()

# 推送统计信息
if stats['success']:
    send_to_wechat_work(format_stats_message(stats['data']))
```

## 📊 部署建议

### 生产环境部署

1. **使用PM2管理进程**
```bash
npm install -g pm2
pm2 start server.js --name "order-robot"
pm2 startup
pm2 save
```

2. **Nginx反向代理配置**
```nginx
server {
    listen 80;
    server_name your-domain.com;
    
    location / {
        proxy_pass http://localhost:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

3. **数据备份脚本**
```bash
#!/bin/bash
# backup-data.sh
DATE=$(date +%Y%m%d_%H%M%S)
tar -czf "backup_${DATE}.tar.gz" data/
# 可配置到cron定期执行
```

### Docker离线部署

适用于服务器无网络环境，通过Docker容器提供运行环境，只需同步修改的代码文件。

#### 🔧 部署流程

**1. 联网环境构建镜像**
```bash
# 在开发机上构建Docker镜像
./build-docker.sh v1.0.6

# 生成文件: order-robot-v1.0.6.tar.gz
```

**2. 上传文件到离线服务器**
```bash
# 自动同步所有必需文件（已配置服务器信息）
./sync-files.sh

# 或手动上传以下文件：
# - order-robot-v1.0.6.tar.gz (Docker镜像)
# - docker-compose.yml (容器编排)
# - deploy-offline.sh (部署脚本)
# - server.js, config/, public/, database/, scripts/, data/
# - .env.production, ecosystem.config.js, feishu-config.js
```

**3. 离线服务器部署**
```bash
# 一键部署（自动加载镜像、更新latest标签、清理旧镜像）
./deploy-offline.sh v1.0.6

# 服务自动启动在: http://localhost:3000
```

#### 📁 文件挂载说明

Docker容器通过文件挂载实现代码热更新：

```yaml
volumes:
  # 只读挂载 - 代码文件（支持热更新）
  - ./server.js:/app/server.js:ro
  - ./config:/app/config:ro
  - ./public:/app/public:ro
  - ./database:/app/database:ro
  - ./scripts:/app/scripts:ro
  - ./feishu-config.js:/app/feishu-config.js:ro
  - ./.env.production:/app/.env.production:ro
  - ./ecosystem.config.js:/app/ecosystem.config.js:ro

  # 读写挂载 - 数据目录
  - ./data:/app/data
  - ./logs:/app/logs
```

#### 🔄 日常更新流程

**方式1: 自动同步脚本**
```bash
# 修改代码后，一键同步到服务器并重启服务
./sync-files.sh
```

**方式2: 手动更新**
```bash
# 1. 上传修改的文件到服务器
scp server.js root@192.168.1.100:/opt/order-robot/

# 2. 重启容器生效
docker-compose restart order-robot
```

#### 🛠️ 管理命令

```bash
# 查看服务状态
docker-compose ps

# 查看实时日志
docker-compose logs -f order-robot

# 重启服务
docker-compose restart order-robot

# 停止服务
docker-compose down

# 启动服务
docker-compose up -d

# 进入容器调试
docker-compose exec order-robot sh
```

#### 🔍 故障排查

```bash
# 查看容器详细信息
docker inspect order-robot

# 查看镜像列表
docker images order-robot

# 手动运行容器调试
docker run -it --rm order-robot:latest sh

# 检查文件权限
ls -la server.js config/ public/
```

#### ⚡ 性能优化

- **镜像优化**: 基于Alpine Linux，镜像大小约220MB
- **依赖缓存**: 分层构建，依赖变化时无需重新安装
- **热更新**: 代码文件挂载，修改即时生效
- **自动清理**: 部署时自动清理旧版本镜像
- **健康检查**: 内置服务健康检查机制

#### 📦 部署架构

```
开发机(联网) -> 构建Docker镜像 -> 导出tar.gz
     ↓
离线服务器 -> 加载镜像 -> 启动容器 -> 挂载代码文件
     ↓
日常更新 -> 只传输代码文件 -> 容器自动重启
```

**优势：**
- ✅ 环境一致性 - Docker容器统一运行环境
- ✅ 快速部署 - 一键脚本自动化部署
- ✅ 增量更新 - 日常只需传输修改文件
- ✅ 版本管理 - 支持版本回滚和管理
- ✅ 自动维护 - 自动清理旧镜像节省空间

## 🛠️ 开发说明

### 项目结构
```
order-robot/
├── server.js           # 主服务器文件
├── package.json        # 项目配置
├── data/              # 数据存储目录
├── public/            # 前端静态文件
│   ├── index.html     # 用户端页面
│   └── admin.html     # 管理后台页面
└── README.md          # 项目文档
```

### 技术栈
- **后端**: Node.js + Express + JSON文件存储
- **前端**: Vue 3 + Element Plus + 响应式设计
- **定时任务**: node-cron
- **工具库**: moment.js, fs-extra

### API接口文档

#### 用户端接口
- `GET /api/menu/today` - 今日菜单
- `GET /api/menu/week` - 本周菜单  
- `POST /api/no-eat/register` - 不吃登记
- `DELETE /api/no-eat/cancel` - 取消登记
- `GET /api/order/stats/today` - 今日统计
- `POST /api/rating/submit` - 提交评价

#### 管理端接口
- `GET /api/admin/stats` - 统计概览
- `GET/POST/PUT/DELETE /api/admin/employees` - 员工管理
- `GET/POST/PUT/DELETE /api/admin/dishes` - 菜品管理
- `GET/PUT /api/admin/settings` - 系统设置
- `POST /api/admin/menu/generate` - 生成菜单
- `GET /api/admin/export/*` - 数据导出

#### 机器人接口
- `GET /api/bot/menu/today` - 今日菜单JSON
- `GET /api/bot/stats/today` - 今日统计JSON

## 📞 技术支持

### 常见问题
1. **Q: 菜单没有自动生成?**
   A: 检查是否有可用菜品，确认定时任务是否正常运行

2. **Q: 不吃登记不能提交?**
   A: 确认当前时间是否在开放时间内，检查姓名是否已登记

3. **Q: 数据丢失怎么办?**
   A: 定期备份data目录，重要数据建议导出保存

### 日志查看
```bash
# 查看实时日志
tail -f logs/app.log

# 使用PM2查看日志
pm2 logs order-robot
```

### 故障排查
1. 检查端口是否被占用
2. 确认data目录权限是否正确
3. 查看系统日志确认定时任务执行情况

## 📝 更新日志

### v1.1.0 (2025-09-06)
- 🎉 **全新用户点餐页面** - 专门的点餐界面，提升用户体验
- ✅ **餐次展示优化** - 今日中餐/晚餐详细菜单展示  
- ✅ **吃/不吃快速切换** - 大按钮设计，操作更便捷
- ✅ **本周菜单展开功能** - 一键查看完整周菜单
- ✅ **未来餐次预订** - 支持为未来日期设置餐次偏好
- ✅ **时间限制优化** - 晚餐截止时间调整为16:30，更符合实际需求
- ✅ **智能状态提示** - 实时显示截止时间和操作状态
- ✅ **飞书OAuth修复** - 支持动态回调URL，解决重定向问题
- ✅ **Docker部署支持** - 新增本地构建和部署方案

### v1.0.0 (2024-01-15)  
- ✅ 初始版本发布
- ✅ 智能菜单生成功能
- ✅ 用户端和管理后台
- ✅ 定时任务和机器人API
- ✅ 数据导出功能

## 📄 许可证

MIT License - 可自由使用和修改