const fs = require('fs').promises;
const path = require('path');

// 读取JSON文件
async function readJson(filename) {
  try {
    const data = await fs.readFile(path.join(__dirname, 'data', filename), 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.error(`读取 ${filename} 失败:`, error);
    return [];
  }
}

// 写入JSON文件
async function writeJson(filename, data) {
  try {
    await fs.writeFile(
      path.join(__dirname, 'data', filename),
      JSON.stringify(data, null, 2),
      'utf8'
    );
    console.log(`✅ 已更新 ${filename}`);
  } catch (error) {
    console.error(`写入 ${filename} 失败:`, error);
  }
}

// 主修复函数
async function fixNoEatSync() {
  console.log('🔧 开始修复不吃登记同步问题...\n');

  // 读取相关数据文件
  const noEatRegs = await readJson('no-eat-registrations.json');
  const userRegistrations = await readJson('user-registrations.json');
  const users = await readJson('users.json');

  console.log(`📊 数据统计:`);
  console.log(`- 不吃登记记录: ${noEatRegs.length} 条`);
  console.log(`- 用户登记记录: ${userRegistrations.length} 条`);
  console.log(`- 用户信息: ${users.length} 条\n`);

  let addedCount = 0;
  let skippedCount = 0;

  // 遍历所有不吃登记记录
  for (const noEatReg of noEatRegs) {
    const { userId, date, mealType, registeredAt } = noEatReg;

    // 检查是否已在用户登记记录中存在
    const existingReg = userRegistrations.find(reg =>
      reg.userId === userId &&
      reg.date === date &&
      reg.mealType === mealType &&
      reg.dishName === '不吃'
    );

    if (existingReg) {
      skippedCount++;
      continue;
    }

    // 查找用户信息
    const user = users.find(u => u.id === userId);
    const userName = user ? user.name : `用户${userId}`;

    // 创建新的用户登记记录
    const newRegistration = {
      id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
      userId: userId,
      date: date,
      mealType: mealType,
      dishId: null,
      dishName: '不吃',
      restaurantName: '无',
      price: 0,
      createdAt: registeredAt,
      updatedAt: registeredAt,
      note: '历史数据同步 - 通过飞书按钮快速登记'
    };

    userRegistrations.push(newRegistration);
    addedCount++;

    console.log(`✅ 已添加: ${userName} | ${date} | ${mealType === 'lunch' ? '午餐' : '晚餐'}`);
  }

  // 保存更新后的数据
  if (addedCount > 0) {
    await writeJson('user-registrations.json', userRegistrations);
  }

  console.log(`\n🎉 修复完成！`);
  console.log(`- 新增同步记录: ${addedCount} 条`);
  console.log(`- 跳过已存在记录: ${skippedCount} 条`);
  console.log(`- 总处理记录: ${noEatRegs.length} 条\n`);

  if (addedCount > 0) {
    console.log('📋 现在管理员界面应该能正确显示所有不吃登记记录了！');
  } else {
    console.log('ℹ️ 没有需要同步的历史记录。');
  }
}

// 运行修复脚本
if (require.main === module) {
  fixNoEatSync().catch(console.error);
}

module.exports = { fixNoEatSync };