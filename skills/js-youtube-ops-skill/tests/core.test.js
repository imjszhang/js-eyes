'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { extractVideoId } = require('../lib/youtubeUtils');
const definition = require('../skill.definition');

test('extractVideoId supports watch, short, shorts, and embed URLs', () => {
  const id = 'dQw4w9WgXcQ';
  assert.equal(extractVideoId(`https://www.youtube.com/watch?v=${id}&t=1`), id);
  assert.equal(extractVideoId(`https://youtu.be/${id}`), id);
  assert.equal(extractVideoId(`https://www.youtube.com/shorts/${id}`), id);
  assert.equal(extractVideoId(`https://www.youtube.com/embed/${id}`), id);
  assert.equal(extractVideoId('https://example.com/watch?v=dQw4w9WgXcQ'), null);
});

test('definition exposes the two local-process read tools', () => {
  assert.deepEqual(
    definition.TOOL_DEFINITIONS.map((tool) => tool.name),
    ['youtube_get_video', 'youtube_get_subtitles'],
  );
  for (const tool of definition.TOOL_DEFINITIONS) {
    assert.equal(tool.risk, 'read');
    assert.deepEqual(tool.capabilities.sort(), ['network.direct', 'process.spawn']);
  }
});
