// 飞书OAuth配置
const FEISHU_CONFIG = {
  // 飞书应用配置
  APP_ID: process.env.APP_ID || process.env.FEISHU_APP_ID || 'cli_a829a525a418500d',
  APP_SECRET: process.env.APP_SECRET || process.env.FEISHU_APP_SECRET || 'LfRLdJsosP9Pwx8hGqeTrpDwD67qVUki',
  
  // OAuth URLs
  AUTHORIZATION_URL: 'https://open.feishu.cn/open-apis/authen/v1/authorize',
  TOKEN_URL: 'https://open.feishu.cn/open-apis/authen/v1/oidc/access_token',
  USER_INFO_URL: 'https://open.feishu.cn/open-apis/authen/v1/user_info',
  
  // 重定向URI - 支持多种访问方式
  REDIRECT_URI: 'http://localhost:3001/auth/feishu/callback',
  REDIRECT_URI_LAN: 'http://100.100.192.158:3000/auth/feishu/callback',
  REDIRECT_URI_SERVER: 'http://172.16.74.75:3000/auth/feishu/callback',
  
  // 动态生成回调URI的函数
  getRedirectUri: function(req) {
    const host = req.get('host');
    // 临时固定使用服务器地址进行测试
    if (host === '172.16.74.75:3000') {
      return this.REDIRECT_URI_SERVER;
    }
    return `http://${host}/auth/feishu/callback`;
  },
  
  // 权限范围
  SCOPE: 'contact:user.id:readonly contact:user.base:readonly',
  
  // 会话配置
  SESSION_SECRET: 'order-robot-feishu-session-' + Date.now(),
  
  // Webhook机器人配置
  WEBHOOK_CONFIG: {
    // 群自定义 Webhook（仅用于纯通知场景）
    // 默认关闭：不再内置任何固定 URL，需显式通过环境变量提供
    // 示例：FEISHU_WEBHOOK_URL=https://open.feishu.cn/open-apis/bot/v2/hook/xxxx
    WEBHOOK_URL: process.env.FEISHU_WEBHOOK_URL || '',

    // 消息签名密钥 (可选)
    SECRET: process.env.FEISHU_WEBHOOK_SECRET || '',

    // 默认消息模板
    DEFAULT_TITLE: '🍽️ 订餐系统通知',

    // 消息类型
    MESSAGE_TYPES: {
      DAILY_MENU: 'daily_menu',      // 每日菜单推送
      ORDER_STATS: 'order_stats',    // 订餐统计
      SYSTEM_ALERT: 'system_alert',  // 系统提醒
      CUSTOM: 'custom'               // 自定义消息
    }
  }
};

module.exports = FEISHU_CONFIG;
