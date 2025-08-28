const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs-extra');
const cron = require('node-cron');
const moment = require('moment');
const xlsx = require('xlsx');
const csv = require('csv-parser');

const app = express();
const PORT = process.env.PORT || 3000;

// 中间件
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// 数据存储工具类
class DataStore {
  constructor() {
    this.dataDir = path.join(__dirname, 'data');
    this.ensureDataDir();
    this.initializeData();
  }

  async ensureDataDir() {
    await fs.ensureDir(this.dataDir);
  }

  async initializeData() {
    const defaultData = {
      'employees.json': [],
      'dishes.json': [],
      'restaurants.json': [],
      'weekly-menus.json': [],
      'daily-orders.json': [],
      'no-eat-registrations.json': [],
      'ratings.json': [],
      'settings.json': {
        totalEmployees: 50,
        lunchOpenTime: '10:00',
        dinnerOpenTime: '16:00',
        menuGenerateTime: '09:00',
        currentWeekStart: null
      }
    };

    for (const [filename, data] of Object.entries(defaultData)) {
      const filepath = path.join(this.dataDir, filename);
      if (!(await fs.pathExists(filepath))) {
        await fs.writeJson(filepath, data, { spaces: 2 });
      }
    }
  }

  async read(filename) {
    try {
      const filepath = path.join(this.dataDir, filename);
      return await fs.readJson(filepath);
    } catch (error) {
      console.error(`读取 ${filename} 失败:`, error);
      return null;
    }
  }

  async write(filename, data) {
    try {
      const filepath = path.join(this.dataDir, filename);
      await fs.writeJson(filepath, data, { spaces: 2 });
      return true;
    } catch (error) {
      console.error(`写入 ${filename} 失败:`, error);
      return false;
    }
  }

  // 生成唯一ID
  generateId(existingData) {
    if (!Array.isArray(existingData) || existingData.length === 0) return 1;
    return Math.max(...existingData.map(item => item.id || 0)) + 1;
  }

  // 获取今日日期字符串
  getTodayString() {
    return moment().format('YYYY-MM-DD');
  }

  // 获取本周开始日期
  getWeekStart() {
    return moment().startOf('week').add(1, 'day').format('YYYY-MM-DD'); // 周一开始
  }
}

const dataStore = new DataStore();

// Excel数据同步工具类
class ExcelSyncManager {
  constructor() {
    this.excelPath = path.join(__dirname, '菜单管理.csv');
  }

  // 读取Excel/CSV文件并解析菜单数据
  async readExcelMenu() {
    try {
      if (!await fs.pathExists(this.excelPath)) {
        console.log('Excel文件不存在:', this.excelPath);
        return null;
      }

      const results = [];
      
      return new Promise((resolve, reject) => {
        fs.createReadStream(this.excelPath, { encoding: 'utf8' })
          .pipe(csv({ separator: ',', skipEmptyLines: true }))
          .on('data', (data) => {
            // 转换CSV数据为系统格式
            if (data['星期'] && data['餐次'] && data['菜品名称']) {
              results.push({
                dayOfWeek: parseInt(data['星期']),
                mealType: data['餐次'] === 'lunch' ? 'lunch' : 'dinner',
                restaurantName: data['饭店名称'] || '未知餐厅',
                dishName: data['菜品名称'],
                description: data['菜品描述'] || '',
                price: parseFloat(data['价格']) || 0,
                category: data['类别'] || '其他',
                imageUrl: data['图片文件名'] ? `/images/dishes/${data['图片文件名']}` : '/images/default-dish.jpg',
                rating: parseFloat(data['评分']) || 0
              });
            }
          })
          .on('end', () => {
            console.log(`从Excel读取了 ${results.length} 条菜单记录`);
            resolve(results);
          })
          .on('error', (error) => {
            console.error('读取Excel失败:', error);
            reject(error);
          });
      });
    } catch (error) {
      console.error('Excel同步失败:', error);
      return null;
    }
  }

  // 将Excel数据同步到系统
  async syncToSystem() {
    try {
      const excelData = await this.readExcelMenu();
      if (!excelData || excelData.length === 0) {
        return { success: false, message: 'Excel文件为空或读取失败' };
      }

      // 更新餐厅数据
      const restaurants = await this.updateRestaurants(excelData);
      
      // 更新菜品数据
      const dishes = await this.updateDishes(excelData, restaurants);
      
      // 更新周菜单数据
      const weekMenus = await this.updateWeekMenus(excelData, dishes);

      return { 
        success: true, 
        message: `成功同步 ${excelData.length} 条菜单记录`,
        summary: {
          restaurants: restaurants.length,
          dishes: dishes.length,
          weekMenus: weekMenus.length
        }
      };
    } catch (error) {
      console.error('同步到系统失败:', error);
      return { success: false, message: '同步失败: ' + error.message };
    }
  }

  // 更新餐厅数据
  async updateRestaurants(excelData) {
    const existingRestaurants = await dataStore.read('restaurants.json');
    const restaurantNames = [...new Set(excelData.map(item => item.restaurantName))];
    
    restaurantNames.forEach(name => {
      if (!existingRestaurants.find(r => r.name === name)) {
        existingRestaurants.push({
          id: dataStore.generateId(existingRestaurants),
          name: name,
          description: `${name}餐厅`,
          phone: '待填写',
          active: true
        });
      }
    });

    await dataStore.write('restaurants.json', existingRestaurants);
    return existingRestaurants;
  }

  // 更新菜品数据
  async updateDishes(excelData, restaurants) {
    const dishes = [];
    
    excelData.forEach(item => {
      const restaurant = restaurants.find(r => r.name === item.restaurantName);
      if (restaurant) {
        dishes.push({
          id: dataStore.generateId(dishes),
          name: item.dishName,
          description: item.description,
          category: item.category,
          price: item.price,
          restaurantId: restaurant.id,
          imageUrl: item.imageUrl,
          rating: item.rating,
          active: true
        });
      }
    });

    await dataStore.write('dishes.json', dishes);
    return dishes;
  }

  // 更新周菜单数据
  async updateWeekMenus(excelData, dishes) {
    const weekMenus = [];
    const currentWeekStart = dataStore.getWeekStart();

    excelData.forEach(item => {
      const dish = dishes.find(d => d.name === item.dishName);
      if (dish) {
        weekMenus.push({
          id: dataStore.generateId(weekMenus),
          weekStart: currentWeekStart,
          dayOfWeek: item.dayOfWeek,
          mealType: item.mealType,
          dishId: dish.id,
          dishName: dish.name,
          restaurantName: item.restaurantName,
          imageUrl: dish.imageUrl,
          rating: dish.rating,
          active: true
        });
      }
    });

    await dataStore.write('weekly-menus.json', weekMenus);
    return weekMenus;
  }
}

const excelSyncManager = new ExcelSyncManager();

// 更新菜品平均评分
async function updateDishAverageRating(dishId) {
  try {
    const ratings = await dataStore.read('ratings.json');
    const dishes = await dataStore.read('dishes.json');
    const weeklyMenus = await dataStore.read('weekly-menus.json');
    
    // 计算该菜品的平均评分
    const dishRatings = ratings.filter(r => r.dishId === parseInt(dishId));
    let averageRating = 0;
    
    if (dishRatings.length > 0) {
      const totalRating = dishRatings.reduce((sum, r) => sum + r.rating, 0);
      averageRating = Math.round((totalRating / dishRatings.length) * 10) / 10; // 保留1位小数
    }
    
    // 更新dishes.json中的评分
    const dish = dishes.find(d => d.id === parseInt(dishId));
    if (dish) {
      dish.rating = averageRating;
      await dataStore.write('dishes.json', dishes);
    }
    
    // 更新weekly-menus.json中的评分
    const menusToUpdate = weeklyMenus.filter(m => m.dishId === parseInt(dishId));
    menusToUpdate.forEach(menu => {
      menu.rating = averageRating;
    });
    if (menusToUpdate.length > 0) {
      await dataStore.write('weekly-menus.json', weeklyMenus);
    }
    
    console.log(`更新菜品 ${dishId} 的平均评分为: ${averageRating}`);
  } catch (error) {
    console.error('更新菜品评分失败:', error);
  }
}

// 菜单生成逻辑
class MenuGenerator {
  constructor() {
    this.mealTypes = ['lunch', 'dinner'];
    this.weekDays = [1, 2, 3, 4, 5, 0]; // 周一到周五 + 周日（0表示周日）
  }

  // 基于评分生成智能菜单
  async generateWeeklyMenu() {
    console.log('开始生成本周菜单...');
    
    const dishes = await dataStore.read('dishes.json');
    const restaurants = await dataStore.read('restaurants.json');
    const ratings = await dataStore.read('ratings.json');
    const weekStart = dataStore.getWeekStart();
    
    if (!dishes || dishes.length === 0) {
      console.log('暂无菜品数据，无法生成菜单');
      return false;
    }

    if (!restaurants || restaurants.length === 0) {
      console.log('暂无饭店数据，无法生成菜单');
      return false;
    }

    // 计算菜品平均评分
    const dishRatings = this.calculateDishRatings(dishes, ratings);
    
    // 生成菜单
    const weeklyMenu = [];
    const usedDishes = new Set(); // 防止同周重复

    for (const day of this.weekDays) {
      // 获取当天可用的饭店
      const availableRestaurants = restaurants.filter(r => 
        r.active && r.availableDays.includes(day)
      );
      
      if (availableRestaurants.length === 0) {
        console.log(`周${day}没有可用饭店，跳过`);
        continue;
      }

      // 随机选择一个饭店
      const selectedRestaurant = availableRestaurants[
        Math.floor(Math.random() * availableRestaurants.length)
      ];

      // 获取该饭店的菜品
      const restaurantDishes = dishRatings.filter(dish => 
        dish.restaurantId === selectedRestaurant.id && dish.active
      );

      if (restaurantDishes.length === 0) {
        console.log(`饭店${selectedRestaurant.name}没有可用菜品，跳过`);
        continue;
      }

      for (const mealType of this.mealTypes) {
        const selectedDishes = this.selectDishesForMeal(restaurantDishes, usedDishes, 4);
        
        selectedDishes.forEach(dish => {
          weeklyMenu.push({
            id: weeklyMenu.length + 1,
            weekStart,
            dayOfWeek: day,
            mealType,
            dishId: dish.id,
            dishName: dish.name,
            restaurantId: selectedRestaurant.id,
            restaurantName: selectedRestaurant.name,
            rating: dish.avgRating,
            generatedAt: moment().toISOString()
          });
        });
      }
    }

    // 保存菜单
    await dataStore.write('weekly-menus.json', weeklyMenu);
    
    // 更新设置中的当前周
    const settings = await dataStore.read('settings.json');
    settings.currentWeekStart = weekStart;
    await dataStore.write('settings.json', settings);
    
    console.log(`本周菜单生成完成，共 ${weeklyMenu.length} 个菜品`);
    return true;
  }

  // 计算菜品评分
  calculateDishRatings(dishes, ratings) {
    return dishes.map(dish => {
      const dishRatings = ratings.filter(r => r.dishId === dish.id);
      const avgRating = dishRatings.length > 0 
        ? dishRatings.reduce((sum, r) => sum + r.rating, 0) / dishRatings.length
        : 3.0; // 默认3分
      
      return {
        ...dish,
        avgRating,
        ratingCount: dishRatings.length
      };
    });
  }

  // 为单餐选择菜品
  selectDishesForMeal(dishRatings, usedDishes, count = 4) {
    const availableDishes = dishRatings.filter(dish => !usedDishes.has(dish.id));
    
    if (availableDishes.length < count) {
      // 如果可用菜品不足，清空已使用记录
      usedDishes.clear();
      return this.selectDishesForMeal(dishRatings, usedDishes, count);
    }

    // 按评分排序，但加入随机性
    const sortedDishes = availableDishes.sort((a, b) => {
      const scoreDiff = b.avgRating - a.avgRating;
      const randomFactor = (Math.random() - 0.5) * 0.5; // ±0.25的随机因子
      return scoreDiff + randomFactor;
    });

    const selectedDishes = sortedDishes.slice(0, count);
    selectedDishes.forEach(dish => usedDishes.add(dish.id));
    
    return selectedDishes;
  }
}

const menuGenerator = new MenuGenerator();

// 订餐统计管理
class OrderManager {
  // 获取今日订餐状态
  async getTodayOrderStatus(mealType) {
    const today = dataStore.getTodayString();
    const dailyOrders = await dataStore.read('daily-orders.json');
    const settings = await dataStore.read('settings.json');
    
    let todayOrder = dailyOrders.find(order => 
      order.date === today && order.mealType === mealType
    );

    if (!todayOrder) {
      // 初始状态：人数为0，等待管理员设置
      todayOrder = {
        id: dataStore.generateId(dailyOrders),
        date: today,
        mealType,
        totalPeople: 0,
        noEatCount: 0,
        orderCount: 0,
        status: 'closed',
        createdAt: moment().toISOString()
      };
      
      dailyOrders.push(todayOrder);
      await dataStore.write('daily-orders.json', dailyOrders);
    }

    return todayOrder;
  }

  // 开放订餐登记
  async openRegistration(mealType) {
    console.log(`开放 ${mealType} 不吃登记...`);
    
    const today = dataStore.getTodayString();
    const dailyOrders = await dataStore.read('daily-orders.json');
    const settings = await dataStore.read('settings.json');

    const orderIndex = dailyOrders.findIndex(order => 
      order.date === today && order.mealType === mealType
    );

    if (orderIndex >= 0) {
      dailyOrders[orderIndex].status = 'open';
    } else {
      dailyOrders.push({
        id: dataStore.generateId(dailyOrders),
        date: today,
        mealType,
        totalPeople: settings.totalEmployees,
        noEatCount: 0,
        orderCount: settings.totalEmployees,
        status: 'open',
        createdAt: moment().toISOString()
      });
    }

    await dataStore.write('daily-orders.json', dailyOrders);
    console.log(`${mealType} 登记已开放`);
  }

  // 更新订餐统计
  async updateOrderCount(mealType) {
    const today = dataStore.getTodayString();
    const dailyOrders = await dataStore.read('daily-orders.json');
    const noEatRegs = await dataStore.read('no-eat-registrations.json');
    
    const todayNoEat = noEatRegs.filter(reg => {
      // 统一日期格式进行比较
      const regDate = reg.date ? reg.date.replace(/\//g, '-') : '';
      const todayFormatted = today.replace(/\//g, '-');
      return regDate === todayFormatted && reg.mealType === mealType;
    }).length;

    const orderIndex = dailyOrders.findIndex(order => 
      order.date === today && order.mealType === mealType
    );

    if (orderIndex >= 0) {
      const order = dailyOrders[orderIndex];
      order.noEatCount = todayNoEat;
      // 使用 totalPeople 作为基数计算订餐数，确保不会出现负数
      order.orderCount = Math.max(0, (order.totalPeople || 0) - todayNoEat);
      
      await dataStore.write('daily-orders.json', dailyOrders);
    } else {
      // 如果没有找到订餐记录，创建一个新的
      const settings = await dataStore.read('settings.json');
      const defaultPeople = settings.totalEmployees || 50;
      
      dailyOrders.push({
        id: dataStore.generateId(dailyOrders),
        date: today,
        mealType,
        totalPeople: defaultPeople,
        noEatCount: todayNoEat,
        orderCount: Math.max(0, defaultPeople - todayNoEat),
        status: 'open',
        createdAt: moment().toISOString()
      });
      
      await dataStore.write('daily-orders.json', dailyOrders);
    }
    
    console.log(`更新${mealType}统计: 不吃人数=${todayNoEat}`);
  }
}

const orderManager = new OrderManager();

// API路由

// 获取今日菜单
app.get('/api/menu/today', async (req, res) => {
  try {
    const weeklyMenus = await dataStore.read('weekly-menus.json');
    const today = moment();
    const dayOfWeek = today.day(); // 周日为0，周一为1...周六为6
    const weekStart = dataStore.getWeekStart();
    
    if (dayOfWeek === 6) { // 只有周六返回空菜单
      return res.json({ success: true, data: { lunch: [], dinner: [] } });
    }

    const todayMenus = weeklyMenus.filter(menu => 
      menu.weekStart === weekStart && menu.dayOfWeek === dayOfWeek
    );

    const lunch = todayMenus.filter(menu => menu.mealType === 'lunch');
    const dinner = todayMenus.filter(menu => menu.mealType === 'dinner');

    res.json({
      success: true,
      data: { lunch, dinner, date: dataStore.getTodayString() }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// 获取本周菜单
app.get('/api/menu/week', async (req, res) => {
  try {
    const weeklyMenus = await dataStore.read('weekly-menus.json');
    const weekStart = dataStore.getWeekStart();
    
    const thisWeekMenus = weeklyMenus.filter(menu => menu.weekStart === weekStart);
    
    // 按天和餐次组织数据（周日=0, 周一=1...周五=5）
    const organizedMenus = {};
    const workDays = [0, 1, 2, 3, 4, 5]; // 周日到周五
    
    workDays.forEach(day => {
      organizedMenus[day] = {
        lunch: thisWeekMenus.filter(m => m.dayOfWeek === day && m.mealType === 'lunch'),
        dinner: thisWeekMenus.filter(m => m.dayOfWeek === day && m.mealType === 'dinner')
      };
    });

    res.json({
      success: true,
      data: organizedMenus,
      weekStart
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// 设置当前人数
app.post('/api/current-people/set', async (req, res) => {
  try {
    const { currentPeople } = req.body;
    
    if (currentPeople === undefined) {
      return res.status(400).json({ success: false, message: '缺少必要参数' });
    }

    if (currentPeople < 0) {
      return res.status(400).json({ success: false, message: '当前人数不能小于0' });
    }

    const dailyOrders = await dataStore.read('daily-orders.json');
    const today = dataStore.getTodayString();
    const settings = await dataStore.read('settings.json');
    
    // 同时设置午餐和晚餐的人数
    const mealTypes = ['lunch', 'dinner'];
    const noEatRegs = await dataStore.read('no-eat-registrations.json');
    
    for (const mealType of mealTypes) {
      // 计算当天该餐次的不吃人数
      const todayNoEat = noEatRegs.filter(reg => 
        reg.date === today && reg.mealType === mealType
      ).length;
      
      const orderIndex = dailyOrders.findIndex(order => 
        order.date === today && order.mealType === mealType
      );

      if (orderIndex >= 0) {
        // 更新现有记录
        dailyOrders[orderIndex].totalPeople = currentPeople;
        dailyOrders[orderIndex].noEatCount = todayNoEat;
        dailyOrders[orderIndex].orderCount = Math.max(0, currentPeople - todayNoEat);
      } else {
        // 创建新记录
        dailyOrders.push({
          id: dataStore.generateId(dailyOrders),
          date: today,
          mealType,
          totalPeople: currentPeople,
          noEatCount: todayNoEat,
          orderCount: Math.max(0, currentPeople - todayNoEat),
          status: 'open',
          createdAt: moment().toISOString()
        });
      }
    }

    await dataStore.write('daily-orders.json', dailyOrders);
    res.json({ success: true, message: '设置成功' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// 获取当前人数设置
app.get('/api/current-people/today', async (req, res) => {
  try {
    const dailyOrders = await dataStore.read('daily-orders.json');
    const today = dataStore.getTodayString();
    
    const lunchOrder = dailyOrders.find(order => 
      order.date === today && order.mealType === 'lunch'
    );

    const totalPeople = lunchOrder ? lunchOrder.totalPeople : 0;

    res.json({
      success: true,
      data: {
        total: totalPeople,
        date: today
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// 获取今日订餐统计
app.get('/api/order/stats/today', async (req, res) => {
  try {
    const lunchStats = await orderManager.getTodayOrderStatus('lunch');
    const dinnerStats = await orderManager.getTodayOrderStatus('dinner');

    res.json({
      success: true,
      data: {
        lunch: lunchStats,
        dinner: dinnerStats,
        date: dataStore.getTodayString()
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// 管理员API - 饭店管理
app.get('/api/admin/restaurants', async (req, res) => {
  try {
    const restaurants = await dataStore.read('restaurants.json');
    res.json({ success: true, data: restaurants || [] });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

app.post('/api/admin/restaurants', async (req, res) => {
  try {
    const { name, description, phone, address, availableDays } = req.body;
    
    if (!name) {
      return res.status(400).json({ success: false, message: '饭店名称不能为空' });
    }

    const restaurants = await dataStore.read('restaurants.json');
    const newRestaurant = {
      id: dataStore.generateId(restaurants),
      name,
      description: description || '',
      phone: phone || '',
      address: address || '',
      availableDays: availableDays || [1, 2, 3, 4, 5], // 默认周一到周五
      active: true,
      createdAt: moment().toISOString()
    };

    restaurants.push(newRestaurant);
    await dataStore.write('restaurants.json', restaurants);
    
    res.json({ success: true, data: newRestaurant });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

app.put('/api/admin/restaurants/:id', async (req, res) => {
  try {
    const restaurantId = parseInt(req.params.id);
    const { name, description, phone, address, availableDays, active } = req.body;
    
    const restaurants = await dataStore.read('restaurants.json');
    const restaurantIndex = restaurants.findIndex(r => r.id === restaurantId);
    
    if (restaurantIndex === -1) {
      return res.status(404).json({ success: false, message: '饭店不存在' });
    }

    restaurants[restaurantIndex] = {
      ...restaurants[restaurantIndex],
      name: name || restaurants[restaurantIndex].name,
      description: description !== undefined ? description : restaurants[restaurantIndex].description,
      phone: phone !== undefined ? phone : restaurants[restaurantIndex].phone,
      address: address !== undefined ? address : restaurants[restaurantIndex].address,
      availableDays: availableDays || restaurants[restaurantIndex].availableDays,
      active: active !== undefined ? active : restaurants[restaurantIndex].active,
      updatedAt: moment().toISOString()
    };

    await dataStore.write('restaurants.json', restaurants);
    res.json({ success: true, data: restaurants[restaurantIndex] });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

app.delete('/api/admin/restaurants/:id', async (req, res) => {
  try {
    const restaurantId = parseInt(req.params.id);
    
    const restaurants = await dataStore.read('restaurants.json');
    const restaurantIndex = restaurants.findIndex(r => r.id === restaurantId);
    
    if (restaurantIndex === -1) {
      return res.status(404).json({ success: false, message: '饭店不存在' });
    }

    restaurants.splice(restaurantIndex, 1);
    await dataStore.write('restaurants.json', restaurants);
    
    res.json({ success: true, message: '删除成功' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// 提交菜品评价
app.post('/api/rating/submit', async (req, res) => {
  try {
    const { employeeName, dishId, rating, comment, mealType } = req.body;
    
    if (!employeeName || !dishId || !rating || !mealType) {
      return res.status(400).json({ success: false, message: '缺少必要参数' });
    }

    if (rating < 1 || rating > 5) {
      return res.status(400).json({ success: false, message: '评分必须在1-5之间' });
    }

    const ratings = await dataStore.read('ratings.json');
    const today = dataStore.getTodayString();
    
    // 检查今日是否已评价过该菜品
    const existing = ratings.find(r => 
      r.employeeName === employeeName && 
      r.dishId === dishId && 
      r.date === today &&
      r.mealType === mealType
    );

    if (existing) {
      // 更新评价
      existing.rating = rating;
      existing.comment = comment || '';
      existing.updatedAt = moment().toISOString();
    } else {
      // 新增评价
      ratings.push({
        id: dataStore.generateId(ratings),
        employeeName,
        dishId,
        date: today,
        mealType,
        rating,
        comment: comment || '',
        createdAt: moment().toISOString()
      });
    }

    await dataStore.write('ratings.json', ratings);
    
    // 更新菜品和菜单的平均评分
    await updateDishAverageRating(dishId);
    
    res.json({ success: true, message: '评价提交成功' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// 机器人API - 今日菜单
app.get('/api/bot/menu/today', async (req, res) => {
  try {
    const response = await fetch(`http://localhost:${PORT}/api/menu/today`);
    const data = await response.json();
    res.json(data);
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// 机器人API - 今日统计
app.get('/api/bot/stats/today', async (req, res) => {
  try {
    const response = await fetch(`http://localhost:${PORT}/api/order/stats/today`);
    const data = await response.json();
    res.json(data);
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// 管理员API - 统计数据
app.get('/api/admin/stats', async (req, res) => {
  try {
    const employees = await dataStore.read('employees.json');
    const orderStats = await orderManager.getTodayOrderStatus('lunch');
    const dinnerStats = await orderManager.getTodayOrderStatus('dinner');
    const ratings = await dataStore.read('ratings.json');
    const today = dataStore.getTodayString();
    
    const todayRatings = ratings.filter(r => r.date === today).length;
    
    res.json({
      success: true,
      data: {
        totalEmployees: employees.length,
        lunchOrders: orderStats.orderCount,
        dinnerOrders: dinnerStats.orderCount,
        totalRatings: todayRatings
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// 管理员API - 员工管理
app.get('/api/admin/employees', async (req, res) => {
  try {
    const employees = await dataStore.read('employees.json');
    res.json({ success: true, data: employees || [] });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

app.post('/api/admin/employees', async (req, res) => {
  try {
    const { name, department, active = true } = req.body;
    
    if (!name) {
      return res.status(400).json({ success: false, message: '姓名不能为空' });
    }

    const employees = await dataStore.read('employees.json');
    const newEmployee = {
      id: dataStore.generateId(employees),
      name,
      department: department || '',
      active,
      createdAt: moment().toISOString()
    };

    employees.push(newEmployee);
    await dataStore.write('employees.json', employees);
    
    res.json({ success: true, data: newEmployee });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

app.put('/api/admin/employees/:id', async (req, res) => {
  try {
    const employeeId = parseInt(req.params.id);
    const { name, department, active } = req.body;
    
    const employees = await dataStore.read('employees.json');
    const employeeIndex = employees.findIndex(e => e.id === employeeId);
    
    if (employeeIndex === -1) {
      return res.status(404).json({ success: false, message: '员工不存在' });
    }

    employees[employeeIndex] = {
      ...employees[employeeIndex],
      name: name || employees[employeeIndex].name,
      department: department !== undefined ? department : employees[employeeIndex].department,
      active: active !== undefined ? active : employees[employeeIndex].active,
      updatedAt: moment().toISOString()
    };

    await dataStore.write('employees.json', employees);
    res.json({ success: true, data: employees[employeeIndex] });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

app.delete('/api/admin/employees/:id', async (req, res) => {
  try {
    const employeeId = parseInt(req.params.id);
    
    const employees = await dataStore.read('employees.json');
    const employeeIndex = employees.findIndex(e => e.id === employeeId);
    
    if (employeeIndex === -1) {
      return res.status(404).json({ success: false, message: '员工不存在' });
    }

    employees.splice(employeeIndex, 1);
    await dataStore.write('employees.json', employees);
    
    res.json({ success: true, message: '删除成功' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// 管理员API - 菜品管理
app.get('/api/admin/dishes', async (req, res) => {
  try {
    const dishes = await dataStore.read('dishes.json');
    res.json({ success: true, data: dishes || [] });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

app.post('/api/admin/dishes', async (req, res) => {
  try {
    const { name, description, category, price, active = true } = req.body;
    
    if (!name) {
      return res.status(400).json({ success: false, message: '菜名不能为空' });
    }

    const dishes = await dataStore.read('dishes.json');
    const newDish = {
      id: dataStore.generateId(dishes),
      name,
      description: description || '',
      category: category || '荤菜',
      price: parseFloat(price) || 0,
      active,
      createdAt: moment().toISOString()
    };

    dishes.push(newDish);
    await dataStore.write('dishes.json', dishes);
    
    res.json({ success: true, data: newDish });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

app.put('/api/admin/dishes/:id', async (req, res) => {
  try {
    const dishId = parseInt(req.params.id);
    const { name, description, category, price, active } = req.body;
    
    const dishes = await dataStore.read('dishes.json');
    const dishIndex = dishes.findIndex(d => d.id === dishId);
    
    if (dishIndex === -1) {
      return res.status(404).json({ success: false, message: '菜品不存在' });
    }

    dishes[dishIndex] = {
      ...dishes[dishIndex],
      name: name || dishes[dishIndex].name,
      description: description !== undefined ? description : dishes[dishIndex].description,
      category: category || dishes[dishIndex].category,
      price: price !== undefined ? parseFloat(price) : dishes[dishIndex].price,
      active: active !== undefined ? active : dishes[dishIndex].active,
      updatedAt: moment().toISOString()
    };

    await dataStore.write('dishes.json', dishes);
    res.json({ success: true, data: dishes[dishIndex] });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

app.delete('/api/admin/dishes/:id', async (req, res) => {
  try {
    const dishId = parseInt(req.params.id);
    
    const dishes = await dataStore.read('dishes.json');
    const dishIndex = dishes.findIndex(d => d.id === dishId);
    
    if (dishIndex === -1) {
      return res.status(404).json({ success: false, message: '菜品不存在' });
    }

    dishes.splice(dishIndex, 1);
    await dataStore.write('dishes.json', dishes);
    
    res.json({ success: true, message: '删除成功' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// 管理员API - 系统设置
app.get('/api/admin/settings', async (req, res) => {
  try {
    const settings = await dataStore.read('settings.json');
    res.json({ success: true, data: settings });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

app.put('/api/admin/settings', async (req, res) => {
  try {
    const settings = await dataStore.read('settings.json');
    const updatedSettings = {
      ...settings,
      ...req.body,
      updatedAt: moment().toISOString()
    };
    
    await dataStore.write('settings.json', updatedSettings);
    res.json({ success: true, data: updatedSettings });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// 管理员API - 手动生成菜单
app.post('/api/admin/menu/generate', async (req, res) => {
  try {
    const result = await menuGenerator.generateWeeklyMenu();
    if (result) {
      res.json({ success: true, message: '菜单生成成功' });
    } else {
      res.json({ success: false, message: '菜单生成失败，请检查是否有可用菜品' });
    }
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// 清零不吃人数API
app.post('/api/no-eat/clear', async (req, res) => {
  try {
    const { mealType } = req.body;
    
    console.log('收到清零不吃人数请求:', { mealType });
    
    if (!mealType) {
      return res.status(400).json({ 
        success: false, 
        message: '缺少必要参数' 
      });
    }

    if (mealType !== 'lunch' && mealType !== 'dinner') {
      return res.status(400).json({ 
        success: false, 
        message: '餐次参数无效' 
      });
    }

    const today = dataStore.getTodayString();
    const noEatRegs = await dataStore.read('no-eat-registrations.json');
    
    console.log('今日日期:', today);
    console.log('清零前记录数:', noEatRegs.length);
    
    // 删除今日指定餐次的所有不吃记录（考虑多种日期格式）
    const filteredRegs = noEatRegs.filter(reg => {
      // 统一日期格式进行比较
      const regDate = reg.date ? reg.date.replace(/\//g, '-') : '';
      const todayFormatted = today.replace(/\//g, '-');
      
      const shouldKeep = !(regDate === todayFormatted && reg.mealType === mealType);
      if (!shouldKeep) {
        console.log('将删除记录:', reg);
      }
      return shouldKeep;
    });
    
    const removedCount = noEatRegs.length - filteredRegs.length;
    
    await dataStore.write('no-eat-registrations.json', filteredRegs);
    
    console.log(`清零${mealType}不吃记录: 删除${removedCount}条记录`);

    // 更新订餐统计
    await orderManager.updateOrderCount(mealType);

    res.json({ 
      success: true, 
      message: `已清零${mealType === 'lunch' ? '午餐' : '晚餐'}不吃人数 (清理了${removedCount}条记录)` 
    });
  } catch (error) {
    console.error('清零不吃人数失败:', error);
    res.status(500).json({ 
      success: false, 
      message: '清零失败，请重试' 
    });
  }
});

// 不吃登记API
app.post('/api/no-eat/register', async (req, res) => {
  try {
    const { mealType, date } = req.body;
    
    console.log('收到不吃登记请求:', { mealType, date });
    
    if (!mealType || !date) {
      return res.status(400).json({ 
        success: false, 
        message: '缺少必要参数' 
      });
    }

    const noEatRegs = await dataStore.read('no-eat-registrations.json');
    
    // 添加新的不吃登记（不需要检查重复，每次点击都增加一个）
    const newReg = {
      id: dataStore.generateId(noEatRegs),
      mealType: mealType,
      date: date,
      registeredAt: moment().toISOString()
    };

    noEatRegs.push(newReg);
    await dataStore.write('no-eat-registrations.json', noEatRegs);
    
    console.log('添加不吃记录:', newReg);

    // 更新订餐统计
    await orderManager.updateOrderCount(mealType);

    res.json({ 
      success: true, 
      message: '登记成功' 
    });
  } catch (error) {
    console.error('不吃登记失败:', error);
    res.status(500).json({ 
      success: false, 
      message: '登记失败，请重试' 
    });
  }
});

// Excel数据同步API
app.post('/api/excel/sync', async (req, res) => {
  try {
    const result = await excelSyncManager.syncToSystem();
    res.json(result);
  } catch (error) {
    console.error('Excel同步API失败:', error);
    res.status(500).json({ 
      success: false, 
      message: '同步失败: ' + error.message 
    });
  }
});

// 检查Excel文件状态API
app.get('/api/excel/status', async (req, res) => {
  try {
    const excelPath = path.join(__dirname, '菜单管理.csv');
    const exists = await fs.pathExists(excelPath);
    
    if (exists) {
      const stats = await fs.stat(excelPath);
      res.json({
        success: true,
        data: {
          exists: true,
          path: excelPath,
          lastModified: stats.mtime,
          size: stats.size
        }
      });
    } else {
      res.json({
        success: true,
        data: {
          exists: false,
          path: excelPath
        }
      });
    }
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      message: error.message 
    });
  }
});

// 管理员API - 数据导出
app.get('/api/admin/export/:type', async (req, res) => {
  try {
    const type = req.params.type;
    let filename, data;
    
    switch (type) {
      case 'employees':
        filename = 'employees.json';
        break;
      case 'dishes':
        filename = 'dishes.json';
        break;
      case 'ratings':
        filename = 'ratings.json';
        break;
      case 'orders':
        filename = 'daily-orders.json';
        break;
      default:
        return res.status(400).json({ success: false, message: '无效的导出类型' });
    }
    
    data = await dataStore.read(filename);
    
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename=${filename}`);
    res.send(JSON.stringify(data, null, 2));
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

app.get('/api/admin/export/all', async (req, res) => {
  try {
    const allData = {
      employees: await dataStore.read('employees.json'),
      dishes: await dataStore.read('dishes.json'),
      weeklyMenus: await dataStore.read('weekly-menus.json'),
      dailyOrders: await dataStore.read('daily-orders.json'),
      noEatRegistrations: await dataStore.read('no-eat-registrations.json'),
      ratings: await dataStore.read('ratings.json'),
      settings: await dataStore.read('settings.json'),
      exportTime: moment().toISOString()
    };
    
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', 'attachment; filename=order-system-all-data.json');
    res.send(JSON.stringify(allData, null, 2));
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// 定时任务
// 每周一 09:00 生成菜单
cron.schedule('0 9 * * 1', () => {
  console.log('执行定时任务: 生成本周菜单');
  menuGenerator.generateWeeklyMenu();
});

// 每天 10:00 开放午餐登记
cron.schedule('0 10 * * 1-5', () => {
  console.log('执行定时任务: 开放午餐不吃登记');
  orderManager.openRegistration('lunch');
});

// 每天 16:00 开放晚餐登记
cron.schedule('0 16 * * 1-5', () => {
  console.log('执行定时任务: 开放晚餐不吃登记');
  orderManager.openRegistration('dinner');
});

// 静态文件服务
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 启动服务器
app.listen(PORT, () => {
  console.log(`\n🚀 订餐系统启动成功!`);
  console.log(`📱 访问地址: http://localhost:${PORT}`);
  console.log(`🤖 机器人API: http://localhost:${PORT}/api/bot`);
  console.log(`⏰ 定时任务已设置:`);
  console.log(`   - 每周一 09:00 生成菜单`);
  console.log(`   - 每天 10:00 开放午餐登记`);
  console.log(`   - 每天 16:00 开放晚餐登记\n`);
});