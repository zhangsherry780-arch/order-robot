#!/usr/bin/env node

/**
 * 数据同步修复脚本
 * 用于检测和修复 user-registrations.json 和 no-eat-registrations.json 之间的数据不同步问题
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = './data';
const USER_REGISTRATIONS_FILE = path.join(DATA_DIR, 'user-registrations.json');
const NO_EAT_REGISTRATIONS_FILE = path.join(DATA_DIR, 'no-eat-registrations.json');

function loadJSONFile(filePath) {
  try {
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, 'utf8');
      return JSON.parse(content);
    }
    return [];
  } catch (error) {
    console.error(`❌ 读取文件失败: ${filePath}`, error.message);
    return [];
  }
}

function saveJSONFile(filePath, data) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
    return true;
  } catch (error) {
    console.error(`❌ 保存文件失败: ${filePath}`, error.message);
    return false;
  }
}

function syncNoEatData() {
  console.log('🔍 开始检查飞书不吃登记数据同步状态...\n');

  // 1. 读取数据文件
  const userRegistrations = loadJSONFile(USER_REGISTRATIONS_FILE);
  const noEatRegistrations = loadJSONFile(NO_EAT_REGISTRATIONS_FILE);

  console.log(`📁 user-registrations.json: ${userRegistrations.length} 条记录`);
  console.log(`📁 no-eat-registrations.json: ${noEatRegistrations.length} 条记录\n`);

  // 2. 提取"不吃"记录
  const noEatFromUserRegs = userRegistrations.filter(reg =>
    reg.dishName === '不吃' && reg.userId
  );

  console.log(`🍽️ 在用户登记中发现 ${noEatFromUserRegs.length} 条"不吃"记录`);

  if (noEatFromUserRegs.length === 0) {
    console.log('✅ 没有需要同步的"不吃"记录');
    return;
  }

  // 3. 检查同步状态
  const missingInNoEatFile = [];
  const noEatMap = new Map();

  // 创建no-eat-registrations的映射用于快速查找
  noEatRegistrations.forEach(reg => {
    const key = `${reg.userId}-${reg.date}-${reg.mealType}`;
    noEatMap.set(key, reg);
  });

  // 检查哪些记录缺失
  noEatFromUserRegs.forEach(userReg => {
    const key = `${userReg.userId}-${userReg.date}-${userReg.mealType}`;
    if (!noEatMap.has(key)) {
      missingInNoEatFile.push({
        userId: userReg.userId,
        date: userReg.date,
        mealType: userReg.mealType,
        registeredAt: userReg.createdAt
      });
    }
  });

  console.log(`🔍 发现 ${missingInNoEatFile.length} 条记录需要同步到 no-eat-registrations.json\n`);

  if (missingInNoEatFile.length === 0) {
    console.log('✅ 数据已同步，无需修复');
    return;
  }

  // 4. 显示需要同步的记录
  console.log('📋 需要同步的记录:');
  missingInNoEatFile.forEach((record, index) => {
    console.log(`  ${index + 1}. 用户: ${record.userId}, 日期: ${record.date}, 餐次: ${record.mealType}`);
  });

  // 5. 执行同步
  console.log('\n🔧 开始同步数据...');
  const updatedNoEatRegs = [...noEatRegistrations, ...missingInNoEatFile];

  if (saveJSONFile(NO_EAT_REGISTRATIONS_FILE, updatedNoEatRegs)) {
    console.log(`✅ 同步完成！已添加 ${missingInNoEatFile.length} 条记录到 no-eat-registrations.json`);
    console.log(`📁 no-eat-registrations.json 现在有 ${updatedNoEatRegs.length} 条记录`);
  } else {
    console.log('❌ 同步失败！请检查文件权限');
  }

  // 6. 生成同步报告
  console.log('\n📊 同步报告:');
  console.log(`• 总"不吃"记录: ${noEatFromUserRegs.length}`);
  console.log(`• 已同步记录: ${noEatRegistrations.length}`);
  console.log(`• 新增同步记录: ${missingInNoEatFile.length}`);
  console.log(`• 同步后总记录: ${updatedNoEatRegs.length}`);
}

function validateDataIntegrity() {
  console.log('\n🔬 验证数据完整性...');

  const userRegistrations = loadJSONFile(USER_REGISTRATIONS_FILE);
  const noEatRegistrations = loadJSONFile(NO_EAT_REGISTRATIONS_FILE);

  const noEatFromUserRegs = userRegistrations.filter(reg =>
    reg.dishName === '不吃' && reg.userId
  );

  const syncedCount = noEatFromUserRegs.filter(userReg => {
    return noEatRegistrations.some(noEatReg =>
      noEatReg.userId === userReg.userId &&
      noEatReg.date === userReg.date &&
      noEatReg.mealType === userReg.mealType
    );
  }).length;

  const syncPercentage = noEatFromUserRegs.length > 0
    ? ((syncedCount / noEatFromUserRegs.length) * 100).toFixed(1)
    : 100;

  console.log(`📈 数据同步率: ${syncPercentage}% (${syncedCount}/${noEatFromUserRegs.length})`);

  if (syncPercentage === '100.0') {
    console.log('✅ 数据完全同步');
  } else {
    console.log('⚠️ 数据未完全同步，建议运行同步修复');
  }
}

// 主函数
function main() {
  console.log('🛠️  飞书不吃登记数据同步修复工具\n');
  console.log('作用: 确保 user-registrations.json 和 no-eat-registrations.json 数据一致');
  console.log('时间:', new Date().toLocaleString('zh-CN'));
  console.log('='.repeat(60));

  try {
    syncNoEatData();
    validateDataIntegrity();

    console.log('\n🎉 修复完成！');
    console.log('\n💡 建议: 将此脚本加入定时任务，每小时运行一次以确保数据同步');

  } catch (error) {
    console.error('\n❌ 修复过程中发生错误:', error.message);
    console.error('请检查文件权限和数据格式');
    process.exit(1);
  }
}

// 如果作为脚本直接运行
if (require.main === module) {
  main();
}

module.exports = { syncNoEatData, validateDataIntegrity };