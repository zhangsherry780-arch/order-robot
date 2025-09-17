const { sendMessageViaLongConnection } = require('./libs/feishu-longconn');

async function testButton() {
  try {
    console.log('开始测试按钮发送...');

    const chatId = process.env.FEISHU_TARGET_CHAT_ID || 'oc_884ed80945230a297440e788f160426d';

    const buttonMessage = {
      msg_type: 'interactive',
      card: {
        config: {
          wide_screen_mode: true,
          enable_forward: true
        },
        header: {
          title: {
            tag: 'plain_text',
            content: '测试按钮 - UTF-8 修复后'
          },
          template: 'blue'
        },
        elements: [
          {
            tag: 'div',
            text: {
              tag: 'lark_md',
              content: '请点击下面的按钮测试UTF-8编码和按钮功能：'
            }
          },
          {
            tag: 'action',
            actions: [
              {
                tag: 'button',
                text: {
                  tag: 'plain_text',
                  content: '🚫 登记不吃午餐'
                },
                type: 'primary'
              }
            ]
          }
        ]
      }
    };

    console.log('发送按钮消息到群聊:', chatId);
    const result = await sendMessageViaLongConnection(chatId, buttonMessage);
    console.log('发送结果:', result);

  } catch (error) {
    console.error('测试失败:', error);
  }
}

testButton();