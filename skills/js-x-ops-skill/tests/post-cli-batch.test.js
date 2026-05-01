'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

// 目标：验证 post CLI 在多 positional 下会走 lib/api.js::getPost 批量路径
// （而不是 runTool 单 URL 路径），且传入的 tweetInputs 是 positional 数组。
//
// 做法：在 require('../cli') 之前，把 lib/api / lib/runTool / lib/js-eyes-client
// 三个模块的 require cache 换成 stub，观察 CLI 分派。

const apiModPath = require.resolve('../lib/api');
const runToolModPath = require.resolve('../lib/runTool');
const clientModPath = require.resolve('../lib/js-eyes-client');

let getPostCalls = [];
let runToolCalls = [];

require.cache[apiModPath] = {
  id: apiModPath,
  filename: apiModPath,
  loaded: true,
  exports: {
    getPost: async (browser, tweetInputs, options) => {
      getPostCalls.push({ tweetInputs, options });
      return { ok: true, metrics: { durationMs: 1 }, data: { results: [] } };
    },
  },
};
require.cache[runToolModPath] = {
  id: runToolModPath,
  filename: runToolModPath,
  loaded: true,
  exports: {
    runTool: async (browser, spec) => {
      runToolCalls.push(spec);
      return { ok: true, data: {} };
    },
  },
};
require.cache[clientModPath] = {
  id: clientModPath,
  filename: clientModPath,
  loaded: true,
  exports: {
    BrowserAutomation: class {
      constructor() {}
      disconnect() {}
    },
  },
};

const cli = require('../cli');

// 劫持 stdout 避免 printJson 污染测试输出
const origWrite = process.stdout.write;
function silenceStdout(run) {
  return async (...args) => {
    process.stdout.write = () => true;
    try { return await run(...args); } finally { process.stdout.write = origWrite; }
  };
}

test('post 命令单 positional 走 runTool 路径', async () => {
  getPostCalls = [];
  runToolCalls = [];
  await silenceStdout(cli.main)(['post', 'https://x.com/user/status/111']);
  assert.equal(getPostCalls.length, 0, '单 URL 不应走 getPost 批量路径');
  assert.equal(runToolCalls.length, 1, '单 URL 应走 runTool 路径');
  assert.equal(runToolCalls[0].toolName, 'x_get_post');
  assert.equal(runToolCalls[0].args.url, 'https://x.com/user/status/111');
});

test('post 命令多 positional 走 lib/api.js::getPost 批量路径', async () => {
  getPostCalls = [];
  runToolCalls = [];
  await silenceStdout(cli.main)([
    'post',
    'https://x.com/a/status/1',
    'https://x.com/b/status/2',
    'https://x.com/c/status/3',
  ]);
  assert.equal(runToolCalls.length, 0, '多 URL 不应再走 runTool');
  assert.equal(getPostCalls.length, 1, '多 URL 应调用一次 getPost');
  assert.deepEqual(getPostCalls[0].tweetInputs, [
    'https://x.com/a/status/1',
    'https://x.com/b/status/2',
    'https://x.com/c/status/3',
  ]);
});

test('post 命令带 --with-thread / --with-replies 时透传 options', async () => {
  getPostCalls = [];
  runToolCalls = [];
  await silenceStdout(cli.main)([
    'post',
    'https://x.com/a/status/10',
    'https://x.com/b/status/20',
    '--with-thread',
    '--with-replies', '5',
  ]);
  assert.equal(getPostCalls.length, 1);
  assert.equal(getPostCalls[0].options.withThread, true);
  assert.equal(getPostCalls[0].options.withReplies, 5);
});
