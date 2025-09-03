// PM2 生产环境配置文件
module.exports = {
  apps: [{
    name: 'order-robot',
    script: 'server.js',
    instances: 1, // 可以设置为 'max' 使用所有CPU核心
    exec_mode: 'cluster',
    
    // 环境变量
    env: {
      NODE_ENV: 'development',
      PORT: 3000,
      HOST: '0.0.0.0'
    },
    env_production: {
      NODE_ENV: 'production',
      PORT: 3000,
      HOST: '0.0.0.0',
      // 数据库配置
      DB_HOST: 'localhost',
      DB_USER: 'order_robot',
      DB_PASSWORD: 'your_db_password_here',
      DB_NAME: 'order_robot',
      // 飞书配置
      FEISHU_APP_ID: 'cli_a829a525a418500d',
      FEISHU_APP_SECRET: 'LfRLdJsosP9Pwx8hGqeTrpDwD67qVUki',
      // 服务器域名
      SERVER_DOMAIN: '172.16.74.75',
      // 会话密钥
      SESSION_SECRET: 'order-robot-production-secret-please-change-this'
    },
    
    // 日志配置
    log_file: './logs/combined.log',
    out_file: './logs/out.log',
    error_file: './logs/error.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    merge_logs: true,
    
    // 自动重启配置
    watch: false, // 生产环境不建议开启
    max_memory_restart: '500M',
    min_uptime: '10s',
    max_restarts: 10,
    restart_delay: 4000,
    
    // 进程管理
    kill_timeout: 5000,
    wait_ready: true,
    listen_timeout: 8000,
    
    // 高级配置
    node_args: '--max-old-space-size=512',
    
    // 健康检查
    health_check_grace_period: 3000,
    
    // 自动启动
    autorestart: true,
    
    // 错误重启
    exp_backoff_restart_delay: 100
  }],
  
  // 部署配置
  deploy: {
    production: {
      user: 'root',
      host: '172.16.74.75',
      ref: 'origin/main',
      repo: 'https://github.com/zhangsherry780-arch/order-robot.git',
      path: '/root/order-robot-deploy', // PM2部署路径
      'pre-deploy-local': '',
      'post-deploy': 'npm install --production && npm run db:migrate && pm2 reload ecosystem.config.js --env production',
      'pre-setup': ''
    }
  }
};
