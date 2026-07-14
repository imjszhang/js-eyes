'use strict';

const fs = require('fs');
const path = require('path');
const pkg = require('../../package.json');
const { createOfficialApiClient } = require('./index');
const { buildSearchQueryOptions } = require('./buildSearchQuery');
const { normalizeSearchResults } = require('./normalizeSearchTweet');

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
    woeids: [],
    excludeRetweets: true,
    tweetFields: '',
    includePrivateMetrics: false,
    raw: false,
    startTime: null,
    endTime: null,
    nextToken: null,
    sortOrder: null,
    from: null,
    to: null,
    since: null,
    until: null,
    lang: null,
    minLikes: 0,
    minRetweets: 0,
    minReplies: 0,
    excludeReplies: false,
    excludeRetweets: false,
    hasLinks: false,
    scope: 'all',
    bodyFile: null,
    bodyText: null,
    cover: null,
    fetchRemoteImages: false,
    publish: false,
    draftOnly: false,
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
    else if (a === '--woeid') opts.woeids.push(String(argv[++i] || '').trim());
    else if (a.startsWith('--woeid=')) opts.woeids.push(a.slice('--woeid='.length).trim());
    else if (a === '--include-retweets') opts.excludeRetweets = false;
    else if (a === '--exclude-retweets') opts.excludeRetweets = true;
    else if (a === '--tweet-fields') eat('tweetFields');
    else if (a.startsWith('--tweet-fields=')) eatEq('tweetFields', '--tweet-fields=');
    else if (a === '--include-private-metrics') opts.includePrivateMetrics = true;
    else if (a === '--raw') opts.raw = true;
    else if (a === '--start-time') eat('startTime');
    else if (a.startsWith('--start-time=')) eatEq('startTime', '--start-time=');
    else if (a === '--end-time') eat('endTime');
    else if (a.startsWith('--end-time=')) eatEq('endTime', '--end-time=');
    else if (a === '--next-token') eat('nextToken');
    else if (a.startsWith('--next-token=')) eatEq('nextToken', '--next-token=');
    else if (a === '--sort-order') eat('sortOrder');
    else if (a.startsWith('--sort-order=')) eatEq('sortOrder', '--sort-order=');
    else if (a === '--from') eat('from');
    else if (a.startsWith('--from=')) eatEq('from', '--from=');
    else if (a === '--to') eat('to');
    else if (a.startsWith('--to=')) eatEq('to', '--to=');
    else if (a === '--since') eat('since');
    else if (a.startsWith('--since=')) eatEq('since', '--since=');
    else if (a === '--until') eat('until');
    else if (a.startsWith('--until=')) eatEq('until', '--until=');
    else if (a === '--lang') eat('lang');
    else if (a.startsWith('--lang=')) eatEq('lang', '--lang=');
    else if (a === '--min-likes') opts.minLikes = Number(argv[++i]) || 0;
    else if (a.startsWith('--min-likes=')) opts.minLikes = Number(a.slice('--min-likes='.length)) || 0;
    else if (a === '--min-retweets') opts.minRetweets = Number(argv[++i]) || 0;
    else if (a.startsWith('--min-retweets=')) opts.minRetweets = Number(a.slice('--min-retweets='.length)) || 0;
    else if (a === '--min-replies') opts.minReplies = Number(argv[++i]) || 0;
    else if (a.startsWith('--min-replies=')) opts.minReplies = Number(a.slice('--min-replies='.length)) || 0;
    else if (a === '--exclude-replies') opts.excludeReplies = true;
    else if (a === '--exclude-retweets') opts.excludeRetweets = true;
    else if (a === '--has-links') opts.hasLinks = true;
    else if (a === '--scope') eat('scope');
    else if (a.startsWith('--scope=')) eatEq('scope', '--scope=');
    else if (a === '--body-file') eat('bodyFile');
    else if (a.startsWith('--body-file=')) eatEq('bodyFile', '--body-file=');
    else if (a === '--body') eat('bodyText');
    else if (a.startsWith('--body=')) eatEq('bodyText', '--body=');
    else if (a === '--cover') eat('cover');
    else if (a.startsWith('--cover=')) eatEq('cover', '--cover=');
    else if (a === '--fetch-remote-images') opts.fetchRemoteImages = true;
    else if (a === '--publish') opts.publish = true;
    else if (a === '--draft-only') opts.draftOnly = true;
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
    'js-x-ops-skill api - X 官方 API (v2 REST)',
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
    '  mentions [--max-pages N]                读取当前账号 mentions',
    '  tweets <id1> [id2...]                  批量读取推文 metrics',
    '  trends [--woeid id]                     读取指定 WOEID 的趋势话题（可重复）',
    '  search-all <query>                      全库搜索（2006 至今，需 Pay-per-use Bearer）',
    '  search-recent <query>                   近期搜索（7 天窗口）',
    '  article-draft <title>                   创建 Article 草稿（Markdown）',
    '  article-publish <article_id>            发布 Article 草稿',
    '  article <title>                         创建 Article（默认草稿；--publish 发布）',
    '  delete <tweet_id>                       删除当前账号发布的推文',
    '',
    'Options:',
    '  --media <path>                          tweet/thread 第一条媒体路径',
    '  --media-id <id>                         tweet 使用已上传 media_id（可重复）',
    '  --alt <text>                            媒体 alt text',
    '  --max-pages <n>                         timeline 页数上限',
    '  --max-results <n>                       timeline 每页数量',
    '  --user-id <id>                          timeline 指定用户 ID',
    '  --woeid <id>                            trends WOEID（默认 1=Worldwide，可重复）',
    '  --tweet-fields <csv>                    tweets 自定义 tweet.fields',
    '  --include-private-metrics               tweets 请求 organic/non-public metrics（仅自有帖子 + user context）',
    '  --include-retweets / --exclude-retweets timeline 转推控制',
    '  --start-time <iso>                      search 起始时间（ISO8601）',
    '  --end-time <iso>                        search 截止时间（ISO8601）',
    '  --next-token <token>                    search 续页 token',
    '  --sort-order <recency|relevancy>        search-all 排序（默认 relevancy）',
    '  --from <user>                           search 作者过滤（不带 @）',
    '  --to <user>                             search 收件人过滤',
    '  --since <YYYY-MM-DD>                    search 起始日期',
    '  --until <YYYY-MM-DD>                    search 截止日期',
    '  --lang <code>                           search 语言代码',
    '  --min-likes / --min-retweets / --min-replies  search 互动数过滤',
    '  --exclude-replies / --exclude-retweets / --has-links  search 操作符',
    '  --raw                                   search 输出 v2 原始对象（跳过归一化）',
    '  --body-file <path>                      article Markdown 文件',
    '  --body <markdown>                       article 内联 Markdown',
    '  --cover <path>                          article 封面图（本地路径）',
    '  --fetch-remote-images                   article 下载并上传 https 内嵌图',
    '  --publish                               article 创建后立即发布',
    '  --draft-only                            article 仅创建草稿（默认）',
    '  --output <file>                         写入 JSON envelope',
    '  --pretty                                缩进 JSON',
    '',
    'Credentials:',
    '  Reads:  X_BEARER_TOKEN（或 OAuth 1.0a 四元组；全库搜索推荐 Bearer + Pay-per-use）',
    '  Writes: X_API_KEY, X_API_SECRET, X_ACCESS_TOKEN, X_ACCESS_TOKEN_SECRET',
    '',
    'Search notes:',
    '  search-all / search-recent 走 Official API，可能产生 API 费用。',
    '  与 node index.js search（浏览器 GraphQL）不同，不支持 top/latest/media 排序。',
    '',
    'Article notes:',
    '  article-* 需要 OAuth 1.0a 写凭证；发布通常需 X Premium。',
    '  远程 https 图片默认跳过；加 --fetch-remote-images 才会下载上传。',
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

function readArticleBody(opts) {
  if (opts.bodyFile) {
    const abs = path.resolve(opts.bodyFile);
    return fs.readFileSync(abs, 'utf8');
  }
  if (opts.bodyText) return String(opts.bodyText);
  return null;
}

async function runArticleCreateCommand(client, opts, positional, { allowPublish = true } = {}) {
  const title = positional.join(' ').trim();
  if (!title) {
    throw Object.assign(new Error('api article 需要 <title>'), { code: 'E_BAD_ARG' });
  }
  const markdown = readArticleBody(opts);
  if (!markdown || !markdown.trim()) {
    throw Object.assign(new Error('article 需要 --body-file 或 --body'), { code: 'E_BAD_ARG' });
  }

  const baseDir = opts.bodyFile ? path.dirname(path.resolve(opts.bodyFile)) : process.cwd();
  const draftResult = await client.createArticleFromMarkdown({
    title,
    markdown,
    coverPath: opts.cover,
    fetchRemoteImages: opts.fetchRemoteImages,
    baseDir,
  });
  const normalized = normalizeWriteResult(draftResult, { via: 'official_api', published: false });
  if (!normalized.ok) return normalized;

  const shouldPublish = allowPublish && opts.publish && !opts.draftOnly;
  if (!shouldPublish) return normalized;

  const publishResult = await client.publishArticle(normalized.article_id);
  const pubNormalized = normalizeWriteResult(publishResult, { via: 'official_api' });
  if (!pubNormalized.ok) {
    return {
      ...normalized,
      publish_error: pubNormalized.error,
      publish_errorCode: pubNormalized.errorCode,
      published: false,
    };
  }

  return {
    ok: true,
    success: true,
    article_id: normalized.article_id,
    title: normalized.title,
    published: true,
    post_id: pubNormalized.post_id,
    article_url: pubNormalized.article_url,
    post_url: pubNormalized.post_url,
    via: 'official_api',
  };
}

async function runSearchCommand(client, opts, positional, scope) {
  const keyword = positional.join(' ').trim();
  if (!keyword) {
    throw Object.assign(new Error(`api search-${scope === 'recent' ? 'recent' : 'all'} 需要 <query>`), { code: 'E_BAD_ARG' });
  }

  const built = buildSearchQueryOptions({
    keyword,
    from: opts.from,
    to: opts.to,
    since: opts.since,
    until: opts.until,
    lang: opts.lang,
    minLikes: opts.minLikes,
    minRetweets: opts.minRetweets,
    minReplies: opts.minReplies,
    excludeReplies: opts.excludeReplies,
    excludeRetweets: opts.excludeRetweets,
    hasLinks: opts.hasLinks,
    startTime: opts.startTime,
    endTime: opts.endTime,
    nextToken: opts.nextToken,
    sortOrder: opts.sortOrder,
    maxResults: opts.maxResults,
    maxPages: opts.maxPages,
    scope,
  });

  const searchOpts = {
    startTime: built.startTime,
    endTime: built.endTime,
    maxResults: built.maxResults,
    maxPages: built.maxPages,
    nextToken: built.nextToken,
    sortOrder: built.sortOrder,
  };

  const raw = scope === 'recent'
    ? await client.searchRecent(built.fullQuery, searchOpts)
    : await client.searchAll(built.fullQuery, searchOpts);

  if (!raw.ok) {
    const message = raw.errorCode === 'forbidden'
      ? `${raw.error || 'forbidden'}（全库搜索通常需要 Pay-per-use Bearer 权限）`
      : (raw.error || 'search failed');
    return {
      ok: false,
      query: keyword,
      fullQuery: built.fullQuery,
      tweets: [],
      count: 0,
      error: message,
      errorCode: raw.errorCode || 'search_failed',
      status_code: raw.status_code || 0,
      detail: raw.detail || '',
      via: 'official_api',
      endpoint: raw.endpoint,
    };
  }

  if (opts.raw) {
    return {
      ok: true,
      query: keyword,
      fullQuery: built.fullQuery,
      tweets: raw.tweets,
      count: raw.count,
      meta: raw.meta,
      via: 'official_api',
      endpoint: raw.endpoint,
    };
  }

  const normalized = normalizeSearchResults(raw);
  return {
    ok: true,
    query: keyword,
    fullQuery: built.fullQuery,
    tweets: normalized.tweets,
    count: normalized.total,
    meta: raw.meta,
    via: 'official_api',
    endpoint: raw.endpoint,
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
        ok: access.available !== false,
        configured: client.isConfigured,
        read_configured: client.isReadConfigured,
        write_configured: client.isWriteConfigured,
        auth: {
          bearer: !!client.bearerToken,
          oauth1: client.isWriteConfigured,
        },
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
    } else if (sub === 'mentions') {
      const tweets = await client.getMentions({
        userId: opts.userId,
        maxResults: opts.maxResults,
        maxPages: opts.maxPages,
      });
      result = { ok: true, tweets, count: tweets.length, via: 'official_api' };
    } else if (sub === 'tweets') {
      if (!positional.length) throw Object.assign(new Error('api tweets 需要至少一个 tweet id'), { code: 'E_BAD_ARG' });
      const data = await client.getTweetsByIds(positional, {
        tweetFields: opts.tweetFields || undefined,
        includePrivateMetrics: opts.includePrivateMetrics,
      });
      result = { ok: true, ...data, via: 'official_api' };
    } else if (sub === 'trends') {
      const woeids = [...opts.woeids, ...positional].map((id) => String(id || '').trim()).filter(Boolean);
      if (!woeids.length) woeids.push('1');
      const perLocation = [];
      const trendMap = new Map();
      for (const woeid of woeids) {
        const data = await client.getTrends(woeid);
        if (!data.ok) {
          result = { ok: false, ...data, woeid, via: 'official_api' };
          break;
        }
        perLocation.push(data);
        for (const trend of (data.trends || [])) {
          const name = String(trend.trend_name || trend.name || '').trim();
          if (!name) continue;
          const key = name.toLowerCase();
          const tweetCount = Number(trend.tweet_count ?? trend.tweet_volume ?? 0) || 0;
          const existing = trendMap.get(key);
          if (!existing) {
            trendMap.set(key, {
              trend_name: name,
              tweet_count: tweetCount,
              woeids: [String(woeid)],
              sources: [{ woeid: String(woeid), tweet_count: tweetCount }],
            });
          } else {
            existing.tweet_count = Math.max(existing.tweet_count || 0, tweetCount);
            if (!existing.woeids.includes(String(woeid))) existing.woeids.push(String(woeid));
            existing.sources.push({ woeid: String(woeid), tweet_count: tweetCount });
          }
        }
      }
      if (!result) {
        const trends = Array.from(trendMap.values()).sort((a, b) => (b.tweet_count || 0) - (a.tweet_count || 0));
        result = { ok: true, trends, count: trends.length, woeids, per_location: perLocation, via: 'official_api' };
      }
    } else if (sub === 'search-all') {
      result = await runSearchCommand(client, opts, positional, 'all');
    } else if (sub === 'search-recent') {
      result = await runSearchCommand(client, opts, positional, 'recent');
    } else if (sub === 'article-draft') {
      result = await runArticleCreateCommand(client, opts, positional, { allowPublish: true });
    } else if (sub === 'article') {
      result = await runArticleCreateCommand(client, opts, positional, { allowPublish: true });
    } else if (sub === 'article-publish') {
      const [articleId] = positional;
      if (!articleId) throw Object.assign(new Error('api article-publish 需要 <article_id>'), { code: 'E_BAD_ARG' });
      result = normalizeWriteResult(await client.publishArticle(articleId), {
        via: 'official_api',
        published: true,
      });
    } else if (sub === 'delete') {
      const [tweetId] = positional;
      if (!tweetId) throw Object.assign(new Error('api delete 需要 <tweet_id>'), { code: 'E_BAD_ARG' });
      result = normalizeWriteResult(await client.deleteTweet(tweetId), { via: 'official_api' });
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
  runSearchCommand,
  runArticleCreateCommand,
  readArticleBody,
};
