import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { BrowserAutomation } = require('../lib/js-eyes-client.js');
const { getNote } = require('../lib/api.js');

export default function register(api) {
  const cfg = api.pluginConfig ?? {};
  const serverUrl = cfg.jsEyesServerUrl || 'ws://localhost:18080';
  const defaultMaxCommentPages = cfg.defaultMaxCommentPages || 0;

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
      name: 'xhs_get_note',
      label: 'XHS Ops: Get Note',
      description: '读取小红书笔记详情，返回正文、图片、作者信息和评论。',
      parameters: {
        type: 'object',
        properties: {
          url: {
            type: 'string',
            description: '小红书笔记 URL',
          },
          maxCommentPages: {
            type: 'number',
            description: '评论翻页数，默认 0 表示不扩展抓取评论分页',
          },
        },
        required: ['url'],
      },
      async execute(_id, params) {
        const bot = ensureBot();
        const result = await getNote(bot, params.url, {
          browserServer: serverUrl,
          maxCommentPages: params.maxCommentPages ?? defaultMaxCommentPages,
        });
        return jsonResult(result);
      },
    },
    { optional: true },
  );
}
