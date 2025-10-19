// Load environment variables early
try {
  const dotenv = require('dotenv');
  const envFile = (process.env.NODE_ENV === 'production') ? '.env.production' : '.env';
  dotenv.config({ path: envFile });
  console.log(`[env] Loaded ${envFile}. FEISHU_LONG_CONN_ENABLED=${process.env.FEISHU_LONG_CONN_ENABLED || 'false'}`);
} catch (e) {
  console.warn('[env] dotenv not loaded:', e.message);
}

// 获取基础URL的工具函数
function getBaseUrl() {
  const port = process.env.PORT || 3000;
  return process.env.SERVER_DOMAIN ? `http://${process.env.SERVER_DOMAIN}:${port}` : `http://localhost:${port}`;
}

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
console.log(`[feishu] LONG_CONN=${process.env.FEISHU_LONG_CONN_ENABLED || 'false'}, APP_ID set=${Boolean(process.env.APP_ID || process.env.FEISHU_APP_ID)}`);
let feishuAppBot = null;
try {
  const { FeishuAppBot, buildNoEatCard } = require('./libs/feishu-app-bot');
  feishuAppBot = new FeishuAppBot(FEISHU_CONFIG);
  global.__buildNoEatCard = buildNoEatCard;
} catch (e) {
  console.warn('Feishu AppBot helper not available:', e.message);
}
// 尝试加载长连接兼容启动器，并避免调用旧的 startLongConnection
try {
  const { startFeishuLongConnection, sendMessageViaLongConnection, getChatId } = require('./libs/feishu-longconn');
  global.__startFeishuLongConnection = startFeishuLongConnection;
  global.__sendMessageViaLongConnection = sendMessageViaLongConnection;
  global.__getChatId = getChatId;
  if (feishuAppBot && feishuAppBot.startLongConnection) {
    feishuAppBot.startLongConnection = null;
  }
} catch (e) {
  console.warn('Feishu long connection helper not available:', e.message);
}

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
        lunchPushTime: '11:00',
        dinnerPushTime: '17:00',
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

    // 修正逻辑：总是显示从周日到周五的菜单周期
    // 如果今天是周六，显示下周的菜单（下个周日开始）
    // 如果今天是周日到周五，显示本周的菜单（本周日开始）
    if (today.day() === 6) { // 如果今天是周六
      // 从明天(周日)开始的一周
      weekStart = today.clone().add(1, 'day').startOf('week').format('YYYY-MM-DD');
    } else {
      // 周日到周五：显示本周的周日开始
      weekStart = today.clone().startOf('week').format('YYYY-MM-DD');
    }

    return weekStart;
  }

  // 获取菜单周的结束日期（周六）
  getWeekEnd() {
    const weekStart = moment(this.getWeekStart());
    const weekEnd = weekStart.clone().add(6, 'days').format('YYYY-MM-DD'); // 周日+6天=周六
    return weekEnd;
  }

  // 确保指定日期有点餐记录（如果没有则创建默认记录）
  async ensureDailyOrderRecord(date) {
    try {
      const dailyOrders = await this.read('daily-orders.json') || [];
      const userRegistrations = await this.read('user-registrations.json') || [];
      const mealTypes = ['lunch', 'dinner'];
      const settings = await this.read('settings.json') || { totalEmployees: 50 };

      let hasChanges = false;

      for (const mealType of mealTypes) {
        const existingRecord = dailyOrders.find(order =>
          order.date === date && order.mealType === mealType
        );

        if (!existingRecord) {
          // 计算该日期该餐次的不吃人数
          const noEatCount = userRegistrations.filter(reg =>
            reg.date === date && reg.mealType === mealType && reg.dishName === '不吃'
          ).length;

          // 计算该日期该餐次的轻食人数
          const lightMealCount = userRegistrations.filter(reg =>
            reg.date === date && reg.mealType === mealType && reg.dishName === '轻食'
          ).length;

          // 检查是否是周六
          const recordDate = new Date(date);
          const isSaturday = recordDate.getDay() === 6;

          // 创建默认点餐记录，周六默认关闭点餐
          dailyOrders.push({
            id: this.generateId(dailyOrders),
            date,
            mealType,
            totalPeople: settings.totalEmployees || 0,
            noEatCount,
            lightMealCount,
            // orderCount不再存储，改为动态计算
            status: isSaturday ? 'closed' : 'open',
            createdAt: moment().toISOString()
          });

          hasChanges = true;
          console.log(`创建${date}的${mealType === 'lunch' ? '午餐' : '晚餐'}点餐记录 (${isSaturday ? '周六，默认关闭' : '工作日，默认开放'})`);
        }
      }

      if (hasChanges) {
        await this.write('daily-orders.json', dailyOrders);
      }

      return hasChanges;
    } catch (error) {
      console.error('确保每日点餐记录失败:', error);
      return false;
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

  // 用户ID映射管理方法
  async updateUserIdMapping(unionId, openId = null, userId = null) {
    try {
      let mappings = await this.read('user-id-mappings.json') || {};

      if (!mappings[unionId]) {
        mappings[unionId] = {
          unionId,
          openIds: [],
          userIds: [],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        };
      }

      // 添加新的openId (如果不存在)
      if (openId && !mappings[unionId].openIds.includes(openId)) {
        mappings[unionId].openIds.push(openId);
      }

      // 添加新的userId (如果不存在)
      if (userId && !mappings[unionId].userIds.includes(userId)) {
        mappings[unionId].userIds.push(userId);
      }

      mappings[unionId].updatedAt = new Date().toISOString();

      await this.write('user-id-mappings.json', mappings);
      return mappings[unionId];
    } catch (error) {
      console.error('更新用户ID映射失败:', error);
      return null;
    }
  }

  async findUserByAnyId(searchId) {
    try {
      const mappings = await this.read('user-id-mappings.json') || {};

      // 直接匹配unionId（但排除null和无效键）
      if (searchId && mappings[searchId] && searchId !== 'null' && searchId !== 'undefined') {
        return mappings[searchId];
      }

      // 在所有映射中搜索openId或userId（但跳过null键和无效映射）
      for (const [unionId, mapping] of Object.entries(mappings)) {
        if (unionId === 'null' || unionId === 'undefined' || !mapping) {
          continue; // 跳过无效的映射
        }

        if (mapping.openIds && mapping.openIds.includes(searchId)) {
          return mapping;
        }
        if (mapping.userIds && mapping.userIds.includes(searchId)) {
          return mapping;
        }
      }

      return null;
    } catch (error) {
      console.error('查找用户ID映射失败:', error);
      return null;
    }
  }

  async migrateUserIdData(oldId, newUnionId) {
    try {
      console.log(`开始迁移用户数据: ${oldId} -> ${newUnionId}`);

      const filesToMigrate = [
        'daily-orders.json',
        'ratings.json',
        'restaurant-suggestions.json',
        'restaurant-submissions.json',
        'submission-likes.json'
      ];

      let migratedCount = 0;

      for (const filename of filesToMigrate) {
        const data = await this.read(filename) || [];
        if (!Array.isArray(data)) continue;

        let fileChanged = false;
        data.forEach(item => {
          if (item.userId === oldId || item.user === oldId || item.feishuId === oldId) {
            if (item.userId) item.userId = newUnionId;
            if (item.user) item.user = newUnionId;
            if (item.feishuId) item.feishuId = newUnionId;
            fileChanged = true;
            migratedCount++;
          }
        });

        if (fileChanged) {
          await this.write(filename, data);
          console.log(`迁移文件 ${filename}: 更新了 ${migratedCount} 条记录`);
        }
      }

      console.log(`用户数据迁移完成: 总共更新 ${migratedCount} 条记录`);
      return migratedCount;
    } catch (error) {
      console.error('迁移用户数据失败:', error);
      return 0;
    }
  }

  async getUserRole(userId) {
    try {
      const roleData = await this.read('user-roles.json') || { defaultAdmins: [], users: {} };

      // 检查是否是默认管理员
      if (roleData.defaultAdmins && roleData.defaultAdmins.includes(userId)) {
        return 'admin';
      }

      // 检查用户角色映射
      if (roleData.users && roleData.users[userId]) {
        return roleData.users[userId];
      }

      // 默认角色
      return 'user';
    } catch (error) {
      console.error('获取用户角色失败:', error);
      return 'user';
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
      dailyOrders[orderIndex].updatedAt = moment().toISOString();
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

  // 关闭订餐登记
  async closeRegistration(mealType) {
    console.log(`关闭 ${mealType} 不吃登记...`);

    const today = dataStore.getTodayString();
    const dailyOrders = await dataStore.read('daily-orders.json');

    const orderIndex = dailyOrders.findIndex(order =>
      order.date === today && order.mealType === mealType
    );

    if (orderIndex >= 0) {
      dailyOrders[orderIndex].status = 'closed';
      dailyOrders[orderIndex].updatedAt = moment().toISOString();
      await dataStore.write('daily-orders.json', dailyOrders);
      console.log(`${mealType} 登记已关闭`);
    } else {
      console.log(`未找到今日的 ${mealType} 记录，无需关闭`);
    }
  }

  // 更新订餐统计
  async updateOrderCount(mealType, targetDate = null) {
    const updateDate = targetDate || dataStore.getTodayString();
    const dailyOrders = await dataStore.read('daily-orders.json');
    const userRegistrations = await dataStore.read('user-registrations.json');

    // 统一日期格式进行比较
    const updateDateFormatted = updateDate.replace(/\//g, '-');

    // 统计不吃人数
    const targetNoEat = userRegistrations.filter(reg => {
      const regDate = reg.date ? reg.date.replace(/\//g, '-') : '';
      return regDate === updateDateFormatted && reg.mealType === mealType && reg.dishName === '不吃';
    }).length;

    // 统计轻食人数
    const targetLightMeal = userRegistrations.filter(reg => {
      const regDate = reg.date ? reg.date.replace(/\//g, '-') : '';
      return regDate === updateDateFormatted && reg.mealType === mealType && reg.dishName === '轻食';
    }).length;

    const orderIndex = dailyOrders.findIndex(order =>
      order.date === updateDate && order.mealType === mealType
    );

    if (orderIndex >= 0) {
      const order = dailyOrders[orderIndex];
      order.noEatCount = targetNoEat;
      order.lightMealCount = targetLightMeal;
      // orderCount不再存储，改为动态计算
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
        lightMealCount: targetLightMeal,
        // orderCount不再存储，改为动态计算
        status: 'open',
        createdAt: moment().toISOString()
      });

      await dataStore.write('daily-orders.json', dailyOrders);
    }

    const updatedOrder = dailyOrders.find(o => o.date === updateDate && o.mealType === mealType);
    const regularCount = updatedOrder ? Math.max(0, (updatedOrder.totalPeople || 0) - targetNoEat - targetLightMeal) : 0;
    console.log(`更新${mealType}统计 (${updateDate}): 不吃人数=${targetNoEat}, 轻食人数=${targetLightMeal}, 非轻食人数=${regularCount}`);
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
              restaurantName: restaurant.restaurantName, // 使用外层的餐厅名称
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
            imageUrl: restaurant.imageUrl || '/images/default-dish.jpg',
            tags: restaurant.tags || []
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
    // 从请求参数获取weekStart，如果没有则使用当前周
    const weekStart = req.query.weekStart || dataStore.getWeekStart();

    // 按天和餐次组织数据（周日=0, 周一=1...周六=6）
    const organizedMenus = {};
    const allDays = [0, 1, 2, 3, 4, 5, 6]; // 周日到周六，包含周六

    allDays.forEach(day => {
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
            imageUrl: restaurant.imageUrl || '/images/default-dish.jpg',
            tags: restaurant.tags || []
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
    const userRegistrations = await dataStore.read('user-registrations.json');

    for (const mealType of mealTypes) {
      // 计算当天该餐次的不吃人数
      const todayNoEat = userRegistrations.filter(reg =>
        reg.date === today && reg.mealType === mealType && reg.dishName === '不吃'
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
      const chatId = process.env.FEISHU_TARGET_CHAT_ID;
      if (feishuAppBot && chatId) {
        const text = title ? `${title}\n\n${content}` : content;
        const response = await feishuAppBot.sendTextToChat(chatId, text);
        console.log('飞书消息发送成功(IM)');
        return { success: true, message: '消息发送成功', data: response };
      }

      if (!this.webhookUrl) throw new Error('飞书Webhook URL未配置');
      const message = { msg_type: 'text', content: { text: title ? `${title}\n\n${content}` : content } };
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
      const chatId = process.env.FEISHU_TARGET_CHAT_ID;
      if (feishuAppBot && chatId) {
        const card = { config: { wide_screen_mode: true }, header: { template: 'blue', title: { tag: 'plain_text', content: title } }, elements: [ { tag: 'div', text: { tag: 'lark_md', content } } ] };
        const response = await feishuAppBot.sendInteractiveCardToChat(chatId, card);
        console.log('飞书富文本消息发送成功(IM)');
        return { success: true, message: '消息发送成功', data: response };
      }

      if (!this.webhookUrl) throw new Error('飞书Webhook URL未配置');
      const message = { msg_type: 'post', content: { post: { zh_cn: { title, content } } } };
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
      const chatId = process.env.FEISHU_TARGET_CHAT_ID;
      const card = {
        config: {
          wide_screen_mode: true,
          enable_forward: true,
          update_multi: false
        },
        header: { title: { tag: 'plain_text', content: title }, template: color },
        elements: [ { tag: 'div', text: { tag: 'lark_md', content } } ]
      };
      if (feishuAppBot && chatId) {
        const response = await feishuAppBot.sendInteractiveCardToChat(chatId, card);
        console.log('飞书卡片消息发送成功(IM)');
        return { success: true, message: '消息发送成功', data: response };
      }

      if (!this.webhookUrl) throw new Error('飞书Webhook URL未配置');
      const message = { msg_type: 'interactive', card };
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

  // 发送交互式卡片消息（带按钮）
async sendInteractiveCardMessage(title, content, actions = [], color = 'blue') {
    try {
      const chatId = process.env.FEISHU_TARGET_CHAT_ID;
      const elements = [ { tag: 'div', text: { tag: 'lark_md', content } } ];
      if (actions && actions.length > 0) elements.push({ tag: 'action', actions });
      const card = { config: { wide_screen_mode: true, enable_forward: true }, header: { title: { tag: 'plain_text', content: title }, template: color }, elements };

      if (feishuAppBot && chatId) {
        const response = await feishuAppBot.sendInteractiveCardToChat(chatId, card);
        console.log('飞书交互式卡片消息发送成功(IM)');
        return { success: true, message: '交互式消息发送成功', data: response };
      }

      if (!this.webhookUrl) throw new Error('飞书Webhook URL未配置');
      const message = { msg_type: 'interactive', card };
      const response = await axios.post(this.webhookUrl, message);

      if (response.data.code === 0) {
        console.log('飞书交互式卡片消息发送成功');
        return { success: true, message: '交互式消息发送成功' };
      } else {
        throw new Error(response.data.msg || '交互式消息发送失败');
      }
    } catch (error) {
      console.error('飞书交互式卡片消息发送失败:', error.message);
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
        content += `${index + 1}. ${dish.restaurantName} - ${dish.dishName}\n`;
      });
      content += '\n';
    }
    
    if (menuData.dinner && menuData.dinner.length > 0) {
      content += `🍽️ **晚餐菜单：**\n`;
      menuData.dinner.forEach((dish, index) => {
        content += `${index + 1}. ${dish.restaurantName} - ${dish.dishName}\n`;
      });
    }
    
    content += `\n📱 点击链接进行订餐: ${getBaseUrl()}`;
    
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

  // 不吃登记提醒模板（交互式卡片）
  static getNoEatReminderMessage(mealType = 'lunch') {
    const today = moment().format('YYYY年MM月DD日');
    const dayOfWeek = moment().format('dddd');
    const mealName = mealType === 'lunch' ? '午餐' : '晚餐';
    const mealEmoji = mealType === 'lunch' ? '🥗' : '🍽️';

    const content = `📅 **${today} (${dayOfWeek})**\n\n${mealEmoji} **${mealName}登记提醒**\n\n如果您今天不准备用餐，请点击下方按钮进行登记：\n\n💡 **温馨提示：**\n• 登记不吃可以帮助食堂准确统计用餐人数\n• 避免浪费，节约资源\n• 您随时可以访问系统取消登记`;

    return {
      title: `${mealEmoji} ${mealName}登记提醒`,
      content: content
    };
  }

  // 生成不吃按钮
  static getNoEatActions(mealType = 'lunch') {
    const baseUrl = getBaseUrl();
    const mealName = mealType === 'lunch' ? '午餐' : '晚餐';

    return [
      {
        tag: 'button',
        text: {
          tag: 'plain_text',
          content: `🚫 登记不吃${mealName}`
        },
        type: 'primary',
        value: {
          action: 'no_eat',
          mealType: mealType,
          source: 'reminder'
        }
      },
      {
        tag: 'button',
        text: {
          tag: 'plain_text',
          content: '📱 打开订餐系统'
        },
        type: 'default',
        url: `${baseUrl}/user-dashboard.html`
      }
    ];
  }

  // 菜单推送交互式消息模板
  static getMenuPushMessage(menuData, mealType = 'lunch') {
    const today = moment().format('YYYY年MM月DD日');
    const dayOfWeek = moment().format('dddd');
    const mealName = mealType === 'lunch' ? '午餐' : '晚餐';
    const mealEmoji = mealType === 'lunch' ? '🥗' : '🍽️';

    let content = `📅 **${today} (${dayOfWeek})**\n\n${mealEmoji} **今日${mealName}菜单**\n\n`;

    if (menuData && menuData.length > 0) {
      menuData.forEach((dish, index) => {
        content += `${index + 1}. ${dish.restaurantName} - ${dish.dishName}\n`;
      });
      content += '\n💡 **温馨提示：**\n';
      content += '• 套餐内容以实际为准\n';
      content += '• 点击下方按钮快速登记不吃\n';
      content += '• 访问系统去点餐或评价菜品\n';
      content += '• 如有疑问请联系管理员';
    } else {
      content += '❌ 今日暂无菜单\n\n请联系管理员确认。';
    }

    return {
      title: `${mealEmoji} 今日${mealName}菜单`,
      content: content
    };
  }

  // 生成菜单推送按钮
  static getMenuPushActions(mealType = 'lunch', menuDishes = []) {
    const mealName = mealType === 'lunch' ? '午餐' : '晚餐';
    const baseUrl = getBaseUrl();

    console.log(`🔍 生成${mealName}按钮，菜单数量: ${menuDishes ? menuDishes.length : 0}`);
    if (menuDishes && menuDishes.length > 0) {
      console.log(`📋 菜单详情:`, JSON.stringify(menuDishes.map(d => ({
        name: d.dishName,
        tags: d.tags
      })), null, 2));
    }

    // 检查是否有轻食菜品
    const hasLightMeal = menuDishes && Array.isArray(menuDishes) && menuDishes.some(dish =>
      dish.tags && Array.isArray(dish.tags) &&
      (dish.tags.includes('轻食') || dish.tags.includes('light'))
    );

    console.log(`🥗 是否有轻食: ${hasLightMeal}`);

    const actions = [
      {
        tag: 'button',
        text: {
          tag: 'plain_text',
          content: `🚫 登记不吃${mealName}`
        },
        type: 'primary',
        value: {
          action: 'no_eat',
          mealType: mealType,
          source: 'menu_push'
        }
      }
    ];

    // 如果有轻食，添加轻食按钮
    if (hasLightMeal) {
      actions.push({
        tag: 'button',
        text: {
          tag: 'plain_text',
          content: `🥗 登记吃轻食`
        },
        type: 'primary',
        value: {
          action: 'light_meal',
          mealType: mealType,
          source: 'menu_push'
        }
      });
    }

    // 添加前往订餐系统按钮
    actions.push({
      tag: 'button',
      text: {
        tag: 'plain_text',
        content: '🍽️ 前往订餐系统'
      },
      type: 'default',
      url: baseUrl
    });

    return actions;
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

// 发送不吃登记提醒（交互式卡片）
app.post('/api/feishu/send-no-eat-reminder', async (req, res) => {
  try {
    const { mealType = 'lunch' } = req.body;

    const template = FeishuMessageTemplates.getNoEatReminderMessage(mealType);
    const actions = FeishuMessageTemplates.getNoEatActions(mealType);

    const result = await feishuSender.sendInteractiveCardMessage(
      template.title,
      template.content,
      actions,
      'orange'
    );

    res.json(result);
  } catch (error) {
    console.error('发送不吃登记提醒失败:', error);
    res.status(500).json({ success: false, message: '发送提醒失败' });
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

// 检查飞书长连接状态
app.get('/api/feishu/connection-status', (req, res) => {
  try {
    const isConnected = global.__feishu_connection_status ? global.__feishu_connection_status() : false;
    const hasWsClient = !!global.__feishu_ws_client;
    const hasClient = !!global.__feishu_client;

    res.json({
      success: true,
      data: {
        isConnected,
        hasWsClient,
        hasClient,
        timestamp: new Date().toISOString(),
        status: isConnected ? 'connected' : 'disconnected'
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: '获取连接状态失败: ' + error.message
    });
  }
});

// 测试不吃登记交互式卡片
app.post('/api/feishu/test-no-eat-card', async (req, res) => {
  try {
    const { mealType = 'lunch' } = req.body;

    const template = FeishuMessageTemplates.getNoEatReminderMessage(mealType);
    const actions = FeishuMessageTemplates.getNoEatActions(mealType);

    console.log('发送不吃登记交互式卡片:', {
      title: template.title,
      content: template.content,
      actions: actions
    });

    const result = await feishuSender.sendInteractiveCardMessage(
      template.title,
      template.content,
      actions,
      'orange'
    );

    res.json(result);
  } catch (error) {
    console.error('测试不吃登记卡片失败:', error);
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
      '本周菜单': this.handleWeeklyMenuCommand.bind(this),
      '不吃午餐': this.handleNoEatCommand.bind(this, 'lunch'),
      '不吃晚餐': this.handleNoEatCommand.bind(this, 'dinner'),
      '不吃': this.handleNoEatCommand.bind(this, 'lunch') // 默认午餐
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
      
      content += `📱 点击链接查看详情: ${getBaseUrl()}`;
      
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
      content += `🔗 访问地址: ${getBaseUrl()}\n\n`;
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
    content += `🔗 **网页版:** ${getBaseUrl()}`;
    
    return {
      success: true,
      reply: content,
      type: 'card'
    };
  }

  // 处理不吃登记命令
  async handleNoEatCommand(mealType, text, userId) {
    try {
      const mealName = mealType === 'lunch' ? '午餐' : '晚餐';

      if (!userId) {
        return {
          success: true,
          reply: `❌ 无法识别用户身份，请重新尝试`
        };
      }

      // 调用现有的不吃登记API
      const response = await fetch(`http://localhost:${PORT}/api/no-eat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          userId: userId,
          meal: mealType,
          source: 'feishu-bot'
        })
      });

      const result = await response.json();

      if (result.success) {
        return {
          success: true,
          reply: `✅ **${mealName}不吃登记成功**\n\n📅 日期：${moment().format('YYYY年MM月DD日')}\n👤 用户：${userId}\n🚫 ${mealName}已登记为不用餐\n\n💡 如需取消，请访问系统去点餐或评价菜品或联系管理员`
        };
      } else {
        return {
          success: true,
          reply: `❌ **${mealName}不吃登记失败**\n\n${result.message || '未知错误'}\n\n💡 请稍后重试或联系管理员`
        };
      }

    } catch (error) {
      console.error('处理不吃登记失败:', error);
      return {
        success: true,
        reply: `❌ **登记失败**\n\n系统暂时不可用，请稍后重试\n\n💡 或访问系统去点餐或评价菜品`
      };
    }
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

// 转换餐厅菜单格式为菜品数组格式的辅助函数
function convertRestaurantMenuToDishArray(restaurantMenus) {
  if (!restaurantMenus || !Array.isArray(restaurantMenus)) {
    return [];
  }

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
      // 如果不是标准格式，尝试直接处理
      dishes.push({
        dishId: restaurant.dishId || restaurant.id,
        dishName: restaurant.dishName || restaurant.name,
        restaurantName: restaurant.restaurantName,
        rating: restaurant.rating || 0,
        imageUrl: restaurant.imageUrl || '/images/default-dish.jpg',
        tags: restaurant.tags || []
      });
    }
  });

  return dishes;
}

// 获取今日菜单数据的核心逻辑 (与 /api/menu/today 保持一致)
async function getTodayMenuData() {
  const weeklyMenus = await dataStore.read('weekly-menus.json');
  const dailyOrders = await dataStore.read('daily-orders.json');
  const today = moment();
  const dayOfWeek = today.day(); // 周日为0，周一为1...周六为6
  const weekStart = dataStore.getWeekStart();
  const todayString = dataStore.getTodayString();

  let lunch = [];
  let dinner = [];

  // 优先级1: 使用管理员发布的今日菜单
  console.log(`查找今日菜单: date=${todayString}, publishedAt存在`);
  const todayDailyMenu = dailyOrders.find(order =>
    order.date === todayString && order.publishedAt
  );

  console.log(`找到今日已发布菜单:`, !!todayDailyMenu);

  if (todayDailyMenu) {
    // 使用管理员发布的今日菜单，转换格式以匹配前端期望
    console.log(`今日菜单原始数据 - 午餐:`, todayDailyMenu.lunch);
    console.log(`今日菜单原始数据 - 晚餐:`, todayDailyMenu.dinner);

    lunch = convertRestaurantMenuToDishArray(todayDailyMenu.lunch || []);
    dinner = convertRestaurantMenuToDishArray(todayDailyMenu.dinner || []);

    console.log(`转换后的午餐菜单:`, lunch);
    console.log(`转换后的晚餐菜单:`, dinner);
  } else {
    // 回退到 weekly-menus.json 查找菜单

    // 优先级2: 尝试新格式（管理员发布的周菜单）
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
      // 优先级3: 最后回退到旧格式（系统生成的菜单）
      const todayMenus = weeklyMenus.filter(menu =>
        menu.weekStart === weekStart && menu.dayOfWeek === dayOfWeek && menu.mealType
      );

      lunch = todayMenus.filter(menu => menu.mealType === 'lunch');
      dinner = todayMenus.filter(menu => menu.mealType === 'dinner');
    }
  }

  return { lunch, dinner };
}

// 推送当日午餐菜单功能
async function pushTodayLunchMenu() {
  try {
    // 获取今天的日期
    const today = moment();
    const todayDate = today.format('YYYY-MM-DD');
    const todayDateText = today.format('M月D日 dddd');
    const todayDayOfWeek = today.day(); // 0=周日, 1=周一, ..., 6=周六

    console.log(`准备推送当日午餐菜单: ${todayDate} (${todayDateText}, dayOfWeek: ${todayDayOfWeek})`);

    // 检查午餐点餐状态
    const dailyOrders = await dataStore.read('daily-orders.json');
    const lunchOrder = dailyOrders.find(order =>
      order.date === todayDate && order.mealType === 'lunch'
    );

    if (lunchOrder && lunchOrder.status === 'closed') {
      console.log(`${todayDate} 午餐点餐已关闭，跳过菜单推送`);
      return;
    }

    // 使用与今日菜单API相同的逻辑获取菜单数据
    console.log('正在调用getTodayMenuData()...');
    const { lunch } = await getTodayMenuData();

    console.log(`getTodayMenuData()返回的午餐菜单:`, lunch);

    if (!lunch || lunch.length === 0) {
      console.log(`${todayDate} 没有午餐菜单数据，跳过推送`);
      return;
    }

    console.log(`准备推送的午餐菜单数量: ${lunch.length}`);
    lunch.forEach((dish, index) => {
      console.log(`  ${index + 1}. ${dish.restaurantName}: ${dish.dishName}`);
    });

    // 构建午餐菜单交互式消息
    const template = FeishuMessageTemplates.getMenuPushMessage(lunch, 'lunch');
    const actions = FeishuMessageTemplates.getMenuPushActions('lunch', lunch);

    // 通过长连接发送交互式卡片到飞书群
    if (typeof global.__sendMessageViaLongConnection === 'function') {
      const chatId = process.env.FEISHU_TARGET_CHAT_ID;
      if (chatId) {
        // 构建交互式卡片消息
        const cardMessage = {
          msg_type: 'interactive',
          card: {
            config: {
              wide_screen_mode: true,
              enable_forward: true
            },
            header: {
              title: {
                tag: 'plain_text',
                content: template.title
              },
              template: 'blue'
            },
            elements: [
              {
                tag: 'div',
                text: {
                  tag: 'lark_md',
                  content: template.content
                }
              },
              {
                tag: 'action',
                actions: actions
              }
            ]
          }
        };
        await global.__sendMessageViaLongConnection(chatId, cardMessage);
      } else {
        console.warn('FEISHU_TARGET_CHAT_ID 未配置，跳过午餐菜单推送');
      }
    } else {
      console.warn('长连接消息发送器不可用，跳过午餐菜单推送');
    }

    console.log(`当日午餐菜单推送成功: ${todayDate} (午餐:${lunch.length}种)`);
  } catch (error) {
    console.error('推送当日午餐菜单失败:', error);
    throw error;
  }
}

// 推送当日晚餐菜单功能
async function pushTodayDinnerMenu() {
  try {
    // 获取今天的日期
    const today = moment();
    const todayDate = today.format('YYYY-MM-DD');
    const todayDateText = today.format('M月D日 dddd');
    const todayDayOfWeek = today.day(); // 0=周日, 1=周一, ..., 6=周六

    console.log(`准备推送当日晚餐菜单: ${todayDate} (${todayDateText}, dayOfWeek: ${todayDayOfWeek})`);

    // 检查晚餐点餐状态
    const dailyOrders = await dataStore.read('daily-orders.json');
    const dinnerOrder = dailyOrders.find(order =>
      order.date === todayDate && order.mealType === 'dinner'
    );

    if (dinnerOrder && dinnerOrder.status === 'closed') {
      console.log(`${todayDate} 晚餐点餐已关闭，跳过菜单推送`);
      return;
    }

    // 使用与今日菜单API相同的逻辑获取菜单数据
    const { dinner } = await getTodayMenuData();

    if (!dinner || dinner.length === 0) {
      console.log(`${todayDate} 没有晚餐菜单数据，跳过推送`);
      return;
    }

    // 构建晚餐菜单交互式消息
    const template = FeishuMessageTemplates.getMenuPushMessage(dinner, 'dinner');
    const actions = FeishuMessageTemplates.getMenuPushActions('dinner', dinner);

    // 通过长连接发送交互式卡片到飞书群
    if (typeof global.__sendMessageViaLongConnection === 'function') {
      const chatId = process.env.FEISHU_TARGET_CHAT_ID;
      if (chatId) {
        // 构建交互式卡片消息
        const cardMessage = {
          msg_type: 'interactive',
          card: {
            config: {
              wide_screen_mode: true,
              enable_forward: true
            },
            header: {
              title: {
                tag: 'plain_text',
                content: template.title
              },
              template: 'orange'
            },
            elements: [
              {
                tag: 'div',
                text: {
                  tag: 'lark_md',
                  content: template.content
                }
              },
              {
                tag: 'action',
                actions: actions
              }
            ]
          }
        };
        await global.__sendMessageViaLongConnection(chatId, cardMessage);
      } else {
        console.warn('FEISHU_TARGET_CHAT_ID 未配置，跳过晚餐菜单推送');
      }
    } else {
      console.warn('长连接消息发送器不可用，跳过晚餐菜单推送');
    }

    console.log(`当日晚餐菜单推送成功: ${todayDate} (晚餐:${dinner.length}种)`);
  } catch (error) {
    console.error('推送当日晚餐菜单失败:', error);
    throw error;
  }
}

// 推送当日菜单功能（保留原有功能作为备用）
async function pushTodayMenu() {
  try {
    // 获取今天的日期
    const today = moment();
    const todayDate = today.format('YYYY-MM-DD');
    const todayDateText = today.format('M月D日 dddd');
    const todayDayOfWeek = today.day(); // 0=周日, 1=周一, ..., 6=周六

    console.log(`准备推送当日菜单: ${todayDate} (${todayDateText}, dayOfWeek: ${todayDayOfWeek})`);

    // 检查点餐状态
    const dailyOrders = await dataStore.read('daily-orders.json');
    const lunchOrder = dailyOrders.find(order =>
      order.date === todayDate && order.mealType === 'lunch'
    );
    const dinnerOrder = dailyOrders.find(order =>
      order.date === todayDate && order.mealType === 'dinner'
    );

    // 如果午餐和晚餐都关闭，跳过推送
    const lunchClosed = lunchOrder && lunchOrder.status === 'closed';
    const dinnerClosed = dinnerOrder && dinnerOrder.status === 'closed';

    if (lunchClosed && dinnerClosed) {
      console.log(`${todayDate} 午餐和晚餐点餐都已关闭，跳过菜单推送`);
      return;
    }

    // 使用与今日菜单API相同的逻辑获取菜单数据
    const { lunch, dinner } = await getTodayMenuData();

    const hasLunch = lunch && lunch.length > 0 && !lunchClosed;
    const hasDinner = dinner && dinner.length > 0 && !dinnerClosed;

    if (!hasLunch && !hasDinner) {
      console.log(`${todayDate} 没有可推送的菜单数据，跳过推送`);
      return;
    }

    // 构建当日菜单卡片消息
    const cardMessage = buildTodayMenuCardFromMenus(today, lunch, dinner);

    // 发送到飞书群
    const messageSender = new FeishuMessageSender();
    await messageSender.sendCardMessage('🍽️ 今日菜单', cardMessage, 'blue');

    console.log(`当日菜单推送成功: ${todayDate} (午餐:${hasLunch ? lunch.length + '种' : '无'}, 晚餐:${hasDinner ? dinner.length + '种' : '无'})`);
  } catch (error) {
    console.error('推送当日菜单失败:', error);
    throw error;
  }
}

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
    const weekStart = dataStore.getWeekStart();
    
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

// 构建单餐菜单卡片内容 (从菜单条目数组)
function buildMealMenuCardFromMenus(today, menus, mealType) {
  const dateText = today.format('M月D日 dddd');
  const mealName = mealType === 'lunch' ? '午餐' : '晚餐';
  const emoji = mealType === 'lunch' ? '👨‍🍳' : '🌙';
  const deadline = mealType === 'lunch' ? "11:10" : "17:10";

  let menuContent = `🍽️ **[今日${mealName}菜单] (${dateText})**\n\n`;

  // 菜单内容
  if (menus && menus.length > 0) {
    menuContent += `${emoji} **${mealName}菜单**（登记不吃截止：${deadline}）\n`;

    // 按餐厅分组
    const menusByRestaurant = {};
    menus.forEach(item => {
      if (!menusByRestaurant[item.restaurantName]) {
        menusByRestaurant[item.restaurantName] = [];
      }
      menusByRestaurant[item.restaurantName].push(item.dishName);
    });

    Object.keys(menusByRestaurant).forEach(restaurant => {
      menuContent += `🏪 **餐厅**：${restaurant}\n`;
      menuContent += `🍽️ **菜品**：${menusByRestaurant[restaurant].join('、')}\n\n`;
    });
  } else {
    menuContent += `${emoji} **${mealName}菜单**（登记不吃截止：${deadline}）\n`;
    menuContent += `暂无${mealName}菜单数据\n\n`;
  }

  // 添加操作提示
  menuContent += `💡 **温馨提示**：\n`;
  menuContent += `• 套餐内容以实际为准\n`;
  menuContent += `• 默认所有人员都会用餐\n`;
  menuContent += `• 如需登记不吃，请访问系统去点餐或评价菜品\n`;
  menuContent += `• ${mealName}登记截止时间：${deadline}`;

  return menuContent;
}

// 构建当日菜单卡片内容 (从菜单条目数组)
function buildTodayMenuCardFromMenus(today, lunchMenus, dinnerMenus) {
  const dateText = today.format('M月D日 dddd');
  const lunchDeadline = "11:10";
  const dinnerDeadline = "17:10";

  let menuContent = `🍽️ **[今日菜单] (${dateText}) 午餐 & 晚餐**\n\n`;

  // 午餐菜单
  if (lunchMenus && lunchMenus.length > 0) {
    menuContent += `👨‍🍳 **午餐菜单**（登记不吃截止：${lunchDeadline}）\n`;

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
    menuContent += `👨‍🍳 **午餐菜单**（登记不吃截止：${lunchDeadline}）\n`;
    menuContent += `暂无午餐菜单数据\n\n`;
  }

  // 晚餐菜单
  if (dinnerMenus && dinnerMenus.length > 0) {
    menuContent += `🌙 **晚餐菜单**（登记不吃截止：${dinnerDeadline}）\n`;

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
    menuContent += `🌙 **晚餐菜单**（登记不吃截止：${dinnerDeadline}）\n`;
    menuContent += `暂无晚餐菜单数据\n\n`;
  }

  // 添加操作提示
  menuContent += `💡 **温馨提示**：\n`;
  menuContent += `• 套餐内容以实际为准\n`;
  menuContent += `• 默认所有人员都会用餐\n`;
  menuContent += `• 如需登记不吃，请访问系统去点餐或评价菜品\n`;
  menuContent += `• 午餐登记截止时间：${lunchDeadline}\n`;
  menuContent += `• 晚餐登记截止时间：${dinnerDeadline}`;

  return menuContent;
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

    // 支持新旧两种事件格式
    // 旧格式: { header: { event_type }, event: {...} }
    // 新格式: { event_type, action, operator, ... }
    const eventType = header?.event_type || req.body.event_type;
    const eventData = event || req.body;

    // 验证请求数据格式
    if (!eventType) {
      console.log('收到无效的飞书webhook请求:', JSON.stringify(req.body, null, 2));
      return res.json({ code: -1, msg: 'invalid request format' });
    }

    console.log(`收到飞书事件: ${eventType}`);

    // URL验证 (飞书会发送此类型请求验证webhook地址)
    if (eventType === 'url_verification') {
      return res.json({ challenge: eventData.challenge });
    }

    // 处理消息事件
    if (eventType === 'im.message.receive_v1') {
      const message = eventData.message;
      const sender = eventData.sender;

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

    // 处理卡片交互事件
    if (eventType === 'card.action.trigger') {
      const action = eventData.action;

      // 飞书卡片交互事件中用户ID可能在不同位置，优先获取union_id
      const rawUserId = eventData.operator?.union_id || eventData.operator?.user_id || eventData.operator?.operator_id?.union_id || eventData.operator?.operator_id?.user_id;
      const openId = eventData.operator?.open_id;

      // 获取更多用户信息
      const userInfo = {
        user_id: eventData.operator?.user_id,
        open_id: openId,
        union_id: eventData.operator?.union_id,
        name: eventData.operator?.name || eventData.operator?.user_name,
        全部信息: eventData.operator
      };

      console.log(`🔘 收到飞书卡片交互 - 按钮文本: ${action.tag === 'button' ? (action.text?.content || action.text || '未知') : action.value || '未知'}`);
      console.log(`👤 点击用户信息:`, JSON.stringify(userInfo, null, 2));

      // 确定最终使用的用户ID，优先使用union_id
      let userId = eventData.operator?.union_id || openId || rawUserId;

      // 验证用户ID有效性
      if (!userId) {
        console.error('❌ 无法获取有效的用户ID，跳过处理');
        return res.json({ code: -1, msg: 'invalid user id' });
      }

      console.log(`✅ 确定使用用户ID: ${userId}`);

      // 立即返回响应给飞书
      res.json({ code: 0, msg: 'success' });

      // 异步处理不吃登记和轻食登记按钮 - 优先使用value属性，回退到按钮文本识别
      let mealType = null;
      let actionType = null; // 'no_eat' 或 'light_meal'

      console.log(`🔍 按钮交互详细信息:`, JSON.stringify(action, null, 2));

      // 优先通过value属性获取操作信息
      if (action.value) {
        if (typeof action.value === 'object') {
          if (action.value.action === 'no_eat') {
            mealType = action.value.mealType;
            actionType = 'no_eat';
            console.log(`✅ 通过value对象识别到不吃登记操作: ${mealType}, source: ${action.value.source}`);
          } else if (action.value.action === 'light_meal') {
            mealType = action.value.mealType;
            actionType = 'light_meal';
            console.log(`✅ 通过value对象识别到轻食登记操作: ${mealType}, source: ${action.value.source}`);
          }
        } else if (typeof action.value === 'string' && action.value.startsWith('no_eat_')) {
          const parts = action.value.split('_');
          if (parts.length >= 3) {
            mealType = parts[2]; // no_eat_lunch_menu_push -> lunch
            actionType = 'no_eat';
            const source = parts.slice(3).join('_'); // menu_push 或 reminder
            console.log(`✅ 通过value字符串识别到不吃登记操作: ${mealType}, source: ${source}`);
          }
        }
      }

      if (!mealType) {
        // 回退到通过按钮文本识别操作类型和餐次
        const buttonText = action.tag === 'button' ? (action.text?.content || action.text || '') : '';
        console.log(`🔍 分析按钮文本: "${buttonText}"`);

        if (buttonText.includes('登记不吃')) {
          actionType = 'no_eat';
          if (buttonText.includes('午餐') || buttonText.includes('午饭')) {
            mealType = 'lunch';
          } else if (buttonText.includes('晚餐') || buttonText.includes('晚饭')) {
            mealType = 'dinner';
          }
          console.log(`✅ 通过文本识别到不吃登记操作: ${mealType}`);
        } else if (buttonText.includes('登记吃轻食') || buttonText.includes('轻食')) {
          actionType = 'light_meal';
          // 轻食按钮不包含餐次信息，需要从其他地方推断
          console.log(`✅ 通过文本识别到轻食登记操作`);
        } else {
          console.log(`ℹ️ 非登记按钮，跳过处理`);
        }
      }

      if (mealType) {

        // 使用 setImmediate 异步处理，避免阻塞响应
        setImmediate(async () => {
          try {
            console.log(`\n=== 🔘 飞书按钮点击回调信息 ===`);
            console.log(`👤 用户ID: ${userId}`);
            console.log(`🍽️ 餐次: ${mealType}`);
            console.log(`🎬 操作类型: ${actionType}`);
            console.log(`📱 用户详细信息:`, JSON.stringify(userInfo, null, 2));

            console.log(`🔍 按钮值信息:`, JSON.stringify(action.value, null, 2));
            console.log(`=================================\n`);

            // 根据操作类型调用不同的API
            const currentPort = process.env.PORT || 3000;
            let apiEndpoint = '';
            let requestBody = {};

            if (actionType === 'light_meal') {
              apiEndpoint = `http://127.0.0.1:${currentPort}/api/light-meal`;
              requestBody = {
                userId: userId,
                meal: mealType,
                source: 'feishu-card'
              };
            } else {
              // 默认为不吃登记
              apiEndpoint = `http://127.0.0.1:${currentPort}/api/no-eat`;
              requestBody = {
                userId: userId,
                meal: mealType,
                source: 'feishu-card'
              };
            }

            const response = await fetch(apiEndpoint, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json'
              },
              body: JSON.stringify(requestBody)
            });

            const result = await response.json();

            if (result.success) {
              const mealName = mealType === 'lunch' ? '午餐' : '晚餐';

              // 优先使用飞书回调中的用户名，其次使用API返回的用户名，最后使用默认值
              let userName = eventData.operator?.name || result.data?.userName || '用户';

              // 如果用户名为空或者是默认值，尝试从用户数据中获取
              if (!userName || userName === '用户' || userName === 'Unknown') {
                try {
                  const usersData = await dataStore.read('users.json') || [];
                  const user = usersData.find(u => u.id === userId);
                  if (user && user.name) {
                    userName = user.name;
                  }
                } catch (err) {
                  console.log('获取用户名失败，使用默认值');
                }
              }

              const actionText = actionType === 'light_meal' ? '登记吃轻食' : '登记不吃';
              console.log(`✅ 飞书卡片${actionText}成功: ${userName}, ${mealName}`);

              // 发送确认消息到群聊
              try {
                const confirmMessage = actionType === 'light_meal'
                  ? `✅ ${userName} 已成功登记吃${mealName}轻食`
                  : `✅ ${userName} 已成功登记不吃${mealName}`;
                await feishuSender.sendTextMessage(confirmMessage);
                console.log(`📢 已发送确认消息到群聊: ${confirmMessage}`);
              } catch (msgError) {
                console.error('❌ 发送确认消息失败:', msgError);
              }
            } else {
              const actionText = actionType === 'light_meal' ? '轻食登记' : '不吃登记';
              console.error(`❌ ${actionText}API返回失败:`, result.message);

              // 发送错误消息
              try {
                const mealName = mealType === 'lunch' ? '午餐' : '晚餐';
                const errorMessage = actionType === 'light_meal'
                  ? `❌ 登记吃${mealName}轻食失败: ${result.message}`
                  : `❌ 登记不吃${mealName}失败: ${result.message}`;
                await feishuSender.sendTextMessage(errorMessage);
              } catch (msgError) {
                console.error('❌ 发送错误消息失败:', msgError);
              }
            }
          } catch (error) {
            console.error('❌ 处理按钮点击失败:', error);
            console.error('错误详情:', error.stack);

            // 记录错误上下文信息
            console.error('错误上下文信息:', {
              userId,
              mealType,
              userInfo,
              action: JSON.stringify(action, null, 2)
            });

            try {
              // 尝试使用飞书长连接发送错误消息
              if (process.env.FEISHU_LONG_CONN_ENABLED === 'true') {
                const { sendMessageViaLongConnection } = require('./libs/feishu-longconn');
                const chatId = process.env.FEISHU_TARGET_CHAT_ID;
                if (chatId) {
                  await sendMessageViaLongConnection(chatId, {
                    msg_type: 'text',
                    content: { text: `❌ 登记失败，请稍后重试或联系管理员。\n错误: ${error.message}` }
                  });
                } else {
                  console.warn('FEISHU_TARGET_CHAT_ID 未配置，无法发送错误消息');
                }
              }
            } catch (sendError) {
              console.error('❌ 发送错误消息失败:', sendError);
            }
          }
        });
      }

      // 已经发送了响应，直接返回
      return;
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
app.get('/api/admin/orders', requireAdminAuth, async (req, res) => {
  try {
    const dailyOrders = await dataStore.read('daily-orders.json');
    const userRegistrations = await dataStore.read('user-registrations.json') || [];
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
      // 默认行为：显示本菜单周期（周日到周六，包括周六）的记录
      filterStartDate = dataStore.getWeekStart();
      filterEndDate = dataStore.getWeekEnd();
      console.log('使用默认日期范围:', { filterStartDate, filterEndDate });
    }

    // 过滤：显示指定日期范围的记录，并且是点餐记录格式（有mealType字段）
    const filteredOrders = dailyOrders.filter(order => {
      return order.date >= filterStartDate && order.date <= filterEndDate && order.mealType && order.id;
    });

    // 去重：确保每个日期和餐次的组合只出现一次，保留最新的记录
    const deduplicatedOrders = [];
    const seen = new Map();

    // 按更新时间倒序排序，确保最新的记录优先
    // 如果没有时间戳，使用订单ID作为备用排序依据（较大的ID表示较新）
    const sortedOrders = filteredOrders.sort((a, b) => {
      const timeA = new Date(a.updatedAt || a.createdAt || 0);
      const timeB = new Date(b.updatedAt || b.createdAt || 0);

      // 如果时间戳相同（都是无效时间），按ID排序（较大的ID优先）
      if (timeA.getTime() === timeB.getTime()) {
        return b.id - a.id;
      }

      return timeB - timeA;
    });

    for (const order of sortedOrders) {
      const key = `${order.date}-${order.mealType}`;
      if (!seen.has(key)) {
        seen.set(key, true);
        deduplicatedOrders.push(order);
      }
    }

    // 重新按日期正序排序，同一天内午餐在前、晚餐在后
    deduplicatedOrders.sort((a, b) => {
      const dateA = new Date(a.date);
      const dateB = new Date(b.date);
      if (dateA.getTime() === dateB.getTime()) {
        // 同一天的话，午餐排在晚餐前
        if (a.mealType === 'lunch' && b.mealType === 'dinner') return -1;
        if (a.mealType === 'dinner' && b.mealType === 'lunch') return 1;
        return 0;
      }
      return dateA.getTime() - dateB.getTime();
    });

    console.log('筛选结果:', {
      totalOrders: dailyOrders.length,
      filteredOrders: filteredOrders.length,
      deduplicatedOrders: deduplicatedOrders.length,
      dateRange: { filterStartDate, filterEndDate },
      uniqueDates: [...new Set(deduplicatedOrders.map(o => o.date))].sort()
    });

    // 计算每日每餐次的不吃人数和用户详情（从用户注册记录中统计）
    const calculateNoEatData = (date, mealType) => {
      const noEatRegs = userRegistrations.filter(reg =>
        reg.date === date &&
        reg.mealType === mealType &&
        reg.dishName === '不吃'
      );

      // 按用户ID去重，保留最新的登记记录
      const uniqueUserRegs = new Map();
      noEatRegs.forEach(reg => {
        const existingReg = uniqueUserRegs.get(reg.userId);
        if (!existingReg || new Date(reg.createdAt) > new Date(existingReg.createdAt)) {
          uniqueUserRegs.set(reg.userId, reg);
        }
      });

      // 获取对应的用户信息
      const noEatUsers = Array.from(uniqueUserRegs.values()).map(reg => {
        const user = users.find(u => u.id === reg.userId);
        return {
          userId: reg.userId,
          userName: user ? user.name : `用户${reg.userId}`,
          registrationTime: reg.createdAt,
          note: reg.note || '通过飞书按钮快速登记'
        };
      });

      return {
        count: uniqueUserRegs.size,
        users: noEatUsers
      };
    };

    // 计算每日每餐次的轻食人数和用户详情（从用户注册记录中统计）
    const calculateLightMealData = (date, mealType) => {
      const lightMealRegs = userRegistrations.filter(reg =>
        reg.date === date &&
        reg.mealType === mealType &&
        reg.dishName === '轻食'
      );

      // 按用户ID去重，保留最新的登记记录
      const uniqueUserRegs = new Map();
      lightMealRegs.forEach(reg => {
        const existingReg = uniqueUserRegs.get(reg.userId);
        if (!existingReg || new Date(reg.createdAt) > new Date(existingReg.createdAt)) {
          uniqueUserRegs.set(reg.userId, reg);
        }
      });

      // 获取对应的用户信息
      const lightMealUsers = Array.from(uniqueUserRegs.values()).map(reg => {
        const user = users.find(u => u.id === reg.userId);
        return {
          userId: reg.userId,
          userName: user ? user.name : `用户${reg.userId}`,
          registrationTime: reg.createdAt,
          note: reg.note || '轻食登记'
        };
      });

      return {
        count: uniqueUserRegs.size,
        users: lightMealUsers
      };
    };

    // 丰富点餐记录数据
    const enrichedOrders = deduplicatedOrders.map(order => {
      // 修复时区问题：强制使用本地时区解析日期
      const dateParts = order.date.split('-');
      const orderDate = new Date(parseInt(dateParts[0]), parseInt(dateParts[1]) - 1, parseInt(dateParts[2]));
      const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
      const weekday = weekdays[orderDate.getDay()];

      // 计算实际的不吃人数和用户详情（基于用户注册记录）
      const noEatData = calculateNoEatData(order.date, order.mealType);
      // 计算实际的轻食人数和用户详情（基于用户注册记录）
      const lightMealData = calculateLightMealData(order.date, order.mealType);

      return {
        ...order,
        noEatCount: noEatData.count, // 覆盖原有的noEatCount字段
        noEatUsers: noEatData.users, // 新增: 不吃用户详情
        lightMealCount: lightMealData.count, // 新增: 轻食人数
        lightMealUsers: lightMealData.users, // 新增: 轻食用户详情
        orderCount: Math.max(0, (order.totalPeople || 0) - noEatData.count - lightMealData.count), // 重新计算正常用餐人数
        dateFormatted: orderDate.toLocaleDateString('zh-CN'),
        weekday: weekday,
        dateWithWeekday: `${orderDate.toLocaleDateString('zh-CN')} ${weekday}`,
        mealTypeText: order.mealType === 'lunch' ? '午餐' : '晚餐',
        statusText: order.status === 'open' ? '开放点餐' : '已关闭'
      };
    }).sort((a, b) => new Date(a.date) - new Date(b.date)); // 按日期正序排序（当日优先）

    console.log('增强后的订单数据示例:', enrichedOrders.slice(0, 2));

    res.json({ success: true, data: enrichedOrders || [] });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// 测试去重功能的端点（无需认证）
app.get('/api/test/deduplication', async (req, res) => {
  try {
    const dailyOrders = await dataStore.read('daily-orders.json');

    // 使用相同的逻辑
    const { startDate, endDate } = req.query;

    let filterStartDate, filterEndDate;
    if (startDate && endDate) {
      filterStartDate = startDate;
      filterEndDate = endDate;
    } else {
      filterStartDate = dataStore.getWeekStart();
      filterEndDate = dataStore.getWeekEnd();
    }

    // 过滤：显示指定日期范围的记录，并且是点餐记录格式（有mealType字段）
    const filteredOrders = dailyOrders.filter(order => {
      return order.date >= filterStartDate && order.date <= filterEndDate && order.mealType && order.id;
    });

    // 去重：确保每个日期和餐次的组合只出现一次，保留最新的记录
    const deduplicatedOrders = [];
    const seen = new Map();

    // 按更新时间倒序排序，确保最新的记录优先
    // 如果没有时间戳，使用订单ID作为备用排序依据（较大的ID表示较新）
    const sortedOrders = filteredOrders.sort((a, b) => {
      const timeA = new Date(a.updatedAt || a.createdAt || 0);
      const timeB = new Date(b.updatedAt || b.createdAt || 0);

      // 如果时间戳相同（都是无效时间），按ID排序（较大的ID优先）
      if (timeA.getTime() === timeB.getTime()) {
        return b.id - a.id;
      }

      return timeB - timeA;
    });

    for (const order of sortedOrders) {
      const key = `${order.date}-${order.mealType}`;
      if (!seen.has(key)) {
        seen.set(key, true);
        deduplicatedOrders.push(order);
      }
    }

    // 重新按日期正序排序
    deduplicatedOrders.sort((a, b) => new Date(a.date) - new Date(b.date));

    console.log('【测试去重】筛选结果:', {
      totalOrders: dailyOrders.length,
      filteredOrders: filteredOrders.length,
      deduplicatedOrders: deduplicatedOrders.length,
      dateRange: { filterStartDate, filterEndDate },
      uniqueDates: [...new Set(deduplicatedOrders.map(o => o.date))].sort(),
      duplicateDetails: filteredOrders.filter(o => o.date === '2025-09-14').map(o => ({
        id: o.id,
        date: o.date,
        mealType: o.mealType,
        updatedAt: o.updatedAt,
        createdAt: o.createdAt
      }))
    });

    res.json({
      success: true,
      totalOrders: dailyOrders.length,
      filteredOrders: filteredOrders.length,
      deduplicatedOrders: deduplicatedOrders.length,
      dateRange: { filterStartDate, filterEndDate },
      uniqueDates: [...new Set(deduplicatedOrders.map(o => o.date))].sort(),
      sept14Details: filteredOrders.filter(o => o.date === '2025-09-14'),
      deduplicatedSept14: deduplicatedOrders.filter(o => o.date === '2025-09-14')
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// 防重复操作的锁
const toggleStatusLocks = new Map();

// 更改点餐状态
app.post('/api/admin/orders/toggle-status', requireAdminAuth, async (req, res) => {
  const { date, mealType } = req.body;
  const lockKey = `${date}-${mealType}`;

  console.log('收到状态切换请求:', { date, mealType });

  // 检查是否有正在处理的相同请求
  if (toggleStatusLocks.has(lockKey)) {
    console.log('重复请求被拒绝:', lockKey);
    return res.status(429).json({
      success: false,
      message: '请求处理中，请稍候...'
    });
  }

  // 参数验证
  if (!date || !mealType) {
    console.log('参数验证失败');
    return res.status(400).json({
      success: false,
      message: '缺少必要参数'
    });
  }

  // 设置锁
  toggleStatusLocks.set(lockKey, true);
  console.log('已设置锁:', lockKey);

  try {
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

    const oldStatus = dailyOrders[orderIndex].status;

    // 切换状态
    dailyOrders[orderIndex].status = dailyOrders[orderIndex].status === 'open' ? 'closed' : 'open';
    dailyOrders[orderIndex].updatedAt = moment().toISOString();

    console.log(`状态切换: ${date} ${mealType} ${oldStatus} -> ${dailyOrders[orderIndex].status}`);

    // 保存到文件
    await dataStore.write('daily-orders.json', dailyOrders);

    console.log('状态切换成功并已保存到文件');

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
  } finally {
    // 总是清理锁
    toggleStatusLocks.delete(lockKey);
    console.log('已清理锁:', lockKey);
  }
});

// 清零不吃人数
app.post('/api/admin/orders/clear-no-eat', requireAdminAuth, async (req, res) => {
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

    // 删除对应的用户不吃和轻食登记记录
    const userRegistrations = await dataStore.read('user-registrations.json') || [];
    const filteredUserRegs = userRegistrations.filter(reg => {
      const regDate = reg.date ? reg.date.replace(/\//g, '-') : '';
      const targetDate = date.replace(/\//g, '-');
      // 删除"不吃"和"轻食"两种登记
      return !(regDate === targetDate && reg.mealType === mealType && (reg.dishName === '不吃' || reg.dishName === '轻食'));
    });

    console.log(`删除用户不吃和轻食登记记录: ${userRegistrations.length} -> ${filteredUserRegs.length}`);
    await dataStore.write('user-registrations.json', filteredUserRegs);

    // 单一数据源，只需要清理用户登记文件即可

    // 清零不吃人数和轻食人数
    dailyOrders[orderIndex].noEatCount = 0;
    dailyOrders[orderIndex].lightMealCount = 0;
    // 重新计算点餐人数
    const totalPeople = dailyOrders[orderIndex].totalPeople || 0;
    dailyOrders[orderIndex].orderCount = Math.max(0, totalPeople - 0);
    dailyOrders[orderIndex].updatedAt = moment().toISOString();

    await dataStore.write('daily-orders.json', dailyOrders);

    console.log('清零完成:', { date, mealType, noEatCount: 0, lightMealCount: 0 });

    res.json({
      success: true,
      message: '不吃和轻食人数已清零',
      data: {
        date: date,
        mealType: mealType,
        noEatCount: 0,
        lightMealCount: 0
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

// 获取系统用户列表 - 已废弃，使用下方新版本
/* app.get('/api/admin/users', async (req, res) => {
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
}); */

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

    // 如果员工总人数发生变化，更新从今天开始的所有订单记录
    if (req.body.totalEmployees && req.body.totalEmployees !== settings.totalEmployees) {
      console.log(`员工总人数已更改: ${settings.totalEmployees} -> ${req.body.totalEmployees}`);
      console.log('正在更新从今天开始的所有订单记录...');

      const dailyOrders = await dataStore.read('daily-orders.json');
      const today = moment().format('YYYY-MM-DD');
      let updatedCount = 0;

      dailyOrders.forEach(order => {
        // 只更新今天及未来的记录
        if (order.date >= today && order.totalPeople !== undefined) {
          order.totalPeople = req.body.totalEmployees;
          updatedCount++;
        }
      });

      if (updatedCount > 0) {
        await dataStore.write('daily-orders.json', dailyOrders);
        console.log(`已更新 ${updatedCount} 条订单记录的总人数`);
      }
    }

    // 如果时间设置发生变化，重新初始化定时任务
    const timeFields = ['lunchOpenTime', 'dinnerOpenTime', 'lunchPushTime', 'dinnerPushTime'];
    const timeChanged = timeFields.some(field => req.body[field] && req.body[field] !== settings[field]);

    if (timeChanged) {
      console.log('时间设置已更改，重新初始化定时任务...');
      await initializeCronJobs();
    }

    res.json({ success: true, data: updatedSettings });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// 管理员API - 测试午餐推送
app.post('/api/admin/test-lunch-push', async (req, res) => {
  try {
    await pushTodayLunchMenu();
    res.json({ success: true, message: '午餐推送测试成功' });
  } catch (error) {
    console.error('测试午餐推送失败:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// 管理员API - 测试晚餐推送
app.post('/api/admin/test-dinner-push', async (req, res) => {
  try {
    await pushTodayDinnerMenu();
    res.json({ success: true, message: '晚餐推送测试成功' });
  } catch (error) {
    console.error('测试晚餐推送失败:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// 管理员API - 重新加载定时任务
app.post('/api/admin/reload-cron', async (req, res) => {
  try {
    await initializeCronJobs();
    res.json({ success: true, message: '定时任务重新加载成功' });
  } catch (error) {
    console.error('重新加载定时任务失败:', error);
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
      // 修正：使用正确的日期偏移量映射
      const weekDays = [
        { name: 'sunday', offset: 0 },
        { name: 'monday', offset: 1 },
        { name: 'tuesday', offset: 2 },
        { name: 'wednesday', offset: 3 },
        { name: 'thursday', offset: 4 },
        { name: 'friday', offset: 5 }
      ];

      weekDays.forEach(({ name: day, offset }) => {
        const dayMenu = menu[day];
        if (dayMenu) {
          const dayDate = new Date(weekStart);
          dayDate.setDate(dayDate.getDate() + offset);
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
                    restaurantName: restaurantMenu.restaurantName, // 使用外层的餐厅名称
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
    const userRegistrations = await dataStore.read('user-registrations.json');

    console.log('今日日期:', today);
    console.log('清零前用户登记记录数:', userRegistrations.length);

    // 先找出今日该餐次的所有登记
    const todayRegs = userRegistrations.filter(reg => {
      const regDate = reg.date ? reg.date.replace(/\//g, '-') : '';
      const todayFormatted = today.replace(/\//g, '-');
      return regDate === todayFormatted && reg.mealType === mealType;
    });

    console.log(`今日${mealType}的登记记录:`, todayRegs.map(r => ({
      userId: r.userId,
      dishName: r.dishName,
      date: r.date
    })));

    // 删除今日指定餐次的所有不吃和轻食记录（考虑多种日期格式）
    const filteredRegs = userRegistrations.filter(reg => {
      // 统一日期格式进行比较
      const regDate = reg.date ? reg.date.replace(/\//g, '-') : '';
      const todayFormatted = today.replace(/\//g, '-');

      // 删除"不吃"和"轻食"两种登记
      const shouldKeep = !(
        regDate === todayFormatted &&
        reg.mealType === mealType &&
        (reg.dishName === '不吃' || reg.dishName === '轻食')
      );
      if (!shouldKeep) {
        console.log('将删除登记记录:', reg);
      }
      return shouldKeep;
    });

    const removedCount = userRegistrations.length - filteredRegs.length;

    await dataStore.write('user-registrations.json', filteredRegs);

    console.log(`清零${mealType}不吃和轻食记录: 删除${removedCount}条记录`);

    // 更新订餐统计
    await orderManager.updateOrderCount(mealType);

    res.json({
      success: true,
      message: `已清零${mealType === 'lunch' ? '午餐' : '晚餐'}不吃和轻食人数 (清理了${removedCount}条记录)`
    });
  } catch (error) {
    console.error('清零不吃人数失败:', error);
    res.status(500).json({ 
      success: false, 
      message: '清零失败，请重试' 
    });
  }
});

// 飞书直接不吃登记API（无需认证）
app.post('/api/no-eat', async (req, res) => {
  try {
    const { userId, meal, source = 'feishu' } = req.body;

    console.log('收到飞书直接不吃登记请求:', { userId, meal, source });

    if (!userId || !meal) {
      return res.status(400).json({
        success: false,
        message: '缺少必要参数'
      });
    }

    if (meal !== 'lunch' && meal !== 'dinner') {
      return res.status(400).json({
        success: false,
        message: '餐次参数无效'
      });
    }

    const today = moment().format('YYYY-MM-DD');
    const mealType = meal;

    // 查找或创建用户
    let user = await dataStore.findUserByAnyId(userId);
    if (!user) {
      console.log(`未找到用户映射，创建新用户: ${userId}`);

      // 创建新用户（来自飞书直接调用）
      user = {
        id: userId,
        name: `飞书用户_${userId.substring(0, 8)}`,
        loginMethod: 'feishu',
        firstLoginTime: new Date().toISOString(),
        lastLoginTime: new Date().toISOString()
      };

      // 保存新用户
      const userData = await dataStore.saveOrUpdateUser(user);
      console.log(`✅ 创建新用户成功: ${user.name} (${userId})`);

      // 记录用户ID映射
      if (userId.startsWith('on_')) {
        // union_id格式
        await dataStore.updateUserIdMapping(userId, [], []);
      } else if (userId.startsWith('ou_')) {
        // open_id格式
        await dataStore.updateUserIdMapping(null, [userId], []);
      }

      user = userData;
    } else {
      console.log(`✅ 找到现有用户映射: ${user.name || 'Unknown'}`);

      // 如果找到的用户映射有有效的unionId，使用它
      if (user.unionId && user.unionId !== 'null' && user.unionId !== userId) {
        console.log(`🔄 使用映射的union_id: ${userId} -> ${user.unionId}`);
        userId = user.unionId;
      }
    }

    // 检查管理员设置的餐次状态
    const dailyOrders = await dataStore.read('daily-orders.json');
    const orderRecord = dailyOrders.find(order =>
      order.date === today && order.mealType === mealType
    );

    // 如果管理员明确关闭了该餐次，则拒绝操作
    if (orderRecord && orderRecord.status === 'closed') {
      const mealName = mealType === 'lunch' ? '午餐' : '晚餐';
      const targetDate = moment(today);
      const dateStr = targetDate.format('MM月DD日');

      return res.status(400).json({
        success: false,
        message: `${dateStr}的${mealName}登记已关闭，无法进行操作`
      });
    }

    // 检查是否已经登记过
    const userRegistrations = await dataStore.read('user-registrations.json');
    const existingReg = userRegistrations.find(reg =>
      reg.userId === userId &&
      reg.date === today &&
      reg.mealType === mealType &&
      reg.dishName === '不吃'
    );

    if (existingReg) {
      const mealName = mealType === 'lunch' ? '午餐' : '晚餐';
      return res.json({
        success: true,
        message: `您今天的${mealName}已经登记过不吃了`,
        data: {
          userId,
          date: today,
          mealType,
          alreadyRegistered: true
        }
      });
    }

    // 执行不吃登记
    await addNoEatToUserRegistrations(
      today,
      mealType,
      userId,
      user ? user.name : '未知用户',
      new Date().toISOString(),
      `通过飞书直接登记 (${source})`
    );

    console.log(`飞书不吃登记成功: userId=${userId}, mealType=${mealType}, date=${today}`);

    // 更新订餐统计
    await orderManager.updateOrderCount(mealType, today);

    const mealName = mealType === 'lunch' ? '午餐' : '晚餐';
    res.json({
      success: true,
      message: `${mealName}不吃登记成功`,
      data: {
        userId,
        userName: user ? user.name : '未知用户',
        date: today,
        mealType,
        mealName,
        source
      }
    });

  } catch (error) {
    console.error('飞书直接不吃登记失败:', error);
    res.status(500).json({
      success: false,
      message: '登记失败，请重试'
    });
  }
});

// 轻食登记API（飞书按钮直接调用）
app.post('/api/light-meal', async (req, res) => {
  try {
    const { userId, meal, source = 'feishu' } = req.body;

    console.log('收到飞书直接轻食登记请求:', { userId, meal, source });

    if (!userId || !meal) {
      return res.status(400).json({
        success: false,
        message: '缺少必要参数'
      });
    }

    if (meal !== 'lunch' && meal !== 'dinner') {
      return res.status(400).json({
        success: false,
        message: '餐次参数无效'
      });
    }

    const today = moment().format('YYYY-MM-DD');
    const mealType = meal;

    // 查找或创建用户
    let user = await dataStore.findUserByAnyId(userId);
    if (!user) {
      console.log(`未找到用户映射，创建新用户: ${userId}`);

      // 创建新用户（来自飞书直接调用）
      user = {
        id: userId,
        name: `飞书用户_${userId.substring(0, 8)}`,
        loginMethod: 'feishu',
        firstLoginTime: new Date().toISOString(),
        lastLoginTime: new Date().toISOString()
      };

      // 保存新用户
      const userData = await dataStore.saveOrUpdateUser(user);
      console.log(`✅ 创建新用户成功: ${user.name} (${userId})`);

      // 记录用户ID映射
      if (userId.startsWith('on_')) {
        // union_id格式
        await dataStore.updateUserIdMapping(userId, [], []);
      } else if (userId.startsWith('ou_')) {
        // open_id格式
        await dataStore.updateUserIdMapping(null, [userId], []);
      }

      user = userData;
    } else {
      console.log(`✅ 找到现有用户映射: ${user.name || 'Unknown'}`);

      // 如果找到的用户映射有有效的unionId，使用它
      if (user.unionId && user.unionId !== 'null' && user.unionId !== userId) {
        console.log(`🔄 使用映射的union_id: ${userId} -> ${user.unionId}`);
        userId = user.unionId;
      }
    }

    // 检查管理员设置的餐次状态
    const dailyOrders = await dataStore.read('daily-orders.json');
    const orderRecord = dailyOrders.find(order =>
      order.date === today && order.mealType === mealType
    );

    // 如果管理员明确关闭了该餐次，则拒绝操作
    if (orderRecord && orderRecord.status === 'closed') {
      const mealName = mealType === 'lunch' ? '午餐' : '晚餐';
      const targetDate = moment(today);
      const dateStr = targetDate.format('MM月DD日');

      return res.status(400).json({
        success: false,
        message: `${dateStr}的${mealName}登记已关闭，无法进行操作`
      });
    }

    // 检查当餐是否有轻食菜品
    const { lunch, dinner } = await getTodayMenuData();
    const todayMeal = mealType === 'lunch' ? lunch : dinner;
    const hasLightMeal = todayMeal && todayMeal.some(dish =>
      dish.tags && Array.isArray(dish.tags) &&
      (dish.tags.includes('轻食') || dish.tags.includes('light'))
    );

    if (!hasLightMeal) {
      const mealName = mealType === 'lunch' ? '午餐' : '晚餐';
      return res.status(400).json({
        success: false,
        message: `今天${mealName}没有轻食菜品，无法登记吃轻食`
      });
    }

    // 检查是否已经登记过轻食
    const userRegistrations = await dataStore.read('user-registrations.json');
    const existingLightMeal = userRegistrations.find(reg =>
      reg.userId === userId &&
      reg.date === today &&
      reg.mealType === mealType &&
      reg.dishName === '轻食'
    );

    if (existingLightMeal) {
      const mealName = mealType === 'lunch' ? '午餐' : '晚餐';
      return res.json({
        success: true,
        message: `您今天的${mealName}已经登记过吃轻食了`,
        data: {
          userId,
          date: today,
          mealType,
          alreadyRegistered: true
        }
      });
    }

    // 先删除该用户今天这餐的所有登记（不吃、轻食等）
    const updatedRegistrations = userRegistrations.filter(reg =>
      !(reg.userId === userId && reg.date === today && reg.mealType === mealType)
    );

    // 添加轻食登记
    updatedRegistrations.push({
      userId,
      userName: user ? user.name : '未知用户',
      date: today,
      mealType,
      dishName: '轻食',
      registeredAt: new Date().toISOString(),
      source: `通过飞书直接登记 (${source})`
    });

    await dataStore.write('user-registrations.json', updatedRegistrations);

    console.log(`飞书轻食登记成功: userId=${userId}, mealType=${mealType}, date=${today}`);

    // 更新订餐统计
    await orderManager.updateOrderCount(mealType, today);

    const mealName = mealType === 'lunch' ? '午餐' : '晚餐';
    res.json({
      success: true,
      message: `${mealName}轻食登记成功`,
      data: {
        userId,
        userName: user ? user.name : '未知用户',
        date: today,
        mealType,
        mealName,
        source
      }
    });

  } catch (error) {
    console.error('飞书直接轻食登记失败:', error);
    res.status(500).json({
      success: false,
      message: '登记失败，请重试'
    });
  }
});

// 不吃登记API
app.post('/api/no-eat/register', requireAuth, async (req, res) => {
  try {
    const { mealType, date } = req.body;
    const userId = req.session.user.id;

    console.log('收到不吃登记请求:', { mealType, date, userId });
    console.log('[DEBUG] 开始处理不吃登记，用户会话状态:', !!req.session?.user);

    if (!mealType || !date) {
      return res.status(400).json({
        success: false,
        message: '缺少必要参数'
      });
    }

    const now = moment();
    const targetDate = moment(date);

    console.log('[DEBUG] 当前时间:', now.format('YYYY-MM-DD HH:mm:ss'));

    // 首先检查管理员设置的餐次状态
    const dailyOrders = await dataStore.read('daily-orders.json');
    const orderRecord = dailyOrders.find(order =>
      order.date === date && order.mealType === mealType
    );

    console.log('[DEBUG] 查找管理员状态记录:', { date, mealType });
    console.log('[DEBUG] 找到的记录:', orderRecord);

    // 如果管理员明确关闭了该餐次，则拒绝操作
    if (orderRecord && orderRecord.status === 'closed') {
      const dateStr = targetDate.format('MM月DD日');
      const mealStr = mealType === 'lunch' ? '午餐' : '晚餐';
      return res.status(400).json({
        success: false,
        message: `${dateStr}${mealStr}已被管理员关闭，无法进行登记操作`
      });
    }

    // 如果管理员明确设置为开启状态，则跳过时间检查
    // 如果没有管理员设置记录或状态不是'open'，则进行正常的时间检查
    console.log('[DEBUG] 时间检查逻辑:', {
      hasRecord: !!orderRecord,
      status: orderRecord?.status,
      willCheckTime: !orderRecord || orderRecord.status !== 'open'
    });

    if (!orderRecord || orderRecord.status !== 'open') {
      // 检查时间限制：登记截止时间是该餐当天的时间
      // 午餐截止时间：目标日期当天11点
      if (mealType === 'lunch') {
        const lunchDeadline = moment(date).hour(11).minute(0).second(0);
        console.log('[DEBUG] 午餐时间检查:', {
          now: now.format('YYYY-MM-DD HH:mm:ss'),
          deadline: lunchDeadline.format('YYYY-MM-DD HH:mm:ss'),
          isAfter: now.isAfter(lunchDeadline)
        });
        if (now.isAfter(lunchDeadline)) {
          const dateStr = targetDate.format('MM月DD日');
          console.log('[DEBUG] 午餐时间检查失败，返回错误');
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
    }

    console.log('[DEBUG] 读取用户登记数据前');
    const userRegistrations = await dataStore.read('user-registrations.json');
    console.log('[DEBUG] 读取用户登记数据后，记录数:', userRegistrations.length);

    // 检查用户是否已经登记过
    const existingReg = userRegistrations.find(reg =>
      reg.userId === userId && reg.mealType === mealType && reg.date === date && reg.dishName === '不吃'
    );

    if (existingReg) {
      return res.status(400).json({
        success: false,
        message: '您已经登记过不吃了'
      });
    }

    // 使用统一的不吃登记函数（单一数据源）
    console.log('[DEBUG] 开始调用 addNoEatToUserRegistrations');
    const userName = req.session.user ? req.session.user.name : '未知用户';
    const registeredAt = moment().toISOString();
    await addNoEatToUserRegistrations(date, mealType, userId, userName, registeredAt, '用户界面登记');
    console.log('[DEBUG] addNoEatToUserRegistrations 调用完成');

    console.log('添加不吃记录到用户登记:', { userId, mealType, date, userName });

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

// 获取餐次开放状态API
app.get('/api/meal/status', requireAuth, async (req, res) => {
  try {
    const { date } = req.query;
    const targetDate = date || dataStore.getTodayString();

    const dailyOrders = await dataStore.read('daily-orders.json');

    // 查找对应日期的餐次状态
    const lunchOrder = dailyOrders.find(order =>
      order.date === targetDate && order.mealType === 'lunch'
    );
    const dinnerOrder = dailyOrders.find(order =>
      order.date === targetDate && order.mealType === 'dinner'
    );

    res.json({
      success: true,
      data: {
        lunch: {
          status: lunchOrder ? lunchOrder.status : 'closed',
          canModify: lunchOrder ? lunchOrder.status === 'open' : false
        },
        dinner: {
          status: dinnerOrder ? dinnerOrder.status : 'closed',
          canModify: dinnerOrder ? dinnerOrder.status === 'open' : false
        }
      }
    });
  } catch (error) {
    console.error('获取餐次状态失败:', error);
    res.status(500).json({
      success: false,
      message: '获取状态失败，请重试'
    });
  }
});

// 获取个人点餐历史API - 新逻辑：默认每顿餐都点餐，除非明确登记不吃
app.get('/api/user/meal-history', requireAuth, async (req, res) => {
  try {
    const userId = req.session.user?.id;
    if (!userId) {
      return res.status(401).json({
        success: false,
        message: '未登录或用户信息无效'
      });
    }

    const { page = 1, limit = 20, mealType } = req.query;
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const offset = (pageNum - 1) * limitNum;

    // 读取数据
    const [users, userRegistrations, dailyOrders] = await Promise.all([
      dataStore.read('users.json') || [],
      dataStore.read('user-registrations.json') || [],
      dataStore.read('daily-orders.json') || []
    ]);

    // 获取用户信息
    const user = users.find(u => u.id === userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: '用户信息未找到'
      });
    }

    // 获取用户注册时间
    const userStartDate = new Date(user.firstLoginTime || user.lastLoginTime);
    const today = new Date();

    // 设置时间为当天开始，避免时区问题
    userStartDate.setHours(0, 0, 0, 0);
    today.setHours(23, 59, 59, 999);

    // 生成完整的点餐历史（默认逻辑）
    const completeHistory = [];

    // 从用户注册日期开始，到今天为止的每一天
    for (let date = new Date(userStartDate); date.toISOString().split('T')[0] <= today.toISOString().split('T')[0]; ) {
      const dateStr = date.toISOString().split('T')[0];
      const dayOfWeek = date.getDay();

      // 只处理工作日（周一到周五，0=周日，1=周一...5=周五，6=周六）
      if (dayOfWeek >= 1 && dayOfWeek <= 5) {
        // 为每个工作日生成午餐和晚餐记录
        ['lunch', 'dinner'].forEach(meal => {
          // 检查用户是否有明确的登记记录
          const userRecord = userRegistrations.find(r =>
            r.userId === userId && r.date === dateStr && r.mealType === meal
          );

          // 获取当天的菜单信息
          const dayMenu = dailyOrders.find(order => order.date === dateStr);
          const mealMenu = dayMenu && dayMenu[meal] ? dayMenu[meal] : [];

          let historyRecord = {
            id: userRecord?.id || `default_${userId}_${dateStr}_${meal}`,
            date: dateStr,
            mealType: meal,
            mealTypeName: meal === 'lunch' ? '午餐' : '晚餐',
            createdAt: userRecord?.createdAt || new Date(date).toISOString(),
            updatedAt: userRecord?.updatedAt || userRecord?.createdAt || new Date(date).toISOString()
          };

          if (userRecord) {
            // 用户有明确登记
            if (userRecord.dishName === '不吃') {
              // 用户登记不吃，跳过不添加到点餐记录中
              return;
            } else {
              // 用户选择了具体菜品
              historyRecord = {
                ...historyRecord,
                dishName: userRecord.dishName,
                restaurantName: userRecord.restaurantName,
                price: userRecord.price || 0,
                note: userRecord.note,
                isNoEat: false,
                status: 'ordered'
              };
            }
          } else {
            // 用户没有明确登记，默认点餐
            const defaultDish = mealMenu.length > 0 ? mealMenu[0] : null;
            historyRecord = {
              ...historyRecord,
              dishName: defaultDish ? defaultDish.dishName : '默认套餐',
              restaurantName: defaultDish ? defaultDish.restaurantName : '系统默认',
              price: defaultDish ? defaultDish.price : 0,
              note: '系统默认点餐（未明确选择）',
              isNoEat: false,
              status: 'default'
            };
          }

          completeHistory.push(historyRecord);
        });
      }

      // 增加一天
      date.setDate(date.getDate() + 1);
    }

    // 按餐次类型过滤（如果指定）
    let filteredHistory = completeHistory;
    if (mealType && ['lunch', 'dinner'].includes(mealType)) {
      filteredHistory = completeHistory.filter(record => record.mealType === mealType);
    }

    // 按日期倒序排序（最新的在前）
    filteredHistory.sort((a, b) => {
      const dateA = new Date(a.date);
      const dateB = new Date(b.date);
      if (dateA.getTime() === dateB.getTime()) {
        // 同一天的话，晚餐排在午餐前
        if (a.mealType === 'dinner' && b.mealType === 'lunch') return -1;
        if (a.mealType === 'lunch' && b.mealType === 'dinner') return 1;
        return 0;
      }
      return dateB.getTime() - dateA.getTime();
    });

    // 分页
    const total = filteredHistory.length;
    const paginatedHistory = filteredHistory.slice(offset, offset + limitNum);

    res.json({
      success: true,
      data: {
        history: paginatedHistory,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total,
          totalPages: Math.ceil(total / limitNum),
          hasNext: (pageNum * limitNum) < total,
          hasPrev: pageNum > 1
        }
      }
    });

  } catch (error) {
    console.error('获取个人点餐历史失败:', error);
    res.status(500).json({
      success: false,
      message: '获取点餐历史失败，请重试'
    });
  }
});

// 检查用户不吃登记状态API（已弃用，请使用 /api/meal-preference/status）
app.get('/api/no-eat/status', requireAuth, async (req, res) => {
  try {
    const { mealType, date } = req.query;
    const userId = req.session.user.id;

    console.log(`[DEBUG] 检查不吃状态 - 用户: ${userId}, 餐次: ${mealType}, 日期: ${date}`);

    if (!mealType || !date) {
      return res.status(400).json({
        success: false,
        message: '缺少必要参数'
      });
    }

    // 改为从 user-registrations.json 查询（单一数据源）
    const userRegistrations = await dataStore.read('user-registrations.json');
    console.log(`[DEBUG] 总用户登记记录数: ${userRegistrations.length}`);

    // 检查用户是否已经登记过不吃
    const existingReg = userRegistrations.find(reg =>
      reg.userId === userId &&
      reg.mealType === mealType &&
      reg.date === date &&
      reg.dishName === '不吃'
    );

    console.log(`[DEBUG] 找到匹配的不吃记录:`, existingReg);

    const result = {
      success: true,
      data: {
        registered: !!existingReg,
        registeredAt: existingReg ? existingReg.createdAt : null
      }
    };

    console.log(`[DEBUG] 返回结果:`, result);
    res.json(result);
  } catch (error) {
    console.error('检查不吃登记状态失败:', error);
    res.status(500).json({
      success: false,
      message: '检查状态失败'
    });
  }
});

// 检查用户餐次偏好状态API（支持轻食和不吃）
app.get('/api/meal-preference/status', requireAuth, async (req, res) => {
  try {
    const { mealType, date } = req.query;
    const userId = req.session.user.id;

    console.log(`[DEBUG] 检查用餐偏好状态 - 用户: ${userId}, 餐次: ${mealType}, 日期: ${date}`);

    if (!mealType || !date) {
      return res.status(400).json({
        success: false,
        message: '缺少必要参数'
      });
    }

    const userRegistrations = await dataStore.read('user-registrations.json');
    console.log(`[DEBUG] 总用户登记记录数: ${userRegistrations.length}`);

    // 检查用户的餐次偏好（不吃或轻食）
    const existingReg = userRegistrations.find(reg =>
      reg.userId === userId &&
      reg.mealType === mealType &&
      reg.date === date &&
      (reg.dishName === '不吃' || reg.dishName === '轻食')
    );

    console.log(`[DEBUG] 找到匹配的偏好记录:`, existingReg);

    let preference = 'eat'; // 默认正常用餐
    if (existingReg) {
      if (existingReg.dishName === '不吃') {
        preference = 'no-eat';
      } else if (existingReg.dishName === '轻食') {
        preference = 'light';
      }
    }

    const result = {
      success: true,
      data: {
        preference: preference,
        registeredAt: existingReg ? existingReg.registeredAt : null
      }
    };

    console.log(`[DEBUG] 返回结果:`, result);
    res.json(result);
  } catch (error) {
    console.error('检查用餐偏好状态失败:', error);
    res.status(500).json({
      success: false,
      message: '检查状态失败'
    });
  }
});

// 取消不吃登记API
app.delete('/api/no-eat/register', requireAuth, async (req, res) => {
  try {
    const { mealType, date } = req.body;
    const userId = req.session.user.id;

    if (!mealType || !date) {
      return res.status(400).json({
        success: false,
        message: '缺少必要参数'
      });
    }

    // 检查管理员是否已关闭该日期和餐次的点餐
    const dailyOrders = await dataStore.read('daily-orders.json');
    const orderRecord = dailyOrders.find(order =>
      order.date === date && order.mealType === mealType
    );

    if (orderRecord && orderRecord.status === 'closed') {
      const targetDate = moment(date);
      const dateStr = targetDate.format('MM月DD日');
      const mealStr = mealType === 'lunch' ? '午餐' : '晚餐';
      return res.status(400).json({
        success: false,
        message: `${dateStr}${mealStr}已被管理员关闭，无法进行取消操作`
      });
    }

    // 检查用户登记记录中是否存在不吃记录
    const userRegistrations = await dataStore.read('user-registrations.json');
    const existingReg = userRegistrations.find(reg =>
      reg.userId === userId && reg.mealType === mealType && reg.date === date && reg.dishName === '不吃'
    );

    if (!existingReg) {
      return res.status(400).json({
        success: false,
        message: '未找到登记记录'
      });
    }

    // 使用单一数据源，只需要删除用户登记记录中的不吃记录
    await removeNoEatFromUserRegistrations(date, mealType, userId);

    // 更新订餐统计
    await orderManager.updateOrderCount(mealType, date);

    res.json({
      success: true,
      message: '取消登记成功'
    });
  } catch (error) {
    console.error('取消不吃登记失败:', error);
    res.status(500).json({
      success: false,
      message: '取消登记失败，请重试'
    });
  }
});

// 用餐偏好登记API（支持轻食和不吃）
app.post('/api/meal-preference/register', requireAuth, async (req, res) => {
  try {
    const { mealType, date, preference } = req.body;
    const userId = req.session.user.id;

    console.log('收到用餐偏好登记请求:', { mealType, date, preference, userId });

    if (!mealType || !date || !preference) {
      return res.status(400).json({
        success: false,
        message: '缺少必要参数'
      });
    }

    if (!['light', 'no-eat'].includes(preference)) {
      return res.status(400).json({
        success: false,
        message: '无效的用餐偏好'
      });
    }

    const now = moment();
    const targetDate = moment(date);

    console.log('[DEBUG] 当前时间:', now.format('YYYY-MM-DD HH:mm:ss'));

    // 检查管理员设置的餐次状态
    const dailyOrders = await dataStore.read('daily-orders.json');
    const orderRecord = dailyOrders.find(order =>
      order.date === date && order.mealType === mealType
    );

    console.log('[DEBUG] 查找管理员状态记录:', { date, mealType });
    console.log('[DEBUG] 找到的记录:', orderRecord);

    // 如果管理员明确关闭了该餐次，则拒绝操作
    if (orderRecord && orderRecord.status === 'closed') {
      const dateStr = targetDate.format('MM月DD日');
      const mealStr = mealType === 'lunch' ? '午餐' : '晚餐';
      return res.status(400).json({
        success: false,
        message: `${dateStr}${mealStr}已被管理员关闭，无法进行登记操作`
      });
    }

    // 如果管理员明确设置为开启状态，则跳过时间检查
    if (!orderRecord || orderRecord.status !== 'open') {
      // 检查时间限制
      if (mealType === 'lunch') {
        const lunchDeadline = moment(date).hour(11).minute(0).second(0);
        console.log('[DEBUG] 午餐时间检查:', {
          now: now.format('YYYY-MM-DD HH:mm:ss'),
          deadline: lunchDeadline.format('YYYY-MM-DD HH:mm:ss'),
          isAfter: now.isAfter(lunchDeadline)
        });
        if (now.isAfter(lunchDeadline)) {
          const dateStr = targetDate.format('MM月DD日');
          return res.status(400).json({
            success: false,
            message: `${dateStr}午餐登记时间已截止（${dateStr}11点后不可登记）`
          });
        }
      }

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
    }

    const userRegistrations = await dataStore.read('user-registrations.json');

    // 删除该用户在该日期该餐次的所有现有偏好记录（不吃或轻食）
    const updatedRegs = userRegistrations.filter(reg =>
      !(reg.userId === userId && reg.mealType === mealType && reg.date === date &&
        (reg.dishName === '不吃' || reg.dishName === '轻食'))
    );

    // 添加新的偏好记录
    const userName = req.session.user ? req.session.user.name : '未知用户';
    const registeredAt = moment().toISOString();
    const dishName = preference === 'light' ? '轻食' : '不吃';

    updatedRegs.push({
      id: dataStore.generateId(updatedRegs),
      userId: userId,
      userName: userName,
      date: date,
      mealType: mealType,
      dishName: dishName,
      restaurantName: dishName === '轻食' ? '轻食' : '不点餐',
      registeredAt: registeredAt,
      source: '用户界面登记'
    });

    await dataStore.write('user-registrations.json', updatedRegs);
    console.log('添加用餐偏好记录到用户登记:', { userId, mealType, date, userName, preference });

    // 更新订餐统计
    await orderManager.updateOrderCount(mealType, date);

    const preferenceText = preference === 'light' ? '轻食' : '不吃';
    res.json({
      success: true,
      message: `${preferenceText}登记成功`
    });
  } catch (error) {
    console.error('用餐偏好登记失败:', error);
    res.status(500).json({
      success: false,
      message: '登记失败，请重试'
    });
  }
});

// 取消用餐偏好登记API（取消轻食或不吃，恢复正常用餐）
app.delete('/api/meal-preference/register', requireAuth, async (req, res) => {
  try {
    const { mealType, date } = req.body;
    const userId = req.session.user.id;

    if (!mealType || !date) {
      return res.status(400).json({
        success: false,
        message: '缺少必要参数'
      });
    }

    // 检查管理员是否已关闭该日期和餐次的点餐
    const dailyOrders = await dataStore.read('daily-orders.json');
    const orderRecord = dailyOrders.find(order =>
      order.date === date && order.mealType === mealType
    );

    if (orderRecord && orderRecord.status === 'closed') {
      const targetDate = moment(date);
      const dateStr = targetDate.format('MM月DD日');
      const mealStr = mealType === 'lunch' ? '午餐' : '晚餐';
      return res.status(400).json({
        success: false,
        message: `${dateStr}${mealStr}已被管理员关闭，无法进行取消操作`
      });
    }

    // 删除用户的用餐偏好记录（不吃或轻食）
    const userRegistrations = await dataStore.read('user-registrations.json');
    const existingReg = userRegistrations.find(reg =>
      reg.userId === userId && reg.mealType === mealType && reg.date === date &&
      (reg.dishName === '不吃' || reg.dishName === '轻食')
    );

    if (!existingReg) {
      return res.status(400).json({
        success: false,
        message: '未找到登记记录'
      });
    }

    // 删除偏好记录
    const updatedRegs = userRegistrations.filter(reg =>
      !(reg.userId === userId && reg.mealType === mealType && reg.date === date &&
        (reg.dishName === '不吃' || reg.dishName === '轻食'))
    );

    await dataStore.write('user-registrations.json', updatedRegs);

    // 更新订餐统计
    await orderManager.updateOrderCount(mealType, date);

    res.json({
      success: true,
      message: '取消登记成功，已恢复正常用餐'
    });
  } catch (error) {
    console.error('取消用餐偏好登记失败:', error);
    res.status(500).json({
      success: false,
      message: '取消登记失败，请重试'
    });
  }
});

// 辅助函数：将不吃记录同步到详细点餐记录中
async function syncNoEatToOrderDetails(date, mealType, userId, userName, registeredAt) {
  try {
    console.log(`[syncNoEatToOrderDetails] 开始同步不吃记录: ${date} ${mealType} ${userName}`);

    const dailyOrders = await dataStore.read('daily-orders.json');

    // 查找当天对应餐次的详细订单记录
    const targetOrder = dailyOrders.find(order =>
      order.date === date &&
      order.mealType === mealType &&
      order.dishes && // 只处理有 dishes 字段的详细记录
      Array.isArray(order.dishes)
    );

    if (targetOrder) {
      console.log(`[syncNoEatToOrderDetails] 找到目标订单记录，ID: ${targetOrder.id}`);

      // 在第一个菜品中添加不吃订单记录
      if (targetOrder.dishes.length > 0) {
        if (!targetOrder.dishes[0].orders) {
          targetOrder.dishes[0].orders = [];
        }

        // 检查是否已经存在该用户的记录，避免重复
        const existingOrderIndex = targetOrder.dishes[0].orders.findIndex(order => order.userId === userId);

        const noEatOrder = {
          userId: userId,
          userName: userName,
          quantity: 1,
          isNoEat: true,
          createdAt: registeredAt,
          note: '不吃登记'
        };

        if (existingOrderIndex >= 0) {
          // 更新现有记录
          targetOrder.dishes[0].orders[existingOrderIndex] = noEatOrder;
          console.log(`[syncNoEatToOrderDetails] 更新现有用户记录: ${userName}`);
        } else {
          // 添加新记录
          targetOrder.dishes[0].orders.push(noEatOrder);
          console.log(`[syncNoEatToOrderDetails] 添加新用户记录: ${userName}`);
        }

        await dataStore.write('daily-orders.json', dailyOrders);
        console.log(`[syncNoEatToOrderDetails] 不吃记录同步成功`);
      }
    } else {
      console.log(`[syncNoEatToOrderDetails] 未找到对应的详细订单记录，可能该日期使用简化格式`);
    }
  } catch (error) {
    console.error('同步不吃记录到详细点餐记录失败:', error);
  }
}

// 辅助函数：将不吃记录添加到用户登记记录中（管理员界面显示）
async function addNoEatToUserRegistrations(date, mealType, userId, userName, registeredAt, note = '通过网页登记') {
  try {
    console.log(`[addNoEatToUserRegistrations] 开始添加不吃记录到用户登记: ${date} ${mealType} ${userName}`);

    const userRegistrations = await dataStore.read('user-registrations.json');

    // 检查是否已经存在该用户的不吃记录
    const existingRegIndex = userRegistrations.findIndex(reg =>
      reg.userId === userId &&
      reg.date === date &&
      reg.mealType === mealType &&
      reg.dishName === '不吃'
    );

    if (existingRegIndex >= 0) {
      console.log(`[addNoEatToUserRegistrations] 用户已存在不吃记录，跳过添加: ${userName}`);
      return;
    }

    // 先删除该用户今天这餐的所有登记（包括轻食等），避免冲突
    const updatedRegistrations = userRegistrations.filter(reg =>
      !(reg.userId === userId && reg.date === date && reg.mealType === mealType)
    );

    console.log(`[addNoEatToUserRegistrations] 删除该用户今天这餐的冲突登记`);

    // 生成新的登记记录
    const newRegistration = {
      id: Date.now().toString(),
      userId: userId,
      date: date,
      mealType: mealType,
      dishId: null,
      dishName: '不吃',
      restaurantName: '无',
      price: 0,
      createdAt: registeredAt,
      updatedAt: registeredAt,
      note: note
    };

    updatedRegistrations.push(newRegistration);
    await dataStore.write('user-registrations.json', updatedRegistrations);
    console.log(`[addNoEatToUserRegistrations] 不吃记录添加成功: ${userName}`);
  } catch (error) {
    console.error('添加不吃记录到用户登记失败:', error);
  }
}

// 辅助函数：验证不吃数据同步状态
async function verifyNoEatDataSync(userId, date, mealType) {
  try {
    console.log(`[verifyNoEatDataSync] 验证数据同步: ${userId} ${date} ${mealType}`);

    // 单一数据源，只需要检查用户登记记录即可
    const userRegistrations = await dataStore.read('user-registrations.json');

    const userNoEatRecord = userRegistrations.find(reg =>
      reg.userId === userId &&
      reg.date === date &&
      reg.mealType === mealType &&
      reg.dishName === '不吃'
    );

    if (userNoEatRecord) {
      console.log(`✅ [verifyNoEatDataSync] 单一数据源，数据正常: ${userId} ${date} ${mealType}`);
      return true;
    } else {
      console.log(`❌ [verifyNoEatDataSync] 未找到不吃记录: ${userId} ${date} ${mealType}`);
      return false;
    }

  } catch (error) {
    console.error('[verifyNoEatDataSync] 验证数据同步失败:', error);
    return false;
  }
}

// 辅助函数：从用户登记记录中删除不吃记录（管理员界面显示）
async function removeNoEatFromUserRegistrations(date, mealType, userId) {
  try {
    console.log(`[removeNoEatFromUserRegistrations] 开始删除用户登记中的不吃记录: ${date} ${mealType} ${userId}`);

    const userRegistrations = await dataStore.read('user-registrations.json');

    // 找到并删除对应的不吃记录
    const regIndex = userRegistrations.findIndex(reg =>
      reg.userId === userId &&
      reg.date === date &&
      reg.mealType === mealType &&
      reg.dishName === '不吃'
    );

    if (regIndex >= 0) {
      const deletedReg = userRegistrations.splice(regIndex, 1)[0];
      await dataStore.write('user-registrations.json', userRegistrations);
      console.log(`[removeNoEatFromUserRegistrations] 删除不吃记录成功: ${deletedReg.id}`);
    } else {
      console.log(`[removeNoEatFromUserRegistrations] 未找到对应的不吃记录`);
    }
  } catch (error) {
    console.error('从用户登记记录中删除不吃记录失败:', error);
  }
}

// 辅助函数：更新用户最后点餐时间
async function updateUserLastOrderTime(userId, orderTime) {
  try {
    console.log(`[updateUserLastOrderTime] 更新用户最后点餐时间: ${userId} ${orderTime}`);

    const users = await dataStore.read('users.json');
    const userIndex = users.findIndex(user => user.id === userId);

    if (userIndex >= 0) {
      users[userIndex].lastOrderTime = orderTime;
      users[userIndex].lastLoginTime = orderTime; // 同时更新最后登录时间

      await dataStore.write('users.json', users);
      console.log(`[updateUserLastOrderTime] 用户时间更新成功: ${users[userIndex].name}`);
    } else {
      console.log(`[updateUserLastOrderTime] 用户不存在: ${userId}`);
    }
  } catch (error) {
    console.error('更新用户最后点餐时间失败:', error);
  }
}

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

// =================== 工具函数 ===================

// 确保当天有点餐记录
async function ensureDailyOrderRecords(targetDate = null) {
  const date = targetDate || moment().format('YYYY-MM-DD');
  return await dataStore.ensureDailyOrderRecord(date);
}

// 确保所有有菜单的日期都有点餐记录
async function ensureAllMenuDatesHaveOrderRecords() {
  try {
    const dailyOrders = await dataStore.read('daily-orders.json') || [];
    const menuDates = new Set();

    // 收集所有有菜单的日期
    dailyOrders.forEach(record => {
      if (record.lunch || record.dinner) {
        menuDates.add(record.date);
      }
    });

    let totalCreated = 0;

    // 为每个有菜单的日期确保存在点餐记录
    for (const date of menuDates) {
      const created = await dataStore.ensureDailyOrderRecord(date);
      if (created) totalCreated++;
    }

    if (totalCreated > 0) {
      console.log(`为${totalCreated}天有菜单但无点餐记录的日期创建了点餐记录`);
    }

    return totalCreated;
  } catch (error) {
    console.error('确保菜单日期点餐记录失败:', error);
    return 0;
  }
}

// 确保整个菜单周期都有点餐记录（包括周六）
async function ensureWeeklyOrderRecords() {
  const weekStart = moment(dataStore.getWeekStart());
  let totalCreated = 0;

  // 为周日到周六（7天）创建记录
  for (let i = 0; i < 7; i++) {
    const date = weekStart.clone().add(i, 'days').format('YYYY-MM-DD');
    const created = await dataStore.ensureDailyOrderRecord(date);
    if (created) totalCreated++;
  }

  if (totalCreated > 0) {
    console.log(`为本菜单周期补充了${totalCreated}天的点餐记录（包括周六）`);
  }
}

// 确保未来30天都有点餐记录
async function ensureFutureMonthOrderRecords() {
  const today = moment();
  let totalCreated = 0;

  // 为未来30天创建点餐记录
  for (let i = 0; i <= 30; i++) {
    const date = today.clone().add(i, 'days').format('YYYY-MM-DD');
    const created = await dataStore.ensureDailyOrderRecord(date);
    if (created) totalCreated++;
  }

  if (totalCreated > 0) {
    console.log(`为未来30天补充了${totalCreated}天的点餐记录`);
  }

  return totalCreated;
}

// 定时任务管理器
class CronManager {
  constructor() {
    this.tasks = new Map();
  }

  // 添加或更新定时任务
  scheduleTask(taskName, cronExpression, taskFunction) {
    // 如果已有任务，先销毁
    if (this.tasks.has(taskName)) {
      const existingTask = this.tasks.get(taskName);
      try {
        if (typeof existingTask.destroy === 'function') {
          existingTask.destroy();
        } else if (typeof existingTask.stop === 'function') {
          existingTask.stop();
        }
      } catch (error) {
        console.warn(`销毁定时任务 "${taskName}" 时出错:`, error.message);
      }
    }

    // 创建新任务
    const task = cron.schedule(cronExpression, taskFunction, {
      scheduled: false
    });

    // 存储并启动任务
    this.tasks.set(taskName, task);
    task.start();

    console.log(`定时任务 "${taskName}" 已设置: ${cronExpression}`);
  }

  // 获取所有任务状态
  getTasksStatus() {
    const status = {};
    this.tasks.forEach((task, name) => {
      status[name] = task.running;
    });
    return status;
  }

  // 销毁所有任务
  destroyAll() {
    this.tasks.forEach((task, taskName) => {
      try {
        if (typeof task.destroy === 'function') {
          task.destroy();
        } else if (typeof task.stop === 'function') {
          task.stop();
        }
      } catch (error) {
        console.warn(`销毁定时任务 "${taskName}" 时出错:`, error.message);
      }
    });
    this.tasks.clear();
  }
}

// 创建定时任务管理器实例
const cronManager = new CronManager();

// 初始化定时任务
async function initializeCronJobs() {
  try {
    const settings = await dataStore.read('settings.json');

    // 每周六 00:00 生成下周菜单 (固定不变)
    cronManager.scheduleTask('generateWeeklyMenu', '0 0 * * 6', async () => {
      console.log('执行定时任务: 生成下周菜单');
      menuGenerator.generateWeeklyMenu();
      await ensureWeeklyOrderRecords();
      await ensureAllMenuDatesHaveOrderRecords();
      await ensureFutureMonthOrderRecords();
    });

    // 每天 00:01 确保未来30天都有点餐记录
    cronManager.scheduleTask('dailyEnsureFutureRecords', '1 0 * * *', async () => {
      console.log('执行定时任务: 确保未来30天点餐记录');
      await ensureFutureMonthOrderRecords();
    });

    // 解析时间配置，提供默认值
    const lunchOpenTime = settings.lunchOpenTime || '10:00';
    const dinnerOpenTime = settings.dinnerOpenTime || '16:00';
    const lunchCloseTime = settings.lunchCloseTime || '12:00';
    const dinnerCloseTime = settings.dinnerCloseTime || '18:00';
    const lunchPushTime = settings.lunchPushTime || '11:00';
    const dinnerPushTime = settings.dinnerPushTime || '17:00';

    const [lunchOpenHour, lunchOpenMin] = lunchOpenTime.split(':');
    const [dinnerOpenHour, dinnerOpenMin] = dinnerOpenTime.split(':');
    const [lunchCloseHour, lunchCloseMin] = lunchCloseTime.split(':');
    const [dinnerCloseHour, dinnerCloseMin] = dinnerCloseTime.split(':');
    const [lunchPushHour, lunchPushMin] = lunchPushTime.split(':');
    const [dinnerPushHour, dinnerPushMin] = dinnerPushTime.split(':');

    // 动态配置的定时任务
    cronManager.scheduleTask('lunchRegistration',
      `${lunchOpenMin} ${lunchOpenHour} * * 0,1,2,3,4,5`,
      async () => {
        console.log('执行定时任务: 开放午餐不吃登记');
        await ensureDailyOrderRecords();

        // 创建未来一个月的点餐记录
        const today = moment();
        let createdCount = 0;
        for (let i = 1; i <= 30; i++) {
          const futureDate = today.clone().add(i, 'days');
          const dayOfWeek = futureDate.day();
          // 只为工作日创建(周日到周五)
          if (dayOfWeek >= 0 && dayOfWeek <= 5) {
            const dateStr = futureDate.format('YYYY-MM-DD');
            const created = await dataStore.ensureDailyOrderRecord(dateStr);
            if (created) createdCount++;
          }
        }
        if (createdCount > 0) {
          console.log(`为未来${createdCount}天创建了点餐记录`);
        }

        orderManager.openRegistration('lunch');
      }
    );

    cronManager.scheduleTask('dinnerRegistration',
      `${dinnerOpenMin} ${dinnerOpenHour} * * 0,1,2,3,4,5`,
      () => {
        console.log('执行定时任务: 开放晚餐不吃登记');
        orderManager.openRegistration('dinner');
      }
    );

    cronManager.scheduleTask('lunchPush',
      `${lunchPushMin} ${lunchPushHour} * * 0,1,2,3,4,5`,
      async () => {
        console.log('执行定时任务: 推送当日午餐菜单到飞书群');
        try {
          await pushTodayLunchMenu();
        } catch (error) {
          console.error('推送当日午餐菜单失败:', error);
        }
      }
    );

    cronManager.scheduleTask('dinnerPush',
      `${dinnerPushMin} ${dinnerPushHour} * * 0,1,2,3,4,5`,
      async () => {
        console.log('执行定时任务: 推送当日晚餐菜单到飞书群');
        try {
          await pushTodayDinnerMenu();
        } catch (error) {
          console.error('推送当日晚餐菜单失败:', error);
        }
      }
    );

    // 自动关闭任务
    cronManager.scheduleTask('lunchClose',
      `${lunchCloseMin} ${lunchCloseHour} * * 0,1,2,3,4,5`,
      async () => {
        console.log('执行定时任务: 自动关闭午餐不吃登记');
        try {
          await orderManager.closeRegistration('lunch');
        } catch (error) {
          console.error('自动关闭午餐登记失败:', error);
        }
      }
    );

    cronManager.scheduleTask('dinnerClose',
      `${dinnerCloseMin} ${dinnerCloseHour} * * 0,1,2,3,4,5`,
      async () => {
        console.log('执行定时任务: 自动关闭晚餐不吃登记');
        try {
          await orderManager.closeRegistration('dinner');
        } catch (error) {
          console.error('自动关闭晚餐登记失败:', error);
        }
      }
    );

    console.log('所有定时任务初始化完成');
  } catch (error) {
    console.error('初始化定时任务失败:', error);
  }
}

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

    // 记录ID映射信息，用于数据继承
    if (userInfo.union_id && userInfo.open_id) {
      await dataStore.updateUserIdMapping(userInfo.union_id, userInfo.open_id, userInfo.user_id);
      console.log(`更新用户ID映射: union_id=${userInfo.union_id}, open_id=${userInfo.open_id}, user_id=${userInfo.user_id}`);
    }

    // 检查是否存在需要迁移的数据（通过其他ID创建的用户记录）
    const potentialOldIds = [userInfo.open_id, userInfo.user_id].filter(id => id && id !== userId);
    for (const oldId of potentialOldIds) {
      const oldUser = await dataStore.findUserByAnyId(oldId);
      if (oldUser && oldUser.id !== userId) {
        console.log(`发现需要迁移的旧用户数据: ${oldId} -> ${userId}`);
        await dataStore.migrateUserIdData(oldId, userId);

        // 删除旧用户记录
        const users = await dataStore.read('users.json') || [];
        const updatedUsers = users.filter(u => u.id !== oldId);
        await dataStore.write('users.json', updatedUsers);
        console.log(`删除旧用户记录: ${oldId}`);
      }
    }

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
    
    // 检查是否有不吃登记意图
    if (req.session.noEatIntent) {
      const { mealType, source } = req.session.noEatIntent;
      console.log(`🍽️ 检测到不吃登记意图: ${mealType}, 来源: ${source}`);

      try {
        // 执行不吃登记
        const today = moment().format('YYYY-MM-DD');
        const userRegistrations = await dataStore.read('user-registrations.json');

        // 检查是否已经登记过（单一数据源）
        const existingReg = userRegistrations.find(reg =>
          reg.userId === userId &&
          reg.date === today &&
          reg.mealType === mealType &&
          reg.dishName === '不吃'
        );

        if (!existingReg) {
          // 使用统一的不吃登记函数（单一数据源）
          const registeredAt = new Date().toISOString();
          await addNoEatToUserRegistrations(today, mealType, userId, req.session.user.name, registeredAt, '通过外部链接登记');
          console.log(`✅ 自动完成不吃登记: ${userId} ${today} ${mealType}`);

          // 更新订餐统计
          await orderManager.updateOrderCount(mealType, today);
        }

        // 清除登记意图
        delete req.session.noEatIntent;

        // 重定向到成功页面
        const mealName = mealType === 'lunch' ? '午餐' : '晚餐';
        const successPage = userRole === 'admin' ? '/admin-dashboard.html' : '/user-dashboard.html';
        res.redirect(`${successPage}?no_eat_registered=${mealType}&meal_name=${encodeURIComponent(mealName)}`);
        return;

      } catch (error) {
        console.error('自动不吃登记失败:', error);
        // 继续正常登录流程
      }
    }

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

// 手动启动飞书长连接（用于本地测试，无需重启进程）
app.post('/api/feishu/longconn/start', async (req, res) => {
  try {
    if (typeof global.__startFeishuLongConnection !== 'function') {
      return res.status(400).json({ success: false, message: '长连接启动器不可用（缺少SDK或未加载）' });
    }
    await global.__startFeishuLongConnection(FEISHU_CONFIG, console);
    res.json({ success: true, message: '长连接已启动' });
  } catch (e) {
    console.error('手动启动长连接失败:', e);
    res.status(500).json({ success: false, message: e.message });
  }
});

// 通过长连接发送群消息
app.post('/api/feishu/longconn/send-message', async (req, res) => {
  try {
    if (typeof global.__sendMessageViaLongConnection !== 'function') {
      return res.status(400).json({ success: false, message: '长连接消息发送器不可用' });
    }

    const { chatId, messageType = 'text', title, content, color = 'blue', actions = [] } = req.body;

    if (!chatId) {
      return res.status(400).json({ success: false, message: '缺少群聊ID (chatId)' });
    }

    if (!content) {
      return res.status(400).json({ success: false, message: '缺少消息内容' });
    }

    let message;

    // 根据消息类型构建消息对象
    switch (messageType) {
      case 'text':
        message = {
          msg_type: 'text',
          content: {
            text: title ? `${title}\n\n${content}` : content
          }
        };
        break;

      case 'card':
        message = {
          msg_type: 'interactive',
          card: {
            config: {
              wide_screen_mode: true,
              enable_forward: true
            },
            header: {
              title: {
                tag: 'plain_text',
                content: title || '消息'
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
        break;

      case 'interactive':
        message = {
          msg_type: 'interactive',
          card: {
            config: {
              wide_screen_mode: true,
              enable_forward: true
            },
            header: {
              title: {
                tag: 'plain_text',
                content: title || '消息'
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

        // 添加按钮
        if (actions && actions.length > 0) {
          message.card.elements.push({
            tag: 'action',
            actions: actions
          });
        }
        break;

      default:
        return res.status(400).json({ success: false, message: '不支持的消息类型' });
    }

    const result = await global.__sendMessageViaLongConnection(chatId, message, console);
    res.json(result);

  } catch (e) {
    console.error('通过长连接发送消息失败:', e);
    res.status(500).json({ success: false, message: e.message });
  }
});

// 获取机器人所在的群聊列表
app.get('/api/feishu/longconn/chats', async (req, res) => {
  try {
    if (typeof global.__getChatId !== 'function') {
      return res.status(400).json({ success: false, message: '长连接获取群聊功能不可用' });
    }

    const result = await global.__getChatId(console);
    res.json(result);

  } catch (e) {
    console.error('获取群聊列表失败:', e);
    res.status(500).json({ success: false, message: e.message });
  }
});

// 解析群链接中的 chat_code / link_token 获取 chat_id（open_chat_id）
app.post('/api/feishu/resolve-chat', async (req, res) => {
  try {
    if (!feishuAppBot) {
      return res.status(400).json({ success: false, message: 'Feishu AppBot 未初始化（缺少依赖或配置）' });
    }
    const { chatCode, linkToken, link } = req.body || {};
    let code = chatCode || linkToken;
    if (!code && typeof link === 'string') {
      const m = link.match(/[?&](chat_code|link_token)=([^&]+)/);
      if (m) code = decodeURIComponent(m[2]);
    }
    if (!code) {
      return res.status(400).json({ success: false, message: '请提供 chatCode / linkToken / link' });
    }
    const chatId = await feishuAppBot.resolveChatIdByCode(code);
    if (!chatId) {
      return res.status(404).json({ success: false, message: '未解析到 chat_id，请检查链接是否有效/权限是否足够' });
    }
    res.json({ success: true, chatId });
  } catch (error) {
    console.error('解析群链接失败:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// 使用应用机器人发送交互式卡片（IM接口）
app.post('/api/feishu/send-card', async (req, res) => {
  try {
    if (!feishuAppBot) {
      return res.status(400).json({ success: false, message: 'Feishu AppBot 未初始化（缺少依赖或配置）' });
    }

    const { chatId, mealType = 'lunch' } = req.body || {};
    const finalChatId = chatId || process.env.FEISHU_TARGET_CHAT_ID;
    if (!finalChatId) {
      return res.status(400).json({ success: false, message: '缺少 chatId（或设置 FEISHU_TARGET_CHAT_ID）' });
    }

    const card = (global.__buildNoEatCard ? global.__buildNoEatCard(mealType) : {
      config: { wide_screen_mode: true },
      header: { template: 'blue', title: { tag: 'plain_text', content: '🍽️ 登记不吃' } },
      elements: [
        { tag: 'div', text: { tag: 'lark_md', content: '点击下方按钮登记不吃' } },
        { tag: 'action', actions: [{ tag: 'button', text: { tag: 'plain_text', content: '🚫 登记不吃' }, type: 'primary', value: { action: 'no_eat_lunch' } }] }
      ]
    });

    const result = await feishuAppBot.sendInteractiveCardToChat(finalChatId, card);
    res.json({ success: true, data: result });
  } catch (error) {
    console.error('发送卡片失败:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// 删除用户（管理员权限）
app.delete('/api/admin/users/:userId', requireAdminAuth, async (req, res) => {
  try {
    const { userId } = req.params;

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: '缺少用户ID'
      });
    }

    // 不允许删除默认管理员
    const roleData = await dataStore.read('user-roles.json') || { defaultAdmins: [], users: {} };
    if (roleData.defaultAdmins && roleData.defaultAdmins.includes(userId)) {
      return res.status(400).json({
        success: false,
        message: '不能删除默认管理员'
      });
    }

    // 不允许删除自己，避免误锁
    if (req.session?.user?.id === userId) {
      return res.status(400).json({
        success: false,
        message: '不能删除当前登录用户'
      });
    }

    // 从用户列表中删除
    const users = await dataStore.read('users.json') || [];
    const index = users.findIndex(u => u.id === userId);
    if (index === -1) {
      return res.status(404).json({
        success: false,
        message: '用户不存在'
      });
    }

    const deletedUser = users.splice(index, 1)[0];
    await dataStore.write('users.json', users);

    // 清理角色映射（若有）
    if (roleData.users && roleData.users[userId]) {
      delete roleData.users[userId];
      await dataStore.write('user-roles.json', roleData);
    }

    return res.json({
      success: true,
      message: '用户删除成功',
      data: { id: deletedUser.id, name: deletedUser.name }
    });
  } catch (error) {
    console.error('删除用户失败:', error);
    return res.status(500).json({
      success: false,
      message: '删除用户失败'
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

// 用户中心页面 - 需要登录验证
app.get('/user-dashboard.html', requireAuthPage, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'user-dashboard.html'));
});

// 管理页面 - 需要管理员权限验证
app.get('/admin.html', requireAdminPage, (req, res) => {
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
    const { sortBy = 'time', userId } = req.query; // 排序方式: 'time' 或 'likes'

    const submissions = await dataStore.read('restaurant-submissions.json') || [];
    const likes = await dataStore.read('submission-likes.json') || [];

    console.log(`[投稿API] 获取投稿列表，用户ID: ${userId}, 排序: ${sortBy}`);
    console.log(`[投稿API DEBUG] 总投稿数: ${submissions.length}, 总点赞数: ${likes.length}`);
    console.log(`[投稿API DEBUG] 点赞数据样例:`, likes);

    // 计算每个投稿的点赞数和用户点赞状态
    const submissionsWithLikes = submissions.map(submission => {
      const submissionLikes = likes.filter(like => like.submissionId === submission.id);
      const likedByCurrentUser = userId ? submissionLikes.some(like => like.userId === userId) : false;

      console.log(`[投稿API DEBUG] 投稿ID=${submission.id}, 点赞数=${submissionLikes.length}, 用户${userId}已点赞=${likedByCurrentUser}`);
      console.log(`[投稿API DEBUG] 该投稿的点赞记录:`, submissionLikes);

      return {
        ...submission,
        likeCount: submissionLikes.length,
        likedByCurrentUser
      };
    });

    console.log(`[投稿API] 返回 ${submissionsWithLikes.length} 个投稿，用户 ${userId} 的点赞状态已计算`);

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

    console.log(`[点赞DEBUG] 收到请求: submissionId=${submissionId}, userId=${userId}, action=${action}`);

    if (!userId) {
      console.log('[点赞DEBUG] 用户ID为空');
      return res.status(400).json({ success: false, message: '用户ID不能为空' });
    }

    const likes = await dataStore.read('submission-likes.json') || [];
    console.log(`[点赞DEBUG] 当前点赞数据:`, likes);

    if (action === 'like') {
      // 检查是否已点赞
      const existingLike = likes.find(like =>
        like.submissionId === submissionId && like.userId === userId
      );

      console.log(`[点赞DEBUG] 检查已存在点赞:`, existingLike);

      if (!existingLike) {
        const newLike = {
          id: dataStore.generateId(likes),
          submissionId,
          userId,
          createdAt: moment().toISOString()
        };
        likes.push(newLike);
        console.log(`[点赞DEBUG] 添加新点赞:`, newLike);
        await dataStore.write('submission-likes.json', likes);
      } else {
        console.log(`[点赞DEBUG] 用户已点赞，跳过`);
      }
    } else if (action === 'unlike') {
      const originalCount = likes.length;
      const filteredLikes = likes.filter(like =>
        !(like.submissionId === submissionId && like.userId === userId)
      );
      console.log(`[点赞DEBUG] 取消点赞: 原数量=${originalCount}, 新数量=${filteredLikes.length}`);
      await dataStore.write('submission-likes.json', filteredLikes);
    }

    // 返回新的点赞数和用户点赞状态
    const newLikes = await dataStore.read('submission-likes.json') || [];
    const likeCount = newLikes.filter(like => like.submissionId === submissionId).length;
    const likedByCurrentUser = newLikes.some(like => like.submissionId === submissionId && like.userId === userId);
    console.log(`[点赞DEBUG] 最终点赞数: ${likeCount}, 用户点赞状态: ${likedByCurrentUser}`);

    res.json({ success: true, likeCount, likedByCurrentUser });
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

// 获取可评价的菜品（返回菜品管理中的所有菜品）
app.get('/api/ratings/ratable-dishes', requireAuth, async (req, res) => {
  try {
    const userId = req.session.user?.id;
    if (!userId) {
      return res.json({ success: false, error: '用户未登录' });
    }

    // 读取所有菜品数据
    const dishes = await dataStore.read('dishes.json') || [];

    // 提取所有菜品，按餐厅+菜名去重
    const dishMap = new Map();

    dishes.forEach(dish => {
      if (dish.name && dish.restaurantName) {
        const key = `${dish.restaurantName}-${dish.name}`;
        if (!dishMap.has(key)) {
          dishMap.set(key, {
            id: dish.id,
            name: dish.name,
            restaurant: dish.restaurantName,
            category: dish.category,
            period: dish.mealType || 'lunch',
            tags: dish.tags || []
          });
        }
      }
    });

    // 获取已评价的菜品
    const ratings = await dataStore.read('dish-ratings.json') || [];
    const ratedRestaurantDishes = ratings
      .filter(rating => rating.userId === userId)
      .map(rating => `${rating.restaurant}-${rating.dishName}`);

    // 过滤出未评价的菜品
    const ratableDishes = Array.from(dishMap.values())
      .filter(dish => !ratedRestaurantDishes.includes(`${dish.restaurant}-${dish.name}`))
      .sort((a, b) => {
        // 按餐厅名排序，相同餐厅的按菜品名排序
        if (a.restaurant !== b.restaurant) {
          return a.restaurant.localeCompare(b.restaurant, 'zh-CN');
        }
        return a.name.localeCompare(b.name, 'zh-CN');
      });

    console.log(`用户 ${userId} 可评价菜品数量: ${ratableDishes.length}`);

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
      
      // 使用已有的restaurant字段作为餐厅名，dishName作为菜品名
      let restaurantName = rating.restaurant || '未知餐厅';
      let dishName = rating.dishName || '未知菜品';
      
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
app.post('/api/ratings', requireAuth, async (req, res) => {
  try {
    const { dishId, dishName, restaurant, rating, comment } = req.body;
    const userId = req.session.user?.id;
    const userName = req.session.user?.name;

    if (!dishId || !dishName || !restaurant || !rating || !comment) {
      return res.status(400).json({ success: false, message: '缺少必要参数' });
    }

    if (!userId || !userName) {
      return res.status(401).json({ success: false, message: '用户未登录' });
    }

    if (rating < 1 || rating > 5) {
      return res.status(400).json({ success: false, message: '评分必须在1-5之间' });
    }

    // 检查是否已经评价过此菜品（按餐厅+菜名）
    const existingRatings = await dataStore.read('dish-ratings.json') || [];
    const hasRated = existingRatings.some(r =>
      r.restaurant === restaurant && r.dishName === dishName && r.userId === userId
    );

    if (hasRated) {
      return res.status(400).json({ success: false, message: '您已经评价过此餐厅的这道菜品' });
    }

    // 生成新的评价记录
    const newRating = {
      id: Date.now(),
      dishId,
      dishName,
      restaurant,
      rating,
      comment,
      userId,
      userName,
      createdAt: new Date().toISOString()
    };

    existingRatings.push(newRating);
    await dataStore.write('dish-ratings.json', existingRatings);

    console.log(`用户 ${userName} 评价了 ${restaurant} 的 ${dishName}，评分 ${rating} 星`);

    res.json({ success: true, data: newRating });
  } catch (error) {
    console.error('提交评价失败:', error);
    res.status(500).json({ success: false, message: '提交评价失败' });
  }
});

// 点赞/取消点赞评价
app.post('/api/ratings/like', requireAuth, async (req, res) => {
  try {
    const { ratingId } = req.body;
    const userId = req.session.user?.id;

    if (!ratingId) {
      return res.status(400).json({ success: false, message: '缺少评价ID' });
    }

    if (!userId) {
      return res.status(401).json({ success: false, message: '用户未登录' });
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

// 用户删除自己的评价
app.delete('/api/ratings/:ratingId', requireAuth, async (req, res) => {
  try {
    const { ratingId } = req.params;
    const userId = req.session.user?.id;

    if (!ratingId) {
      return res.status(400).json({ success: false, message: '缺少评价ID' });
    }

    if (!userId) {
      return res.status(401).json({ success: false, message: '用户未登录' });
    }

    // 读取评价数据
    const ratings = await dataStore.read('dish-ratings.json') || [];

    // 查找要删除的评价
    const ratingIndex = ratings.findIndex(r => r.id == ratingId);
    if (ratingIndex === -1) {
      return res.status(404).json({ success: false, message: '评价不存在' });
    }

    const rating = ratings[ratingIndex];

    // 检查是否是用户自己的评价
    if (rating.userId !== userId) {
      return res.status(403).json({ success: false, message: '只能删除自己的评价' });
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

// 管理员手动确保所有菜单日期都有点餐记录
app.post('/api/admin/ensure-menu-order-records', requireAdminAuth, async (req, res) => {
  try {
    console.log('开始为所有菜单日期创建缺失的点餐记录...');
    const totalCreated = await ensureAllMenuDatesHaveOrderRecords();
    res.json({
      success: true,
      message: `成功为${totalCreated}天有菜单但无点餐记录的日期创建了点餐记录`,
      totalCreated
    });
  } catch (error) {
    console.error('确保菜单点餐记录失败:', error);
    res.status(500).json({ success: false, message: '操作失败: ' + error.message });
  }
});

// 管理员手动开放点餐登记
app.post('/api/admin/open-registration', requireAdminAuth, async (req, res) => {
  try {
    const { mealType, date } = req.body;

    if (!mealType || !['lunch', 'dinner'].includes(mealType)) {
      return res.status(400).json({ success: false, message: '无效的餐次类型' });
    }

    console.log(`管理员手动开放${date || '今日'}的${mealType === 'lunch' ? '午餐' : '晚餐'}登记...`);

    // 如果指定了日期，临时设置目标日期
    if (date) {
      const originalGetTodayString = dataStore.getTodayString;
      dataStore.getTodayString = () => date;
      await orderManager.openRegistration(mealType);
      dataStore.getTodayString = originalGetTodayString;
    } else {
      await ensureDailyOrderRecords();
      await orderManager.openRegistration(mealType);
    }

    res.json({
      success: true,
      message: `成功开放${date || '今日'}的${mealType === 'lunch' ? '午餐' : '晚餐'}登记`
    });
  } catch (error) {
    console.error('开放点餐登记失败:', error);
    res.status(500).json({ success: false, message: '操作失败: ' + error.message });
  }
});

// 新版管理员界面 - 需要管理员权限验证
app.get('/admin-dashboard.html', requireAdminPage, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin-dashboard.html'));
});

// 管理员接口：为现有用户补充历史点餐记录
app.post('/api/admin/populate-historical-orders', requireAdminAuth, async (req, res) => {
  try {
    console.log('收到历史点餐记录补充请求');

    // 临时跳过权限验证，直接使用管理员用户
    const users = await dataStore.read('users.json') || [];
    console.log('用户数量:', users.length);

    console.log('开始为现有用户补充历史点餐记录...');

    // 读取相关数据
    const weeklyMenus = await dataStore.read('weekly-menus.json') || [];
    let dailyOrders = await dataStore.read('daily-orders.json') || [];

    console.log('数据加载情况:', {
      weeklyMenusCount: weeklyMenus.length,
      dailyOrdersCount: dailyOrders.length,
      usersCount: users.length
    });

    let addedOrdersCount = 0;

    // 为每个用户处理
    for (const user of users) {
      console.log(`处理用户: ${user.name} (${user.id})`);

      // 获取用户注册时间
      const userRegistrationDate = new Date(user.firstLoginTime);

      // 获取该用户的不吃记录
      const userNoEatRecords = noEatRegs
        .filter(reg => reg.userId === user.id)
        .map(reg => `${reg.date}-${reg.mealType}`);

      // 按周分组菜单
      const menusByWeek = {};
      weeklyMenus.forEach((menu, index) => {
        const weekKey = menu.weekStart;
        if (!menusByWeek[weekKey]) {
          menusByWeek[weekKey] = {};
        }

        const dayKey = `${menu.dayOfWeek}-${menu.mealType}`;
        if (!menusByWeek[weekKey][dayKey]) {
          menusByWeek[weekKey][dayKey] = [];
        }

        if (index < 3) {
          console.log(`菜单 ${index}:`, { dayOfWeek: menu.dayOfWeek, mealType: menu.mealType, dayKey, weekKey });
        }

        menusByWeek[weekKey][dayKey].push(menu);
      });

      console.log(`用户 ${user.name} 菜单按周分组:`, Object.keys(menusByWeek).length, '个周');
      console.log('注册时间:', userRegistrationDate.toISOString());
      console.log('不吃记录数量:', userNoEatRecords.length);

      // 新的逻辑：按日期范围处理，而不是按周模板
      const today = new Date();
      today.setHours(23, 59, 59, 999); // 设置为今天的末尾
      const currentDate = new Date(userRegistrationDate);
      currentDate.setHours(0, 0, 0, 0); // 设置为注册日期的开始

      while (currentDate <= today) {
        const dateStr = currentDate.toISOString().split('T')[0];
        const dayOfWeek = currentDate.getDay(); // 0=Sunday, 1=Monday, ..., 6=Saturday

        // 处理午餐和晚餐
        for (const mealType of ['lunch', 'dinner']) {
          const mealKey = `${dateStr}-${mealType}`;
          const menuKey = `${dayOfWeek}-${mealType}`;

          console.log(`检查餐次: ${dateStr} ${mealType}, mealKey=${mealKey}, menuKey=${menuKey}`);

          // 如果用户没有登记不吃这餐
          if (!userNoEatRecords.includes(mealKey)) {
            // 在所有周的菜单中查找该dayOfWeek的菜单
            const mealMenus = [];
            for (const [weekStart, weekMenus] of Object.entries(menusByWeek)) {
              if (weekMenus[menuKey]) {
                mealMenus.push(...weekMenus[menuKey]);
              }
            }

            console.log(`用户没有登记不吃，菜单数量: ${mealMenus.length}`);
            if (mealMenus.length === 0) {
              console.log(`  未找到 ${menuKey} 的菜单`);
            }

            // 为每个餐厅的菜品创建订单记录
            for (const menu of mealMenus) {
                // 检查是否已存在订单记录
                const existingOrder = dailyOrders.find(order =>
                  order.date === dateStr &&
                  order.mealType === mealType &&
                  order.restaurant === menu.restaurantName
                );

                if (!existingOrder) {
                  // 创建新的订单记录
                  const newOrder = {
                    id: Date.now() + Math.random(),
                    date: dateStr,
                    mealType: mealType,
                    restaurant: menu.restaurantName,
                    dishes: [
                      {
                        id: menu.dishId,
                        name: menu.dishName,
                        imageUrl: menu.imageUrl,
                        orders: [
                          {
                            userId: user.id,
                            userName: user.name,
                            quantity: 1,
                            isNoEat: false,
                            createdAt: user.firstLoginTime // 使用注册时间作为订单时间
                          }
                        ]
                      }
                    ],
                    status: 'closed',
                    createdAt: user.firstLoginTime,
                    openedAt: user.firstLoginTime,
                    closedAt: user.firstLoginTime
                  };

                  dailyOrders.push(newOrder);
                  addedOrdersCount++;
                } else {
                  // 检查用户是否已经有订单
                  const userHasOrder = existingOrder.dishes.some(dish =>
                    dish.orders.some(order => order.userId === user.id)
                  );

                  if (!userHasOrder) {
                    // 为现有订单添加用户订单
                    if (existingOrder.dishes.length > 0) {
                      existingOrder.dishes[0].orders.push({
                        userId: user.id,
                        userName: user.name,
                        quantity: 1,
                        isNoEat: false,
                        createdAt: user.firstLoginTime
                      });
                      addedOrdersCount++;
                    }
                  }
                }
            }
          }
        }

        // 移动到下一天
        currentDate.setDate(currentDate.getDate() + 1);
      }
    }

    // 保存更新后的订单数据
    await dataStore.write('daily-orders.json', dailyOrders);

    console.log(`历史点餐记录补充完成，共添加 ${addedOrdersCount} 条记录`);

    res.json({
      success: true,
      message: `历史点餐记录补充完成，共添加 ${addedOrdersCount} 条记录`,
      addedOrdersCount
    });

  } catch (error) {
    console.error('补充历史点餐记录失败:', error);
    res.status(500).json({ success: false, message: '补充历史点餐记录失败' });
  }
});

// Debug endpoint for testing role system
app.get('/api/debug/roles', async (req, res) => {
  try {
    const roleData = await dataStore.read('user-roles.json');
    const users = await dataStore.read('users.json');

    const userRoles = await dataStore.getAllUserRoles();

    // Test individual user roles
    const roleTests = [];
    for (const user of users) {
      const role = await dataStore.getUserRole(user.id);
      roleTests.push({
        userId: user.id,
        name: user.name,
        role: role,
        inRoleData: roleData.users[user.id] || 'undefined',
        isDefaultAdmin: roleData.defaultAdmins.includes(user.id)
      });
    }

    res.json({
      success: true,
      data: {
        roleData,
        userRoles,
        roleTests,
        totalUsers: users.length,
        totalRoleConfigs: Object.keys(roleData.users).length
      }
    });
  } catch (error) {
    console.error('Debug roles error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Debug endpoint for testing role changes
app.post('/api/debug/test-role-change', async (req, res) => {
  try {
    const { userId, newRole } = req.body;

    if (!userId || !newRole) {
      return res.status(400).json({ success: false, message: 'Missing userId or newRole' });
    }

    console.log(`Testing role change: ${userId} -> ${newRole}`);

    // Test setUserRole function
    const result = await dataStore.setUserRole(userId, newRole);

    // Get updated role
    const updatedRole = await dataStore.getUserRole(userId);

    res.json({
      success: true,
      data: {
        userId,
        requestedRole: newRole,
        updatedRole,
        setRoleResult: result
      }
    });
  } catch (error) {
    console.error('Debug role change error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Debug endpoint for testing default admin protection
app.post('/api/debug/test-default-admin-protection', async (req, res) => {
  try {
    const { userId, newRole } = req.body;

    if (!userId || !newRole) {
      return res.status(400).json({ success: false, message: 'Missing userId or newRole' });
    }

    console.log(`Testing default admin protection: ${userId} -> ${newRole}`);

    // Check if it's a default admin
    const roleData = await dataStore.read('user-roles.json') || { defaultAdmins: [], users: {} };
    const isDefaultAdmin = roleData.defaultAdmins && roleData.defaultAdmins.includes(userId);

    if (isDefaultAdmin) {
      return res.json({
        success: false,
        message: '不能修改默认管理员的角色',
        data: {
          userId,
          requestedRole: newRole,
          isDefaultAdmin: true,
          protectionWorking: true
        }
      });
    }

    // If not default admin, allow change
    const result = await dataStore.setUserRole(userId, newRole);
    const updatedRole = await dataStore.getUserRole(userId);

    res.json({
      success: true,
      data: {
        userId,
        requestedRole: newRole,
        updatedRole,
        isDefaultAdmin: false,
        setRoleResult: result
      }
    });
  } catch (error) {
    console.error('Debug default admin protection error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// 不吃登记页面 - 简化登录流程
app.get('/no-eat', async (req, res) => {
  const { meal, source } = req.query;
  const mealType = meal || 'lunch';
  const mealName = mealType === 'lunch' ? '午餐' : '晚餐';

  // 生成简单的不吃登记页面
  const html = `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>不吃登记 - 订餐系统</title>
    <link href="https://cdn.jsdelivr.net/npm/element-plus@2.4.4/dist/index.css" rel="stylesheet">
    <style>
        body {
            margin: 0;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
        }
        .no-eat-container {
            background: white;
            border-radius: 12px;
            padding: 40px;
            box-shadow: 0 20px 40px rgba(0,0,0,0.1);
            text-align: center;
            max-width: 400px;
            width: 90%;
        }
        .meal-icon {
            font-size: 48px;
            margin-bottom: 20px;
        }
        .title {
            font-size: 24px;
            color: #333;
            margin-bottom: 10px;
        }
        .subtitle {
            color: #666;
            margin-bottom: 30px;
        }
        .login-button {
            width: 100%;
            height: 50px;
            font-size: 16px;
            margin-bottom: 15px;
        }
        .tips {
            background: #f8f9fa;
            border-radius: 8px;
            padding: 15px;
            margin-top: 20px;
            font-size: 14px;
            color: #666;
            text-align: left;
        }
    </style>
</head>
<body>
    <div id="app">
        <div class="no-eat-container">
            <div class="meal-icon">${mealType === 'lunch' ? '🥗' : '🍽️'}</div>
            <h1 class="title">${mealName}不吃登记</h1>
            <p class="subtitle">今天不准备用${mealName}？快速登记一下吧</p>

            <el-button
                type="primary"
                class="login-button"
                @click="loginWithFeishu"
                :loading="loading">
                <span style="margin-right: 8px;">🚀</span>
                飞书登录并登记不吃
            </el-button>

            <div class="tips">
                <p><strong>💡 温馨提示：</strong></p>
                <ul style="margin: 0; padding-left: 20px;">
                    <li>登记不吃可以帮助食堂准确统计用餐人数</li>
                    <li>避免浪费，节约资源</li>
                    <li>您随时可以在系统中取消登记</li>
                </ul>
            </div>
        </div>
    </div>

    <script src="https://unpkg.com/vue@3/dist/vue.global.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/element-plus@2.4.4/dist/index.full.min.js"></script>
    <script>
        const { createApp } = Vue;

        createApp({
            data() {
                return {
                    loading: false,
                    mealType: '${mealType}'
                };
            },
            methods: {
                loginWithFeishu() {
                    this.loading = true;
                    // 保存不吃登记意图到sessionStorage
                    sessionStorage.setItem('noEatIntent', JSON.stringify({
                        mealType: this.mealType,
                        source: '${source || 'direct'}'
                    }));
                    // 跳转到飞书登录
                    window.location.href = '/auth/feishu';
                }
            }
        }).use(ElementPlus).mount('#app');
    </script>
</body>
</html>`;

  res.send(html);
});

// 飞书按钮点击直接登记不吃的API路由
app.get('/api/no-eat/:mealType', async (req, res) => {
  const { mealType } = req.params;
  const { auto_redirect } = req.query;

  console.log(`🔘 收到飞书按钮点击: /api/no-eat/${mealType}`);
  console.log('📋 请求信息:', {
    headers: req.headers,
    ip: req.ip,
    userAgent: req.get('User-Agent')
  });

  // 由于从飞书点击过来无法直接获取用户身份，
  // 我们需要跳转到飞书授权来获取用户信息
  if (auto_redirect) {
    // 保存登记意图到session
    req.session.noEatIntent = {
      mealType: mealType,
      timestamp: Date.now(),
      source: 'feishu_button'
    };

    // 重定向到飞书授权
    const redirectUrl = `/auth/feishu?action=no_eat&meal=${mealType}`;
    console.log(`🔀 重定向到飞书授权: ${redirectUrl}`);
    return res.redirect(redirectUrl);
  }

  // 如果没有auto_redirect参数，返回简单的成功页面
  res.send(`
    <!DOCTYPE html>
    <html>
    <head><title>登记处理</title><meta charset="UTF-8"></head>
    <body>
      <h2>处理不吃登记</h2>
      <p>餐型: ${mealType === 'lunch' ? '午餐' : '晚餐'}</p>
      <p>需要先进行身份验证...</p>
      <a href="/auth/feishu?action=no_eat&meal=${mealType}">点击进行飞书登录</a>
    </body>
    </html>
  `);
});

// 快速登记路由 - 处理按钮点击
app.get('/quick-register', async (req, res) => {
  const { meal, action } = req.query;
  const userAgent = req.headers['user-agent'];

  console.log(`快速登记请求: meal=${meal}, action=${action}, userAgent=${userAgent}`);

  try {
    if (action === 'skip' && (meal === 'lunch' || meal === 'dinner')) {
      // 由于从飞书按钮点击过来，暂时使用默认用户处理
      // 后续可以通过飞书OAuth获取真实用户ID

      const today = moment().format('YYYY-MM-DD');
      const mealType = meal; // 'lunch' 或 'dinner'

      // 临时使用默认用户ID - 实际应用中需要从飞书获取真实用户
      let defaultUserId = null;

      // 查找一个存在的用户ID作为默认值
      const userRegistrations = await dataStore.read('user-registrations.json') || [];
      const orders = await dataStore.read('daily-orders.json') || [];

      // 递归搜索用户ID，因为数据结构可能是嵌套的
      const findUserId = (data) => {
        if (Array.isArray(data)) {
          for (const item of data) {
            const result = findUserId(item);
            if (result) return result;
          }
        } else if (data && typeof data === 'object') {
          if (data.userId) return data.userId;
          for (const value of Object.values(data)) {
            const result = findUserId(value);
            if (result) return result;
          }
        }
        return null;
      };

      // 首先从用户注册记录中查找，然后从订单记录中查找
      defaultUserId = findUserId(userRegistrations) || findUserId(orders);

      if (!defaultUserId) {
        console.log('警告: 没有找到可用的用户ID，无法记录不吃登记');
        res.send(`
          <html>
          <head><meta charset="utf-8"><title>登记失败</title></head>
          <body style="text-align:center; padding:50px; font-family:Arial;">
            <h2>❌ 登记失败</h2>
            <p>系统中没有找到用户信息，请先通过正常流程登录一次</p>
            <p><a href="/">返回首页</a></p>
          </body>
          </html>
        `);
        return;
      }

      // 检查是否已经有今日的"不吃"登记记录（在用户注册记录中查找）
      const existingRegistration = userRegistrations.find(record =>
        record.userId === defaultUserId &&
        record.date === today &&
        record.mealType === mealType &&
        record.dishName === '不吃'
      );

      if (existingRegistration) {
        // 已经有"不吃"登记记录，不需要重复创建
        console.log(`用户已经登记过不吃: ${defaultUserId}, ${today}, ${mealType}`);
      } else {
        // 检查是否有其他菜品的登记记录，如果有就更新为"不吃"
        const existingOtherRegistration = userRegistrations.find(record =>
          record.userId === defaultUserId &&
          record.date === today &&
          record.mealType === mealType
        );

        if (existingOtherRegistration) {
          // 更新现有记录为"不吃"
          existingOtherRegistration.dishId = null;
          existingOtherRegistration.dishName = '不吃';
          existingOtherRegistration.restaurantName = '无';
          existingOtherRegistration.updatedAt = new Date().toISOString();
          existingOtherRegistration.note = '通过飞书按钮快速登记';

          await dataStore.write('user-registrations.json', userRegistrations);
          console.log(`更新现有用户注册记录为不吃: ${defaultUserId}, ${today}, ${mealType}`);
        } else {
          // 创建新的"不吃"记录（存储在用户注册记录中）
          const skipRegistration = {
            id: Date.now().toString(),
            userId: defaultUserId,
            date: today,
            mealType: mealType,
            dishId: null,
            dishName: '不吃',
            restaurantName: '无',
            price: 0,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          note: '通过飞书按钮快速登记'
        };

        userRegistrations.push(skipRegistration);
        await dataStore.write('user-registrations.json', userRegistrations);
        console.log(`创建新的用户不吃注册记录: ${defaultUserId}, ${today}, ${mealType}`);
        }
      }

      res.send(`
        <html>
        <head>
          <meta charset="utf-8">
          <title>快速登记</title>
          <meta name="viewport" content="width=device-width, initial-scale=1">
        </head>
        <body style="text-align:center; padding:50px; font-family:Arial;">
          <h2>✅ 登记成功</h2>
          <p>您已成功登记不吃${meal === 'lunch' ? '午餐' : '晚餐'}</p>
          <p>记录已同步到点餐系统</p>
          <p><a href="/">返回首页</a></p>
        </body>
        </html>
      `);
    } else {
      res.status(400).send('无效的登记参数');
    }
  } catch (error) {
    console.error('快速登记处理错误:', error);
    res.status(500).send('登记失败，请稍后重试');
  }
});

// 首页和其他页面 - 需要验证
app.get('/', requireAuthPage, (req, res) => {
  res.redirect('/user-dashboard.html');
});

// 拦截HTML文件的直接访问（除了login.html）
app.use('/*.html', (req, res, next) => {
  const filename = req.path.substring(1); // 移除开头的 /
  if (filename === 'login.html') {
    // 直接提供login.html文件
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
  } else {
    // 其他HTML文件需要通过路由访问，重定向到登录页面
    res.redirect('/login?error=direct_access');
  }
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
app.listen(PORT, '0.0.0.0', async () => {
  console.log(`\n🚀 订餐系统启动成功!`);
  console.log(`📱 本机访问: http://localhost:${PORT}`);
  console.log(`🌐 局域网访问: http://100.100.192.158:${PORT}`);
  console.log(`🤖 机器人API: http://localhost:${PORT}/api/bot`);

  // 初始化定时任务
  await initializeCronJobs();

  // 确保未来30天的点餐记录已创建
  console.log('正在检查并生成未来30天的点餐记录...');
  await ensureFutureMonthOrderRecords();

  console.log(`\n✅ 系统已就绪，所有定时任务已启动！\n`);

  // 可选：启动飞书长连接（无需公网回调）。需要安装官方SDK并设置 FEISHU_LONG_CONN_ENABLED=true
  if (process.env.FEISHU_LONG_CONN_ENABLED === 'true' && typeof global.__startFeishuLongConnection === 'function') {
    try {
      await global.__startFeishuLongConnection(FEISHU_CONFIG, console);
    } catch (e) {
      console.warn('启动飞书长连接失败:', e.message);
    }
  }
});
