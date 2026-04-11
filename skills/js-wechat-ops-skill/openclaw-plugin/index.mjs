import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { BrowserAutomation } = require('../lib/js-eyes-client.js');
const { getArticle } = require('../lib/api.js');

export default function register(api) {
  const cfg = api.pluginConfig ?? {};
  const serverUrl = cfg.jsEyesServerUrl || 'ws://localhost:18080';

  function ensureBot() {
    return new BrowserAutomation(serverUrl, {
      logger: {
        info: (message) => api.logger.info(message),
        warn: (message) => api.logger.warn(message),
        error: (message) => api.logger.error(message),
      },
    });
  }

  function textResult(text) {
    return { content: [{ type: 'text', text }] };
  }

  function jsonResult(value) {
    return textResult(JSON.stringify(value, null, 2));
  }

  api.registerTool(
    {
      name: 'wechat_get_article',
      label: 'WeChat Ops: Get Article',
      description: '读取微信公众号文章详情，返回标题、作者、摘要、正文、头图和图片列表。',
      parameters: {
        type: 'object',
        properties: {
          url: {
            type: 'string',
            description: '微信公众号文章 URL',
          },
        },
        required: ['url'],
      },
      async execute(_id, params) {
        const bot = ensureBot();
        const result = await getArticle(bot, params.url, {
          browserServer: serverUrl,
        });
        return jsonResult(result);
      },
    },
    { optional: true },
  );
}
