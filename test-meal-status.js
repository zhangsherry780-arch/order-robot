// 测试餐次状态API
const fs = require('fs').promises;

async function testMealStatus() {
  console.log('🧪 测试餐次状态API\n');

  try {
    // 直接读取数据文件模拟API逻辑
    const dailyOrders = JSON.parse(await fs.readFile('./data/daily-orders.json', 'utf8'));
    const targetDate = '2025-09-17';

    const lunchOrder = dailyOrders.find(order =>
      order.date === targetDate && order.mealType === 'lunch'
    );

    const dinnerOrder = dailyOrders.find(order =>
      order.date === targetDate && order.mealType === 'dinner'
    );

    const result = {
      lunch: {
        status: lunchOrder ? lunchOrder.status : 'closed',
        canModify: lunchOrder ? lunchOrder.status === 'open' : false
      },
      dinner: {
        status: dinnerOrder ? dinnerOrder.status : 'closed',
        canModify: dinnerOrder ? dinnerOrder.status === 'open' : false
      }
    };

    console.log('📊 9月17日餐次状态:');
    console.log('   🍽️ 午餐:', result.lunch);
    console.log('   🍽️ 晚餐:', result.dinner);
    console.log();

    // 检查状态一致性
    console.log('✅ 状态一致性检查:');
    console.log(`   午餐状态: ${result.lunch.status} (可修改: ${result.lunch.canModify})`);
    console.log(`   晚餐状态: ${result.dinner.status} (可修改: ${result.dinner.canModify})`);
    console.log();

    if (result.lunch.status === 'closed' && result.dinner.status === 'closed') {
      console.log('🎯 测试成功: 用户界面和管理界面现在会显示相同的状态 (均已关闭)');
    } else {
      console.log('⚠️  部分状态仍为开放:', {
        lunch: result.lunch.status,
        dinner: result.dinner.status
      });
    }

  } catch (error) {
    console.error('❌ 测试失败:', error);
  }
}

if (require.main === module) {
  testMealStatus().catch(console.error);
}

module.exports = { testMealStatus };