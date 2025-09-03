const mysql = require('mysql2/promise');
const fs = require('fs').promises;
const path = require('path');

// 数据库配置
const DB_CONFIG = {
  development: {
    host: 'localhost',
    user: 'root',
    password: '',
    database: 'order_robot',
    charset: 'utf8mb4',
    timezone: '+08:00',
    acquireTimeout: 60000,
    timeout: 60000,
    reconnect: true,
    connectionLimit: 10
  },
  production: {
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'order_robot',
    charset: 'utf8mb4',
    timezone: '+08:00',
    acquireTimeout: 60000,
    timeout: 60000,
    reconnect: true,
    connectionLimit: 20,
    ssl: process.env.DB_SSL === 'true' ? {
      rejectUnauthorized: false
    } : false
  }
};

// 获取当前环境配置
const env = process.env.NODE_ENV || 'development';
const config = DB_CONFIG[env];

// 创建连接池
let pool = null;

async function initDatabase() {
  try {
    // 创建连接池
    pool = mysql.createPool(config);
    
    // 测试连接
    const connection = await pool.getConnection();
    console.log(`✅ 数据库连接成功 (${env}环境)`);
    console.log(`📊 数据库: ${config.database}@${config.host}`);
    connection.release();
    
    return pool;
  } catch (error) {
    console.error('❌ 数据库连接失败:', error.message);
    
    // 如果是生产环境且数据库不存在，提示用户手动创建
    if (error.code === 'ER_BAD_DB_ERROR') {
      console.log('💡 请先创建数据库，然后运行迁移脚本');
      console.log(`   CREATE DATABASE ${config.database} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;`);
    }
    
    throw error;
  }
}

// 执行数据库迁移
async function runMigrations() {
  try {
    console.log('🔄 开始执行数据库迁移...');
    
    const schemaPath = path.join(__dirname, '..', 'database', 'schema.sql');
    const schemaSQL = await fs.readFile(schemaPath, 'utf8');
    
    // 分割SQL语句（按照DELIMITER分割）
    const statements = schemaSQL
      .split(/DELIMITER.*;/g)
      .filter(stmt => stmt.trim() && !stmt.trim().startsWith('--'))
      .map(stmt => stmt.trim());
    
    const connection = await pool.getConnection();
    
    for (const statement of statements) {
      if (!statement) continue;
      
      // 处理触发器等多语句
      if (statement.includes('$$')) {
        const innerStatements = statement.split('$$').filter(s => s.trim());
        for (const innerStmt of innerStatements) {
          if (innerStmt.trim() && !innerStmt.includes('DELIMITER')) {
            await connection.execute(innerStmt);
          }
        }
      } else {
        // 处理普通SQL语句，支持多语句执行
        const singleStatements = statement.split(';').filter(s => s.trim());
        for (const singleStmt of singleStatements) {
          if (singleStmt.trim()) {
            await connection.execute(singleStmt);
          }
        }
      }
    }
    
    connection.release();
    console.log('✅ 数据库迁移完成');
    
  } catch (error) {
    console.error('❌ 数据库迁移失败:', error.message);
    throw error;
  }
}

// 数据库操作工具类
class DatabaseManager {
  constructor() {
    this.pool = pool;
  }
  
  // 执行查询
  async query(sql, params = []) {
    try {
      const [rows] = await this.pool.execute(sql, params);
      return rows;
    } catch (error) {
      console.error('数据库查询错误:', { sql, params, error: error.message });
      throw error;
    }
  }
  
  // 插入数据并返回ID
  async insert(sql, params = []) {
    try {
      const [result] = await this.pool.execute(sql, params);
      return result.insertId;
    } catch (error) {
      console.error('数据库插入错误:', { sql, params, error: error.message });
      throw error;
    }
  }
  
  // 更新数据
  async update(sql, params = []) {
    try {
      const [result] = await this.pool.execute(sql, params);
      return result.affectedRows;
    } catch (error) {
      console.error('数据库更新错误:', { sql, params, error: error.message });
      throw error;
    }
  }
  
  // 删除数据
  async delete(sql, params = []) {
    try {
      const [result] = await this.pool.execute(sql, params);
      return result.affectedRows;
    } catch (error) {
      console.error('数据库删除错误:', { sql, params, error: error.message });
      throw error;
    }
  }
  
  // 事务执行
  async transaction(callback) {
    const connection = await this.pool.getConnection();
    await connection.beginTransaction();
    
    try {
      const result = await callback(connection);
      await connection.commit();
      return result;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }
  
  // 批量插入
  async batchInsert(tableName, data, onDuplicateUpdate = false) {
    if (!data || data.length === 0) return 0;
    
    const columns = Object.keys(data[0]);
    const values = data.map(row => columns.map(col => row[col]));
    
    const placeholders = values.map(() => `(${columns.map(() => '?').join(',')})`).join(',');
    const flatValues = values.flat();
    
    let sql = `INSERT INTO ${tableName} (${columns.join(',')}) VALUES ${placeholders}`;
    
    if (onDuplicateUpdate) {
      const updateClause = columns
        .filter(col => col !== 'id')
        .map(col => `${col} = VALUES(${col})`)
        .join(',');
      sql += ` ON DUPLICATE KEY UPDATE ${updateClause}`;
    }
    
    const [result] = await this.pool.execute(sql, flatValues);
    return result.affectedRows;
  }
}

// 导出数据库管理器实例
let dbManager = null;

async function getDatabase() {
  if (!pool) {
    await initDatabase();
  }
  if (!dbManager) {
    dbManager = new DatabaseManager();
  }
  return dbManager;
}

module.exports = {
  initDatabase,
  runMigrations,
  getDatabase,
  pool: () => pool
};