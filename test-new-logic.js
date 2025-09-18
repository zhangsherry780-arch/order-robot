// 测试新的点餐记录逻辑
const fs = require('fs').promises;

async function testNewMealHistoryLogic() {
  console.log('🧪 测试新的点餐记录逻辑\n');

  try {
    // 读取数据
    const [users, userRegistrations, dailyOrders] = await Promise.all([
      fs.readFile('./data/users.json', 'utf8').then(JSON.parse),
      fs.readFile('./data/user-registrations.json', 'utf8').then(JSON.parse),
      fs.readFile('./data/daily-orders.json', 'utf8').then(JSON.parse)
    ]);

    console.log('📊 数据概览:');
    console.log(`   用户数: ${users.length}`);
    console.log(`   用户登记记录数: ${userRegistrations.length}`);
    console.log(`   菜单记录数: ${dailyOrders.length}`);
    console.log();

    // 测试第一个用户
    const testUser = users[0];
    console.log(`🎯 测试用户: ${testUser.name} (${testUser.id})`);
    console.log(`   注册时间: ${testUser.firstLoginTime}`);

    // 模拟新逻辑
    const userStartDate = new Date(testUser.firstLoginTime || testUser.lastLoginTime);
    userStartDate.setHours(0, 0, 0, 0);
    const today = new Date();
    today.setHours(23, 59, 59, 999);

    console.log(`   开始日期: ${userStartDate.toISOString().split('T')[0]}`);
    console.log(`   结束日期: ${today.toISOString().split('T')[0]}`);
    console.log(`   时间戳比较: ${userStartDate.getTime()} <= ${today.getTime()} = ${userStartDate.getTime() <= today.getTime()}`);

    const completeHistory = [];
    let workDayCount = 0;

    // 从用户注册日期开始，到今天为止的每一天
    for (let date = new Date(userStartDate); date.toISOString().split('T')[0] <= today.toISOString().split('T')[0]; ) {
      const dateStr = date.toISOString().split('T')[0];
      const dayOfWeek = date.getDay();

      console.log(`   日期检查: ${dateStr} (周${dayOfWeek}) 工作日: ${dayOfWeek >= 1 && dayOfWeek <= 5} - 循环条件: ${date.getTime()} <= ${today.getTime()}`);

      // 只处理工作日（周一到周五）
      if (dayOfWeek >= 1 && dayOfWeek <= 5) {
        workDayCount++;

        ['lunch', 'dinner'].forEach(meal => {
          // 检查用户是否有明确的登记记录
          const userRecord = userRegistrations.find(r =>
            r.userId === testUser.id && r.date === dateStr && r.mealType === meal
          );

          // 获取当天的菜单信息
          const dayMenu = dailyOrders.find(order => order.date === dateStr);
          const mealMenu = dayMenu && dayMenu[meal] ? dayMenu[meal] : [];

          let historyRecord = {
            date: dateStr,
            mealType: meal,
            mealTypeName: meal === 'lunch' ? '午餐' : '晚餐'
          };

          if (userRecord) {
            // 用户有明确登记
            if (userRecord.dishName === '不吃') {
              historyRecord.status = 'no_eat';
              historyRecord.dishName = '不吃';
              historyRecord.note = userRecord.note;
            } else {
              historyRecord.status = 'ordered';
              historyRecord.dishName = userRecord.dishName;
              historyRecord.restaurantName = userRecord.restaurantName;
            }
          } else {
            // 用户没有明确登记，默认点餐
            const defaultDish = mealMenu.length > 0 ? mealMenu[0] : null;
            historyRecord.status = 'default';
            historyRecord.dishName = defaultDish ? defaultDish.dishName : '默认套餐';
            historyRecord.restaurantName = defaultDish ? defaultDish.restaurantName : '系统默认';
          }

          completeHistory.push(historyRecord);
        });
      }

      // 增加一天
      date.setDate(date.getDate() + 1);
    }

    console.log();
    console.log('📈 生成结果统计:');
    console.log(`   工作日数: ${workDayCount}`);
    console.log(`   总餐次: ${completeHistory.length}`);

    const stats = {
      totalMeals: completeHistory.length,
      lunchCount: completeHistory.filter(h => h.mealType === 'lunch').length,
      dinnerCount: completeHistory.filter(h => h.mealType === 'dinner').length,
      noEatCount: completeHistory.filter(h => h.status === 'no_eat').length,
      orderedCount: completeHistory.filter(h => h.status === 'ordered').length,
      defaultCount: completeHistory.filter(h => h.status === 'default').length
    };

    console.log(`   午餐次数: ${stats.lunchCount}`);
    console.log(`   晚餐次数: ${stats.dinnerCount}`);
    console.log(`   主动点餐: ${stats.orderedCount}`);
    console.log(`   默认点餐: ${stats.defaultCount}`);
    console.log(`   不吃次数: ${stats.noEatCount}`);

    console.log();
    console.log('📋 最近5条记录:');
    const recentRecords = completeHistory.slice(-5);
    recentRecords.forEach((record, index) => {
      const statusText = {
        'no_eat': '不吃',
        'ordered': '已点餐',
        'default': '默认点餐'
      }[record.status];

      console.log(`   ${index + 1}. ${record.date} ${record.mealTypeName} - ${record.dishName} [${statusText}]`);
      if (record.note) {
        console.log(`      备注: ${record.note}`);
      }
    });

    console.log();
    console.log('✅ 新逻辑测试成功！');
    console.log('💡 核心改进: 现在系统会为每个工作日的每顿餐生成记录，默认为"默认点餐"状态');

  } catch (error) {
    console.error('❌ 测试失败:', error);
  }
}

if (require.main === module) {
  testNewMealHistoryLogic().catch(console.error);
}

module.exports = { testNewMealHistoryLogic };