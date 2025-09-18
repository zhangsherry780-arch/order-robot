# 飞书不吃登记数据同步修复工具

## 问题背景

在订餐系统中，用户通过飞书点击"不吃"按钮登记后，数据需要同时存储在两个文件中：
- `user-registrations.json` - 管理员界面显示用
- `no-eat-registrations.json` - 用户界面状态检查用

由于各种原因（清理操作、服务重启等），这两个文件可能出现数据不同步的情况，导致：
- 管理员界面显示用户已登记"不吃"
- 用户界面显示"吃饭"状态

## 解决方案

创建了一套完整的数据同步修复工具，包含：

### 1. 手动修复脚本 (`fix-data-sync.js`)

一次性检查和修复数据不同步问题：

```bash
# 执行数据同步修复
node fix-data-sync.js
```

**功能：**
- 检查两个JSON文件的数据一致性
- 自动将缺失的记录从用户登记同步到不吃登记
- 显示详细的同步报告和统计信息
- 验证修复后的数据完整性

### 2. 自动监控器 (`auto-sync-monitor.js`)

定期自动检查和修复数据同步问题：

```bash
# 启动监控器（每小时检查一次）
node auto-sync-monitor.js start

# 查看监控状态
node auto-sync-monitor.js status

# 执行一次测试检查
node auto-sync-monitor.js test
```

**功能：**
- 每小时自动检查数据同步状态
- 检测到不同步时自动修复
- 详细的运行统计和错误追踪
- 支持优雅退出和状态报告

### 3. 服务器端增强 (server.js)

增强了飞书按钮处理逻辑：

**新增功能：**
- `verifyNoEatDataSync()` - 每次飞书登记后验证数据同步
- 自动检测和修复不同步记录
- 详细的日志记录和错误处理

## 使用指南

### 立即修复当前问题

```bash
# 1. 检查当前数据状态
node fix-data-sync.js

# 2. 查看修复结果
# 脚本会显示修复了多少条记录
```

### 长期自动维护

```bash
# 1. 启动自动监控器
node auto-sync-monitor.js start

# 2. 监控器将在后台运行，每小时检查一次
# 按 Ctrl+C 可以查看统计信息并退出
```

### 服务器集成

自动同步功能已集成到server.js中：
- 每次飞书"不吃"登记后自动验证同步状态
- 检测到不同步时自动修复
- 无需额外操作

## 监控和维护

### 日志文件

所有同步操作都会在控制台输出详细日志：
- ✅ 数据同步正常
- ⚠️ 检测到数据不同步
- 🔧 自动修复完成
- ❌ 修复失败

### 统计信息

监控器提供详细的运行统计：
- 总检查次数
- 总修复次数
- 错误次数
- 成功率和修复率
- 最后检查/修复时间

### 故障排除

如果同步工具无法解决问题：

1. **检查文件权限**
   ```bash
   # 确保脚本有读写data目录的权限
   ls -la data/
   ```

2. **检查JSON文件格式**
   ```bash
   # 验证JSON文件格式是否正确
   node -e "console.log(JSON.parse(require('fs').readFileSync('data/user-registrations.json')))"
   ```

3. **手动数据检查**
   ```bash
   # 检查特定用户的记录
   grep "on_14f113d8579bbc6bda6afdbf0a93b6ec" data/user-registrations.json
   grep "on_14f113d8579bbc6bda6afdbf0a93b6ec" data/no-eat-registrations.json
   ```

## 配置选项

### 修改检查间隔

自动监控器默认每小时检查一次，可以修改：

```javascript
// 在 auto-sync-monitor.js 中修改
this.checkInterval = 30 * 60 * 1000; // 改为30分钟
```

### 自定义同步逻辑

如需自定义同步逻辑，修改 `fix-data-sync.js` 中的 `syncNoEatData` 函数。

## 部署建议

### 生产环境

1. **添加到系统服务**
   ```bash
   # 创建 systemd 服务文件
   sudo nano /etc/systemd/system/meal-sync-monitor.service
   ```

2. **定时任务**
   ```bash
   # 添加到 crontab（每小时执行）
   0 * * * * cd /path/to/project && node fix-data-sync.js >> sync.log 2>&1
   ```

3. **监控告警**
   - 监控脚本执行结果
   - 设置修复次数过多的告警
   - 定期检查日志文件

### 开发环境

1. **手动执行**
   ```bash
   # 每次发现问题时手动执行
   node fix-data-sync.js
   ```

2. **集成到开发流程**
   ```bash
   # 添加到 package.json scripts
   "scripts": {
     "sync-fix": "node fix-data-sync.js",
     "sync-monitor": "node auto-sync-monitor.js start"
   }
   ```

## 更新记录

- **2025-09-17**: 创建初始版本
  - 数据同步修复脚本
  - 自动监控器
  - 服务器端集成
  - 完整的文档和使用指南

## 联系和支持

如果遇到问题或需要改进建议，请：
1. 检查日志输出
2. 运行测试命令验证问题
3. 提供详细的错误信息和环境描述