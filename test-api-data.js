// 测试管理员订单API返回的数据
async function testApiData() {
  const baseUrl = 'http://localhost:3000';

  console.log('🧪 测试管理员订单API返回的数据...\n');

  try {
    // 首先尝试不带认证调用API，确认需要认证
    console.log('📝 测试API认证状态...');

    const response = await fetch(`${baseUrl}/api/admin/orders`, {
      method: 'GET'
    });

    if (response.status === 401) {
      console.log('✅ API需要认证，这是正确的');

      // 检查具体的返回数据
      const result = await response.json();
      console.log('📋 认证失败响应:', JSON.stringify(result, null, 2));

      console.log('\n💡 要查看完整数据，需要通过认证的浏览器会话访问API');
      console.log('   请在浏览器中登录管理员界面后，在开发者工具的控制台中运行:');
      console.log('   fetch("/api/admin/orders").then(r => r.json()).then(console.log)');

      return;
    }

    console.log('📊 响应状态:', response.status);
    const result = await response.json();

    if (result.success && result.data) {
      console.log('📋 返回的订单数据（前5条）:');
      result.data.slice(0, 5).forEach((order, index) => {
        console.log(`${index + 1}. ${order.date} ${order.mealTypeText}:`);
        console.log(`   状态: ${order.status} | 状态文本: ${order.statusText}`);
        console.log(`   总人数: ${order.totalPeople} | 不吃: ${order.noEatCount} | 点餐: ${order.orderCount}`);
        console.log();
      });

      // 专门检查2025-09-18的数据
      const sep18Data = result.data.filter(order => order.date === '2025-09-18');
      if (sep18Data.length > 0) {
        console.log('🎯 2025-09-18 的状态:');
        sep18Data.forEach(order => {
          console.log(`   ${order.mealTypeText}: status="${order.status}" statusText="${order.statusText}"`);
        });
      }
    } else {
      console.log('❌ API响应格式异常:', JSON.stringify(result, null, 2));
    }

  } catch (error) {
    console.error('❌ 测试失败:', error.message);
  }
}

// 运行测试
if (require.main === module) {
  testApiData().catch(console.error);
}

module.exports = { testApiData };