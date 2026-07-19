'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { OfficialApiClient } = require('../lib/official-api/client');
const { parseApiArgs, runApi, readArticleBody } = require('../lib/official-api/dispatcher');
const { markdownToDraftJs } = require('../lib/official-api/draftJsBuilder');
const { toArticleMediaRef, scanMarkdownImages, isRemoteUrl } = require('../lib/official-api/articleMedia');

function makeResponse({ ok = true, status = 200, body = {} } = {}) {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return {
    ok,
    status,
    json: async () => (typeof body === 'string' ? JSON.parse(body) : body),
    text: async () => text,
  };
}

async function withFetchMock(handler, run) {
  const originalFetch = global.fetch;
  const calls = [];
  global.fetch = async (url, opts = {}) => {
    calls.push({ url: String(url), opts });
    return handler(url, opts, calls);
  };
  try {
    return await run(calls);
  } finally {
    global.fetch = originalFetch;
  }
}

async function silenceStdout(run) {
  const originalWrite = process.stdout.write;
  let output = '';
  process.stdout.write = (chunk) => {
    output += String(chunk);
    return true;
  };
  try {
    const code = await run();
    return { code, output };
  } finally {
    process.stdout.write = originalWrite;
  }
}

function withApiEnv(run) {
  const keys = ['X_API_KEY', 'X_API_SECRET', 'X_ACCESS_TOKEN', 'X_ACCESS_TOKEN_SECRET', 'X_BEARER_TOKEN', 'X_API_BEARER_TOKEN', 'JS_X_SKIP_DOTENV'];
  const old = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  process.env.X_API_KEY = 'key';
  process.env.X_API_SECRET = 'secret';
  process.env.X_ACCESS_TOKEN = 'token';
  process.env.X_ACCESS_TOKEN_SECRET = 'token_secret';
  delete process.env.X_BEARER_TOKEN;
  delete process.env.X_API_BEARER_TOKEN;
  process.env.JS_X_SKIP_DOTENV = '1';
  try {
    return run();
  } finally {
    for (const k of keys) {
      if (old[k] == null) delete process.env[k];
      else process.env[k] = old[k];
    }
  }
}

function withNoApiEnv(run) {
  const keys = ['X_API_KEY', 'X_API_SECRET', 'X_ACCESS_TOKEN', 'X_ACCESS_TOKEN_SECRET', 'X_BEARER_TOKEN', 'X_API_BEARER_TOKEN', 'JS_X_SKIP_DOTENV'];
  const old = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  for (const k of keys) delete process.env[k];
  process.env.JS_X_SKIP_DOTENV = '1';
  try {
    return run();
  } finally {
    for (const k of keys) {
      if (old[k] == null) delete process.env[k];
      else process.env[k] = old[k];
    }
  }
}

test('markdownToDraftJs converts headers lists quote and inline styles', () => {
  const md = [
    '# Title',
    '',
    'Hello **bold** and *italic*',
    '',
    '- item one',
    '1. ordered',
    '',
    '> quote line',
  ].join('\n');
  const { content_state: cs } = markdownToDraftJs(md);
  assert.equal(cs.blocks[0].type, 'header-one');
  assert.equal(cs.blocks[0].text, 'Title');
  const styled = cs.blocks.find((b) => b.text.includes('bold'));
  assert.ok(styled);
  assert.ok(styled.inline_style_ranges.some((r) => r.style === 'bold'));
  assert.ok(cs.blocks.some((b) => b.type === 'unordered-list-item'));
  assert.ok(cs.blocks.some((b) => b.type === 'ordered-list-item'));
  assert.ok(cs.blocks.some((b) => b.type === 'blockquote'));
});

test('markdownToDraftJs downgrades ### to header-two (X API rejects header-three)', () => {
  const { content_state: cs } = markdownToDraftJs('## Section\n\n### Subsection\n\nBody');
  assert.equal(cs.blocks[0].type, 'header-two');
  assert.equal(cs.blocks[0].text, 'Section');
  assert.equal(cs.blocks[1].type, 'header-two');
  assert.equal(cs.blocks[1].text, 'Subsection');
  assert.ok(!cs.blocks.some((b) => b.type === 'header-three'));
});

test('markdownToDraftJs creates link entity with correct range', () => {
  const { content_state: cs } = markdownToDraftJs('See [Docs](https://example.com) now');
  const block = cs.blocks[0];
  assert.equal(block.text, 'See Docs now');
  assert.equal(block.entity_ranges.length, 1);
  assert.equal(block.entity_ranges[0].offset, 4);
  assert.equal(block.entity_ranges[0].length, 4);
  assert.equal(cs.entities[0].value.type, 'link');
  assert.equal(cs.entities[0].value.data.url, 'https://example.com');
});

test('markdownToDraftJs converts fenced code to markdown atomic entity', () => {
  const md = [
    'Intro',
    '',
    '```',
    'You are a research agent',
    '1. step one',
    '- bullet',
    '```',
    '',
    'Outro',
  ].join('\n');
  const { content_state: cs } = markdownToDraftJs(md);
  const atomic = cs.blocks.find((b) => b.type === 'atomic');
  assert.ok(atomic);
  const entity = cs.entities[0].value;
  assert.equal(entity.type, 'markdown');
  assert.match(entity.data.markdown, /You are a research agent/);
  assert.match(entity.data.markdown, /1\. step one/);
  assert.ok(cs.blocks.some((b) => b.text === 'Intro'));
  assert.ok(cs.blocks.some((b) => b.text === 'Outro'));
});

test('markdownToDraftJs embeds tweet blocks', () => {
  const { content_state: cs } = markdownToDraftJs('{{tweet:1234567890}}');
  assert.equal(cs.blocks[0].type, 'atomic');
  assert.equal(cs.entities[0].value.type, 'post');
  assert.equal(cs.entities[0].value.data.post_id, '1234567890');
});

test('markdownToDraftJs applies image media map', () => {
  const { content_state: cs } = markdownToDraftJs('![cover](__ARTICLE_IMAGE__:img0)', {
    imageMediaMap: {
      img0: { media_id: '999', media_category: 'TWEET_IMAGE' },
    },
  });
  assert.equal(cs.entities[0].value.type, 'image');
  assert.deepEqual(cs.entities[0].value.data.media_items, [{
    media_id: '999',
    media_category: 'TWEET_IMAGE',
  }]);
});

test('toArticleMediaRef uppercases media category', () => {
  assert.deepEqual(toArticleMediaRef({ media_id: '1', media_category: 'tweet_image' }), {
    media_id: '1',
    media_category: 'TWEET_IMAGE',
  });
});

test('scanMarkdownImages skips tweet status URLs', () => {
  const refs = scanMarkdownImages('![p](https://x.com/u/status/123) ![img](./a.png)');
  assert.equal(refs.length, 1);
  assert.equal(refs[0].target, './a.png');
});

test('isRemoteUrl detects https refs', () => {
  assert.equal(isRemoteUrl('https://example.com/a.png'), true);
  assert.equal(isRemoteUrl('./local.png'), false);
});

test('OfficialApiClient.createArticleDraft posts draft payload', async () => {
  await withApiEnv(() => withFetchMock(async (url, opts) => {
    assert.equal(url, 'https://api.x.com/2/articles/draft');
    assert.equal(opts.method, 'POST');
    assert.match(opts.headers.Authorization, /^OAuth /);
    const body = JSON.parse(opts.body);
    assert.equal(body.title, 'My Article');
    assert.ok(body.content_state.blocks.length);
    return makeResponse({ status: 201, body: { data: { id: 'art1', title: 'My Article' } } });
  }, async () => {
    const client = new OfficialApiClient();
    const result = await client.createArticleDraft({
      title: 'My Article',
      contentState: markdownToDraftJs('Hello').content_state,
    });
    assert.equal(result.success, true);
    assert.equal(result.article_id, 'art1');
  }));
});

test('OfficialApiClient.publishArticle returns post_id', async () => {
  await withApiEnv(() => withFetchMock(async (url, opts) => {
    assert.match(String(url), /\/2\/articles\/art1\/publish$/);
    assert.equal(opts.method, 'POST');
    return makeResponse({ body: { data: { post_id: 'seed1' } } });
  }, async () => {
    const client = new OfficialApiClient();
    const result = await client.publishArticle('art1');
    assert.equal(result.success, true);
    assert.equal(result.post_id, 'seed1');
    assert.match(result.article_url, /art1/);
  }));
});

test('OfficialApiClient.publishArticle surfaces Premium hint on 403', async () => {
  await withApiEnv(() => withFetchMock(async () => makeResponse({
    ok: false,
    status: 403,
    body: { detail: 'Forbidden' },
  }), async () => {
    const client = new OfficialApiClient();
    const result = await client.publishArticle('art1');
    assert.equal(result.success, false);
    assert.equal(result.errorCode, 'forbidden');
    assert.match(result.error, /Premium/);
  }));
});

test('OfficialApiClient.createArticleDraft requires OAuth config', async () => {
  await withNoApiEnv(async () => {
    const client = new OfficialApiClient();
    const result = await client.createArticleDraft({
      title: 'T',
      contentState: markdownToDraftJs('x').content_state,
    });
    assert.equal(result.success, false);
    assert.equal(result.errorCode, 'api_not_configured');
  });
});

test('parseApiArgs supports article flags', () => {
  const { opts, positional } = parseApiArgs([
    'article-draft', 'Title',
    '--body-file', './a.md',
    '--cover', './cover.jpg',
    '--fetch-remote-images',
    '--publish',
  ]);
  assert.deepEqual(positional, ['article-draft', 'Title']);
  assert.equal(opts.bodyFile, './a.md');
  assert.equal(opts.cover, './cover.jpg');
  assert.equal(opts.fetchRemoteImages, true);
  assert.equal(opts.publish, true);
});

test('runApi article-draft creates draft only by default', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'article_test_'));
  const bodyPath = path.join(tmpDir, 'body.md');
  fs.writeFileSync(bodyPath, '# Hello\n\n**world**', 'utf8');
  try {
    await withApiEnv(() => withFetchMock(async (url) => {
      if (String(url).includes('/2/articles/draft')) {
        return makeResponse({ status: 201, body: { data: { id: 'draft1', title: 'Test Title' } } });
      }
      throw new Error(`unexpected fetch ${url}`);
    }, async () => {
      const { code, output } = await silenceStdout(() => runApi([
        'article-draft', 'Test Title',
        '--body-file', bodyPath,
      ]));
      assert.equal(code, 0);
      const envelope = JSON.parse(output);
      assert.equal(envelope.ok, true);
      assert.equal(envelope.result.article_id, 'draft1');
      assert.equal(envelope.result.published, false);
    }));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('runApi article-draft --publish hits draft and publish endpoints', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'article_pub_'));
  const bodyPath = path.join(tmpDir, 'body.md');
  fs.writeFileSync(bodyPath, 'Hello', 'utf8');
  try {
    await withApiEnv(() => withFetchMock(async (url, opts, calls) => {
      if (calls.length === 1) {
        return makeResponse({ status: 201, body: { data: { id: 'draft2', title: 'Pub Title' } } });
      }
      assert.match(String(url), /\/publish$/);
      return makeResponse({ body: { data: { post_id: 'post2' } } });
    }, async () => {
      const { code, output } = await silenceStdout(() => runApi([
        'article-draft', 'Pub Title',
        '--body-file', bodyPath,
        '--publish',
      ]));
      assert.equal(code, 0);
      const envelope = JSON.parse(output);
      assert.equal(envelope.result.published, true);
      assert.equal(envelope.result.post_id, 'post2');
    }));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('runApi article-publish publishes existing draft', async () => {
  await withApiEnv(() => withFetchMock(async (url) => {
    assert.match(String(url), /\/2\/articles\/abc\/publish$/);
    return makeResponse({ body: { data: { post_id: 'p1' } } });
  }, async () => {
    const { code, output } = await silenceStdout(() => runApi(['article-publish', 'abc']));
    assert.equal(code, 0);
    const envelope = JSON.parse(output);
    assert.equal(envelope.result.published, true);
    assert.equal(envelope.result.post_id, 'p1');
  }));
});

test('readArticleBody reads body file', () => {
  const tmp = path.join(os.tmpdir(), `article-read-${Date.now()}.md`);
  fs.writeFileSync(tmp, 'content', 'utf8');
  try {
    assert.equal(readArticleBody({ bodyFile: tmp }), 'content');
  } finally {
    fs.unlinkSync(tmp);
  }
});
