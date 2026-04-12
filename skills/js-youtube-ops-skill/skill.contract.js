'use strict';

const manifest = require('./openclaw-plugin/openclaw.plugin.json');
const pkg = require('./package.json');
const { getVideo, getSubtitles } = require('./lib/api');

const CLI_COMMANDS = [
  { name: 'video', description: '读取 YouTube 视频元数据' },
  { name: 'subtitles', description: '读取 YouTube 视频字幕' },
];

function createRuntime(config = {}, logger) {
  return {
    config: {
      cookiesFromBrowser: config.cookiesFromBrowser || 'firefox',
      subLangs: config.subLangs || 'zh-Hans,zh-Hant,en',
    },
    logger: logger || console,
    textResult(text) {
      return { content: [{ type: 'text', text }] };
    },
    jsonResult(value) {
      return this.textResult(JSON.stringify(value, null, 2));
    },
  };
}

const TOOL_DEFINITIONS = [
  {
    name: 'youtube_get_video',
    label: 'YouTube Ops: Get Video',
    description: '读取 YouTube 视频元数据，可选同时返回字幕。',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'YouTube 视频 URL' },
        includeSubtitles: { type: 'boolean', description: '是否同时获取字幕' },
      },
      required: ['url'],
    },
    optional: true,
    async execute(runtime, params) {
      return getVideo(params.url, {
        cookiesFromBrowser: runtime.config.cookiesFromBrowser,
        subLangs: runtime.config.subLangs,
        includeSubtitles: params.includeSubtitles !== false,
      });
    },
  },
  {
    name: 'youtube_get_subtitles',
    label: 'YouTube Ops: Get Subtitles',
    description: '读取 YouTube 视频字幕，返回语言列表和字幕文本。',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'YouTube 视频 URL' },
      },
      required: ['url'],
    },
    optional: true,
    async execute(runtime, params) {
      return getSubtitles(params.url, {
        cookiesFromBrowser: runtime.config.cookiesFromBrowser,
        subLangs: runtime.config.subLangs,
      });
    },
  },
];

function createOpenClawAdapter(config = {}, logger) {
  const runtime = createRuntime(config, logger);
  return {
    runtime,
    tools: TOOL_DEFINITIONS.map((tool) => ({
      name: tool.name,
      label: tool.label,
      description: tool.description,
      parameters: tool.parameters,
      optional: tool.optional,
      async execute(_toolCallId, params) {
        const result = await tool.execute(runtime, params);
        return runtime.jsonResult(result);
      },
    })),
  };
}

module.exports = {
  id: manifest.id,
  name: manifest.name || 'JS YouTube Ops Skill',
  version: manifest.version || pkg.version,
  description: manifest.description || pkg.description,
  runtime: {
    requiresLocalBrowserCookies: true,
    platforms: ['youtube.com'],
  },
  cli: {
    entry: './cli/index.js',
    commands: CLI_COMMANDS,
  },
  openclaw: {
    manifestPath: './openclaw-plugin/openclaw.plugin.json',
    tools: TOOL_DEFINITIONS.map((tool) => ({
      name: tool.name,
      label: tool.label,
      description: tool.description,
      parameters: tool.parameters,
      optional: tool.optional,
    })),
  },
  createRuntime,
  createOpenClawAdapter,
};
