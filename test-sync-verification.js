// 验证飞书不吃登记同步修复
const http = require('http');

async function makeRequest(options, postData = null) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          resolve({
            status: res.statusCode,
            data: JSON.parse(data)
          });
        } catch (e) {
          resolve({
            status: res.statusCode,
            data: data
          });
        }
      });
    });

    req.on('error', reject);

    if (postData) {
      req.write(postData);
    }
    req.end();
  });
}

async function testSyncVerification() {
  console.log('🧪 验证飞书不吃登记同步修复\n');

  const testUser = 'on_14f113d8579bbc6bda6afdbf0a93b6ec';
  const testDate = '2025-09-17';
  const testMeal = 'lunch';

  try {
    console.log('📊 检查用户界面状态API...');

    // 模拟登录状态 - 注意：这里没有真实的session，所以会返回401
    const statusOptions = {
      hostname: 'localhost',
      port: 3001,  // 使用3001端口的服务器
      path: `/api/no-eat/status?mealType=${testMeal}&date=${testDate}`,
      method: 'GET',
      headers: {
        'Cookie': 'connect.sid=test-session'
      }
    };

    const statusResult = await makeRequest(statusOptions);
    console.log('状态API响应:', statusResult);

    if (statusResult.status === 401) {
      console.log('\n⚠️  需要登录认证，无法完全测试API');
      console.log('但是可以确认数据文件已经同步：');

      // 直接检查文件内容
      const fs = require('fs');
      const noEatRegs = JSON.parse(fs.readFileSync('./data/no-eat-registrations.json', 'utf8'));
      const userRegs = JSON.parse(fs.readFileSync('./data/user-registrations.json', 'utf8'));

      console.log('\n📁 文件数据检查:');
      console.log('no-eat-registrations.json 记录数:', noEatRegs.length);
      console.log('user-registrations.json 中的不吃记录:',
        userRegs.filter(reg => reg.dishName === '不吃' && reg.date === testDate).length);

      const targetRecord = noEatRegs.find(reg =>
        reg.userId === testUser &&
        reg.date === testDate &&
        reg.mealType === testMeal
      );

      if (targetRecord) {
        console.log('\n✅ 同步成功！在 no-eat-registrations.json 中找到对应记录:');
        console.log('  - 用户ID:', targetRecord.userId);
        console.log('  - 日期:', targetRecord.date);
        console.log('  - 餐次:', targetRecord.mealType);
        console.log('  - 登记时间:', targetRecord.registeredAt);
        console.log('\n🎉 用户界面现在应该能正确显示"不吃"状态！');
      } else {
        console.log('\n❌ 同步失败：未找到对应记录');
      }
    } else if (statusResult.data.success && statusResult.data.data.registered) {
      console.log('\n✅ 完美！API 返回用户已登记不吃');
    }

  } catch (error) {
    console.error('❌ 测试失败:', error.message);
  }
}

testSyncVerification();