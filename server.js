const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs-extra');
const cron = require('node-cron');
const moment = require('moment');
const xlsx = require('xlsx');
const csv = require('csv-parser');
const session = require('express-session');
const axios = require('axios');
const multer = require('multer');
const FEISHU_CONFIG = require('./feishu-config');

const app = express();
const PORT = process.env.PORT || 3000;

// 中间件
app.use(cors());
app.use(express.json());

// 配置multer用于文件上传
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadDir = path.join(__dirname, 'public/uploads/submissions');
    fs.ensureDirSync(uploadDir);
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname);
    cb(null, 'submission-' + uniqueSuffix + ext);
  }
});

const upload = multer({ 
  storage: storage,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit
  },
  fileFilter: function (req, file, cb) {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('只允许上传图片文件'));
    }
  }
});

// 会话管理
app.use(session({
  secret: FEISHU_CONFIG.SESSION_SECRET,
  resave: false,
  saveUninitialized: true,
  cookie: {
    secure: false, // 开发环境设为false，生产环境需要https时设为true
    maxAge: 24 * 60 * 60 * 1000 // 24小时
  }
}));

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
      'restaurant-suggestions.json': [],
      'restaurant-submissions.json': [],
      'submission-likes.json': [],
      'users.json': [],
      'user-roles.json': {
        defaultAdmins: [
          // 默认管理员飞书ID配置
          'admin_user_001',  // 可修改为实际的飞书用户ID
          'admin_user_002'   // 可配置多个默认管理员
        ],
        users: {
          // 用户角色映射: 'userId': 'role'
          // 'feishu_user_id': 'admin' | 'user'
        }
      },
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

  // 获取本周开始日期 (周六作为分界点，切换到下一周)
  getWeekStart() {
    const today = moment();
    let weekStart;
    
    if (today.day() === 6) { // 如果今天是周六
      // 从明天(周日)开始的一周
      weekStart = today.clone().add(1, 'day').startOf('week').format('YYYY-MM-DD');
    } else {
      // 周日到周五：显示本周的周日开始
      weekStart = today.clone().startOf('week').format('YYYY-MM-DD');
    }
    
    console.log(`本周开始日期计算: ${weekStart} (今天: ${today.format('YYYY-MM-DD dddd')})`);
    return weekStart;
  }

  // 用户角色管理方法
  async getUserRole(userId) {
    try {
      const roleData = await this.read('user-roles.json');
      if (!roleData) return 'user'; // 默认为普通用户
      
      // 检查是否为默认管理员
      if (roleData.defaultAdmins && roleData.defaultAdmins.includes(userId)) {
        return 'admin';
      }
      
      // 检查用户设置的角色
      return roleData.users[userId] || 'user';
    } catch (error) {
      console.error('获取用户角色失败:', error);
      return 'user';
    }
  }

  async setUserRole(userId, role) {
    try {
      const roleData = await this.read('user-roles.json') || { defaultAdmins: [], users: {} };
      roleData.users[userId] = role;
      await this.write('user-roles.json', roleData);
      return true;
    } catch (error) {
      console.error('设置用户角色失败:', error);
      return false;
    }
  }

  async getAllUserRoles() {
    try {
      const roleData = await this.read('user-roles.json') || { defaultAdmins: [], users: {} };
      const users = await this.read('users.json') || [];
      
      // 构建完整的用户角色信息
      const userRoles = users.map(user => {
        let role = 'user';
        if (roleData.defaultAdmins && roleData.defaultAdmins.includes(user.id)) {
          role = 'admin';
        } else if (roleData.users[user.id]) {
          role = roleData.users[user.id];
        }
        
        return {
          ...user,
          role,
          isDefaultAdmin: roleData.defaultAdmins && roleData.defaultAdmins.includes(user.id)
        };
      });
      
      return userRoles;
    } catch (error) {
      console.error('获取所有用户角色失败:', error);
      return [];
    }
  }

  async saveOrUpdateUser(userInfo) {
    try {
      const users = await this.read('users.json') || [];
      const existingUserIndex = users.findIndex(u => u.id === userInfo.id);
      
      const userData = {
        id: userInfo.id,
        name: userInfo.name,
        avatar: userInfo.avatar,
        email: userInfo.email,
        mobile: userInfo.mobile,
        loginMethod: 'feishu',
        firstLoginTime: existingUserIndex === -1 ? new Date().toISOString() : users[existingUserIndex].firstLoginTime,
        lastLoginTime: new Date().toISOString()
      };
      
      if (existingUserIndex === -1) {
        users.push(userData);
      } else {
        users[existingUserIndex] = { ...users[existingUserIndex], ...userData };
      }
      
      await this.write('users.json', users);
      return userData;
    } catch (error) {
      console.error('保存用户信息失败:', error);
      return null;
    }
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
    let idCounter = 1;
    
    excelData.forEach(item => {
      const restaurant = restaurants.find(r => r.name === item.restaurantName);
      if (restaurant) {
        // 为同一菜品的不同餐次创建不同的ID
        // 格式: 餐次前缀 + 顺序号 (lunch: 10000+, dinner: 20000+)
        const mealTypePrefix = item.mealType === 'lunch' ? 10000 : 20000;
        const uniqueDishId = mealTypePrefix + idCounter;
        
        dishes.push({
          id: uniqueDishId,
          name: item.dishName,
          description: item.description,
          category: item.category,
          price: item.price,
          restaurantId: restaurant.id,
          imageUrl: item.imageUrl,
          rating: item.rating,
          mealType: item.mealType, // 添加餐次信息
          active: true
        });
        
        idCounter++;
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
      // 查找匹配的菜品：名称和餐次都要匹配
      const dish = dishes.find(d => d.name === item.dishName && d.mealType === item.mealType);
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

  // 复制上一周菜单作为本周菜单
  async copyLastWeekMenu() {
    console.log('开始复制上一周菜单...');
    
    const weeklyMenus = await dataStore.read('weekly-menus.json');
    const currentWeekStart = dataStore.getWeekStart();
    
    // 计算上一周的开始时间
    const lastWeekStart = moment(currentWeekStart).subtract(1, 'week').format('YYYY-MM-DD');
    
    // 查找上一周的菜单
    const lastWeekMenus = weeklyMenus.filter(menu => menu.weekStart === lastWeekStart);
    
    if (!lastWeekMenus || lastWeekMenus.length === 0) {
      console.log('没有找到上一周的菜单，将生成新菜单');
      return this.generateSmartWeeklyMenu();
    }
    
    // 复制上一周菜单，更新为当前周
    const newWeeklyMenu = lastWeekMenus.map((menu, index) => ({
      ...menu,
      id: index + 1,
      weekStart: currentWeekStart,
      generatedAt: moment().toISOString()
    }));
    
    // 移除旧菜单，保存新菜单
    const otherWeekMenus = weeklyMenus.filter(menu => menu.weekStart !== currentWeekStart);
    const allMenus = [...otherWeekMenus, ...newWeeklyMenu];
    
    await dataStore.write('weekly-menus.json', allMenus);
    
    // 更新设置中的当前周
    const settings = await dataStore.read('settings.json');
    settings.currentWeekStart = currentWeekStart;
    await dataStore.write('settings.json', settings);
    
    console.log(`本周菜单生成完成（复制上周），共 ${newWeeklyMenu.length} 个菜品`);
    return true;
  }

  // 基于评分生成智能菜单
  async generateWeeklyMenu() {
    // 默认复制上一周菜单
    return this.copyLastWeekMenu();
  }

  // 基于评分生成智能菜单（原有逻辑，重命名）
  async generateSmartWeeklyMenu() {
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
  async updateOrderCount(mealType, targetDate = null) {
    const updateDate = targetDate || dataStore.getTodayString();
    const dailyOrders = await dataStore.read('daily-orders.json');
    const noEatRegs = await dataStore.read('no-eat-registrations.json');
    
    const targetNoEat = noEatRegs.filter(reg => {
      // 统一日期格式进行比较
      const regDate = reg.date ? reg.date.replace(/\//g, '-') : '';
      const updateDateFormatted = updateDate.replace(/\//g, '-');
      return regDate === updateDateFormatted && reg.mealType === mealType;
    }).length;

    const orderIndex = dailyOrders.findIndex(order => 
      order.date === updateDate && order.mealType === mealType
    );

    if (orderIndex >= 0) {
      const order = dailyOrders[orderIndex];
      order.noEatCount = targetNoEat;
      // 使用 totalPeople 作为基数计算订餐数，确保不会出现负数
      order.orderCount = Math.max(0, (order.totalPeople || 0) - targetNoEat);
      order.updatedAt = moment().toISOString();
      
      await dataStore.write('daily-orders.json', dailyOrders);
    } else {
      // 如果没有找到订餐记录，创建一个新的
      const settings = await dataStore.read('settings.json');
      const defaultPeople = settings.totalEmployees || 50;
      
      dailyOrders.push({
        id: dataStore.generateId(dailyOrders),
        date: updateDate,
        mealType,
        totalPeople: defaultPeople,
        noEatCount: targetNoEat,
        orderCount: Math.max(0, defaultPeople - targetNoEat),
        status: 'open',
        createdAt: moment().toISOString()
      });
      
      await dataStore.write('daily-orders.json', dailyOrders);
    }
    
    console.log(`更新${mealType}统计 (${updateDate}): 不吃人数=${targetNoEat}`);
  }
}

const orderManager = new OrderManager();

// API路由

// 获取今日菜单
app.get('/api/menu/today', async (req, res) => {
  try {
    const weeklyMenus = await dataStore.read('weekly-menus.json');
    const dailyOrders = await dataStore.read('daily-orders.json');
    const today = moment();
    const dayOfWeek = today.day(); // 周日为0，周一为1...周六为6
    const weekStart = dataStore.getWeekStart();
    const todayString = dataStore.getTodayString();
    
    if (dayOfWeek === 6) { // 只有周六返回空菜单
      return res.json({ success: true, data: { lunch: [], dinner: [] } });
    }

    let lunch = [];
    let dinner = [];

    // 首先检查 daily-orders.json 中是否有今日的菜单（管理员发布的菜单）
    const todayDailyMenu = dailyOrders.find(order => 
      order.date === todayString && order.publishedAt
    );

    if (todayDailyMenu) {
      // 使用管理员发布的今日菜单，转换格式以匹配前端期望
      lunch = convertRestaurantMenuToDishArray(todayDailyMenu.lunch || []);
      dinner = convertRestaurantMenuToDishArray(todayDailyMenu.dinner || []);
    } else {
      // 回退到 weekly-menus.json 查找菜单
      
      // 首先尝试新格式（管理员发布的周菜单）
      const currentWeekMenu = weeklyMenus.find(menu => 
        menu.weekStart === weekStart && menu.menu
      );
      
      if (currentWeekMenu) {
        // 将 dayOfWeek 转换为星期名称
        const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
        const dayName = dayNames[dayOfWeek];
        
        if (currentWeekMenu.menu[dayName]) {
          lunch = convertRestaurantMenuToDishArray(currentWeekMenu.menu[dayName].lunch || []);
          dinner = convertRestaurantMenuToDishArray(currentWeekMenu.menu[dayName].dinner || []);
        }
      } else {
        // 最后回退到旧格式（系统生成的菜单）
        const todayMenus = weeklyMenus.filter(menu => 
          menu.weekStart === weekStart && menu.dayOfWeek === dayOfWeek && menu.mealType
        );

        lunch = todayMenus.filter(menu => menu.mealType === 'lunch');
        dinner = todayMenus.filter(menu => menu.mealType === 'dinner');
      }
    }

    // 转换餐厅菜单格式为菜品数组格式的辅助函数
    function convertRestaurantMenuToDishArray(restaurantMenus) {
      const dishes = [];
      restaurantMenus.forEach(restaurant => {
        if (restaurant.dishes && Array.isArray(restaurant.dishes)) {
          // 管理员发布的格式：餐厅包含菜品数组
          restaurant.dishes.forEach(dish => {
            dishes.push({
              dishId: dish.id,
              dishName: dish.name,
              restaurantName: dish.restaurantName || restaurant.restaurantName,
              rating: dish.rating || 0,
              imageUrl: dish.imageUrl || '/images/default-dish.jpg',
              tags: dish.tags || []
            });
          });
        } else {
          // 可能的其他格式，直接作为菜品处理
          dishes.push({
            dishId: restaurant.id || restaurant.dishId,
            dishName: restaurant.name || restaurant.dishName,
            restaurantName: restaurant.restaurantName,
            rating: restaurant.rating || 0,
            imageUrl: restaurant.imageUrl || '/images/default-dish.jpg'
          });
        }
      });
      return dishes;
    }

    res.json({
      success: true,
      data: { lunch, dinner, date: todayString }
    });
  } catch (error) {
    console.error('获取今日菜单失败:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// 获取本周菜单
app.get('/api/menu/week', async (req, res) => {
  try {
    const weeklyMenus = await dataStore.read('weekly-menus.json');
    const dailyOrders = await dataStore.read('daily-orders.json');
    const weekStart = dataStore.getWeekStart();
    
    // 按天和餐次组织数据（周日=0, 周一=1...周六=6）
    const organizedMenus = {};
    const workDays = [0, 1, 2, 3, 4, 5]; // 周日到周五
    
    workDays.forEach(day => {
      organizedMenus[day] = {
        lunch: [],
        dinner: []
      };
    });

    // 从 daily-orders.json 获取已发布的每日菜单
    // weekStart 现在是周日
    const weekStartDate = new Date(weekStart);
    
    const weekDates = [];
    for (let i = 0; i < 7; i++) {
      const date = new Date(weekStartDate);
      date.setDate(date.getDate() + i);
      weekDates.push(date.toISOString().split('T')[0]);
    }

    weekDates.forEach((dateStr, index) => {
      const dayOfWeek = index; // 0=周日, 1=周一...6=周六
      if (dayOfWeek === 6) return; // 跳过周六
      
      const dailyMenu = dailyOrders.find(order => 
        order.date === dateStr && order.publishedAt
      );
      
      if (dailyMenu) {
        organizedMenus[dayOfWeek].lunch = convertRestaurantMenuToDishArray(dailyMenu.lunch || []);
        organizedMenus[dayOfWeek].dinner = convertRestaurantMenuToDishArray(dailyMenu.dinner || []);
      }
    });

    // 如果没有找到daily菜单，回退到weekly-menus.json
    const hasAnyDailyMenu = Object.values(organizedMenus).some(day => 
      day.lunch.length > 0 || day.dinner.length > 0
    );

    if (!hasAnyDailyMenu) {
      // 尝试新格式的周菜单
      const currentWeekMenu = weeklyMenus.find(menu => 
        menu.weekStart === weekStart && menu.menu
      );
      
      if (currentWeekMenu) {
        const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
        
        workDays.forEach(dayOfWeek => {
          const dayName = dayNames[dayOfWeek];
          if (currentWeekMenu.menu[dayName]) {
            organizedMenus[dayOfWeek].lunch = convertRestaurantMenuToDishArray(currentWeekMenu.menu[dayName].lunch || []);
            organizedMenus[dayOfWeek].dinner = convertRestaurantMenuToDishArray(currentWeekMenu.menu[dayName].dinner || []);
          }
        });
      } else {
        // 最后回退到旧格式
        const thisWeekMenus = weeklyMenus.filter(menu => 
          menu.weekStart === weekStart && menu.dayOfWeek !== undefined && menu.mealType
        );
        
        workDays.forEach(day => {
          organizedMenus[day] = {
            lunch: thisWeekMenus.filter(m => m.dayOfWeek === day && m.mealType === 'lunch'),
            dinner: thisWeekMenus.filter(m => m.dayOfWeek === day && m.mealType === 'dinner')
          };
        });
      }
    }

    // 转换餐厅菜单格式为菜品数组格式的辅助函数
    function convertRestaurantMenuToDishArray(restaurantMenus) {
      const dishes = [];
      restaurantMenus.forEach(restaurant => {
        if (restaurant.dishes && Array.isArray(restaurant.dishes)) {
          // 管理员发布的格式：餐厅包含菜品数组
          restaurant.dishes.forEach(dish => {
            dishes.push({
              dishId: dish.id,
              dishName: dish.name,
              restaurantName: dish.restaurantName || restaurant.restaurantName,
              rating: dish.rating || 0,
              imageUrl: dish.imageUrl || '/images/default-dish.jpg',
              tags: dish.tags || []
            });
          });
        } else {
          // 可能的其他格式，直接作为菜品处理
          dishes.push({
            dishId: restaurant.id || restaurant.dishId,
            dishName: restaurant.name || restaurant.dishName,
            restaurantName: restaurant.restaurantName,
            rating: restaurant.rating || 0,
            imageUrl: restaurant.imageUrl || '/images/default-dish.jpg'
          });
        }
      });
      return dishes;
    }

    console.log(`/api/menu/week 返回数据:`, {
      weekStart,
      organizedMenusKeys: Object.keys(organizedMenus),
      weekDates: weekDates
    });
    
    res.json({
      success: true,
      data: organizedMenus,
      weekStart
    });
  } catch (error) {
    console.error('获取周菜单失败:', error);
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

// 获取菜品最新评价记录
app.get('/api/rating/recent/:dishId', async (req, res) => {
  try {
    const dishId = parseInt(req.params.dishId);
    const limit = parseInt(req.query.limit) || 3;
    
    const ratings = await dataStore.read('ratings.json');
    
    // 获取该菜品的最新评价记录，按时间倒序
    const dishRatings = ratings
      .filter(r => r.dishId === dishId)
      .sort((a, b) => {
        // 使用 updatedAt 优先，如果没有则用 createdAt
        const timeA = new Date(a.updatedAt || a.createdAt);
        const timeB = new Date(b.updatedAt || b.createdAt);
        return timeB - timeA;
      })
      .slice(0, limit);
    
    res.json({
      success: true,
      data: dishRatings
    });
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
    
    // 每次都创建新的评价记录，允许同一人对同一菜品多次评价
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

// ===========================================
// 飞书消息发送功能
// ===========================================

// 飞书消息发送类
class FeishuMessageSender {
  constructor() {
    this.webhookUrl = FEISHU_CONFIG.WEBHOOK_CONFIG.WEBHOOK_URL;
    this.secret = FEISHU_CONFIG.WEBHOOK_CONFIG.SECRET;
  }

  // 发送基础文本消息
  async sendTextMessage(content, title = null) {
    try {
      if (!this.webhookUrl) {
        throw new Error('飞书Webhook URL未配置');
      }

      const message = {
        msg_type: 'text',
        content: {
          text: title ? `${title}\n\n${content}` : content
        }
      };

      const response = await axios.post(this.webhookUrl, message);
      
      if (response.data.code === 0) {
        console.log('飞书消息发送成功');
        return { success: true, message: '消息发送成功' };
      } else {
        throw new Error(response.data.msg || '消息发送失败');
      }
    } catch (error) {
      console.error('飞书消息发送失败:', error.message);
      return { success: false, message: error.message };
    }
  }

  // 发送富文本消息
  async sendRichTextMessage(title, content) {
    try {
      if (!this.webhookUrl) {
        throw new Error('飞书Webhook URL未配置');
      }

      const message = {
        msg_type: 'post',
        content: {
          post: {
            zh_cn: {
              title: title,
              content: content
            }
          }
        }
      };

      const response = await axios.post(this.webhookUrl, message);
      
      if (response.data.code === 0) {
        console.log('飞书富文本消息发送成功');
        return { success: true, message: '消息发送成功' };
      } else {
        throw new Error(response.data.msg || '消息发送失败');
      }
    } catch (error) {
      console.error('飞书富文本消息发送失败:', error.message);
      return { success: false, message: error.message };
    }
  }

  // 发送卡片消息
  async sendCardMessage(title, content, color = 'blue') {
    try {
      if (!this.webhookUrl) {
        throw new Error('飞书Webhook URL未配置');
      }

      const message = {
        msg_type: 'interactive',
        card: {
          config: {
            wide_screen_mode: true,
            enable_forward: true
          },
          header: {
            title: {
              tag: 'plain_text',
              content: title
            },
            template: color
          },
          elements: [
            {
              tag: 'div',
              text: {
                tag: 'lark_md',
                content: content
              }
            }
          ]
        }
      };

      const response = await axios.post(this.webhookUrl, message);
      
      if (response.data.code === 0) {
        console.log('飞书卡片消息发送成功');
        return { success: true, message: '消息发送成功' };
      } else {
        throw new Error(response.data.msg || '消息发送失败');
      }
    } catch (error) {
      console.error('飞书卡片消息发送失败:', error.message);
      return { success: false, message: error.message };
    }
  }
}

// 创建飞书消息发送器实例
const feishuSender = new FeishuMessageSender();

// 飞书消息模板类
class FeishuMessageTemplates {
  // 每日菜单推送模板
  static getDailyMenuMessage(menuData) {
    const today = moment().format('YYYY年MM月DD日');
    const dayOfWeek = moment().format('dddd');
    
    let content = `📅 **${today} (${dayOfWeek}) 今日菜单**\n\n`;
    
    if (menuData.lunch && menuData.lunch.length > 0) {
      content += `🥗 **午餐菜单：**\n`;
      menuData.lunch.forEach((dish, index) => {
        content += `${index + 1}. ${dish.dishName} - ${dish.restaurantName}\n`;
      });
      content += '\n';
    }
    
    if (menuData.dinner && menuData.dinner.length > 0) {
      content += `🍽️ **晚餐菜单：**\n`;
      menuData.dinner.forEach((dish, index) => {
        content += `${index + 1}. ${dish.dishName} - ${dish.restaurantName}\n`;
      });
    }
    
    content += '\n📱 点击链接进行订餐: http://localhost:3000';
    
    return {
      title: '🍽️ 每日菜单推送',
      content: content
    };
  }
  
  // 订餐统计推送模板
  static getOrderStatsMessage(lunchStats, dinnerStats) {
    const today = moment().format('YYYY年MM月DD日');
    
    let content = `📊 **${today} 订餐统计**\n\n`;
    content += `🥗 **午餐统计：**\n`;
    content += `• 已订餐：${lunchStats.orderCount || 0} 人\n`;
    content += `• 不吃：${lunchStats.noEatCount || 0} 人\n`;
    content += `• 未登记：${lunchStats.totalPeople - lunchStats.orderCount - lunchStats.noEatCount || 0} 人\n\n`;
    
    content += `🍽️ **晚餐统计：**\n`;
    content += `• 已订餐：${dinnerStats.orderCount || 0} 人\n`;
    content += `• 不吃：${dinnerStats.noEatCount || 0} 人\n`;
    content += `• 未登记：${dinnerStats.totalPeople - dinnerStats.orderCount - dinnerStats.noEatCount || 0} 人\n`;
    
    return {
      title: '📊 订餐统计报告',
      content: content
    };
  }
  
  // 自定义消息模板
  static getCustomMessage(title, content, emoji = '💬') {
    return {
      title: `${emoji} ${title}`,
      content: content
    };
  }
}

// 飞书消息API接口
// 发送自定义消息
app.post('/api/feishu/send-message', async (req, res) => {
  try {
    const { type, title, content, messageType = 'text' } = req.body;
    
    if (!content) {
      return res.status(400).json({ success: false, message: '消息内容不能为空' });
    }
    
    let result;
    
    switch (messageType) {
      case 'text':
        result = await feishuSender.sendTextMessage(content, title);
        break;
      case 'rich':
        if (!title) {
          return res.status(400).json({ success: false, message: '富文本消息需要标题' });
        }
        result = await feishuSender.sendRichTextMessage(title, content);
        break;
      case 'card':
        if (!title) {
          return res.status(400).json({ success: false, message: '卡片消息需要标题' });
        }
        result = await feishuSender.sendCardMessage(title, content);
        break;
      default:
        return res.status(400).json({ success: false, message: '不支持的消息类型' });
    }
    
    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// 发送今日菜单
app.post('/api/feishu/send-daily-menu', async (req, res) => {
  try {
    const menuResponse = await fetch(`http://localhost:${PORT}/api/menu/today`);
    const menuData = await menuResponse.json();
    
    if (!menuData.success) {
      return res.status(400).json({ success: false, message: '获取今日菜单失败' });
    }
    
    const template = FeishuMessageTemplates.getDailyMenuMessage(menuData.data);
    const result = await feishuSender.sendCardMessage(template.title, template.content, 'green');
    
    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// 发送订餐统计
app.post('/api/feishu/send-order-stats', async (req, res) => {
  try {
    const lunchResponse = await fetch(`http://localhost:${PORT}/api/order/stats/lunch`);
    const dinnerResponse = await fetch(`http://localhost:${PORT}/api/order/stats/dinner`);
    
    const lunchData = await lunchResponse.json();
    const dinnerData = await dinnerResponse.json();
    
    if (!lunchData.success || !dinnerData.success) {
      return res.status(400).json({ success: false, message: '获取统计数据失败' });
    }
    
    const template = FeishuMessageTemplates.getOrderStatsMessage(lunchData.data, dinnerData.data);
    const result = await feishuSender.sendCardMessage(template.title, template.content, 'blue');
    
    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// 手动推送次日菜单API接口（测试用）
app.post('/api/feishu/push-tomorrow-menu', async (req, res) => {
  try {
    await pushTomorrowMenu();
    res.json({ success: true, message: '次日菜单推送成功' });
  } catch (error) {
    console.error('手动推送次日菜单失败:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// 测试飞书连接
app.get('/api/feishu/test', async (req, res) => {
  try {
    const testMessage = '🤖 飞书机器人测试消息\n\n系统运行正常，消息发送功能已就绪！';
    const result = await feishuSender.sendTextMessage(testMessage, '✅ 系统测试');
    
    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// ===========================================
// 飞书机器人命令处理功能
// ===========================================

// 命令处理器类
class FeishuCommandHandler {
  constructor() {
    this.commands = {
      '菜单': this.handleMenuCommand.bind(this),
      '今日菜单': this.handleMenuCommand.bind(this),
      '统计': this.handleStatsCommand.bind(this),
      '订餐统计': this.handleStatsCommand.bind(this),
      '帮助': this.handleHelpCommand.bind(this),
      'help': this.handleHelpCommand.bind(this),
      '状态': this.handleStatusCommand.bind(this),
      '本周菜单': this.handleWeeklyMenuCommand.bind(this)
    };
  }

  // 处理用户消息
  async processMessage(message, userId = null) {
    try {
      const text = message.trim();
      console.log(`接收到飞书消息: ${text}, 用户: ${userId}`);
      
      // 查找匹配的命令
      const command = this.findCommand(text);
      
      if (command) {
        return await command(text, userId);
      } else {
        return await this.handleUnknownCommand(text);
      }
    } catch (error) {
      console.error('处理飞书消息失败:', error);
      return {
        success: false,
        reply: '❌ 处理消息时出现错误，请稍后重试'
      };
    }
  }

  // 查找命令
  findCommand(text) {
    const lowerText = text.toLowerCase();
    
    // 精确匹配
    for (const [keyword, handler] of Object.entries(this.commands)) {
      if (text === keyword || lowerText === keyword.toLowerCase()) {
        return handler;
      }
    }
    
    // 模糊匹配
    for (const [keyword, handler] of Object.entries(this.commands)) {
      if (text.includes(keyword) || lowerText.includes(keyword.toLowerCase())) {
        return handler;
      }
    }
    
    return null;
  }

  // 处理菜单命令
  async handleMenuCommand(text, userId) {
    try {
      const menuResponse = await fetch(`http://localhost:${PORT}/api/menu/today`);
      const menuData = await menuResponse.json();
      
      if (!menuData.success) {
        return { success: false, reply: '❌ 获取菜单失败' };
      }
      
      const template = FeishuMessageTemplates.getDailyMenuMessage(menuData.data);
      return {
        success: true,
        reply: `${template.title}\n\n${template.content}`,
        type: 'card'
      };
    } catch (error) {
      return { success: false, reply: '❌ 获取菜单时出现错误' };
    }
  }

  // 处理统计命令
  async handleStatsCommand(text, userId) {
    try {
      const lunchResponse = await fetch(`http://localhost:${PORT}/api/order/stats/lunch`);
      const dinnerResponse = await fetch(`http://localhost:${PORT}/api/order/stats/dinner`);
      
      const lunchData = await lunchResponse.json();
      const dinnerData = await dinnerResponse.json();
      
      if (!lunchData.success || !dinnerData.success) {
        return { success: false, reply: '❌ 获取统计数据失败' };
      }
      
      const template = FeishuMessageTemplates.getOrderStatsMessage(lunchData.data, dinnerData.data);
      return {
        success: true,
        reply: `${template.title}\n\n${template.content}`,
        type: 'card'
      };
    } catch (error) {
      return { success: false, reply: '❌ 获取统计数据时出现错误' };
    }
  }

  // 处理本周菜单命令
  async handleWeeklyMenuCommand(text, userId) {
    try {
      const menuResponse = await fetch(`http://localhost:${PORT}/api/menu/week`);
      const menuData = await menuResponse.json();
      
      if (!menuData.success) {
        return { success: false, reply: '❌ 获取本周菜单失败' };
      }

      const weekStart = moment(menuData.weekStart).format('YYYY年MM月DD日');
      let content = `📅 **本周菜单** (从 ${weekStart} 开始)\n\n`;
      
      const days = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
      
      Object.keys(menuData.data).forEach(dayIndex => {
        if (dayIndex === 'weekStart') return;
        
        const dayMenu = menuData.data[dayIndex];
        const dayName = days[parseInt(dayIndex)];
        const date = moment(menuData.weekStart).add(dayIndex, 'days').format('MM月DD日');
        
        content += `**${dayName} (${date})**\n`;
        
        if (dayMenu.lunch && dayMenu.lunch.length > 0) {
          content += `🥗 午餐: `;
          content += dayMenu.lunch.map(dish => dish.dishName).join(', ') + '\n';
        }
        
        if (dayMenu.dinner && dayMenu.dinner.length > 0) {
          content += `🍽️ 晚餐: `;
          content += dayMenu.dinner.map(dish => dish.dishName).join(', ') + '\n';
        }
        
        content += '\n';
      });
      
      content += '📱 点击链接查看详情: http://localhost:3000';
      
      return {
        success: true,
        reply: content,
        type: 'card'
      };
    } catch (error) {
      return { success: false, reply: '❌ 获取本周菜单时出现错误' };
    }
  }

  // 处理状态命令
  async handleStatusCommand(text, userId) {
    try {
      const today = moment().format('YYYY年MM月DD日 HH:mm:ss');
      const uptime = process.uptime();
      const hours = Math.floor(uptime / 3600);
      const minutes = Math.floor((uptime % 3600) / 60);
      
      let content = `🤖 **系统状态报告**\n\n`;
      content += `📅 当前时间: ${today}\n`;
      content += `⏰ 运行时长: ${hours}小时${minutes}分钟\n`;
      content += `🖥️ 系统状态: 正常运行\n`;
      content += `🔗 访问地址: http://localhost:3000\n\n`;
      content += `💡 输入 "帮助" 查看可用命令`;
      
      return {
        success: true,
        reply: content,
        type: 'card'
      };
    } catch (error) {
      return { success: false, reply: '❌ 获取系统状态时出现错误' };
    }
  }

  // 处理帮助命令
  async handleHelpCommand(text, userId) {
    let content = `🤖 **订餐机器人帮助**\n\n`;
    content += `📋 **可用命令:**\n\n`;
    content += `🍽️ **菜单相关**\n`;
    content += `• "菜单" 或 "今日菜单" - 查看今日菜单\n`;
    content += `• "本周菜单" - 查看本周完整菜单\n\n`;
    content += `📊 **统计相关**\n`;
    content += `• "统计" 或 "订餐统计" - 查看今日订餐统计\n`;
    content += `• "状态" - 查看系统运行状态\n\n`;
    content += `❓ **其他**\n`;
    content += `• "帮助" 或 "help" - 显示此帮助信息\n\n`;
    content += `💡 **提示:** 直接输入关键词即可，不区分大小写\n`;
    content += `🔗 **网页版:** http://localhost:3000`;
    
    return {
      success: true,
      reply: content,
      type: 'card'
    };
  }

  // 处理未知命令
  async handleUnknownCommand(text) {
    return {
      success: true,
      reply: `❓ 抱歉，我不理解 "${text}"\n\n💡 输入 "帮助" 查看可用命令`
    };
  }
}

// 创建命令处理器实例
const commandHandler = new FeishuCommandHandler();

// 推送次日菜单功能
async function pushTomorrowMenu() {
  try {
    // 获取明天的日期
    const tomorrow = moment().add(1, 'day');
    const tomorrowDate = tomorrow.format('YYYY-MM-DD');
    const tomorrowDateText = tomorrow.format('M月D日 dddd');
    const tomorrowDayOfWeek = tomorrow.day(); // 0=周日, 1=周一, ..., 6=周六
    
    console.log(`准备推送次日菜单: ${tomorrowDate} (${tomorrowDateText}, dayOfWeek: ${tomorrowDayOfWeek})`);
    
    // 获取当前周的菜单数据 (使用现有的 weekly-menus.json 数据结构)
    const weeklyMenus = await dataStore.read('weekly-menus.json');
    
    // 获取当前周的开始日期
    const weekStart = getWeekStart();
    
    // 筛选出明天的菜单数据
    const tomorrowLunchMenus = weeklyMenus.filter(menu => 
      menu.weekStart === weekStart && 
      menu.dayOfWeek === tomorrowDayOfWeek && 
      menu.mealType === 'lunch' &&
      menu.active
    );
    
    const tomorrowDinnerMenus = weeklyMenus.filter(menu => 
      menu.weekStart === weekStart && 
      menu.dayOfWeek === tomorrowDayOfWeek && 
      menu.mealType === 'dinner' &&
      menu.active
    );
    
    // 检查是否有菜单数据
    const hasLunch = tomorrowLunchMenus.length > 0;
    const hasDinner = tomorrowDinnerMenus.length > 0;
    
    if (!hasLunch && !hasDinner) {
      console.log(`次日菜单数据为空: ${tomorrowDate}，跳过推送`);
      return;
    }
    
    // 构建菜单推送消息
    const cardMessage = buildTomorrowMenuCardFromMenus(tomorrow, tomorrowLunchMenus, tomorrowDinnerMenus);
    
    // 发送到飞书群
    const messageSender = new FeishuMessageSender();
    await messageSender.sendCardMessage('🍽️ 订餐提醒', cardMessage, 'blue');
    
    console.log(`次日菜单推送成功: ${tomorrowDate} (午餐:${hasLunch ? tomorrowLunchMenus.length + '种' : '无'}, 晚餐:${hasDinner ? tomorrowDinnerMenus.length + '种' : '无'})`);
  } catch (error) {
    console.error('推送次日菜单失败:', error);
    throw error;
  }
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

// 旧版本的构建函数 (保留备用)
function buildTomorrowMenuCard(tomorrow, menuData) {
  const dateText = tomorrow.format('M月D日 dddd');
  const lunchDeadline = tomorrow.clone().hour(11).minute(0).format('次日 HH:mm');
  const dinnerDeadline = tomorrow.clone().hour(16).minute(30).format('次日 HH:mm');
  
  let menuContent = `🍽️ **[订餐提醒] 明日 (${dateText}) 午餐 & 晚餐菜单**\n\n`;
  
  // 午餐菜单
  if (menuData.lunch && menuData.lunch.length > 0) {
    menuContent += `👨‍🍳 **午餐菜单**（截止时间：${lunchDeadline}）\n`;
    menuData.lunch.forEach(item => {
      menuContent += `🏪 **餐厅**：${item.restaurant}\n`;
      menuContent += `🍽️ **菜品**：${item.dishes.join('、')}\n`;
      if (item.price) {
        menuContent += `💰 **价格**：¥${item.price}\n`;
      }
      menuContent += '\n';
    });
  } else {
    menuContent += `👨‍🍳 **午餐菜单**（截止时间：${lunchDeadline}）\n`;
    menuContent += `暂无午餐菜单数据\n\n`;
  }
  
  // 晚餐菜单
  if (menuData.dinner && menuData.dinner.length > 0) {
    menuContent += `👨‍🍳 **晚餐菜单**（截止时间：${dinnerDeadline}）\n`;
    menuData.dinner.forEach(item => {
      menuContent += `🏪 **餐厅**：${item.restaurant}\n`;
      menuContent += `🍽️ **菜品**：${item.dishes.join('、')}\n`;
      if (item.price) {
        menuContent += `💰 **价格**：¥${item.price}\n`;
      }
      menuContent += '\n';
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

// 飞书机器人消息接收接口 (Webhook回调)
app.post('/api/feishu/webhook', async (req, res) => {
  try {
    const { header, event } = req.body;
    
    // URL验证 (飞书会发送此类型请求验证webhook地址)
    if (header.event_type === 'url_verification') {
      return res.json({ challenge: event.challenge });
    }
    
    // 处理消息事件
    if (header.event_type === 'im.message.receive_v1') {
      const message = event.message;
      const sender = event.sender;
      
      // 只处理文本消息，忽略机器人自己的消息
      if (message.message_type === 'text' && !sender.sender_type === 'app') {
        const content = JSON.parse(message.content).text;
        const userId = sender.sender_id.user_id;
        
        console.log(`收到飞书消息: ${content}, 来自用户: ${userId}`);
        
        // 处理用户命令
        const result = await commandHandler.processMessage(content, userId);
        
        if (result.success && result.reply) {
          // 根据类型发送不同格式的回复
          if (result.type === 'card') {
            await feishuSender.sendCardMessage('🤖 订餐机器人', result.reply, 'blue');
          } else {
            await feishuSender.sendTextMessage(result.reply);
          }
        }
      }
    }
    
    // 返回成功响应
    res.json({ code: 0, msg: 'success' });
  } catch (error) {
    console.error('处理飞书Webhook失败:', error);
    res.json({ code: -1, msg: 'error' });
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

// 获取点餐记录
app.get('/api/admin/orders', async (req, res) => {
  try {
    const dailyOrders = await dataStore.read('daily-orders.json');
    const restaurants = await dataStore.read('restaurants.json');
    const users = await dataStore.read('users.json');
    
    // 获取查询参数
    const { startDate, endDate } = req.query;
    console.log('API /api/admin/orders 收到请求，查询参数:', { startDate, endDate, fullQuery: req.query });
    
    let filterStartDate, filterEndDate;
    
    if (startDate && endDate) {
      // 如果提供了日期范围，使用提供的日期
      filterStartDate = startDate;
      filterEndDate = endDate;
      console.log('使用自定义日期范围:', { startDate, endDate });
    } else {
      // 默认行为：显示当天到下星期末的记录
      const today = moment().format('YYYY-MM-DD');
      const currentWeekday = moment().day(); // 0=Sunday, 1=Monday, ..., 6=Saturday
      const daysUntilSunday = currentWeekday === 0 ? 0 : 7 - currentWeekday; // 到本周日还有几天
      const nextWeekEnd = moment().add(daysUntilSunday + 7, 'days').format('YYYY-MM-DD'); // 下星期日
      
      filterStartDate = today;
      filterEndDate = nextWeekEnd;
      console.log('使用默认日期范围:', { today, nextWeekEnd });
    }
    
    // 过滤：显示指定日期范围的记录，并且是点餐记录格式（有mealType字段）
    const filteredOrders = dailyOrders.filter(order => {
      return order.date >= filterStartDate && order.date <= filterEndDate && order.mealType && order.id;
    });
    
    console.log('筛选结果:', {
      totalOrders: dailyOrders.length,
      filteredOrders: filteredOrders.length,
      dateRange: { filterStartDate, filterEndDate },
      dates: filteredOrders.map(o => o.date)
    });
    
    // 丰富点餐记录数据
    const enrichedOrders = filteredOrders.map(order => {
      const orderDate = new Date(order.date);
      const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
      const weekday = weekdays[orderDate.getDay()];
      
      return {
        ...order,
        dateFormatted: orderDate.toLocaleDateString('zh-CN'),
        weekday: weekday,
        dateWithWeekday: `${orderDate.toLocaleDateString('zh-CN')} ${weekday}`,
        mealTypeText: order.mealType === 'lunch' ? '午餐' : '晚餐',
        statusText: order.status === 'open' ? '开放点餐' : '已关闭'
      };
    }).sort((a, b) => new Date(a.date) - new Date(b.date)); // 按日期正序排序（当日优先）
    
    res.json({ success: true, data: enrichedOrders || [] });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// 更改点餐状态
app.post('/api/admin/orders/toggle-status', async (req, res) => {
  try {
    const { date, mealType } = req.body;
    
    console.log('收到状态切换请求:', { date, mealType });
    
    if (!date || !mealType) {
      console.log('参数验证失败');
      return res.status(400).json({ 
        success: false, 
        message: '缺少必要参数' 
      });
    }

    const dailyOrders = await dataStore.read('daily-orders.json');
    
    // 找到对应的点餐记录
    const orderIndex = dailyOrders.findIndex(order => 
      order.date === date && order.mealType === mealType
    );
    
    if (orderIndex === -1) {
      return res.status(404).json({ 
        success: false, 
        message: '未找到对应的点餐记录' 
      });
    }
    
    // 切换状态
    dailyOrders[orderIndex].status = dailyOrders[orderIndex].status === 'open' ? 'closed' : 'open';
    dailyOrders[orderIndex].updatedAt = moment().toISOString();
    
    // 保存到文件
    await dataStore.write('daily-orders.json', dailyOrders);
    
    res.json({ 
      success: true, 
      message: `点餐状态已${dailyOrders[orderIndex].status === 'open' ? '开放' : '关闭'}`,
      data: {
        date: date,
        mealType: mealType,
        status: dailyOrders[orderIndex].status
      }
    });
  } catch (error) {
    console.error('更改点餐状态失败:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// 清零不吃人数
app.post('/api/admin/orders/clear-no-eat', async (req, res) => {
  try {
    console.log('收到清零不吃请求:', req.body);
    const { date, mealType } = req.body;
    
    if (!date || !mealType) {
      console.log('参数验证失败:', { date, mealType });
      return res.status(400).json({ success: false, message: '请提供日期和餐次' });
    }

    const dailyOrders = await dataStore.read('daily-orders.json');
    const orderIndex = dailyOrders.findIndex(order => 
      order.date === date && order.mealType === mealType && order.id
    );

    if (orderIndex === -1) {
      console.log('未找到点餐记录:', { date, mealType, totalRecords: dailyOrders.length });
      return res.status(404).json({ success: false, message: '未找到指定的点餐记录' });
    }

    console.log('找到点餐记录，清零前:', dailyOrders[orderIndex]);
    
    // 删除对应的不吃登记记录
    const noEatRegs = await dataStore.read('no-eat-registrations.json');
    const filteredNoEatRegs = noEatRegs.filter(reg => {
      const regDate = reg.date ? reg.date.replace(/\//g, '-') : '';
      const targetDate = date.replace(/\//g, '-');
      return !(regDate === targetDate && reg.mealType === mealType);
    });
    
    console.log(`删除不吃登记记录: ${noEatRegs.length} -> ${filteredNoEatRegs.length}`);
    await dataStore.write('no-eat-registrations.json', filteredNoEatRegs);
    
    // 清零不吃人数
    dailyOrders[orderIndex].noEatCount = 0;
    // 重新计算点餐人数
    const totalPeople = dailyOrders[orderIndex].totalPeople || 0;
    dailyOrders[orderIndex].orderCount = Math.max(0, totalPeople - 0);
    dailyOrders[orderIndex].updatedAt = moment().toISOString();
    
    await dataStore.write('daily-orders.json', dailyOrders);
    
    console.log('清零完成:', { date, mealType, noEatCount: 0 });
    
    res.json({ 
      success: true, 
      message: '不吃人数已清零',
      data: {
        date: date,
        mealType: mealType,
        noEatCount: 0
      }
    });
  } catch (error) {
    console.error('清零不吃人数失败:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// 获取系统配置
app.get('/api/admin/config', async (req, res) => {
  try {
    let config;
    try {
      config = await dataStore.read('system-config.json');
    } catch (error) {
      // 如果配置文件不存在，创建默认配置
      config = {
        totalPeople: {
          lunch: 50,
          dinner: 45
        },
        createdAt: moment().toISOString(),
        updatedAt: moment().toISOString()
      };
      await dataStore.write('system-config.json', config);
    }
    
    res.json({ success: true, data: config });
  } catch (error) {
    console.error('获取系统配置失败:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// 更新系统配置
app.post('/api/admin/config', async (req, res) => {
  try {
    const { totalPeople } = req.body;
    
    if (!totalPeople || typeof totalPeople.lunch !== 'number' || typeof totalPeople.dinner !== 'number') {
      return res.status(400).json({ 
        success: false, 
        message: '请提供有效的总人数配置 (lunch和dinner都必须是数字)' 
      });
    }

    if (totalPeople.lunch < 0 || totalPeople.dinner < 0) {
      return res.status(400).json({ 
        success: false, 
        message: '总人数不能为负数' 
      });
    }

    let config;
    try {
      config = await dataStore.read('system-config.json');
    } catch (error) {
      // 如果配置文件不存在，创建新的
      config = {
        createdAt: moment().toISOString()
      };
    }

    config.totalPeople = totalPeople;
    config.updatedAt = moment().toISOString();
    
    await dataStore.write('system-config.json', config);
    
    res.json({ 
      success: true, 
      message: '系统配置已更新',
      data: config
    });
  } catch (error) {
    console.error('更新系统配置失败:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// 获取菜品评价记录
app.get('/api/admin/ratings', async (req, res) => {
  try {
    const ratings = await dataStore.read('ratings.json');
    const dishes = await dataStore.read('dishes.json');
    
    // 丰富评价记录数据
    const enrichedRatings = ratings.map(rating => {
      const dish = dishes.find(d => d.id === rating.dishId);
      return {
        ...rating,
        dishName: dish ? dish.name : '未知菜品',
        dateFormatted: new Date(rating.date).toLocaleDateString('zh-CN'),
        timeFormatted: new Date(rating.timestamp).toLocaleTimeString('zh-CN', { 
          hour: '2-digit', 
          minute: '2-digit' 
        }),
        mealTypeText: rating.mealType === 'lunch' ? '午餐' : '晚餐',
        ratingStars: '⭐'.repeat(rating.rating)
      };
    }).sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp)); // 按评价时间倒序排序
    
    res.json({ success: true, data: enrichedRatings || [] });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// 获取系统用户列表
app.get('/api/admin/users', async (req, res) => {
  try {
    const users = await dataStore.read('users.json');
    const employees = await dataStore.read('employees.json');
    const ratings = await dataStore.read('ratings.json');
    
    // 丰富用户数据
    const enrichedUsers = users.map(user => {
      // 查找对应员工信息
      const employee = employees.find(e => e.name === user.name);
      
      // 统计该用户的评价数量
      const userRatings = ratings.filter(r => r.employeeName === user.name);
      
      return {
        ...user,
        department: employee ? employee.department : '未设置',
        isEmployee: !!employee,
        ratingCount: userRatings.length,
        lastLoginFormatted: user.lastLogin ? new Date(user.lastLogin).toLocaleDateString('zh-CN') : '从未登录',
        registerTimeFormatted: user.registerTime ? new Date(user.registerTime).toLocaleDateString('zh-CN') : '未知'
      };
    }).sort((a, b) => new Date(b.lastLogin || 0) - new Date(a.lastLogin || 0)); // 按最后登录时间倒序排序
    
    res.json({ success: true, data: enrichedUsers || [] });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

app.post('/api/admin/dishes', async (req, res) => {
  try {
    const { name, description, category, price, active = true, restaurantName, tags, imageUrl } = req.body;
    
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
      restaurantName: restaurantName || '',
      tags: tags || [],
      imageUrl: imageUrl || '/images/default-dish.jpg',
      rating: 0,
      active,
      status: 'active',
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
    const { name, description, category, price, active, restaurantName, tags, imageUrl } = req.body;
    
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
      restaurantName: restaurantName !== undefined ? restaurantName : dishes[dishIndex].restaurantName,
      tags: tags !== undefined ? tags : dishes[dishIndex].tags,
      imageUrl: imageUrl !== undefined ? imageUrl : dishes[dishIndex].imageUrl,
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

// 管理员API - 手动生成菜单（复制上周）
app.post('/api/admin/menu/generate', async (req, res) => {
  try {
    const result = await menuGenerator.generateWeeklyMenu();
    if (result) {
      res.json({ success: true, message: '菜单生成成功（复制上周）' });
    } else {
      res.json({ success: false, message: '菜单生成失败，请检查是否有可用菜品' });
    }
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// 管理员API - 手动生成智能菜单
app.post('/api/admin/menu/generate-smart', async (req, res) => {
  try {
    const result = await menuGenerator.generateSmartWeeklyMenu();
    if (result) {
      res.json({ success: true, message: '智能菜单生成成功' });
    } else {
      res.json({ success: false, message: '智能菜单生成失败，请检查是否有可用菜品' });
    }
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// 保存菜单草稿API
app.post('/api/admin/menu/save', async (req, res) => {
  try {
    const { type, menu, date, weekStart } = req.body;
    
    let result;
    if (type === 'daily') {
      // 保存单日菜单草稿
      const dailyDrafts = await dataStore.read('daily-drafts.json') || [];
      const existingIndex = dailyDrafts.findIndex(draft => draft.date === date);
      
      const draftData = {
        date: date,
        lunch: menu.lunch || [],
        dinner: menu.dinner || [],
        status: 'draft',
        savedAt: new Date().toISOString()
      };
      
      if (existingIndex !== -1) {
        dailyDrafts[existingIndex] = draftData;
      } else {
        dailyDrafts.push(draftData);
      }
      
      await dataStore.write('daily-drafts.json', dailyDrafts);
      result = { success: true, message: '单日菜单草稿保存成功' };
      
    } else if (type === 'weekly') {
      // 保存周菜单草稿
      const weeklyDrafts = await dataStore.read('weekly-drafts.json') || [];
      const existingIndex = weeklyDrafts.findIndex(draft => draft.weekStart === weekStart);
      
      const draftData = {
        weekStart: weekStart,
        menu: menu,
        status: 'draft',
        savedAt: new Date().toISOString()
      };
      
      if (existingIndex !== -1) {
        weeklyDrafts[existingIndex] = draftData;
      } else {
        weeklyDrafts.push(draftData);
      }
      
      await dataStore.write('weekly-drafts.json', weeklyDrafts);
      result = { success: true, message: '周菜单草稿保存成功' };
    }
    
    res.json(result);
  } catch (error) {
    console.error('保存菜单草稿失败:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// 获取菜单草稿API
app.get('/api/admin/menu/drafts', async (req, res) => {
  try {
    const { type, date, weekStart } = req.query;
    
    let result = null;
    
    if (type === 'daily' && date) {
      const dailyDrafts = await dataStore.read('daily-drafts.json') || [];
      result = dailyDrafts.find(draft => draft.date === date);
    } else if (type === 'weekly' && weekStart) {
      const weeklyDrafts = await dataStore.read('weekly-drafts.json') || [];
      result = weeklyDrafts.find(draft => draft.weekStart === weekStart);
    }
    
    res.json({ success: true, data: result });
  } catch (error) {
    console.error('获取菜单草稿失败:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// 发布菜单API
app.post('/api/admin/menu/publish', async (req, res) => {
  try {
    const { type, menu, date, weekStart } = req.body;
    
    let result;
    if (type === 'daily') {
      // 检查是否为完全空菜单
      const hasLunchMenu = menu.lunch && menu.lunch.length > 0;
      const hasDinnerMenu = menu.dinner && menu.dinner.length > 0;
      
      if (!hasLunchMenu && !hasDinnerMenu) {
        return res.status(400).json({ 
          success: false, 
          message: '不能发布完全空的菜单，请至少添加一个时段的菜品' 
        });
      }
      
      // 发布单日菜单
      const dailyOrders = await dataStore.read('daily-orders.json') || [];
      const existingIndex = dailyOrders.findIndex(order => order.date === date);
      
      const orderData = {
        date: date,
        lunch: menu.lunch || [],
        dinner: menu.dinner || [],
        status: 'open',
        publishedAt: new Date().toISOString()
      };
      
      if (existingIndex !== -1) {
        dailyOrders[existingIndex] = orderData;
      } else {
        dailyOrders.push(orderData);
      }
      
      await dataStore.write('daily-orders.json', dailyOrders);
      result = { success: true, message: '单日菜单发布成功' };
      
    } else if (type === 'weekly') {
      // 检查是否为完全空的周菜单
      const hasAnyMenu = Object.values(menu).some(dayMenu => 
        (dayMenu.lunch && dayMenu.lunch.length > 0) || 
        (dayMenu.dinner && dayMenu.dinner.length > 0)
      );
      
      if (!hasAnyMenu) {
        return res.status(400).json({ 
          success: false, 
          message: '不能发布完全空的周菜单，请至少添加一天的菜品' 
        });
      }
      
      // 发布周菜单
      const weeklyMenus = await dataStore.read('weekly-menus.json') || [];
      const existingIndex = weeklyMenus.findIndex(w => w.weekStart === weekStart);
      
      const weekMenuData = {
        weekStart: weekStart,
        menu: menu,
        publishedAt: new Date().toISOString(),
        status: 'published'
      };
      
      if (existingIndex !== -1) {
        weeklyMenus[existingIndex] = weekMenuData;
      } else {
        weeklyMenus.push(weekMenuData);
      }
      
      await dataStore.write('weekly-menus.json', weeklyMenus);
      
      // 同时更新daily-orders.json
      const dailyOrders = await dataStore.read('daily-orders.json') || [];
      const weekDays = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'sunday'];
      
      weekDays.forEach((day, index) => {
        const dayMenu = menu[day];
        if (dayMenu) {
          const dayDate = new Date(weekStart);
          dayDate.setDate(dayDate.getDate() + index);
          const dateStr = dayDate.toISOString().split('T')[0];
          
          const existingDayIndex = dailyOrders.findIndex(order => order.date === dateStr);
          
          // 转换餐厅格式为菜品数组格式
          const convertRestaurantMenuToDishArray = (mealData) => {
            console.log('转换餐厅菜单格式，输入数据:', JSON.stringify(mealData, null, 2));
            if (!mealData || !Array.isArray(mealData)) {
              console.log('输入数据无效，返回空数组');
              return [];
            }
            
            const dishes = [];
            mealData.forEach(restaurantMenu => {
              console.log('处理餐厅菜单:', restaurantMenu.restaurantName);
              if (restaurantMenu.dishes && Array.isArray(restaurantMenu.dishes)) {
                console.log('餐厅菜品数量:', restaurantMenu.dishes.length);
                restaurantMenu.dishes.forEach(dish => {
                  const dishData = {
                    dishId: dish.id,
                    dishName: dish.name,
                    restaurantName: dish.restaurantName,
                    rating: dish.rating || 0,
                    imageUrl: dish.imageUrl || '/images/default-dish.jpg',
                    tags: dish.tags || []
                  };
                  console.log('转换菜品:', dishData);
                  dishes.push(dishData);
                });
              } else {
                console.log('餐厅菜品数组无效');
              }
            });
            console.log('转换结果，菜品总数:', dishes.length);
            return dishes;
          };
          
          const dayOrderData = {
            date: dateStr,
            lunch: convertRestaurantMenuToDishArray(dayMenu.lunch),
            dinner: convertRestaurantMenuToDishArray(dayMenu.dinner),
            status: 'open',
            publishedAt: new Date().toISOString()
          };
          
          if (existingDayIndex !== -1) {
            dailyOrders[existingDayIndex] = dayOrderData;
          } else {
            dailyOrders.push(dayOrderData);
          }
        }
      });
      
      await dataStore.write('daily-orders.json', dailyOrders);
      result = { success: true, message: '周菜单发布成功' };
    }
    
    res.json(result);
  } catch (error) {
    console.error('发布菜单失败:', error);
    res.status(500).json({ success: false, message: '发布菜单失败: ' + error.message });
  }
});

// 更新当前菜单API
app.post('/api/admin/menu/update', async (req, res) => {
  try {
    const { lunch, dinner, date } = req.body;
    
    console.log('收到更新菜单请求:', { lunch, dinner, date });
    
    if (!date) {
      return res.status(400).json({ 
        success: false, 
        message: '缺少日期参数' 
      });
    }
    
    const dailyOrders = await dataStore.read('daily-orders.json') || [];
    const existingIndex = dailyOrders.findIndex(order => order.date === date);
    
    const orderData = {
      date: date,
      lunch: lunch || [],
      dinner: dinner || [],
      status: 'open',
      publishedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    
    if (existingIndex !== -1) {
      // 更新现有菜单，保留publishedAt时间
      orderData.publishedAt = dailyOrders[existingIndex].publishedAt;
      dailyOrders[existingIndex] = orderData;
    } else {
      // 新建菜单
      dailyOrders.push(orderData);
    }
    
    await dataStore.write('daily-orders.json', dailyOrders);
    
    console.log('菜单更新成功');
    res.json({ 
      success: true, 
      message: '菜单更新成功',
      data: orderData
    });
    
  } catch (error) {
    console.error('更新菜单失败:', error);
    res.status(500).json({ 
      success: false, 
      message: '更新菜单失败: ' + error.message 
    });
  }
});

// 获取所有daily-orders数据的API (管理员专用)
app.get('/api/admin/daily-orders', async (req, res) => {
  try {
    const dailyOrders = await dataStore.read('daily-orders.json') || [];
    res.json({
      success: true,
      data: dailyOrders
    });
  } catch (error) {
    console.error('获取daily-orders数据失败:', error);
    res.status(500).json({
      success: false,
      message: '获取数据失败: ' + error.message
    });
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

    // 检查时间限制：登记截止时间是该餐当天的时间
    const now = moment();
    const targetDate = moment(date);
    const currentHour = now.hour();
    
    // 检查是否已经过了该餐的截止时间
    // 午餐截止时间：目标日期当天11点
    if (mealType === 'lunch') {
      const lunchDeadline = moment(date).hour(11).minute(0).second(0);
      if (now.isAfter(lunchDeadline)) {
        const dateStr = targetDate.format('MM月DD日');
        return res.status(400).json({
          success: false,
          message: `${dateStr}午餐登记时间已截止（${dateStr}11点后不可登记）`
        });
      }
    }
    
    // 晚餐截止时间：目标日期当天17点
    if (mealType === 'dinner') {
      const dinnerDeadline = moment(date).hour(17).minute(0).second(0);
      if (now.isAfter(dinnerDeadline)) {
        const dateStr = targetDate.format('MM月DD日');
        return res.status(400).json({
          success: false,
          message: `${dateStr}晚餐登记时间已截止（${dateStr}17点后不可登记）`
        });
      }
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
    await orderManager.updateOrderCount(mealType, date);

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

// 每天 20:00 推送次日菜单
cron.schedule('0 20 * * 0-4', async () => {
  console.log('执行定时任务: 推送次日菜单到飞书群');
  try {
    await pushTomorrowMenu();
  } catch (error) {
    console.error('推送次日菜单失败:', error);
  }
});

// =================== 餐厅投稿相关接口 ===================

// 提交餐厅投稿
app.post('/api/restaurant-suggestions/submit', async (req, res) => {
  try {
    const { restaurantName, submitterName, reason, imageUrl } = req.body;

    if (!restaurantName || !submitterName) {
      return res.status(400).json({
        success: false,
        message: '餐厅名称和投稿人姓名不能为空'
      });
    }

    const suggestions = await dataStore.read('restaurant-suggestions.json');
    
    const newSuggestion = {
      id: dataStore.generateId(suggestions),
      restaurantName: restaurantName.trim(),
      submitterName: submitterName.trim(),
      reason: reason ? reason.trim() : '',
      imageUrl: imageUrl ? imageUrl.trim() : '',
      submittedAt: moment().toISOString(),
      likes: 0,
      likedBy: []
    };

    suggestions.push(newSuggestion);
    await dataStore.write('restaurant-suggestions.json', suggestions);

    res.json({
      success: true,
      message: '餐厅投稿提交成功！',
      data: newSuggestion
    });

  } catch (error) {
    console.error('提交餐厅投稿失败:', error);
    res.status(500).json({
      success: false,
      message: '提交失败，请重试'
    });
  }
});

// 获取餐厅投稿列表
app.get('/api/restaurant-suggestions/list', async (req, res) => {
  try {
    const suggestions = await dataStore.read('restaurant-suggestions.json');
    
    // 按点赞数降序，然后按提交时间降序排列
    const sortedSuggestions = suggestions.sort((a, b) => {
      if (b.likes !== a.likes) {
        return b.likes - a.likes;
      }
      return new Date(b.submittedAt) - new Date(a.submittedAt);
    });

    res.json({
      success: true,
      data: sortedSuggestions
    });

  } catch (error) {
    console.error('获取餐厅投稿列表失败:', error);
    res.status(500).json({
      success: false,
      message: '获取列表失败，请重试'
    });
  }
});

// 为餐厅投稿点赞
app.post('/api/restaurant-suggestions/vote', async (req, res) => {
  try {
    const { suggestionId, voterName } = req.body;

    if (!suggestionId || !voterName) {
      return res.status(400).json({
        success: false,
        message: '投稿ID和点赞人姓名不能为空'
      });
    }

    const suggestions = await dataStore.read('restaurant-suggestions.json');
    const suggestion = suggestions.find(s => s.id === suggestionId);

    if (!suggestion) {
      return res.status(404).json({
        success: false,
        message: '投稿不存在'
      });
    }

    // 检查是否已经点过赞
    if (suggestion.likedBy.includes(voterName.trim())) {
      return res.status(400).json({
        success: false,
        message: '您已经支持过这家餐厅了！'
      });
    }

    // 添加点赞
    suggestion.likedBy.push(voterName.trim());
    suggestion.likes = suggestion.likedBy.length;

    await dataStore.write('restaurant-suggestions.json', suggestions);

    res.json({
      success: true,
      message: '支持成功！',
      data: {
        suggestionId,
        likes: suggestion.likes,
        hasVoted: true
      }
    });

  } catch (error) {
    console.error('点赞失败:', error);
    res.status(500).json({
      success: false,
      message: '支持失败，请重试'
    });
  }
});

// 检查用户是否已对某投稿点赞
app.get('/api/restaurant-suggestions/check-vote/:suggestionId/:voterName', async (req, res) => {
  try {
    const { suggestionId, voterName } = req.params;

    const suggestions = await dataStore.read('restaurant-suggestions.json');
    const suggestion = suggestions.find(s => s.id === parseInt(suggestionId));

    if (!suggestion) {
      return res.status(404).json({
        success: false,
        message: '投稿不存在'
      });
    }

    const hasVoted = suggestion.likedBy.includes(voterName);

    res.json({
      success: true,
      data: {
        hasVoted,
        likes: suggestion.likes
      }
    });

  } catch (error) {
    console.error('检查点赞状态失败:', error);
    res.status(500).json({
      success: false,
      message: '检查失败，请重试'
    });
  }
});

// =================== 飞书OAuth认证路由 ===================

// 生成随机state用于CSRF防护
function generateState() {
  return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
}

// 飞书登录 - 重定向到飞书授权页面
app.get('/auth/feishu', (req, res) => {
  const state = generateState();
  req.session.oauthState = state;
  
  const authUrl = `${FEISHU_CONFIG.AUTHORIZATION_URL}?` +
    `client_id=${FEISHU_CONFIG.APP_ID}&` +
    `redirect_uri=${encodeURIComponent(FEISHU_CONFIG.getRedirectUri(req))}&` +
    `response_type=code&` +
    `scope=${encodeURIComponent(FEISHU_CONFIG.SCOPE)}&` +
    `state=${state}`;
  
  console.log('重定向到飞书授权页面:', authUrl);
  console.log('回调URL:', FEISHU_CONFIG.getRedirectUri(req));
  console.log('APP_ID:', FEISHU_CONFIG.APP_ID);
  res.redirect(authUrl);
});

// 飞书授权回调
app.get('/auth/feishu/callback', async (req, res) => {
  const { code, state, error } = req.query;
  
  try {
    // 如果用户拒绝授权
    if (error) {
      console.log('用户拒绝授权:', error);
      return res.redirect('/login?error=access_denied&message=用户拒绝授权');
    }
    
    // 检查授权码
    if (!code) {
      console.log('回调缺少授权码');
      return res.redirect('/login?error=no_code&message=授权码缺失');
    }
    
    // 验证state防止CSRF攻击 (但允许session过期的情况)
    if (state && req.session.oauthState && state !== req.session.oauthState) {
      console.log('State参数不匹配:', { received: state, expected: req.session.oauthState });
      return res.redirect('/login?error=invalid_state&message=安全验证失败，请重新登录');
    }
    
    console.log('收到飞书回调，code:', code, 'state:', state);
    
    // 第一步：获取app access token
    const appTokenResponse = await axios.post('https://open.feishu.cn/open-apis/auth/v3/app_access_token/internal', {
      app_id: FEISHU_CONFIG.APP_ID,
      app_secret: FEISHU_CONFIG.APP_SECRET
    }, {
      headers: {
        'Content-Type': 'application/json; charset=utf-8'
      }
    });
    
    if (appTokenResponse.data.code !== 0) {
      console.error('获取app access token失败:', appTokenResponse.data);
      return res.redirect('/login?error=app_token_failed&message=应用认证失败');
    }
    
    const appAccessToken = appTokenResponse.data.app_access_token;
    console.log('获取到app access token');
    
    // 第二步：使用app access token获取用户access token
    const tokenResponse = await axios.post(FEISHU_CONFIG.TOKEN_URL, {
      grant_type: 'authorization_code',
      code: code
    }, {
      headers: {
        'Authorization': `Bearer ${appAccessToken}`,
        'Content-Type': 'application/json'
      }
    });
    
    if (tokenResponse.data.code !== 0) {
      console.error('获取token失败:', tokenResponse.data);
      return res.status(400).send('Failed to get access token');
    }
    
    const { access_token } = tokenResponse.data.data;
    
    // 获取用户信息
    const userResponse = await axios.get(FEISHU_CONFIG.USER_INFO_URL, {
      headers: {
        'Authorization': `Bearer ${access_token}`
      }
    });
    
    if (userResponse.data.code !== 0) {
      console.error('获取用户信息失败:', userResponse.data);
      return res.status(400).send('Failed to get user info');
    }
    
    const userInfo = userResponse.data.data;
    console.log('飞书用户信息:', userInfo);
    
    const userId = userInfo.union_id || userInfo.user_id;
    
    // 保存或更新用户信息到数据库
    const userData = await dataStore.saveOrUpdateUser({
      id: userId,
      name: userInfo.name,
      avatar: userInfo.avatar_url || userInfo.avatar_thumb,
      email: userInfo.email,
      mobile: userInfo.mobile
    });
    
    // 获取用户角色
    const userRole = await dataStore.getUserRole(userId);
    
    // 保存用户信息到session
    req.session.user = {
      id: userId,
      name: userInfo.name,
      avatar: userInfo.avatar_url || userInfo.avatar_thumb,
      email: userInfo.email,
      mobile: userInfo.mobile,
      role: userRole,
      loginTime: new Date().toISOString(),
      accessToken: access_token
    };
    
    // 清除OAuth state
    delete req.session.oauthState;
    
    // 根据用户角色重定向到对应页面
    if (userRole === 'admin') {
      res.redirect('/admin-dashboard.html?login=success');
    } else {
      res.redirect('/user-dashboard.html?login=success');
    }
    
  } catch (error) {
    console.error('飞书OAuth回调错误:', error);
    
    // 根据错误类型提供更详细的错误信息
    let errorMessage = '登录失败，请重试';
    if (error.response) {
      const { status, data } = error.response;
      console.error('API错误响应:', { status, data });
      
      if (status === 400) {
        errorMessage = '授权参数错误，请重新登录';
      } else if (status === 401) {
        errorMessage = '应用认证失败，请联系管理员';
      } else if (status >= 500) {
        errorMessage = '飞书服务暂时不可用，请稍后重试';
      }
    } else if (error.code === 'ENOTFOUND') {
      errorMessage = '网络连接失败，请检查网络设置';
    }
    
    res.redirect(`/login?error=oauth_error&message=${encodeURIComponent(errorMessage)}`);
  }
});

// 获取当前登录用户信息
app.get('/api/auth/user', (req, res) => {
  if (req.session.user) {
    res.json({
      success: true,
      data: {
        id: req.session.user.id,
        name: req.session.user.name,
        avatar: req.session.user.avatar,
        email: req.session.user.email,
        role: req.session.user.role,
        loginTime: req.session.user.loginTime
      }
    });
  } else {
    res.json({
      success: false,
      message: '用户未登录'
    });
  }
});

// 退出登录
app.post('/api/auth/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      return res.status(500).json({
        success: false,
        message: '退出登录失败'
      });
    }
    
    res.json({
      success: true,
      message: '已成功退出登录'
    });
  });
});

// =================== 用户管理 API ===================

// 获取所有用户列表（管理员权限）
app.get('/api/admin/users', requireAdminAuth, async (req, res) => {
  try {
    const userRoles = await dataStore.getAllUserRoles();
    res.json({
      success: true,
      data: userRoles
    });
  } catch (error) {
    console.error('获取用户列表失败:', error);
    res.status(500).json({
      success: false,
      message: '获取用户列表失败'
    });
  }
});

// 设置用户角色（管理员权限）
app.put('/api/admin/users/:userId/role', requireAdminAuth, async (req, res) => {
  try {
    const { userId } = req.params;
    const { role } = req.body;
    
    if (!userId || !role) {
      return res.status(400).json({
        success: false,
        message: '缺少必要参数'
      });
    }
    
    if (!['admin', 'user'].includes(role)) {
      return res.status(400).json({
        success: false,
        message: '无效的角色类型'
      });
    }
    
    // 检查是否为默认管理员
    const roleData = await dataStore.read('user-roles.json') || { defaultAdmins: [], users: {} };
    if (roleData.defaultAdmins && roleData.defaultAdmins.includes(userId)) {
      return res.status(400).json({
        success: false,
        message: '不能修改默认管理员的角色'
      });
    }
    
    const success = await dataStore.setUserRole(userId, role);
    if (!success) {
      return res.status(500).json({
        success: false,
        message: '设置用户角色失败'
      });
    }
    
    res.json({
      success: true,
      message: '用户角色设置成功',
      data: { userId, role }
    });
  } catch (error) {
    console.error('设置用户角色失败:', error);
    res.status(500).json({
      success: false,
      message: '设置用户角色失败'
    });
  }
});

// 获取用户角色配置（管理员权限）
app.get('/api/admin/user-roles-config', requireAdminAuth, async (req, res) => {
  try {
    const roleData = await dataStore.read('user-roles.json') || { defaultAdmins: [], users: {} };
    res.json({
      success: true,
      data: roleData
    });
  } catch (error) {
    console.error('获取角色配置失败:', error);
    res.status(500).json({
      success: false,
      message: '获取角色配置失败'
    });
  }
});

// 权限验证中间件
function requireAuth(req, res, next) {
  if (!req.session.user) {
    return res.status(401).json({
      success: false,
      message: '请先登录',
      code: 'UNAUTHORIZED'
    });
  }
  next();
}

// 页面权限验证中间件
function requireAuthPage(req, res, next) {
  if (!req.session.user) {
    // 重定向到登录页面
    return res.redirect('/login?error=unauthorized');
  }
  next();
}

// 管理员权限验证中间件
async function requireAdminAuth(req, res, next) {
  try {
    if (!req.session.user) {
      return res.status(401).json({
        success: false,
        message: '请先登录',
        code: 'UNAUTHORIZED'
      });
    }

    const userRole = await dataStore.getUserRole(req.session.user.id);
    if (userRole !== 'admin') {
      return res.status(403).json({
        success: false,
        message: '需要管理员权限',
        code: 'FORBIDDEN'
      });
    }

    // 在请求对象中存储用户角色信息
    req.userRole = userRole;
    next();
  } catch (error) {
    console.error('权限验证失败:', error);
    return res.status(500).json({
      success: false,
      message: '权限验证失败',
      code: 'INTERNAL_ERROR'
    });
  }
}

// 管理员页面权限验证中间件
async function requireAdminPage(req, res, next) {
  try {
    if (!req.session.user) {
      return res.redirect('/login?error=unauthorized');
    }

    const userRole = await dataStore.getUserRole(req.session.user.id);
    if (userRole !== 'admin') {
      return res.redirect('/user-dashboard.html?error=forbidden');
    }

    next();
  } catch (error) {
    console.error('页面权限验证失败:', error);
    return res.redirect('/login?error=server_error');
  }
}

// =================== 页面路由 ===================

// 登录页面 - 无需验证
app.get('/login', (req, res) => {
  // 如果已登录，重定向到首页
  if (req.session.user) {
    return res.redirect('/');
  }
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// 用户中心页面 - 无需验证，内部自己处理登录状态
app.get('/user-dashboard.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'user-dashboard.html'));
});

// 管理页面 - 需要验证
app.get('/admin.html', requireAuthPage, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// 切换菜品状态
app.put('/api/admin/dishes/:id/status', async (req, res) => {
  try {
    const dishId = parseInt(req.params.id);
    const { status } = req.body;
    
    const dishes = await dataStore.read('dishes.json');
    const dishIndex = dishes.findIndex(d => d.id === dishId);
    
    if (dishIndex === -1) {
      return res.status(404).json({ success: false, message: '菜品不存在' });
    }
    
    dishes[dishIndex].status = status;
    dishes[dishIndex].active = status === 'active';
    dishes[dishIndex].updatedAt = moment().toISOString();
    
    await dataStore.write('dishes.json', dishes);
    res.json({ success: true, data: dishes[dishIndex] });
  } catch (error) {
    console.error('切换菜品状态失败:', error);
    res.status(500).json({ success: false, message: '操作失败' });
  }
});

// 批量禁用菜品
app.put('/api/admin/dishes/batch/disable', async (req, res) => {
  try {
    const { dishIds } = req.body;
    
    if (!Array.isArray(dishIds) || dishIds.length === 0) {
      return res.status(400).json({ success: false, message: '请选择要禁用的菜品' });
    }
    
    const dishes = await dataStore.read('dishes.json');
    let updatedCount = 0;
    
    dishIds.forEach(dishId => {
      const dishIndex = dishes.findIndex(d => d.id === parseInt(dishId));
      if (dishIndex !== -1) {
        dishes[dishIndex].status = 'inactive';
        dishes[dishIndex].active = false;
        dishes[dishIndex].updatedAt = moment().toISOString();
        updatedCount++;
      }
    });
    
    await dataStore.write('dishes.json', dishes);
    res.json({ success: true, updatedCount });
  } catch (error) {
    console.error('批量禁用菜品失败:', error);
    res.status(500).json({ success: false, message: '批量操作失败' });
  }
});

// ===== 餐厅投稿墙 API =====

// 图片上传API
app.post('/api/upload/submission', upload.single('image'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: '请选择图片文件' });
    }
    
    const imageUrl = `/uploads/submissions/${req.file.filename}`;
    res.json({ success: true, imageUrl });
  } catch (error) {
    console.error('图片上传失败:', error);
    res.status(500).json({ success: false, message: '图片上传失败' });
  }
});

// 获取投稿列表
app.get('/api/submissions', async (req, res) => {
  try {
    const { sortBy = 'time' } = req.query; // 排序方式: 'time' 或 'likes'
    
    const submissions = await dataStore.read('restaurant-submissions.json') || [];
    const likes = await dataStore.read('submission-likes.json') || [];
    
    // 计算每个投稿的点赞数
    const submissionsWithLikes = submissions.map(submission => {
      const submissionLikes = likes.filter(like => like.submissionId === submission.id);
      return {
        ...submission,
        likeCount: submissionLikes.length,
        likedByCurrentUser: false // 前端根据用户ID计算
      };
    });
    
    // 排序
    if (sortBy === 'likes') {
      submissionsWithLikes.sort((a, b) => b.likeCount - a.likeCount);
    } else {
      submissionsWithLikes.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    }
    
    res.json(submissionsWithLikes);
  } catch (error) {
    console.error('获取投稿列表失败:', error);
    res.status(500).json({ success: false, message: '获取投稿列表失败' });
  }
});

// 点赞/取消点赞
app.post('/api/submissions/:id/like', async (req, res) => {
  try {
    const submissionId = parseInt(req.params.id);
    const { userId, action } = req.body; // action: 'like' 或 'unlike'
    
    if (!userId) {
      return res.status(400).json({ success: false, message: '用户ID不能为空' });
    }
    
    const likes = await dataStore.read('submission-likes.json') || [];
    
    if (action === 'like') {
      // 检查是否已点赞
      const existingLike = likes.find(like => 
        like.submissionId === submissionId && like.userId === userId
      );
      
      if (!existingLike) {
        const newLike = {
          id: dataStore.generateId(likes),
          submissionId,
          userId,
          createdAt: moment().toISOString()
        };
        likes.push(newLike);
        await dataStore.write('submission-likes.json', likes);
      }
    } else if (action === 'unlike') {
      const filteredLikes = likes.filter(like => 
        !(like.submissionId === submissionId && like.userId === userId)
      );
      await dataStore.write('submission-likes.json', filteredLikes);
    }
    
    // 返回新的点赞数
    const newLikes = await dataStore.read('submission-likes.json') || [];
    const likeCount = newLikes.filter(like => like.submissionId === submissionId).length;
    
    res.json({ success: true, likeCount });
  } catch (error) {
    console.error('点赞操作失败:', error);
    res.status(500).json({ success: false, message: '点赞操作失败' });
  }
});

// 新增投稿
app.post('/api/submissions', async (req, res) => {
  try {
    const { restaurantName, dishName, tags, imageUrl, description, userId, userName } = req.body;
    
    if (!restaurantName || !dishName || !userId) {
      return res.status(400).json({ success: false, message: '餐厅名称、菜品名称和用户ID不能为空' });
    }
    
    const submissions = await dataStore.read('restaurant-submissions.json') || [];
    const restaurants = await dataStore.read('restaurants.json') || [];
    const dishes = await dataStore.read('dishes.json') || [];
    
    const newSubmission = {
      id: dataStore.generateId(submissions),
      restaurantName,
      dishName,
      tags: tags || [],
      imageUrl: imageUrl || '/images/default-dish.jpg',
      description: description || '',
      userId,
      userName,
      createdAt: moment().toISOString()
    };
    
    submissions.push(newSubmission);
    await dataStore.write('restaurant-submissions.json', submissions);
    
    // 自动添加餐厅到数据库（如果不存在）
    const existingRestaurant = restaurants.find(r => r.name === restaurantName);
    if (!existingRestaurant) {
      const newRestaurant = {
        id: dataStore.generateId(restaurants),
        name: restaurantName,
        address: '',
        phone: '',
        description: `来自用户投稿: ${dishName}`,
        rating: 0,
        imageUrl: '/images/default-restaurant.jpg',
        tags: [],
        status: 'active',
        createdAt: moment().toISOString()
      };
      restaurants.push(newRestaurant);
      await dataStore.write('restaurants.json', restaurants);
      
      // 添加菜品到数据库
      const newDish = {
        id: dataStore.generateId(dishes),
        name: dishName,
        description: description || '',
        category: '其他',
        price: 0,
        restaurantId: newRestaurant.id,
        imageUrl: imageUrl || '/images/default-dish.jpg',
        rating: 0,
        mealType: 'lunch',
        active: false, // 投稿的菜品默认不激活，需要管理员审核
        tags: tags || [],
        status: 'pending', // 待审核状态
        restaurantName: restaurantName,
        createdAt: moment().toISOString(),
        updatedAt: moment().toISOString()
      };
      dishes.push(newDish);
      await dataStore.write('dishes.json', dishes);
    }
    
    res.json({ success: true, submission: newSubmission });
  } catch (error) {
    console.error('新增投稿失败:', error);
    res.status(500).json({ success: false, message: '新增投稿失败' });
  }
});

// 删除投稿
app.delete('/api/submissions/:id', async (req, res) => {
  try {
    const submissionId = parseInt(req.params.id);
    const { userId } = req.body;
    
    if (!userId) {
      return res.status(400).json({ success: false, message: '用户ID不能为空' });
    }
    
    const submissions = await dataStore.read('restaurant-submissions.json') || [];
    const submission = submissions.find(s => s.id === submissionId);
    
    if (!submission) {
      return res.status(404).json({ success: false, message: '投稿不存在' });
    }
    
    // 只能删除自己的投稿
    if (submission.userId !== userId) {
      return res.status(403).json({ success: false, message: '只能删除自己的投稿' });
    }
    
    const filteredSubmissions = submissions.filter(s => s.id !== submissionId);
    await dataStore.write('restaurant-submissions.json', filteredSubmissions);
    
    // 删除相关的点赞记录
    const likes = await dataStore.read('submission-likes.json') || [];
    const filteredLikes = likes.filter(like => like.submissionId !== submissionId);
    await dataStore.write('submission-likes.json', filteredLikes);
    
    res.json({ success: true });
  } catch (error) {
    console.error('删除投稿失败:', error);
    res.status(500).json({ success: false, message: '删除投稿失败' });
  }
});

// ============= 评价系统相关API =============

// 获取可评价的菜品（基于用户订单历史）
app.get('/api/ratings/ratable-dishes', async (req, res) => {
  try {
    const { userId } = req.query;
    
    // 获取用户的订单历史
    const dailyOrders = await dataStore.read('daily-orders.json') || [];
    const userOrders = [];
    
    // 收集用户的所有点餐记录
    dailyOrders.forEach(order => {
      ['lunch', 'dinner'].forEach(period => {
        if (order[period]) {
          order[period].forEach(dish => {
            if (dish.orders && dish.orders.some(o => o.userId === userId && o.status === 'eat')) {
              userOrders.push({
                id: `${order.date}-${period}-${dish.name}`,
                name: dish.name,
                restaurant: dish.restaurant || '未知餐厅',
                date: order.date,
                period: period,
                orderedAt: order.publishedAt
              });
            }
          });
        }
      });
    });
    
    // 获取已评价的菜品
    const ratings = await dataStore.read('dish-ratings.json') || [];
    const ratedDishIds = ratings
      .filter(rating => rating.userId === userId)
      .map(rating => rating.dishId);
    
    // 过滤出未评价的菜品
    const ratableDishes = userOrders.filter(dish => !ratedDishIds.includes(dish.id));
    
    res.json({
      success: true,
      data: ratableDishes
    });
  } catch (error) {
    console.error('获取可评价菜品失败:', error);
    res.status(500).json({ success: false, message: '获取可评价菜品失败' });
  }
});

// 获取菜品评价列表
app.get('/api/ratings', async (req, res) => {
  try {
    const { sort = 'time' } = req.query;
    
    // 读取评价数据
    const ratings = await dataStore.read('dish-ratings.json') || [];
    const likes = await dataStore.read('rating-likes.json') || [];
    
    // 为每个评价计算点赞数和点赞状态，并添加餐厅名称
    const ratingsWithLikes = ratings.map(rating => {
      const ratingLikes = likes.filter(like => like.ratingId === rating.id);
      
      // 从dishName中提取餐厅名和菜品名（格式：餐厅名 - 菜品名）
      let restaurantName = '未知餐厅';
      let dishName = rating.dishName || '未知菜品';
      
      if (rating.dishName && rating.dishName.includes(' - ')) {
        const parts = rating.dishName.split(' - ');
        restaurantName = parts[0];
        dishName = parts[1] || dishName;
      }
      
      return {
        ...rating,
        restaurantName,
        dishName,
        score: rating.rating, // 统一字段名
        comment: rating.comment,
        timestamp: rating.createdAt,
        likeCount: ratingLikes.length,
        likes: ratingLikes
      };
    });
    
    // 排序
    let sortedRatings = ratingsWithLikes;
    if (sort === 'time') {
      sortedRatings = ratingsWithLikes.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    } else if (sort === 'likes') {
      sortedRatings = ratingsWithLikes.sort((a, b) => b.likeCount - a.likeCount);
    }
    
    res.json({
      success: true,
      data: sortedRatings
    });
  } catch (error) {
    console.error('获取评价列表失败:', error);
    res.status(500).json({ success: false, message: '获取评价列表失败' });
  }
});

// 提交菜品评价
app.post('/api/ratings', async (req, res) => {
  try {
    const { dishId, dishName, rating, comment, userId, userName } = req.body;
    
    if (!dishId || !dishName || !rating || !comment || !userId || !userName) {
      return res.status(400).json({ success: false, message: '缺少必要参数' });
    }
    
    if (rating < 1 || rating > 5) {
      return res.status(400).json({ success: false, message: '评分必须在1-5之间' });
    }
    
    // 检查是否已经评价过此菜品
    const existingRatings = await dataStore.read('dish-ratings.json') || [];
    const hasRated = existingRatings.some(r => r.dishId === dishId && r.userId === userId);
    
    if (hasRated) {
      return res.status(400).json({ success: false, message: '您已经评价过此菜品' });
    }
    
    // 生成新的评价记录
    const newRating = {
      id: Date.now(),
      dishId,
      dishName,
      rating,
      comment,
      userId,
      userName,
      createdAt: new Date().toISOString()
    };
    
    existingRatings.push(newRating);
    await dataStore.write('dish-ratings.json', existingRatings);
    
    res.json({ success: true, data: newRating });
  } catch (error) {
    console.error('提交评价失败:', error);
    res.status(500).json({ success: false, message: '提交评价失败' });
  }
});

// 点赞/取消点赞评价
app.post('/api/ratings/like', async (req, res) => {
  try {
    const { ratingId, userId } = req.body;
    
    if (!ratingId || !userId) {
      return res.status(400).json({ success: false, message: '缺少必要参数' });
    }
    
    // 读取点赞数据
    const likes = await dataStore.read('rating-likes.json') || [];
    
    // 检查是否已点赞
    const existingLikeIndex = likes.findIndex(like => 
      like.ratingId === ratingId && like.userId === userId
    );
    
    if (existingLikeIndex !== -1) {
      // 取消点赞
      likes.splice(existingLikeIndex, 1);
    } else {
      // 添加点赞
      const newLike = {
        id: Date.now(),
        ratingId,
        userId,
        createdAt: new Date().toISOString()
      };
      likes.push(newLike);
    }
    
    await dataStore.write('rating-likes.json', likes);
    
    // 计算当前点赞数
    const likesCount = likes.filter(like => like.ratingId === ratingId).length;
    
    res.json({ 
      success: true, 
      data: { 
        likesCount,
        hasLiked: existingLikeIndex === -1
      } 
    });
  } catch (error) {
    console.error('点赞操作失败:', error);
    res.status(500).json({ success: false, message: '点赞操作失败' });
  }
});

// 管理员删除评价
app.delete('/api/admin/ratings/:ratingId', requireAdminAuth, async (req, res) => {
  try {
    const { ratingId } = req.params;
    
    if (!ratingId) {
      return res.status(400).json({ success: false, message: '缺少评价ID' });
    }
    
    // 读取评价数据
    const ratings = await dataStore.read('dish-ratings.json') || [];
    
    // 查找要删除的评价
    const ratingIndex = ratings.findIndex(rating => rating.id == ratingId);
    
    if (ratingIndex === -1) {
      return res.status(404).json({ success: false, message: '评价不存在' });
    }
    
    // 删除评价
    const deletedRating = ratings.splice(ratingIndex, 1)[0];
    await dataStore.write('dish-ratings.json', ratings);
    
    // 同时删除相关的点赞记录
    const likes = await dataStore.read('rating-likes.json') || [];
    const updatedLikes = likes.filter(like => like.ratingId != ratingId);
    await dataStore.write('rating-likes.json', updatedLikes);
    
    res.json({ 
      success: true, 
      message: '评价删除成功',
      data: deletedRating
    });
  } catch (error) {
    console.error('删除评价失败:', error);
    res.status(500).json({ success: false, message: '删除评价失败' });
  }
});

// 新版管理员界面 - 无需验证，内部处理认证状态
app.get('/admin-dashboard.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin-dashboard.html'));
});

// 首页和其他页面 - 需要验证
app.get('/', (req, res) => {
  res.redirect('/user-dashboard.html');
});

// 静态资源 - 无需验证（CSS, JS, 图片等），但不包括 HTML 文件
app.use('/css', express.static(path.join(__dirname, 'public/css')));
app.use('/js', express.static(path.join(__dirname, 'public/js')));
app.use('/images', express.static(path.join(__dirname, 'public/images')));
app.use('/assets', express.static(path.join(__dirname, 'public/assets')));
app.use('/uploads', express.static(path.join(__dirname, 'public/uploads')));

// 捕获所有其他路由 - 重定向到用户中心页面
app.get('*', (req, res) => {
  res.redirect('/user-dashboard.html');
});

// 启动服务器
app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🚀 订餐系统启动成功!`);
  console.log(`📱 本机访问: http://localhost:${PORT}`);
  console.log(`🌐 局域网访问: http://100.100.192.158:${PORT}`);
  console.log(`🤖 机器人API: http://localhost:${PORT}/api/bot`);
  console.log(`⏰ 定时任务已设置:`);
  console.log(`   - 每周一 09:00 生成菜单`);
  console.log(`   - 每天 10:00 开放午餐登记`);
  console.log(`   - 每天 16:00 开放晚餐登记`);
  console.log(`   - 每天 20:00 推送次日菜单\n`);
});