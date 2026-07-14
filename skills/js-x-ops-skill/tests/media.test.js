'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { listMediaFromTweet, normalizePhotoUrl, pickBestMp4, classifyStream } = require('../lib/media');

test('listMediaFromTweet from mediaDetails photo and video', () => {
  const items = listMediaFromTweet({
    tweetId: '1',
    mediaDetails: [
      {
        type: 'photo',
        url: 'https://pbs.twimg.com/media/AbCd?format=jpg&name=small',
      },
      {
        type: 'video',
        bestMp4Url: 'https://video.twimg.com/ext_tw_video/1.mp4',
        m3u8Url: 'https://video.twimg.com/pl/1.m3u8',
        variants: [{ url: 'https://video.twimg.com/ext_tw_video/1.mp4', contentType: 'video/mp4' }],
      },
    ],
  });
  assert.equal(items.length, 2);
  assert.equal(items[0].type, 'photo');
  assert.ok(items[0].url.includes('name=orig'));
  assert.equal(items[1].type, 'video');
  assert.equal(items[1].streamType, 'mp4');
});

test('listMediaFromTweet falls back to mediaUrls', () => {
  const items = listMediaFromTweet({
    mediaUrls: [
      'https://pbs.twimg.com/media/X?format=png',
      'https://video.twimg.com/v.mp4',
    ],
  });
  assert.equal(items.length, 2);
  assert.equal(items[0].type, 'photo');
  assert.equal(items[1].type, 'video');
});

test('normalizePhotoUrl and pickBestMp4', () => {
  assert.ok(normalizePhotoUrl('https://pbs.twimg.com/media/A?format=jpg&name=small').includes('name=orig'));
  const best = pickBestMp4([
    'https://video.twimg.com/640x360/x.mp4',
    'https://video.twimg.com/1280x720/x.mp4',
  ]);
  assert.equal(best[0], 'https://video.twimg.com/1280x720/x.mp4');
  assert.equal(classifyStream('https://video.twimg.com/pl/x.m3u8'), 'hls');
});
