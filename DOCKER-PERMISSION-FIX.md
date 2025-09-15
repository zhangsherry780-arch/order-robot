# Docker权限问题修复

## 问题描述

在Docker容器部署中，出现以下错误：
```
写入 users.json 失败: [Error: EACCES: permission denied, open '/app/data/users.json']
```

这导致：
- 用户登记"不吃"后无法保存数据
- 取消登记时显示"未找到登记记录"
- 所有数据文件写入操作失败

## 问题原因

1. **用户ID不匹配**：Windows系统文件传输到Linux后，保持Windows用户ID（197609:197121），而Docker容器内使用`node`用户（1000:1000）
2. **Docker用户权限**：容器内使用`node`用户运行，但挂载的宿主机目录权限不匹配
3. **卷配置冲突**：docker-compose.yml中同时使用了绑定挂载和命名卷

**典型症状**：
```
ls -la data/
-rwxrwxr-x 1 197609 197121 ... no-eat-registrations.json  # Windows用户ID
```
而容器内期望的是：
```
-rw-rw-r-- 1 1000 1000 ... no-eat-registrations.json     # Linux用户ID
```

## 解决方案

### 1. 对于新部署

修改已完成：
- ✅ 修复了`docker-compose.yml`中的卷配置
- ✅ 更新了`Dockerfile`设置正确的权限
- ✅ 改进了`deploy-offline.sh`自动设置权限

### 2. 对于现有部署

#### 快速修复（推荐）
运行修复脚本：
```bash
chmod +x fix-permissions.sh
./fix-permissions.sh
```

#### 手动修复
```bash
# 1. 停止容器
docker-compose down

# 2. 修复文件所有者（关键步骤！）
sudo chown -R 1000:1000 data logs

# 3. 设置目录权限
sudo chmod -R 775 data logs

# 4. 重启容器
docker-compose up -d
```

## 验证修复

1. 查看容器日志确认没有权限错误：
```bash
docker-compose logs --tail 20 order-robot
```

2. 测试功能：
   - 登记"不吃"
   - 取消登记
   - 检查是否成功保存

## 预防措施

- 新部署使用最新的Docker配置文件
- 定期检查data目录权限
- 监控容器日志中的权限错误