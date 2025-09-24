const axios = require('axios');

(async () => {
  try {
    const res = await axios.get('http://localhost:3000/api/user/meal-history?page=1&limit=10', {
      headers: { Cookie: 'connect.sid=test' }
    });

    if (res.data.success) {
      console.log('前10条记录:');
      res.data.data.history.forEach((r, i) => {
        console.log(`${i+1}. ${r.date} ${r.mealTypeName} - ${r.dishName} (${r.restaurantName})`);
      });
    } else {
      console.log('错误:', res.data.message);
    }
  } catch(e) {
    console.log('请求失败:', e.message);
  }
})();