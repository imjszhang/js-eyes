import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { getVideo, getSubtitles } = require('../lib/api.js');

export default function register(api) {
  const cfg = api.pluginConfig ?? {};
  const cookiesFromBrowser = cfg.cookiesFromBrowser || 'firefox';
  const subLangs = cfg.subLangs || 'zh-Hans,zh-Hant,ai-zh';

  function textResult(text) {
    return { content: [{ type: 'text', text }] };
  }

  function jsonResult(value) {
    return textResult(JSON.stringify(value, null, 2));
  }

  api.registerTool(
    {
      name: 'bilibili_get_video',
      label: 'Bilibili Ops: Get Video',
      description: '读取 Bilibili 视频元数据，可选同时返回字幕。',
      parameters: {
        type: 'object',
        properties: {
          url: {
            type: 'string',
            description: 'Bilibili 视频 URL',
          },
          includeSubtitles: {
            type: 'boolean',
            description: '是否同时获取字幕',
          },
        },
        required: ['url'],
      },
      async execute(_id, params) {
        const result = await getVideo(params.url, {
          cookiesFromBrowser,
          subLangs,
          includeSubtitles: params.includeSubtitles !== false,
        });
        return jsonResult(result);
      },
    },
    { optional: true },
  );

  api.registerTool(
    {
      name: 'bilibili_get_subtitles',
      label: 'Bilibili Ops: Get Subtitles',
      description: '读取 Bilibili 视频字幕，返回语言列表和字幕文本。',
      parameters: {
        type: 'object',
        properties: {
          url: {
            type: 'string',
            description: 'Bilibili 视频 URL',
          },
        },
        required: ['url'],
      },
      async execute(_id, params) {
        const result = await getSubtitles(params.url, {
          cookiesFromBrowser,
          subLangs,
        });
        return jsonResult(result);
      },
    },
    { optional: true },
  );
}
