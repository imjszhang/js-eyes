'use strict';

const fs = require('fs');
const path = require('path');
const pkg = require('../../package.json');
const { createOfficialApiClient } = require('./index');

function parseApiArgs(argv) {
  const opts = {
    output: null,
    pretty: false,
    help: false,
    maxPages: 2,
    maxResults: 100,
    media: null,
    mediaIds: [],
    alt: '',
    userId: null,
    excludeRetweets: true,
  };
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const eat = (k) => { opts[k] = argv[++i]; };
    const eatEq = (k, prefix) => { opts[k] = a.slice(prefix.length); };
    if (a === '--output') eat('output');
    else if (a.startsWith('--output=')) eatEq('output', '--output=');
    else if (a === '--pretty') opts.pretty = true;
    else if (a === '-h' || a === '--help') opts.help = true;
    else if (a === '--media' || a === '--media-path') eat('media');
    else if (a.startsWith('--media=')) eatEq('media', '--media=');
    else if (a.startsWith('--media-path=')) eatEq('media', '--media-path=');
    else if (a === '--media-id') opts.mediaIds.push(String(argv[++i] || '').trim());
    else if (a.startsWith('--media-id=')) opts.mediaIds.push(a.slice('--media-id='.length).trim());
    else if (a === '--alt' || a === '--alt-text') eat('alt');
    else if (a.startsWith('--alt=')) eatEq('alt', '--alt=');
    else if (a.startsWith('--alt-text=')) eatEq('alt', '--alt-text=');
    else if (a === '--max-pages') opts.maxPages = Number(argv[++i]) || 2;
    else if (a.startsWith('--max-pages=')) opts.maxPages = Number(a.slice('--max-pages='.length)) || 2;
    else if (a === '--max-results') opts.maxResults = Number(argv[++i]) || 100;
    else if (a.startsWith('--max-results=')) opts.maxResults = Number(a.slice('--max-results='.length)) || 100;
    else if (a === '--user-id') eat('userId');
    else if (a.startsWith('--user-id=')) eatEq('userId', '--user-id=');
    else if (a === '--include-retweets') opts.excludeRetweets = false;
    else if (a === '--exclude-retweets') opts.excludeRetweets = true;
    else if (a.startsWith('-')) {
      const err = new Error(`api: 未知选项 ${a}`);
      err.code = 'E_BAD_ARG';
      throw err;
    } else {
      positional.push(a);
    }
  }
  return { opts, positional };
}

function buildEnvelope(value, opts = {}) {
  const ok = !(value && value.ok === false);
  return {
    ok,
    result: value,
    error: ok ? null : {
      code: (value && (value.code || value.errorCode || value.error)) || 'command_failed',
      message: String((value && (value.message || value.error)) || 'command failed'),
    },
    meta: {
      version: pkg.version,
      command: opts.command || 'api',
      duration_ms: opts.startedAt ? Date.now() - opts.startedAt : null,
    },
  };
}

function printJson(value, opts) {
  const payload = buildEnvelope(value, opts);
  const text = JSON.stringify(payload, null, opts && opts.pretty ? 2 : 0) + '\n';
  if (opts && opts.output) {
    const abs = path.resolve(opts.output);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, text, 'utf8');
  }
  process.stdout.write(text);
}

function printApiHelp() {
  const lines = [
    'js-x-ops-skill api - X 官方 API (OAuth 1.0a)',
    '',
    'Usage: node index.js api <subcommand> [args] [options]',
    '',
    'Subcommands:',
    '  status                                  检查凭证配置与读权限',
    '  reply <tweet_id> <text>                 回复推文',
    '  tweet <text> [--media <path>]           发新帖，可附媒体',
    '  quote <tweet_id> <text>                 引用推文',
    '  thread <text1> <text2> ...              发串推',
    '  upload-media <path> [--alt <text>]      上传媒体，返回 media_id',
    '  timeline [--max-pages N]                读取当前账号时间线',
    '  tweets <id1> [id2...]                  批量读取推文 metrics',
    '',
    'Options:',
    '  --media <path>                          tweet/thread 第一条媒体路径',
    '  --media-id <id>                         tweet 使用已上传 media_id（可重复）',
    '  --alt <text>                            媒体 alt text',
    '  --max-pages <n>                         timeline 页数上限',
    '  --max-results <n>                       timeline 每页数量',
    '  --user-id <id>                          timeline 指定用户 ID',
    '  --include-retweets / --exclude-retweets timeline 转推控制',
    '  --output <file>                         写入 JSON envelope',
    '  --pretty                                缩进 JSON',
    '',
    'Credentials:',
    '  X_API_KEY, X_API_SECRET, X_ACCESS_TOKEN, X_ACCESS_TOKEN_SECRET',
  ];
  process.stdout.write(lines.join('\n') + '\n');
}

function normalizeWriteResult(result, extra = {}) {
  if (result && result.success) return { ok: true, ...result, ...extra };
  return {
    ok: false,
    error: result?.error || 'official api command failed',
    errorCode: result?.errorCode || result?.code || 'official_api_failed',
    status_code: result?.status_code || 0,
    detail: result?.detail || '',
    ...result,
    ...extra,
  };
}

async function runApi(argv) {
  let parsed;
  try {
    parsed = parseApiArgs(argv);
  } catch (err) {
    process.stderr.write(`ERROR: ${err.message}\n`);
    return 2;
  }
  const { opts, positional } = parsed;
  const sub = positional.shift();
  opts.command = sub ? `api ${sub}` : 'api';
  opts.startedAt = Date.now();

  if (!sub || opts.help) {
    printApiHelp();
    return 0;
  }

  const client = createOfficialApiClient();

  try {
    let result;
    if (sub === 'status') {
      const access = await client.checkReadAccess();
      result = {
        ok: client.isConfigured && access.available !== false,
        configured: client.isConfigured,
        access,
      };
      if (!result.ok) {
        result.error = access.reason || 'api_not_configured';
        result.errorCode = access.status_code === 403 ? 'forbidden' : 'api_not_configured';
      }
    } else if (sub === 'reply') {
      const [tweetId, text] = positional;
      if (!tweetId || !text) throw Object.assign(new Error('api reply 需要 <tweet_id> <text>'), { code: 'E_BAD_ARG' });
      result = normalizeWriteResult(await client.createReply(text, tweetId), { via: 'official_api' });
    } else if (sub === 'tweet') {
      const [text] = positional;
      if (!text) throw Object.assign(new Error('api tweet 需要 <text>'), { code: 'E_BAD_ARG' });
      const mediaIds = opts.mediaIds.filter(Boolean);
      if (opts.media) {
        const upload = await client.uploadMedia(opts.media, { altText: opts.alt });
        if (!upload.success) result = normalizeWriteResult(upload, { via: 'official_api' });
        else mediaIds.push(upload.media_id);
      }
      if (!result) result = normalizeWriteResult(await client.createTweet(text, mediaIds.length ? mediaIds : undefined), { via: 'official_api' });
    } else if (sub === 'quote') {
      const [tweetId, text] = positional;
      if (!tweetId || !text) throw Object.assign(new Error('api quote 需要 <tweet_id> <text>'), { code: 'E_BAD_ARG' });
      result = normalizeWriteResult(await client.createQuote(text, tweetId), { via: 'official_api' });
    } else if (sub === 'thread') {
      if (!positional.length) throw Object.assign(new Error('api thread 需要至少一段文本'), { code: 'E_BAD_ARG' });
      const tweets = positional.map((text, idx) => ({
        text,
        media_paths: idx === 0 && opts.media ? [opts.media] : [],
      }));
      result = normalizeWriteResult(await client.createThread(tweets), { via: 'official_api' });
    } else if (sub === 'upload-media') {
      const [filePath] = positional;
      if (!filePath) throw Object.assign(new Error('api upload-media 需要 <path>'), { code: 'E_BAD_ARG' });
      result = normalizeWriteResult(await client.uploadMedia(filePath, { altText: opts.alt }), { via: 'official_api' });
    } else if (sub === 'timeline') {
      const tweets = await client.getUserTweets({
        userId: opts.userId,
        maxResults: opts.maxResults,
        maxPages: opts.maxPages,
        excludeRetweets: opts.excludeRetweets,
      });
      result = { ok: true, tweets, count: tweets.length, via: 'official_api' };
    } else if (sub === 'tweets') {
      if (!positional.length) throw Object.assign(new Error('api tweets 需要至少一个 tweet id'), { code: 'E_BAD_ARG' });
      const data = await client.getTweetsByIds(positional);
      result = { ok: true, ...data, via: 'official_api' };
    } else {
      process.stderr.write(`未知 api 子命令: ${sub}\n\n`);
      printApiHelp();
      return 2;
    }

    printJson(result, opts);
    return result && result.ok === false ? 1 : 0;
  } catch (err) {
    const result = {
      ok: false,
      error: err.message || String(err),
      errorCode: err.code === 'E_BAD_ARG' ? 'bad_arg' : 'api_command_failed',
    };
    printJson(result, opts);
    return err.code === 'E_BAD_ARG' ? 2 : 1;
  }
}

module.exports = {
  runApi,
  parseApiArgs,
  printApiHelp,
};
