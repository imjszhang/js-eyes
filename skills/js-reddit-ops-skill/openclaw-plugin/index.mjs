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
      name: 'reddit_get_post',
      label: 'Reddit Ops: Get Post',
      description: '读取 Reddit 帖子详情，返回正文、subreddit、图片和评论树。',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'Reddit 帖子 URL' },
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
