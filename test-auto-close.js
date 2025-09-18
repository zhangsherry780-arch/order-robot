// 测试自动关闭功能
const fs = require('fs').promises;
const moment = require('moment');

// 模拟orderManager的closeRegistration方法
async function testCloseRegistration(mealType) {
  console.log(`测试关闭 ${mealType} 不吃登记...`);

  const today = '2025-09-17'; // 固定测试日期
  const dailyOrdersPath = './data/daily-orders.json';

  try {
    const data = await fs.readFile(dailyOrdersPath, 'utf8');
    const dailyOrders = JSON.parse(data);

    const orderIndex = dailyOrders.findIndex(order =>
      order.date === today && order.mealType === mealType
    );

    console.log(`查找 ${today} ${mealType} 的记录...`);

    if (orderIndex >= 0) {
      const oldStatus = dailyOrders[orderIndex].status;
      dailyOrders[orderIndex].status = 'closed';
      dailyOrders[orderIndex].updatedAt = moment().toISOString();

      await fs.writeFile(dailyOrdersPath, JSON.stringify(dailyOrders, null, 2));
      console.log(`✅ ${mealType} 状态已从 "${oldStatus}" 更改为 "closed"`);
      console.log(`   更新时间: ${dailyOrders[orderIndex].updatedAt}`);
    } else {
      console.log(`❌ 未找到今日的 ${mealType} 记录，无法关闭`);
    }
  } catch (error) {
    console.error('关闭失败:', error);
  }
}

async function main() {
  console.log('🧪 测试自动关闭功能\n');

  // 首先查看当前状态
  try {
    const data = await fs.readFile('./data/daily-orders.json', 'utf8');
    const dailyOrders = JSON.parse(data);

    const today = '2025-09-17';
    const todayOrders = dailyOrders.filter(order => order.date === today);

    console.log('📋 当前9月17日状态:');
    todayOrders.forEach(order => {
      console.log(`   ${order.mealType}: ${order.status} (最后更新: ${order.updatedAt || '未知'})`);
    });
    console.log();

    // 测试关闭午餐
    await testCloseRegistration('lunch');
  } catch (error) {
    console.error('测试失败:', error);
  }
}

if (require.main === module) {
  main().catch(console.error);
}

module.exports = { testCloseRegistration };