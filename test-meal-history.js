// 测试个人点餐历史API
const fs = require('fs').promises;

async function testMealHistoryAPI() {
  console.log('🧪 测试个人点餐历史功能\n');

  try {
    // 1. 检查用户注册数据
    const userRegistrations = JSON.parse(await fs.readFile('./data/user-registrations.json', 'utf8'));
    console.log('📊 用户注册数据统计:');
    console.log(`   总记录数: ${userRegistrations.length}`);

    // 统计用户ID
    const userIds = [...new Set(userRegistrations.map(r => r.userId))];
    console.log(`   用户数: ${userIds.length}`);

    // 显示前几个用户的记录
    userIds.slice(0, 3).forEach(userId => {
      if (!userId) return; // 跳过空的userId

      const userRecords = userRegistrations.filter(r => r.userId === userId);
      const lunchCount = userRecords.filter(r => r.mealType === 'lunch').length;
      const dinnerCount = userRecords.filter(r => r.mealType === 'dinner').length;
      const noEatCount = userRecords.filter(r => r.dishName === '不吃').length;

      const displayUserId = userId.length > 20 ? userId.substring(0, 20) + '...' : userId;
      console.log(`   用户 ${displayUserId}:`);
      console.log(`     总记录: ${userRecords.length} (午餐: ${lunchCount}, 晚餐: ${dinnerCount}, 不吃: ${noEatCount})`);
    });

    console.log();

    // 2. 模拟API逻辑测试
    if (userIds.length > 0) {
      const testUserId = userIds[0];
      const displayTestUserId = testUserId.length > 20 ? testUserId.substring(0, 20) + '...' : testUserId;
      console.log(`🎯 测试用户 ${displayTestUserId} 的点餐历史:`);

      // 过滤用户记录
      let userHistory = userRegistrations.filter(record => record.userId === testUserId);

      // 按日期倒序排序
      userHistory.sort((a, b) => {
        const dateA = new Date(a.date);
        const dateB = new Date(b.date);
        if (dateA.getTime() === dateB.getTime()) {
          if (a.mealType === 'dinner' && b.mealType === 'lunch') return -1;
          if (a.mealType === 'lunch' && b.mealType === 'dinner') return 1;
          return 0;
        }
        return dateB.getTime() - dateA.getTime();
      });

      // 模拟分页
      const pageSize = 5;
      const paginatedHistory = userHistory.slice(0, pageSize);

      console.log(`   最近 ${pageSize} 条记录:`);
      paginatedHistory.forEach((record, index) => {
        const mealTypeName = record.mealType === 'lunch' ? '午餐' : '晚餐';
        const isNoEat = record.dishName === '不吃';
        const status = isNoEat ? '不吃' : '已点餐';

        console.log(`   ${index + 1}. ${record.date} ${mealTypeName} - ${record.dishName} (${record.restaurantName}) [${status}]`);
        if (record.note) {
          console.log(`      备注: ${record.note}`);
        }
      });

      // 计算统计信息
      const stats = {
        totalMeals: userHistory.length,
        lunchCount: userHistory.filter(h => h.mealType === 'lunch').length,
        dinnerCount: userHistory.filter(h => h.mealType === 'dinner').length,
        noEatCount: userHistory.filter(h => h.dishName === '不吃').length
      };

      console.log();
      console.log('📈 用户统计信息:');
      console.log(`   总点餐次数: ${stats.totalMeals}`);
      console.log(`   午餐次数: ${stats.lunchCount}`);
      console.log(`   晚餐次数: ${stats.dinnerCount}`);
      console.log(`   不吃次数: ${stats.noEatCount}`);

      console.log();
      console.log('✅ API逻辑测试成功！');

    } else {
      console.log('⚠️  没有找到用户数据');
    }

  } catch (error) {
    console.error('❌ 测试失败:', error);
  }
}

if (require.main === module) {
  testMealHistoryAPI().catch(console.error);
}

module.exports = { testMealHistoryAPI };