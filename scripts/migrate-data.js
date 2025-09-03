const path = require('path');
const fs = require('fs').promises;
const { getDatabase, runMigrations } = require('../config/database');

// 数据迁移脚本 - 将JSON文件数据迁移到MySQL数据库

async function readJsonFile(filename) {
  try {
    const filePath = path.join(__dirname, '..', 'data', filename);
    const data = await fs.readFile(filePath, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.log(`⚠️  文件 ${filename} 不存在或为空，跳过迁移`);
    return [];
  }
}

async function migrateEmployees() {
  console.log('📊 迁移员工数据...');
  const employees = await readJsonFile('employees.json');
  const db = await getDatabase();
  
  for (const emp of employees) {
    await db.query(
      'INSERT IGNORE INTO employees (id, name, department, active, created_at) VALUES (?, ?, ?, ?, NOW())',
      [emp.id, emp.name, emp.department || '未分组', emp.active !== false]
    );
  }
  
  console.log(`✅ 迁移了 ${employees.length} 个员工`);
}

async function migrateRestaurants() {
  console.log('📊 迁移餐厅数据...');
  const restaurants = await readJsonFile('restaurants.json');
  const db = await getDatabase();
  
  for (const rest of restaurants) {
    await db.query(
      'INSERT IGNORE INTO restaurants (id, name, description, phone, address, available_days, active, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, NOW())',
      [
        rest.id,
        rest.name,
        rest.description || '',
        rest.phone || '',
        rest.address || '',
        JSON.stringify(rest.availableDays || [1,2,3,4,5]),
        rest.active !== false
      ]
    );
  }
  
  console.log(`✅ 迁移了 ${restaurants.length} 个餐厅`);
}

async function migrateDishes() {
  console.log('📊 迁移菜品数据...');
  const dishes = await readJsonFile('dishes.json');
  const db = await getDatabase();
  
  for (const dish of dishes) {
    await db.query(
      'INSERT IGNORE INTO dishes (id, name, description, category, price, restaurant_id, image_url, rating, meal_type, active, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())',
      [
        dish.id,
        dish.name,
        dish.description || '',
        dish.category || '普通',
        dish.price || 0,
        dish.restaurantId,
        dish.imageUrl || '',
        dish.rating || 0,
        dish.mealType || 'lunch',
        dish.active !== false
      ]
    );
  }
  
  console.log(`✅ 迁移了 ${dishes.length} 个菜品`);
}

async function migrateWeeklyMenus() {
  console.log('📊 迁移周菜单数据...');
  const weeklyMenus = await readJsonFile('weekly-menus.json');
  const db = await getDatabase();
  
  for (const menu of weeklyMenus) {
    await db.query(
      'INSERT IGNORE INTO weekly_menus (week_start, day_of_week, meal_type, dish_name, restaurant_name, description, category, price, image_url, dish_id, restaurant_id, active, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())',
      [
        menu.weekStart,
        menu.dayOfWeek,
        menu.mealType,
        menu.dishName,
        menu.restaurantName,
        menu.description || '',
        menu.category || '普通',
        menu.price || 0,
        menu.imageUrl || '',
        menu.dishId || null,
        menu.restaurantId || null,
        menu.active !== false
      ]
    );
  }
  
  console.log(`✅ 迁移了 ${weeklyMenus.length} 个菜单项`);
}

async function migrateDailyOrders() {
  console.log('📊 迁移每日订单数据...');
  const dailyOrders = await readJsonFile('daily-orders.json');
  const db = await getDatabase();
  
  for (const order of dailyOrders) {
    await db.query(
      'INSERT IGNORE INTO daily_orders (id, order_date, meal_type, total_people, no_eat_count, order_count, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [
        order.id,
        order.date,
        order.mealType,
        order.totalPeople || 0,
        order.noEatCount || 0,
        order.orderCount || 0,
        order.status || 'open',
        order.createdAt || new Date().toISOString()
      ]
    );
  }
  
  console.log(`✅ 迁移了 ${dailyOrders.length} 个每日订单`);
}

async function migrateNoEatRegistrations() {
  console.log('📊 迁移不用餐登记数据...');
  const noEatRegs = await readJsonFile('no-eat-registrations.json');
  const db = await getDatabase();
  
  for (const reg of noEatRegs) {
    // 先查找或创建员工
    let employeeId = null;
    const employees = await db.query('SELECT id FROM employees WHERE name = ?', [reg.employeeName]);
    
    if (employees.length > 0) {
      employeeId = employees[0].id;
    } else {
      // 创建新员工
      employeeId = await db.insert(
        'INSERT INTO employees (name, department, active, created_at) VALUES (?, ?, TRUE, NOW())',
        [reg.employeeName, '未分组']
      );
    }
    
    await db.query(
      'INSERT IGNORE INTO no_eat_registrations (employee_id, employee_name, registration_date, meal_type, reason, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      [
        employeeId,
        reg.employeeName,
        reg.date,
        reg.mealType,
        reg.reason || '',
        reg.createdAt || new Date().toISOString()
      ]
    );
  }
  
  console.log(`✅ 迁移了 ${noEatRegs.length} 个不用餐登记`);
}

async function migrateRatings() {
  console.log('📊 迁移评价数据...');
  const ratings = await readJsonFile('ratings.json');
  const db = await getDatabase();
  
  for (const rating of ratings) {
    // 查找员工ID
    let employeeId = null;
    const employees = await db.query('SELECT id FROM employees WHERE name = ?', [rating.employeeName]);
    
    if (employees.length > 0) {
      employeeId = employees[0].id;
    } else {
      // 创建新员工
      employeeId = await db.insert(
        'INSERT INTO employees (name, department, active, created_at) VALUES (?, ?, TRUE, NOW())',
        [rating.employeeName, '未分组']
      );
    }
    
    // 查找菜品ID
    let dishId = null;
    const dishes = await db.query(
      'SELECT id FROM dishes WHERE name = ? AND meal_type = ? LIMIT 1',
      [rating.dishName, rating.mealType]
    );
    
    if (dishes.length > 0) {
      dishId = dishes[0].id;
    }
    
    if (dishId) {
      await db.query(
        'INSERT IGNORE INTO ratings (employee_id, employee_name, dish_id, dish_name, restaurant_name, meal_type, rating, comment, rating_date, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [
          employeeId,
          rating.employeeName,
          dishId,
          rating.dishName,
          rating.restaurantName,
          rating.mealType,
          rating.rating,
          rating.comment || '',
          rating.date || new Date().toISOString().split('T')[0],
          rating.createdAt || new Date().toISOString()
        ]
      );
    }
  }
  
  console.log(`✅ 迁移了 ${ratings.length} 个评价`);
}

async function migrateRestaurantSuggestions() {
  console.log('📊 迁移餐厅投稿数据...');
  const suggestions = await readJsonFile('restaurant-suggestions.json');
  const db = await getDatabase();
  
  for (const suggestion of suggestions) {
    // 查找员工ID
    let employeeId = null;
    const employees = await db.query('SELECT id FROM employees WHERE name = ?', [suggestion.submitterName]);
    
    if (employees.length > 0) {
      employeeId = employees[0].id;
    } else {
      // 创建新员工
      employeeId = await db.insert(
        'INSERT INTO employees (name, department, active, created_at) VALUES (?, ?, TRUE, NOW())',
        [suggestion.submitterName, '未分组']
      );
    }
    
    const suggestionId = await db.insert(
      'INSERT INTO restaurant_suggestions (employee_id, employee_name, restaurant_name, reason, image_url, votes, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [
        employeeId,
        suggestion.submitterName,
        suggestion.restaurantName,
        suggestion.reason,
        suggestion.imageUrl || '',
        suggestion.likes || 0,
        'approved',
        suggestion.createdAt || new Date().toISOString()
      ]
    );
    
    // 迁移投票数据
    if (suggestion.likedBy && suggestion.likedBy.length > 0) {
      for (const voterName of suggestion.likedBy) {
        let voterId = null;
        const voters = await db.query('SELECT id FROM employees WHERE name = ?', [voterName]);
        
        if (voters.length > 0) {
          voterId = voters[0].id;
        } else {
          // 创建新员工
          voterId = await db.insert(
            'INSERT INTO employees (name, department, active, created_at) VALUES (?, ?, TRUE, NOW())',
            [voterName, '未分组']
          );
        }
        
        await db.query(
          'INSERT IGNORE INTO suggestion_votes (suggestion_id, employee_id, employee_name, vote_type, created_at) VALUES (?, ?, ?, ?, NOW())',
          [suggestionId, voterId, voterName, 'up']
        );
      }
    }
  }
  
  console.log(`✅ 迁移了 ${suggestions.length} 个餐厅投稿`);
}

async function migrateSettings() {
  console.log('📊 迁移系统设置数据...');
  const settings = await readJsonFile('settings.json');
  const db = await getDatabase();
  
  for (const [key, value] of Object.entries(settings)) {
    await db.query(
      'INSERT IGNORE INTO settings (setting_key, setting_value, description, created_at) VALUES (?, ?, ?, NOW())',
      [key, JSON.stringify(value), `从JSON文件迁移: ${key}`]
    );
  }
  
  console.log(`✅ 迁移了 ${Object.keys(settings).length} 个设置项`);
}

// 主迁移函数
async function runDataMigration() {
  console.log('🚀 开始数据迁移...\n');
  
  try {
    // 1. 首先执行数据库架构迁移
    await runMigrations();
    
    // 2. 按依赖顺序迁移数据
    await migrateEmployees();
    await migrateRestaurants(); 
    await migrateDishes();
    await migrateWeeklyMenus();
    await migrateDailyOrders();
    await migrateNoEatRegistrations();
    await migrateRatings();
    await migrateRestaurantSuggestions();
    await migrateSettings();
    
    console.log('\n🎉 数据迁移完成！');
    console.log('💡 建议备份原始JSON文件后，可以将它们移动到 data/backup/ 目录');
    
  } catch (error) {
    console.error('\n❌ 数据迁移失败:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

// 如果直接运行此脚本
if (require.main === module) {
  runDataMigration().then(() => {
    process.exit(0);
  }).catch(error => {
    console.error('迁移失败:', error);
    process.exit(1);
  });
}

module.exports = {
  runDataMigration
};