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
```

4. **访问系统**
- 用户端: http://localhost:3000
- 管理后台: http://localhost:3000/admin.html
- 机器人API: http://localhost:3000/api/bot

## 📱 使用说明

### 用户端功能
1. **查看今日菜单** - 显示当天午餐和晚餐菜单
2. **不吃登记** - 输入姓名选择餐次进行不吃登记
3. **菜品评价** - 点击菜品卡片进行打分和建议
4. **查看统计** - 实时显示订餐人数统计
5. **本周菜单** - 查看完整周菜单

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

### Docker部署(可选)
```dockerfile
FROM node:16
WORKDIR /app
COPY package*.json ./
RUN npm install --production
COPY . .
EXPOSE 3000
CMD ["npm", "start"]
```

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

### v1.0.0 (2024-01-15)
- ✅ 初始版本发布
- ✅ 智能菜单生成功能
- ✅ 用户端和管理后台
- ✅ 定时任务和机器人API
- ✅ 数据导出功能

## 📄 许可证

MIT License - 可自由使用和修改