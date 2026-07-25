'use strict';

// Shared declarative metadata for the CLI and the native V2 entry.

const pkg = require('./package.json');
const { getVideo, getSubtitles } = require('./lib/api');
const { resolveRuntimeConfig } = require('./lib/runtimeConfig');

const CLI_COMMANDS = [
  { name: 'video', description: '读取 Bilibili 视频元数据' },
  { name: 'subtitles', description: '读取 Bilibili 视频字幕' },
];

function createRuntime(config = {}, logger) {
  const resolvedConfig = resolveRuntimeConfig(config);
  return {
    config: {
      cookiesFromBrowser: config.cookiesFromBrowser || 'firefox',
      subLangs: config.subLangs || 'zh-Hans,zh-Hant,ai-zh',
      recording: resolvedConfig.recording,
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
    name: 'bilibili_get_video',
    risk: 'read',
    capabilities: ["network.direct","process.spawn"],
    label: 'Bilibili Ops: Get Video',
    description: '读取 Bilibili 视频元数据，可选同时返回字幕。',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'Bilibili 视频 URL' },
        includeSubtitles: { type: 'boolean', description: '是否同时获取字幕' },
      },
      required: ['url'],
    },
    optional: true,
    async execute(runtime, params, context = {}) {
      return getVideo(params.url, {
        cookiesFromBrowser: runtime.config.cookiesFromBrowser,
        subLangs: runtime.config.subLangs,
        includeSubtitles: params.includeSubtitles !== false,
        recording: runtime.config.recording,
        runId: context.toolCallId,
      });
    },
  },
  {
    name: 'bilibili_get_subtitles',
    risk: 'read',
    capabilities: ["network.direct","process.spawn"],
    label: 'Bilibili Ops: Get Subtitles',
    description: '读取 Bilibili 视频字幕，返回语言列表和字幕文本。',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'Bilibili 视频 URL' },
      },
      required: ['url'],
    },
    optional: true,
    async execute(runtime, params, context = {}) {
      return getSubtitles(params.url, {
        cookiesFromBrowser: runtime.config.cookiesFromBrowser,
        subLangs: runtime.config.subLangs,
        recording: runtime.config.recording,
        runId: context.toolCallId,
      });
    },
  },
];



const skillCapabilities = {
  "browser": [],
  "network": {
    "direct": true,
    "hosts": [
      "bilibili.com"
    ]
  },
  "filesystem": [
    "skillData"
  ],
  "process": [
    "spawn"
  ],
  "secrets": [],
  "background": false
};
const skillRequirements = {
  "server": false,
  "browserExtension": false,
  "login": false,
  "platforms": [
    "bilibili.com"
  ]
};

module.exports = {
  capabilities: skillCapabilities,
  requirements: skillRequirements,
  id: pkg.name,
  name: 'JS Bilibili Ops Skill',
  version: pkg.version,
  description: pkg.description,
  runtime: {
    requiresLocalBrowserCookies: true,
    platforms: ['bilibili.com'],
  },
  cli: {
    entry: './cli/index.js',
    commands: CLI_COMMANDS,
  },
  createRuntime,
  TOOL_DEFINITIONS,
};
