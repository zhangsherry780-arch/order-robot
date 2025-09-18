// 模拟飞书按钮点击"不吃"测试
const moment = require('moment');

async function testFeishuNoEatRegistration() {
  console.log('🧪 测试飞书不吃登记功能\n');

  const testData = {
    userId: 'on_14f113d8579bbc6bda6afdbf0a93b6ec', // 使用现有用户ID
    mealType: 'lunch',
    date: '2025-09-17'
  };

  console.log('测试数据:', testData);

  try {
    // 1. 首先检查当前状态
    const statusResponse = await fetch(`http://localhost:3001/api/no-eat/status?mealType=${testData.mealType}&date=${testData.date}`, {
      headers: {
        'Cookie': 'connect.sid=test-session' // 模拟登录会话
      }
    });

    console.log('\n📊 登记前状态检查:');
    console.log('状态码:', statusResponse.status);

    if (statusResponse.status === 200) {
      const statusResult = await statusResponse.json();
      console.log('当前状态:', statusResult);
    } else {
      console.log('状态检查失败 - 可能需要登录');
    }

    // 2. 模拟直接调用不吃登记API (模拟通过网页登记)
    console.log('\n🔧 模拟网页不吃登记:');
    const registrationResponse = await fetch('http://localhost:3001/api/no-eat/register', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': 'connect.sid=test-session'
      },
      body: JSON.stringify({
        mealType: testData.mealType,
        date: testData.date
      })
    });

    console.log('登记响应状态:', registrationResponse.status);
    const registrationResult = await registrationResponse.json();
    console.log('登记结果:', registrationResult);

    // 3. 再次检查状态
    console.log('\n📊 登记后状态检查:');
    const statusResponse2 = await fetch(`http://localhost:3001/api/no-eat/status?mealType=${testData.mealType}&date=${testData.date}`, {
      headers: {
        'Cookie': 'connect.sid=test-session'
      }
    });

    if (statusResponse2.status === 200) {
      const statusResult2 = await statusResponse2.json();
      console.log('登记后状态:', statusResult2);

      if (statusResult2.success && statusResult2.data.registered) {
        console.log('\n✅ 测试成功：不吃登记已正确同步到用户界面！');
      } else {
        console.log('\n❌ 测试失败：登记未同步到用户界面');
      }
    } else {
      console.log('状态检查失败');
    }

  } catch (error) {
    console.error('❌ 测试失败:', error.message);
  }
}

testFeishuNoEatRegistration();