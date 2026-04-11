import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { BrowserAutomation } = require('../lib/js-eyes-client.js');
const { getAnswer, getArticle } = require('../lib/api.js');

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
      name: 'zhihu_get_answer',
      label: 'Zhihu Ops: Get Answer',
      description: '读取知乎回答详情，返回标题、作者、正文、点赞和评论数。',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: '知乎回答 URL' },
        },
        required: ['url'],
      },
      async execute(_id, params) {
        const bot = ensureBot();
        const result = await getAnswer(bot, params.url, { browserServer: serverUrl });
        return jsonResult(result);
      },
    },
    { optional: true },
  );

  api.registerTool(
    {
      name: 'zhihu_get_article',
      label: 'Zhihu Ops: Get Article',
      description: '读取知乎专栏详情，返回标题、作者、发布时间和正文。',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: '知乎专栏 URL' },
        },
        required: ['url'],
      },
      async execute(_id, params) {
        const bot = ensureBot();
        const result = await getArticle(bot, params.url, { browserServer: serverUrl });
        return jsonResult(result);
      },
    },
    { optional: true },
  );
}
