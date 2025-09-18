/**
 * 自动数据同步监控器
 * 定期检查并修复飞书不吃登记数据同步问题
 */

const { syncNoEatData, validateDataIntegrity } = require('./fix-data-sync');

class AutoSyncMonitor {
  constructor() {
    this.isRunning = false;
    this.intervalId = null;
    this.checkInterval = 60 * 60 * 1000; // 每小时检查一次
    this.lastSyncTime = null;
    this.stats = {
      totalChecks: 0,
      totalFixes: 0,
      lastFixTime: null,
      errors: 0
    };
  }

  /**
   * 启动自动监控
   */
  start() {
    if (this.isRunning) {
      console.log('⚠️ 自动同步监控器已在运行中');
      return;
    }

    console.log('🚀 启动飞书不吃数据自动同步监控器');
    console.log(`📅 检查间隔: ${this.checkInterval / 1000 / 60} 分钟`);

    this.isRunning = true;

    // 立即执行一次检查
    this.performSync();

    // 设置定期检查
    this.intervalId = setInterval(() => {
      this.performSync();
    }, this.checkInterval);

    console.log('✅ 自动同步监控器启动成功');
  }

  /**
   * 停止自动监控
   */
  stop() {
    if (!this.isRunning) {
      console.log('⚠️ 自动同步监控器未在运行');
      return;
    }

    console.log('🛑 停止飞书不吃数据自动同步监控器');

    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }

    this.isRunning = false;
    console.log('✅ 自动同步监控器已停止');
  }

  /**
   * 执行同步检查和修复
   */
  async performSync() {
    const startTime = new Date();
    this.stats.totalChecks++;

    try {
      console.log(`\n🔍 [${startTime.toLocaleString('zh-CN')}] 开始第 ${this.stats.totalChecks} 次数据同步检查`);

      // 静默执行同步修复
      const originalConsoleLog = console.log;
      const logs = [];

      // 捕获同步过程中的日志
      console.log = (...args) => {
        logs.push(args.join(' '));
      };

      try {
        await syncNoEatData();
      } finally {
        console.log = originalConsoleLog;
      }

      // 分析同步结果
      const syncedRecords = logs.filter(log => log.includes('同步完成！已添加')).length;
      const alreadySynced = logs.some(log => log.includes('数据已同步，无需修复'));

      if (syncedRecords > 0) {
        this.stats.totalFixes++;
        this.stats.lastFixTime = startTime;
        console.log(`🔧 检测到数据不同步，已自动修复 ${syncedRecords} 条记录`);
      } else if (alreadySynced) {
        console.log(`✅ 数据同步正常，无需修复`);
      } else {
        console.log(`ℹ️ 检查完成，无数据需要同步`);
      }

      this.lastSyncTime = startTime;

    } catch (error) {
      this.stats.errors++;
      console.error(`❌ 自动同步检查失败:`, error.message);
    }

    const duration = new Date() - startTime;
    console.log(`⏱️ 本次检查耗时: ${duration}ms`);
  }

  /**
   * 获取监控统计信息
   */
  getStats() {
    return {
      ...this.stats,
      isRunning: this.isRunning,
      lastSyncTime: this.lastSyncTime,
      uptime: this.isRunning && this.lastSyncTime ?
        new Date() - this.lastSyncTime : 0
    };
  }

  /**
   * 打印监控状态
   */
  printStatus() {
    const stats = this.getStats();

    console.log('\n📊 自动同步监控器状态报告');
    console.log('='.repeat(40));
    console.log(`📡 运行状态: ${stats.isRunning ? '🟢 运行中' : '🔴 已停止'}`);
    console.log(`🔍 总检查次数: ${stats.totalChecks}`);
    console.log(`🔧 总修复次数: ${stats.totalFixes}`);
    console.log(`❌ 错误次数: ${stats.errors}`);
    console.log(`⏰ 最后检查时间: ${stats.lastSyncTime ? stats.lastSyncTime.toLocaleString('zh-CN') : '无'}`);
    console.log(`🔧 最后修复时间: ${stats.lastFixTime ? stats.lastFixTime.toLocaleString('zh-CN') : '无'}`);
    console.log(`📅 检查间隔: ${this.checkInterval / 1000 / 60} 分钟`);

    if (stats.totalChecks > 0) {
      const successRate = ((stats.totalChecks - stats.errors) / stats.totalChecks * 100).toFixed(1);
      const fixRate = (stats.totalFixes / stats.totalChecks * 100).toFixed(1);
      console.log(`📈 检查成功率: ${successRate}%`);
      console.log(`🔧 修复率: ${fixRate}%`);
    }
  }

  /**
   * 设置检查间隔（分钟）
   */
  setInterval(minutes) {
    const newInterval = minutes * 60 * 1000;

    if (newInterval < 5 * 60 * 1000) {
      console.log('⚠️ 检查间隔不能小于5分钟');
      return false;
    }

    this.checkInterval = newInterval;
    console.log(`✅ 检查间隔已设置为 ${minutes} 分钟`);

    // 如果正在运行，重启以应用新间隔
    if (this.isRunning) {
      this.stop();
      this.start();
    }

    return true;
  }
}

// 创建全局监控器实例
const autoSyncMonitor = new AutoSyncMonitor();

// 如果作为脚本直接运行
if (require.main === module) {
  console.log('🛠️ 飞书不吃数据自动同步监控器');
  console.log('');

  const args = process.argv.slice(2);
  const command = args[0];

  switch (command) {
    case 'start':
      autoSyncMonitor.start();

      // 监听退出信号
      process.on('SIGINT', () => {
        console.log('\n📊 收到退出信号，正在关闭监控器...');
        autoSyncMonitor.stop();
        autoSyncMonitor.printStatus();
        process.exit(0);
      });

      // 每10分钟打印一次状态
      setInterval(() => {
        autoSyncMonitor.printStatus();
      }, 10 * 60 * 1000);

      break;

    case 'status':
      autoSyncMonitor.printStatus();
      break;

    case 'test':
      console.log('🧪 执行一次性同步检查...');
      autoSyncMonitor.performSync().then(() => {
        autoSyncMonitor.printStatus();
        process.exit(0);
      });
      break;

    default:
      console.log('用法:');
      console.log('  node auto-sync-monitor.js start   # 启动监控器');
      console.log('  node auto-sync-monitor.js status  # 查看状态');
      console.log('  node auto-sync-monitor.js test    # 执行一次测试');
      break;
  }
}

module.exports = { AutoSyncMonitor, autoSyncMonitor };