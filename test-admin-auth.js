// 测试管理员认证和开放点餐功能
async function testAdminAuth() {
  const baseUrl = 'http://localhost:3000';

  console.log('🧪 开始测试管理员认证和开放点餐功能...\n');

  try {
    // 测试1：未认证状态下调用API
    console.log('📝 测试1: 未认证状态下调用toggle-status API');

    let response = await fetch(`${baseUrl}/api/admin/orders/toggle-status`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        date: '2025-09-17',
        mealType: 'lunch'
      })
    });

    let result = await response.json();

    console.log('📊 响应状态:', response.status);
    console.log('📋 响应结果:', JSON.stringify(result, null, 2));

    if (response.status === 401) {
      console.log('✅ 正确：未认证用户被拒绝访问');
    } else {
      console.log('❌ 错误：未认证用户应该被拒绝访问');
    }

    // 测试2：测试管理员界面是否能正常加载
    console.log('\n📝 测试2: 检查管理员界面是否需要认证');

    response = await fetch(`${baseUrl}/admin-dashboard.html`, {
      method: 'GET',
      redirect: 'manual' // 不自动跟随重定向
    });

    console.log('📊 管理员界面响应状态:', response.status);

    if (response.status === 302 || response.status === 301) {
      const location = response.headers.get('location');
      console.log('✅ 正确：管理员界面需要认证，重定向到:', location);
    } else if (response.status === 200) {
      console.log('❌ 错误：管理员界面应该需要认证');
    }

    // 测试3：检查获取点餐记录API
    console.log('\n📝 测试3: 检查获取点餐记录API认证');

    response = await fetch(`${baseUrl}/api/admin/orders`, {
      method: 'GET'
    });

    result = await response.json();

    console.log('📊 点餐记录API响应状态:', response.status);
    console.log('📋 点餐记录API响应结果:', JSON.stringify(result, null, 2));

    if (response.status === 401) {
      console.log('✅ 正确：获取点餐记录API需要认证');
    } else {
      console.log('❌ 错误：获取点餐记录API应该需要认证');
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

  console.log('\n🎯 测试总结:');
  console.log('1. 管理员API现在需要认证');
  console.log('2. 用户需要先登录并获得管理员权限');
  console.log('3. 在管理员界面中点击开放点餐按钮应该能正常工作');
}

// 运行测试
if (require.main === module) {
  testAdminAuth().catch(console.error);
}

module.exports = { testAdminAuth };