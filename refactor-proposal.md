# 数据存储重构方案

## 问题分析

当前系统使用两个文件存储"不吃"登记数据：
- `user-registrations.json` - 所有登记记录
- `no-eat-registrations.json` - 不吃登记记录

这种设计导致：
1. 数据重复
2. 同步问题
3. 维护复杂

## 重构方案

### 方案1：统一使用 user-registrations.json

**优势：**
- 单一数据源，不会有同步问题
- 数据完整性好
- 维护简单

**实现：**

```javascript
// 检查用户不吃状态
async function checkUserNoEatStatus(userId, date, mealType) {
  const userRegistrations = await dataStore.read('user-registrations.json');

  return userRegistrations.find(reg =>
    reg.userId === userId &&
    reg.date === date &&
    reg.mealType === mealType &&
    reg.dishName === '不吃'
  );
}

// 用户界面API修改
app.get('/api/no-eat/status', requireAuth, async (req, res) => {
  const { mealType, date } = req.query;
  const userId = req.session.user.id;

  const noEatRecord = await checkUserNoEatStatus(userId, date, mealType);

  res.json({
    success: true,
    data: {
      registered: !!noEatRecord,
      registeredAt: noEatRecord ? noEatRecord.createdAt : null
    }
  });
});
```

### 方案2：统一使用 no-eat-registrations.json + 普通点餐记录

**优势：**
- 分离不同类型的数据
- 查询性能更好（文件更小）
- 逻辑更清晰

**实现：**

```javascript
// 所有不吃登记都只存在 no-eat-registrations.json
// user-registrations.json 只存储实际的点餐记录

// 飞书按钮处理简化
async function handleFeishuNoEat(userId, date, mealType) {
  const noEatRegs = await dataStore.read('no-eat-registrations.json');

  const newReg = {
    userId,
    date,
    mealType,
    registeredAt: new Date().toISOString()
  };

  noEatRegs.push(newReg);
  await dataStore.write('no-eat-registrations.json', noEatRegs);

  // 不需要同步到其他文件
}
```

### 方案3：使用数据库（推荐长期方案）

**优势：**
- 原子性操作
- 事务支持
- 性能更好
- 扩展性强

```javascript
// 使用 SQLite 或其他轻量级数据库
CREATE TABLE user_registrations (
  id INTEGER PRIMARY KEY,
  user_id TEXT,
  date TEXT,
  meal_type TEXT,
  dish_id INTEGER,
  dish_name TEXT,
  created_at DATETIME,
  UNIQUE(user_id, date, meal_type)
);

// 查询变为
SELECT * FROM user_registrations
WHERE user_id = ? AND date = ? AND meal_type = ?;
```

## 推荐的立即可行方案

**方案1 - 统一使用 user-registrations.json**

这是最简单、最安全的重构方案：

### 步骤1：修改用户状态检查API

```javascript
// 将 /api/no-eat/status 改为查询 user-registrations.json
app.get('/api/no-eat/status', requireAuth, async (req, res) => {
  const { mealType, date } = req.query;
  const userId = req.session.user.id;

  const userRegistrations = await dataStore.read('user-registrations.json');

  const noEatRecord = userRegistrations.find(reg =>
    reg.userId === userId &&
    reg.date === date &&
    reg.mealType === mealType &&
    reg.dishName === '不吃'
  );

  res.json({
    success: true,
    data: {
      registered: !!noEatRecord,
      registeredAt: noEatRecord ? noEatRecord.createdAt : null
    }
  });
});
```

### 步骤2：简化飞书按钮处理

```javascript
// 飞书按钮只需要调用现有的 addNoEatToUserRegistrations
// 不再需要操作 no-eat-registrations.json
async function handleFeishuNoEat(userId, date, mealType, userName) {
  await addNoEatToUserRegistrations(date, mealType, userId, userName,
    new Date().toISOString(), '通过飞书按钮快速登记');

  // 更新统计
  await orderManager.updateOrderCount(mealType, date);
}
```

### 步骤3：删除 no-eat-registrations.json

```javascript
// 在确认新方案工作正常后，可以删除这个文件
// 并清理所有相关的代码
```

## 实施建议

1. **阶段1**：修改API查询逻辑，但保留两个文件
2. **阶段2**：验证新逻辑工作正常
3. **阶段3**：停止写入 no-eat-registrations.json
4. **阶段4**：清理相关代码和文件

这样可以确保平滑过渡，避免数据丢失。