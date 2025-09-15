# Docker 离线部署方案

本方案适用于服务器无法联网的环境，通过Docker容器提供运行环境，只需同步修改的代码文件。

## 📋 方案概述

1. **联网环境**: 构建包含所有依赖的Docker镜像
2. **离线服务器**: 加载镜像并启动容器，挂载代码文件
3. **日常更新**: 只需同步修改的文件，容器自动重启

## 🔧 环境准备

### 联网环境（开发机）
- Docker
- Docker Compose

### 离线服务器
- Docker
- Docker Compose
- 无需Node.js环境

## 🚀 部署步骤

### 1. 联网环境构建镜像

```bash
# 构建Docker镜像并导出
./build-docker.sh [版本号]

# 例如: ./build-docker.sh v1.0.0
# 默认版本: ./build-docker.sh
```

此脚本会生成:
- `order-robot-[版本].tar.gz` - Docker镜像文件

### 2. 上传文件到服务器

将以下文件上传到服务器部署目录:

#### 必需文件
- `order-robot-[版本].tar.gz` - Docker镜像
- `docker-compose.yml` - 容器编排文件
- `deploy-offline.sh` - 部署脚本
- `sync-files.sh` - 同步脚本

#### 代码文件
- `server.js` - 主服务文件
- `config/` - 配置目录

- `public/` - 静态文件
- `database/` - 数据库相关
- `scripts/` - 脚本文件
- `.env.production` - 生产环境配置
- `ecosystem.config.js` - PM2配置

### 3. 离线服务器部署

```bash
# 在服务器上运行部署脚本
./deploy-offline.sh [版本号]

# 例如: ./deploy-offline.sh v1.0.0
```

## 📁 文件挂载说明

Docker容器通过以下方式挂载文件:

```yaml
volumes:
  # 只读挂载 - 代码文件
  - ./server.js:/app/server.js:ro
  - ./config:/app/config:ro
  - ./public:/app/public:ro
  - ./database:/app/database:ro
  - ./scripts:/app/scripts:ro
  - ./.env.production:/app/.env.production:ro
  - ./ecosystem.config.js:/app/ecosystem.config.js:ro

  # 读写挂载 - 数据目录
  - ./data:/app/data
  - ./logs:/app/logs
```

## 🔄 日常更新流程

### 方案1: 手动同步

1. 修改代码文件
2. 上传修改的文件到服务器
3. 重启容器:
   ```bash
   docker-compose restart order-robot
   ```

### 方案2: 脚本同步

```bash
# 自动同步文件并重启服务
./sync-files.sh 服务器地址 [用户名] [服务器路径]

# 例如:
./sync-files.sh 192.168.1.100 ubuntu /opt/order-robot
```

## 🛠️ 管理命令

```bash
# 查看服务状态
docker-compose ps

# 查看日志
docker-compose logs -f order-robot

# 重启服务
docker-compose restart order-robot

# 停止服务
docker-compose down

# 启动服务
docker-compose up -d

# 进入容器
docker-compose exec order-robot sh
```

## 📊 监控和健康检查

容器包含健康检查机制:
- 检查间隔: 30秒
- 超时时间: 10秒
- 重试次数: 3次
- 启动期间: 30秒

查看健康状态:
```bash
docker-compose ps
# 或
docker inspect order-robot --format='{{.State.Health.Status}}'
```

## 🔧 故障排查

### 容器无法启动
```bash
# 查看容器日志
docker-compose logs order-robot

# 查看构建日志
docker build -t order-robot .
```

### 服务无法访问
```bash
# 检查端口映射
docker-compose ps

# 检查网络
docker network ls
docker network inspect order-robot_default
```

### 文件权限问题
```bash
# 确保文件权限正确
chmod -R 755 config/ public/ database/ scripts/
chmod 644 server.js .env.production ecosystem.config.js
```

## ⚡ 性能优化

1. **镜像大小优化**: 使用 `alpine` 基础镜像
2. **缓存优化**: 分层构建，依赖先安装
3. **数据持久化**: 数据目录挂载到宿主机
4. **日志管理**: 日志文件挂载，便于查看和备份

## 🔒 安全建议

1. 使用非root用户运行容器
2. 只读挂载代码文件
3. 定期更新基础镜像
4. 配置防火墙规则
5. 使用密钥文件而不是密码SSH

## 📝 版本管理

建议的版本号格式:
- 主版本更新: `v1.0.0`, `v2.0.0`
- 功能更新: `v1.1.0`, `v1.2.0`
- 修复更新: `v1.1.1`, `v1.1.2`
- 开发版本: `v1.1.0-dev`, `v1.1.0-beta`

每次构建都应该打上相应的版本标签，便于回滚和管理。