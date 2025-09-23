const axios = require('axios');

class FeishuAppBot {
  constructor(config) {
    this.config = config;
    this.cachedToken = null;
    this.cachedTokenExpireAt = 0;
  }

  async getTenantAccessToken() {
    const now = Date.now();
    if (this.cachedToken && now < this.cachedTokenExpireAt - 60_000) {
      return this.cachedToken;
    }
    const { APP_ID, APP_SECRET } = this.config;
    if (!APP_ID || !APP_SECRET) {
      throw new Error('Missing FEISHU APP_ID/APP_SECRET in feishu-config.js');
    }
    const resp = await axios.post(
      'https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal',
      { app_id: APP_ID, app_secret: APP_SECRET },
      { headers: { 'Content-Type': 'application/json' } }
    );
    if (!resp.data || resp.data.code !== 0) {
      throw new Error('Failed to get tenant_access_token: ' + JSON.stringify(resp.data));
    }
    this.cachedToken = resp.data.tenant_access_token;
    // 官方返回通常有 expire 时间（秒），保守设定 1 小时
    this.cachedTokenExpireAt = Date.now() + (resp.data.expire || 3600) * 1000;
    return this.cachedToken;
    
  }

  async sendInteractiveCardToChat(chatId, cardJson) {
    if (!chatId) throw new Error('chatId is required');
    const token = await this.getTenantAccessToken();
    const url = 'https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=chat_id';
    const payload = {
      receive_id: chatId,
      msg_type: 'interactive',
      content: JSON.stringify(cardJson)
    };
    const resp = await axios.post(url, payload, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
    });
    if (!resp.data || resp.data.code !== 0) {
      const code = resp.data?.code;
      const msg = resp.data?.msg || resp.data?.message;
      throw new Error(`Failed to send card: code=${code} msg=${msg}`);
    }
    return resp.data;
  }

  async sendTextToChat(chatId, text) {
    if (!chatId) throw new Error('chatId is required');
    const token = await this.getTenantAccessToken();
    const url = 'https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=chat_id';
    const payload = {
      receive_id: chatId,
      msg_type: 'text',
      content: JSON.stringify({ text })
    };
    const resp = await axios.post(url, payload, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
    });
    if (!resp.data || resp.data.code !== 0) {
      const code = resp.data?.code;
      const msg = resp.data?.msg || resp.data?.message;
      throw new Error(`Failed to send text: code=${code} msg=${msg}`);
    }
    return resp.data;
  }

  async resolveChatIdByCode(chatCode) {
    if (!chatCode) throw new Error('chatCode is required');
    const token = await this.getTenantAccessToken();
    const url = `https://open.feishu.cn/open-apis/im/v1/chats/find_by_chat_code?chat_code=${encodeURIComponent(chatCode)}`;
    const resp = await axios.get(url, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!resp.data || resp.data.code !== 0) {
      throw new Error('Failed to resolve chat_id: ' + JSON.stringify(resp.data));
    }
    // 返回数据通常在 data.chat_id 或 data.open_chat_id
    const data = resp.data.data || {};
    return data.chat_id || data.open_chat_id || null;
  }

  // 可选：使用官方 SDK 启动长连接（如果未安装 SDK，则跳过）。
  async startLongConnection(logger = console) {
    if (process.env.FEISHU_LONG_CONN_ENABLED !== 'true') {
      logger.log('Feishu long connection disabled (FEISHU_LONG_CONN_ENABLED!=true)');
      return;
    }
    let sdk;
    try {
      // 延迟加载，避免在未安装 SDK 时直接报错
      sdk = require('@larksuiteoapi/node-sdk');
    } catch (e) {
      logger.warn('Feishu SDK not installed. Run: npm i @larksuiteoapi/node-sdk');
      return;
    }

    const { APP_ID, APP_SECRET } = this.config;
    const client = new sdk.Client({
      appId: APP_ID,
      appSecret: APP_SECRET,
      appType: sdk.AppType.SelfBuild,
      domain: sdk.Domain.FeiShu
    });
    // 长连接（事件订阅）

    // 注册卡片交互事件
    client.event.on('card.action.trigger', async (ctx) => {
      try {
        const body = ctx.getRequestBody();
        logger.log('Long-conn card action received');
        // 复用现有 webhook 处理逻辑
        const port = process.env.PORT || 3000;
        try {
          await axios.post(`http://127.0.0.1:${port}/api/feishu/webhook`, body, {
            headers: { 'Content-Type': 'application/json' }
          });
        } catch (err) {
          logger.warn('Forward card action to local webhook failed:', err.message);
        }
      } catch (err) {
        logger.error('card.action handler error:', err);
      }
    });

    // 可选：监听群消息，便于读取 chat_id（需在应用后台勾选“接收消息事件”）
    client.event.on('im.message.receive_v1', async (ctx) => {
      try {
        const event = (ctx.getRequestBody() || {}).event || {};
        const chatId = event.message?.chat_id || event.message?.open_chat_id;
        if (chatId) logger.log('im.message.receive_v1 chat_id:', chatId);
      } catch (e) {
        logger.warn('im.message.receive_v1 handler error:', e.message);
      }
    });

    await client.event.start();
    logger.log('Feishu long connection started');
  }
}

function buildNoEatCard(mealType = 'lunch') {
  const isLunch = mealType === 'lunch';
  const title = isLunch ? '🍽️ 今日午餐' : '🌙 今日晚餐';
  const actionValue = isLunch ? 'no_eat_lunch' : 'no_eat_dinner';
  return {
    config: { wide_screen_mode: true },
    header: { template: isLunch ? 'blue' : 'orange', title: { tag: 'plain_text', content: `${title}登记提醒` } },
    elements: [
      { tag: 'div', text: { tag: 'lark_md', content: '若不用餐，请在截止时间前点击下方按钮登记不吃。' } },
      {
        tag: 'action',
        actions: [
          {
            tag: 'button',
            text: { tag: 'plain_text', content: `🚫 登记不吃${isLunch ? '午餐' : '晚餐'}` },
            type: 'primary',
            value: { action: actionValue }
          }
        ]
      }
    ]
  };
}

module.exports = { FeishuAppBot, buildNoEatCard };
