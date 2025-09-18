// 测试不吃登记API
const http = require('http');

function testNoEatAPI() {
  console.log('🧪 测试不吃登记API\n');

  const postData = JSON.stringify({
    mealType: 'lunch',
    date: '2025-09-17'
  });

  const options = {
    hostname: 'localhost',
    port: 3000,
    path: '/api/no-eat/register',
    method: 'POST',
    headers: {
      'Cookie': 'connect.sid=test-session',
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(postData)
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
      } catch (e) {
        console.log('📄 原始响应:', data);
        console.log('❌ JSON解析失败:', e.message);
      }
    });
  });

  req.on('error', (e) => {
    console.error('❌ 请求失败:', e.message);
  });

  req.write(postData);
  req.end();
}

testNoEatAPI();