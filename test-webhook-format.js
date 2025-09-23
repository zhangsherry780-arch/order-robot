const axios = require('axios');

// 模拟新格式的飞书卡片交互事件（使用真实用户ID和姓名）
const newFormatEvent = {
  event_type: 'card.action.trigger',
  action: {
    value: {
      action: 'no_eat',
      mealType: 'lunch',
      source: 'test'
    }
  },
  operator: {
    union_id: 'on_14f113d8579bbc6bda6afdbf0a93b6ec',
    name: '张雪岩'  // 使用真实用户名
  }
};

// 模拟旧格式的飞书卡片交互事件
const oldFormatEvent = {
  header: {
    event_type: 'card.action.trigger'
  },
  event: {
    action: {
      value: {
        action: 'no_eat',
        mealType: 'dinner',
        source: 'test'
      }
    },
    operator: {
      union_id: 'on_14f113d8579bbc6bda6afdbf0a93b6ec',
      name: '测试用户'
    }
  }
};

async function testWebhook() {
  const port = 3001; // 使用新的端口

  console.log('🔄 测试新格式事件...');
  try {
    const response1 = await axios.post(`http://127.0.0.1:${port}/api/feishu/webhook`, newFormatEvent, {
      headers: { 'Content-Type': 'application/json' }
    });
    console.log('✅ 新格式测试成功:', response1.data);
  } catch (error) {
    console.error('❌ 新格式测试失败:', error.response?.data || error.message);
  }

  console.log('🔄 测试旧格式事件...');
  try {
    const response2 = await axios.post(`http://127.0.0.1:${port}/api/feishu/webhook`, oldFormatEvent, {
      headers: { 'Content-Type': 'application/json' }
    });
    console.log('✅ 旧格式测试成功:', response2.data);
  } catch (error) {
    console.error('❌ 旧格式测试失败:', error.response?.data || error.message);
  }
}

testWebhook();