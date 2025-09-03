// 飞书OAuth配置
const FEISHU_CONFIG = {
  // 飞书应用配置
  APP_ID: 'cli_a829a525a418500d',
  APP_SECRET: 'LfRLdJsosP9Pwx8hGqeTrpDwD67qVUki',
  
  // OAuth URLs
  AUTHORIZATION_URL: 'https://open.feishu.cn/open-apis/authen/v1/authorize',
  TOKEN_URL: 'https://open.feishu.cn/open-apis/authen/v1/oidc/access_token',
  USER_INFO_URL: 'https://open.feishu.cn/open-apis/authen/v1/user_info',
  
  // 重定向URI - 支持多种访问方式
  REDIRECT_URI: 'http://localhost:3000/auth/feishu/callback',
  REDIRECT_URI_LAN: 'http://100.100.192.158:3000/auth/feishu/callback',
  
  // 动态生成回调URI的函数
  getRedirectUri: function(req) {
    const host = req.get('host');
    return `http://${host}/auth/feishu/callback`;
  },
  
  // 权限范围
  SCOPE: 'contact:user.id:readonly contact:user.base:readonly',
  
  // 会话配置
  SESSION_SECRET: 'order-robot-feishu-session-' + Date.now()
};

module.exports = FEISHU_CONFIG;