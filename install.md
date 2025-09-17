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

# 安装依赖（已包含飞书官方SDK，用于长连接/IM发送）
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

## 🤖 飞书机器人配置与环境变量

> 说明：本项目支持“应用机器人 + 消息卡片回调/长连接”的方式在飞书内点击按钮完成“不吃登记”。

### 1) 在飞书开放平台获取 APP_ID / APP_SECRET

1. 访问“飞书开放平台” → 选择你的应用
2. 左侧“应用凭证”页面可查看：
   - App ID → 配置为 `APP_ID`
   - App Secret → 配置为 `APP_SECRET`
3. 在“应用功能 → 机器人 → 消息卡片”中：
   - 若使用 HTTP 回调：开启“卡片回调”，填写 `https://你的域名/api/feishu/webhook`
   - 若使用长连接：可不配置回调 URL（需要在服务端开启长连接）

将以上写入环境（示例 .env.production）：
```
APP_ID=cli_xxx
APP_SECRET=xxxxx
```

### 2) 获取 FEISHU_TARGET_CHAT_ID（目标群ID）

用于把卡片发送到指定群（测试/日常群）。常见获取方式：

- 简单方式（推荐）：在飞书客户端中打开目标群 → 右上角“...” → 复制群链接，链接中包含 `open_chat_id=oc_********`，将该 `oc_...` 值直接作为 `FEISHU_TARGET_CHAT_ID` 使用。
  - 在 IM v1 接口中，`receive_id_type=chat_id` 接受以 `oc_` 开头的群ID。

- 或通过 OpenAPI 获取：使用租户 token 调用 `im/v1/chats` 或相关接口查询你需要的群并读取其 `chat_id/open_chat_id`（需要相应权限）。

设置环境变量：
```
FEISHU_TARGET_CHAT_ID=oc_************************
```

### 3) 可选：启用长连接（无需公网回调）

1. 官方 SDK 已在 `package.json` 中声明，`npm install` 会自动安装。
2. 设置环境变量：
```
FEISHU_LONG_CONN_ENABLED=true
```
3. 启动服务后，长连接会尝试建立，与飞书保持连接，按钮点击事件将通过长连接抵达服务端。

### 4) 发送测试卡片

调用后端接口发送一张带“登记不吃”按钮的卡片到目标群：
```
POST http://<你的服务>/api/feishu/send-card
Content-Type: application/json
{
  "chatId": "oc_************************",  // 也可不传，使用 FEISHU_TARGET_CHAT_ID
  "mealType": "lunch"                        // lunch | dinner
}
```

点击按钮后：
- 若配置了“卡片回调URL”，则事件以 HTTP 请求到达 `/api/feishu/webhook`
- 若启用了“长连接”，则事件会通过长连接抵达服务端回调

### 5) 纯通知的 Webhook（可选）

仅用于无回调的文本/富文本通知：
- 在飞书群中配置“自定义群机器人 Webhook”
- 设置环境变量 `FEISHU_WEBHOOK_URL` 为该地址
- 代码中仅将其用于纯通知；带按钮的卡片建议统一走“应用机器人 IM 接口”

> 提醒：不要再使用硬编码 Webhook URL，仓库已默认清空 `feishu-config.js` 中的默认值。
