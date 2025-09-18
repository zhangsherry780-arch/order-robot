// 直接测试API - 模拟已登录用户请求
const http = require('http');

function testAPI() {
  console.log('🧪 直接测试点餐历史API\n');

  const options = {
    hostname: 'localhost',
    port: 3001,
    path: '/api/user/meal-history?page=1&limit=5',
    method: 'GET',
    headers: {
      'Cookie': 'connect.sid=test-session',  // 模拟session cookie
      'Content-Type': 'application/json'
    }
  };

  const req = http.request(options, (res) => {
    let data = '';

    res.on('data', (chunk) => {
      data += chunk;
    });

    res.on('end', () => {
      console.log(`📊 响应状态: ${res.statusCode}`);
      console.log('📋 响应内容:');
      try {
        const result = JSON.parse(data);
        console.log(JSON.stringify(result, null, 2));

        if (result.success) {
          console.log('\n✅ API测试成功！');
          if (result.data.history && result.data.history.length > 0) {
            console.log(`📈 找到 ${result.data.history.length} 条记录`);
            console.log(`📊 统计信息: 总共 ${result.data.pagination.total} 条记录`);
          } else {
            console.log('📝 当前用户暂无点餐记录');
          }
        } else {
          console.log(`❌ API错误: ${result.message}`);
        }
      } catch (e) {
        console.log('📄 原始响应:', data);
        console.log('❌ JSON解析失败:', e.message);
      }
    });
  });

  req.on('error', (e) => {
    console.error('❌ 请求失败:', e.message);
  });

  req.end();
}

testAPI();