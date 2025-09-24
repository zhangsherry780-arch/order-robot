const moment = require('moment');
const fs = require('fs').promises;
const path = require('path');

async function createFutureOrders() {
  const filePath = path.join(__dirname, 'data', 'daily-orders.json');
  const dailyOrders = JSON.parse(await fs.readFile(filePath, 'utf8'));

  const today = moment();
  let createdCount = 0;
  const created = [];
  const existingKeys = new Set(dailyOrders.map(o => `${o.date}-${o.mealType}`));

  // 创建未来30天的记录
  for (let i = 1; i <= 30; i++) {
    const futureDate = today.clone().add(i, 'days');
    const dayOfWeek = futureDate.day();

    // 只为工作日创建(周日到周五)
    if (dayOfWeek >= 0 && dayOfWeek <= 5) {
      const dateStr = futureDate.format('YYYY-MM-DD');

      // 检查午餐和晚餐记录是否存在
      ['lunch', 'dinner'].forEach(mealType => {
        const key = `${dateStr}-${mealType}`;
        if (!existingKeys.has(key)) {
          const newRecord = {
            id: Date.now() + Math.random(),
            date: dateStr,
            mealType: mealType,
            totalPeople: 25,
            noEatCount: 0,
            orderCount: 25,
            status: 'open',
            createdAt: new Date().toISOString()
          };
          dailyOrders.push(newRecord);
          createdCount++;
          created.push(`${dateStr} ${mealType}`);
        }
      });
    }
  }

  // 保存回文件
  await fs.writeFile(filePath, JSON.stringify(dailyOrders, null, 2));

  console.log(`✅ 成功创建 ${createdCount} 条点餐记录`);
  console.log('创建的记录:', created);
}

createFutureOrders().then(() => {
  console.log('完成!');
  process.exit(0);
}).catch(err => {
  console.error('错误:', err);
  process.exit(1);
});