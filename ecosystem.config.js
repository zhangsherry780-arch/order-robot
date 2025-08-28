// PM2 部署配置文件
module.exports = {
  apps: [
    {
      name: 'order-robot',
      script: 'server.js',
      cwd: './',
      instances: 1,
      exec_mode: 'cluster',
      watch: false,
      env: {
        NODE_ENV: 'production',
        PORT: 3000
      },
      env_development: {
        NODE_ENV: 'development',
        PORT: 3000
      },
      log_file: './logs/app.log',
      out_file: './logs/app-out.log',
      error_file: './logs/app-error.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      merge_logs: true,
      max_restarts: 10,
      min_uptime: '10s',
      restart_delay: 5000,
      autorestart: true,
      cron_restart: '0 2 * * *', // 每天凌晨2点重启
      max_memory_restart: '500M'
    }
  ]
};