// 使用Node.js内置的fetch API（Node.js 18+）

// 测试开放点餐状态切换功能
async function testToggleStatus() {
  const baseUrl = 'http://localhost:3000';

  console.log('🧪 开始测试开放点餐状态切换功能...\n');

  // 测试数据 - 使用今天的日期
  const testDate = '2025-09-17';
  const testMealType = 'lunch';

  try {
    // 测试状态切换API
    console.log(`📝 测试切换状态: ${testDate} ${testMealType}`);

    const response = await fetch(`${baseUrl}/api/admin/orders/toggle-status`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        date: testDate,
        mealType: testMealType
      })
    });

    const result = await response.json();

    console.log('📊 响应状态:', response.status);
    console.log('📋 响应结果:', JSON.stringify(result, null, 2));

    if (result.success) {
      console.log(`✅ 状态切换成功: ${result.message}`);
      console.log(`📍 新状态: ${result.data.status}`);
    } else {
      console.log(`❌ 状态切换失败: ${result.message}`);
    }

    // 再次切换回来测试
    console.log('\n🔄 测试再次切换状态...');

    const response2 = await fetch(`${baseUrl}/api/admin/orders/toggle-status`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        date: testDate,
        mealType: testMealType
      })
    });

    const result2 = await response2.json();

    console.log('📊 第二次响应状态:', response2.status);
    console.log('📋 第二次响应结果:', JSON.stringify(result2, null, 2));

    if (result2.success) {
      console.log(`✅ 第二次状态切换成功: ${result2.message}`);
      console.log(`📍 最终状态: ${result2.data.status}`);
    } else {
      console.log(`❌ 第二次状态切换失败: ${result2.message}`);
    }

  } catch (error) {
    console.error('❌ 测试失败:', error.message);

    // 检查服务器是否运行
    try {
      const healthCheck = await fetch(`${baseUrl}/`);
      console.log('🏥 服务器健康检查:', healthCheck.status);
    } catch (healthError) {
      console.error('💀 服务器似乎没有运行:', healthError.message);
    }
  }
}

// 运行测试
if (require.main === module) {
  testToggleStatus().catch(console.error);
}

module.exports = { testToggleStatus };