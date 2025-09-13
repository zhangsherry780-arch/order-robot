const axios = require('axios');
const moment = require('moment');
const fs = require('fs-extra');

// 设置中文locale
moment.locale('zh-cn');

const WEBHOOK_URL = 'https://open.feishu.cn/open-apis/bot/v2/hook/4418e0bf-66ee-48f9-b5e7-b55aaee5c5a3';

// 数据存储工具
const dataStore = {
  async read(fileName) {
    try {
      const filePath = `./data/${fileName}`;
      const data = await fs.readJson(filePath);
      return data;
    } catch (error) {
      return [];
    }
  }
};

// 获取周开始日期的函数
function getWeekStart() {
  const today = moment();
  let weekStart;
  
  if (today.day() === 6) { // 如果今天是周六
    // 从明天(周日)开始的一周
    weekStart = today.clone().add(1, 'day').startOf('week').format('YYYY-MM-DD');
  } else {
    // 周日到周五：显示本周的周日开始
    weekStart = today.clone().startOf('week').format('YYYY-MM-DD');
  }
  
  return weekStart;
}

// 构建次日菜单卡片内容 (从菜单条目数组)
function buildTomorrowMenuCardFromMenus(tomorrow, lunchMenus, dinnerMenus) {
  const dateText = tomorrow.format('M月D日 dddd');
  const lunchDeadline = "次日 11:00";
  const dinnerDeadline = "次日 16:30";
  
  let menuContent = `🍽️ **[订餐提醒] 明日 (${dateText}) 午餐 & 晚餐菜单**\n\n`;
  
  // 午餐菜单
  if (lunchMenus && lunchMenus.length > 0) {
    menuContent += `👨‍🍳 **午餐菜单**（截止时间：${lunchDeadline}）\n`;
    
    // 按餐厅分组
    const lunchByRestaurant = {};
    lunchMenus.forEach(item => {
      if (!lunchByRestaurant[item.restaurantName]) {
        lunchByRestaurant[item.restaurantName] = [];
      }
      lunchByRestaurant[item.restaurantName].push(item.dishName);
    });
    
    Object.keys(lunchByRestaurant).forEach(restaurant => {
      menuContent += `🏪 **餐厅**：${restaurant}\n`;
      menuContent += `🍽️ **菜品**：${lunchByRestaurant[restaurant].join('、')}\n\n`;
    });
  } else {
    menuContent += `👨‍🍳 **午餐菜单**（截止时间：${lunchDeadline}）\n`;
    menuContent += `暂无午餐菜单数据\n\n`;
  }
  
  // 晚餐菜单
  if (dinnerMenus && dinnerMenus.length > 0) {
    menuContent += `👨‍🍳 **晚餐菜单**（截止时间：${dinnerDeadline}）\n`;
    
    // 按餐厅分组
    const dinnerByRestaurant = {};
    dinnerMenus.forEach(item => {
      if (!dinnerByRestaurant[item.restaurantName]) {
        dinnerByRestaurant[item.restaurantName] = [];
      }
      dinnerByRestaurant[item.restaurantName].push(item.dishName);
    });
    
    Object.keys(dinnerByRestaurant).forEach(restaurant => {
      menuContent += `🏪 **餐厅**：${restaurant}\n`;
      menuContent += `🍽️ **菜品**：${dinnerByRestaurant[restaurant].join('、')}\n\n`;
    });
  } else {
    menuContent += `👨‍🍳 **晚餐菜单**（截止时间：${dinnerDeadline}）\n`;
    menuContent += `暂无晚餐菜单数据\n\n`;
  }
  
  // 添加提示信息
  menuContent += `**💡 温馨提示**\n`;
  menuContent += `👉 如果不吃午饭或晚饭，请在截止时间前到订餐系统登记。\n`;
  menuContent += `📱 订餐系统：http://172.16.74.75:3000\n`;
  menuContent += `🕐 请注意截止时间，过时无法修改订餐状态！`;
  
  return menuContent;
}

// 推送次日菜单功能
async function testPushRealTomorrowMenu() {
  try {
    // 获取明天的日期
    const tomorrow = moment().add(1, 'day');
    const tomorrowDate = tomorrow.format('YYYY-MM-DD');
    const tomorrowDateText = tomorrow.format('M月D日 dddd');
    const tomorrowDayOfWeek = tomorrow.day(); // 0=周日, 1=周一, ..., 6=周六
    
    console.log(`准备推送次日菜单: ${tomorrowDate} (${tomorrowDateText}, dayOfWeek: ${tomorrowDayOfWeek})`);
    
    // 获取当前周的菜单数据 (使用现有的 weekly-menus.json 数据结构)
    const weeklyMenus = await dataStore.read('weekly-menus.json');
    console.log(`读取到 ${weeklyMenus.length} 条菜单记录`);
    
    // 获取当前周的开始日期
    const weekStart = getWeekStart();
    console.log(`当前周开始日期: ${weekStart}`);
    
    // 为了测试，使用有数据的周（2025-09-01）进行演示
    const testWeekStart = '2025-09-01';
    const testDayOfWeek = 1; // 周一
    console.log(`\n=== 使用测试数据演示推送功能 ===`);
    console.log(`测试周开始日期: ${testWeekStart}, 测试日期: 周一`);
    
    // 筛选出明天的菜单数据
    const tomorrowLunchMenus = weeklyMenus.filter(menu => 
      menu.weekStart === testWeekStart && 
      menu.dayOfWeek === testDayOfWeek && 
      menu.mealType === 'lunch' &&
      menu.active
    );
    
    const tomorrowDinnerMenus = weeklyMenus.filter(menu => 
      menu.weekStart === testWeekStart && 
      menu.dayOfWeek === testDayOfWeek && 
      menu.mealType === 'dinner' &&
      menu.active
    );
    
    console.log(`测试午餐菜单: ${tomorrowLunchMenus.length} 种`);
    console.log(`测试晚餐菜单: ${tomorrowDinnerMenus.length} 种`);
    
    // 检查是否有菜单数据
    const hasLunch = tomorrowLunchMenus.length > 0;
    const hasDinner = tomorrowDinnerMenus.length > 0;
    
    if (!hasLunch && !hasDinner) {
      console.log(`测试菜单数据为空，跳过推送`);
      return;
    }
    
    // 构建菜单推送消息
    const cardContent = buildTomorrowMenuCardFromMenus(tomorrow, tomorrowLunchMenus, tomorrowDinnerMenus);
    
    console.log('\n推送内容预览:');
    console.log('='.repeat(50));
    console.log(cardContent);
    console.log('='.repeat(50));
    
    const cardMessage = {
      msg_type: "interactive",
      card: {
        elements: [{
          tag: "div",
          text: {
            content: cardContent,
            tag: "lark_md"
          }
        }],
        header: {
          title: {
            content: "🍽️ 订餐提醒",
            tag: "plain_text"
          },
          template: "blue"
        }
      }
    };

    const response = await axios.post(WEBHOOK_URL, cardMessage, {
      headers: {
        'Content-Type': 'application/json; charset=utf-8'
      }
    });
    
    console.log('\n推送结果:', response.data);
    console.log(`次日菜单推送成功: ${tomorrowDate} (午餐:${hasLunch ? tomorrowLunchMenus.length + '种' : '无'}, 晚餐:${hasDinner ? tomorrowDinnerMenus.length + '种' : '无'})`);
  } catch (error) {
    console.error('推送失败:', error.message);
  }
}

// 执行测试
testPushRealTomorrowMenu();