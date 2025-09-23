const axios = require('axios');

async function startFeishuLongConnection(config, logger = console) {
  if (process.env.FEISHU_LONG_CONN_ENABLED !== 'true') {
    logger.log('Feishu long connection disabled (FEISHU_LONG_CONN_ENABLED!=true)');
    return;
  }

  let Lark;
  try {
    Lark = require('@larksuiteoapi/node-sdk');
    try {
      const ver = require('@larksuiteoapi/node-sdk/package.json').version;
      logger.log(`[feishu-sdk] @larksuiteoapi/node-sdk version: ${ver}`);
    } catch {}
  } catch (e) {
    logger.warn('Feishu SDK not installed. Run: npm i @larksuiteoapi/node-sdk');
    return;
  }

  const { APP_ID, APP_SECRET } = config;

  try {
    // 创建基础配置
    const baseConfig = {
      appId: APP_ID,
      appSecret: APP_SECRET,
      appType: Lark.AppType.SelfBuild,
      domain: Lark.Domain.FeiShu
    };

    // 创建普通客户端用于发送消息
    const client = new Lark.Client(baseConfig);

    // 创建WebSocket客户端用于长连接
    const wsClient = new Lark.WSClient({
      ...baseConfig,
      loggerLevel: Lark.LoggerLevel.info
    });

    logger.log('[feishu-sdk] Creating event dispatcher...');

    // 创建事件分发器
    const eventDispatcher = new Lark.EventDispatcher({}).register({
      // 处理消息接收事件
      'im.message.receive_v1': async (data) => {
        try {
          logger.log('Long-conn message received:', JSON.stringify(data, null, 2));
          const { message } = data;
          const chatId = message?.chat_id;
          if (chatId) {
            logger.log('im.message.receive_v1 chat_id:', chatId);
            // 转发到本地webhook处理
            const port = process.env.PORT || 3000;
            try {
              await axios.post(`http://127.0.0.1:${port}/api/feishu/webhook`, data, {
                headers: { 'Content-Type': 'application/json' }
              });
              logger.log('Message forwarded to local webhook successfully');
            } catch (err) {
              logger.warn('Forward message to local webhook failed:', err.message);
            }
          }
        } catch (e) {
          logger.error('im.message.receive_v1 handler error:', e);
        }
      },

      // 处理卡片交互事件
      'card.action.trigger': async (data) => {
        try {
          logger.log('Long-conn card action received:', JSON.stringify(data, null, 2));

          // 直接转发所有卡片交互事件到主代码的webhook处理器
          const port = process.env.PORT || 3000;
          try {
            await axios.post(`http://127.0.0.1:${port}/api/feishu/webhook`, data, {
              headers: { 'Content-Type': 'application/json' }
            });
            logger.log('Card action forwarded to local webhook successfully');
          } catch (err) {
            logger.warn('Forward card action to local webhook failed:', err.message);
          }
        } catch (err) {
          logger.error('card.action handler error:', err);
        }
      }
    });

    logger.log('[feishu-sdk] Starting WebSocket client...');

    // 添加连接状态监控
    let isConnected = false;
    let reconnectTimer = null;
    let heartbeatTimer = null;

    // 连接状态监控函数
    const startHeartbeat = () => {
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      heartbeatTimer = setInterval(() => {
        if (isConnected) {
          logger.log('🫀 Feishu长连接心跳检查 - 连接正常');
        } else {
          logger.warn('⚠️  Feishu长连接心跳检查 - 连接异常，尝试重连...');
          attemptReconnect();
        }
      }, 30000); // 每30秒检查一次
    };

    // 重连机制
    const attemptReconnect = async () => {
      if (reconnectTimer) return; // 避免重复重连

      logger.warn('🔄 开始重连Feishu长连接...');
      reconnectTimer = setTimeout(async () => {
        try {
          // 重新创建WebSocket客户端
          const newWsClient = new Lark.WSClient({
            ...baseConfig,
            loggerLevel: Lark.LoggerLevel.info
          });

          await newWsClient.start({
            eventDispatcher: eventDispatcher
          });

          // 更新全局引用
          global.__feishu_ws_client = newWsClient;
          isConnected = true;
          reconnectTimer = null;

          logger.log('✅ Feishu长连接重连成功');
        } catch (error) {
          logger.error('❌ Feishu长连接重连失败:', error);
          reconnectTimer = null;
          isConnected = false;
          // 5秒后再次尝试重连
          setTimeout(attemptReconnect, 5000);
        }
      }, 2000);
    };

    // 启动WebSocket长连接
    try {
      await wsClient.start({
        eventDispatcher: eventDispatcher
      });

      isConnected = true;
      logger.log('✅ Feishu long connection started successfully with WSClient');

      // 启动心跳监控
      startHeartbeat();

      // 监听连接错误事件
      wsClient.on?.('error', (error) => {
        logger.error('❌ Feishu长连接错误:', error);
        isConnected = false;
      });

      wsClient.on?.('close', () => {
        logger.warn('⚠️  Feishu长连接已关闭');
        isConnected = false;
      });

      wsClient.on?.('open', () => {
        logger.log('✅ Feishu长连接已恢复');
        isConnected = true;
      });

    } catch (error) {
      logger.error('❌ 启动Feishu长连接失败:', error);
      isConnected = false;
      // 启动重连机制
      attemptReconnect();
    }

    // 保存客户端引用以便后续使用
    global.__feishu_ws_client = wsClient;
    global.__feishu_client = client;
    global.__feishu_connection_status = () => isConnected;

  } catch (e) {
    logger.error('Failed to start Feishu long connection:', e);
    throw e;
  }
}

// 使用长连接客户端发送群消息的函数
async function sendMessageViaLongConnection(chatId, message, logger = console) {
  try {
    // 获取全局保存的长连接客户端
    const client = global.__feishu_client;
    if (!client) {
      throw new Error('长连接客户端未初始化，请先启动长连接');
    }

    // 简化编码处理 - 直接返回原字符串，避免编码问题
    const ensureUtf8 = (str) => {
      if (typeof str !== 'string') return str;
      return str; // 直接返回，不做额外处理
    };

    // 根据消息类型发送不同格式的消息
    let response;

    if (message.msg_type === 'text') {
      // 发送文本消息
      const textContent = ensureUtf8(message.content.text);
      logger.log('准备发送文本内容:', textContent);

      response = await client.im.message.create({
        params: { receive_id_type: 'chat_id' },
        data: {
          receive_id: chatId,
          content: JSON.stringify({ text: textContent }),
          msg_type: 'text'
        }
      });
    } else if (message.msg_type === 'interactive') {
      // 发送交互式卡片消息
      // 递归处理卡片内容中的中文
      const processCardContent = (obj) => {
        if (typeof obj === 'string') {
          return ensureUtf8(obj);
        } else if (Array.isArray(obj)) {
          return obj.map(processCardContent);
        } else if (obj && typeof obj === 'object') {
          const processed = {};
          for (const [key, value] of Object.entries(obj)) {
            processed[key] = processCardContent(value);
          }
          return processed;
        }
        return obj;
      };

      const processedCard = processCardContent(message.card);
      logger.log('准备发送卡片内容:', JSON.stringify(processedCard, null, 2));

      // 对于长连接，使用标准的消息创建API，但确保卡片格式正确
      response = await client.im.message.create({
        params: { receive_id_type: 'chat_id' },
        data: {
          receive_id: chatId,
          content: JSON.stringify(processedCard),
          msg_type: 'interactive'
        }
      });
    } else if (message.msg_type === 'post') {
      // 发送富文本消息
      const processedPost = JSON.parse(JSON.stringify(message.content.post, (key, value) => {
        return typeof value === 'string' ? ensureUtf8(value) : value;
      }));

      response = await client.im.message.create({
        params: { receive_id_type: 'chat_id' },
        data: {
          receive_id: chatId,
          content: JSON.stringify(processedPost),
          msg_type: 'post'
        }
      });
    } else {
      throw new Error(`不支持的消息类型: ${message.msg_type}`);
    }

    logger.log('长连接发送群消息成功:', response.data);
    return { success: true, data: response.data, message: '消息发送成功' };

  } catch (error) {
    logger.error('长连接发送群消息失败:', error);
    return { success: false, message: error.message };
  }
}

// 获取群聊ID的辅助函数
async function getChatId(logger = console) {
  try {
    const client = global.__feishu_client;
    if (!client) {
      throw new Error('长连接客户端未初始化');
    }

    // 获取机器人所在的群聊列表
    const response = await client.im.chat.list({
      params: {
        page_size: 50
      }
    });

    logger.log('群聊列表:', response.data);
    return { success: true, data: response.data };

  } catch (error) {
    logger.error('获取群聊ID失败:', error);
    return { success: false, message: error.message };
  }
}

module.exports = {
  startFeishuLongConnection,
  sendMessageViaLongConnection,
  getChatId
};
