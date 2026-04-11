import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { BrowserAutomation } = require('../lib/js-eyes-client.js');
const { getPost } = require('../lib/api.js');

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
      name: 'jike_get_post',
      label: 'Jike Ops: Get Post',
      description: '读取即刻帖子详情，返回正文、图片、作者、互动数据和评论。',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: '即刻帖子 URL' },
        },
        required: ['url'],
      },
      async execute(_id, params) {
        const bot = ensureBot();
        const result = await getPost(bot, params.url, { browserServer: serverUrl });
        return jsonResult(result);
      },
    },
    { optional: true },
  );
}
