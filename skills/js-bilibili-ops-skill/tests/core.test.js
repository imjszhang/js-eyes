'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { extractVideoId } = require('../lib/bilibiliUtils');
const definition = require('../skill.definition');

test('extractVideoId supports canonical, mobile, av, and short URLs', () => {
  assert.equal(extractVideoId('https://www.bilibili.com/video/BV1xx411c7mD'), 'BV1xx411c7mD');
  assert.equal(extractVideoId('https://m.bilibili.com/video/av12345'), 'AV12345');
  assert.equal(extractVideoId('https://b23.tv/AbCd12'), 'AbCd12');
  assert.equal(extractVideoId('https://example.com/video/BV1xx411c7mD'), null);
});

test('definition exposes the two local-process read tools', () => {
  assert.deepEqual(
    definition.TOOL_DEFINITIONS.map((tool) => tool.name),
    ['bilibili_get_video', 'bilibili_get_subtitles'],
  );
  for (const tool of definition.TOOL_DEFINITIONS) {
    assert.equal(tool.risk, 'read');
    assert.deepEqual(tool.capabilities.sort(), ['network.direct', 'process.spawn']);
  }
});
