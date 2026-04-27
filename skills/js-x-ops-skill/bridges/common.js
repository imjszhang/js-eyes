// bridges/common.js
// ---------------------------------------------------------------------------
// 本文件是纯浏览器代码，不要被 Node require。
// 每个 bridge 文件的顶部包含一行：
//   // @@include ./common.js
// session.js 在注入 bridge 前会把这一行替换为本文件全部内容，
// 从而实现 helpers 单一来源（不依赖运行时 module resolution）。
//
// 设计取舍：
// - READ 数据优先走 X.com 内部 GraphQL 端点（同源，复用 cookie + bearer）。
// - GraphQL queryId / features / variables 通过 performance API + JS bundle 动态发现并缓存。
// - DOM fallback 仅在 GraphQL 失败时启用。
// - navigateLocation 严格限制 *.x.com / *.twitter.com 同源，绝不跨站跳转。
// ---------------------------------------------------------------------------

const __jseXCache = {
  graphqlByOp: Object.create(null),  // { [opName]: { queryId, features, variables, savedAt } }
  loginCache: null,
  loginCacheHref: null,
};

const __JSE_X_GRAPHQL_TTL_MS = 12 * 60 * 60 * 1000;

const BEARER_TOKEN = 'Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA';

const DEFAULT_GRAPHQL_FEATURES = {
  rweb_video_screen_enabled: false,
  payments_enabled: false,
  rweb_xchat_enabled: false,
  profile_label_improvements_pcf_label_in_post_enabled: true,
  rweb_tipjar_consumption_enabled: true,
  verified_phone_label_enabled: false,
  creator_subscriptions_tweet_preview_api_enabled: true,
  responsive_web_graphql_timeline_navigation_enabled: true,
  responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
  premium_content_api_read_enabled: false,
  communities_web_enable_tweet_community_results_fetch: true,
  c9s_tweet_anatomy_moderator_badge_enabled: true,
  responsive_web_grok_analyze_button_fetch_trends_enabled: false,
  responsive_web_grok_analyze_post_followups_enabled: false,
  responsive_web_jetfuel_frame: true,
  responsive_web_grok_share_attachment_enabled: true,
  articles_preview_enabled: true,
  responsive_web_edit_tweet_api_enabled: true,
  graphql_is_translatable_rweb_tweet_is_translatable_enabled: true,
  view_counts_everywhere_api_enabled: true,
  longform_notetweets_consumption_enabled: true,
  responsive_web_twitter_article_tweet_consumption_enabled: true,
  tweet_awards_web_tipping_enabled: false,
  responsive_web_grok_show_grok_translated_post: false,
  responsive_web_grok_analysis_button_from_backend: true,
  creator_subscriptions_quote_tweet_preview_enabled: false,
  freedom_of_speech_not_reach_fetch_enabled: true,
  standardized_nudges_misinfo: true,
  tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled: true,
  longform_notetweets_rich_text_read_enabled: true,
  longform_notetweets_inline_media_enabled: true,
  responsive_web_grok_image_annotation_enabled: true,
  responsive_web_grok_imagine_annotation_enabled: true,
  responsive_web_grok_community_note_auto_translation_is_enabled: false,
  responsive_web_enhance_cards_enabled: false,
};

const DEFAULT_USER_FEATURES = {
  hidden_profile_subscriptions_enabled: true,
  rweb_tipjar_consumption_enabled: true,
  responsive_web_graphql_exclude_directive_enabled: true,
  verified_phone_label_enabled: false,
  subscriptions_verification_info_is_identity_verified_enabled: true,
  subscriptions_verification_info_verified_since_enabled: true,
  highlights_tweets_tab_ui_enabled: true,
  responsive_web_twitter_article_notes_tab_enabled: true,
  subscriptions_feature_can_gift_premium: true,
  creator_subscriptions_tweet_preview_api_enabled: true,
  responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
  responsive_web_graphql_timeline_navigation_enabled: true,
  responsive_web_profile_redirect_enabled: false,
  profile_label_improvements_pcf_label_in_post_enabled: true,
};

// ---------------------------------------------------------------------------
// 通用小工具
// ---------------------------------------------------------------------------

function clampLimit(value, defaultValue, maxValue){
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return defaultValue;
  return Math.min(Math.floor(n), maxValue);
}

function shortText(value, maxLen){
  const text = String(value == null ? '' : value);
  const limit = clampLimit(maxLen, 2000, 20000);
  if (text.length <= limit) return { text, truncated: false, length: text.length };
  return { text: text.slice(0, limit), truncated: true, length: text.length };
}

function okResult(data){ return { ok: true, data }; }
function errResult(error, extra){ return Object.assign({ ok: false, error: String(error) }, extra || {}); }

function getCt0Cookie(){
  try {
    const m = document.cookie.match(/(?:^|;\s*)ct0=([^;]+)/);
    return m ? m[1] : null;
  } catch (_) { return null; }
}

function getAuthToken(){
  return BEARER_TOKEN;
}

async function delay(ms){ return new Promise((r) => setTimeout(r, ms)); }

function isOnX(){
  try {
    return /(?:^|\.)(?:x\.com|twitter\.com)$/i.test(location.hostname);
  } catch (_) { return false; }
}

// ---------------------------------------------------------------------------
// 等待页面就绪（取代散落各处的固定 setTimeout）
// ---------------------------------------------------------------------------

async function waitForReactReady(opts){
  const { timeoutMs = 20000, intervalMs = 250 } = opts || {};
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if (document.readyState === 'complete') {
        if (document.querySelector('[data-testid="primaryColumn"]')
            || document.querySelector('main[role="main"]')
            || document.querySelector('[data-testid="loginButton"]')) {
          return true;
        }
      }
    } catch (_) {}
    await delay(intervalMs);
  }
  return false;
}

// ---------------------------------------------------------------------------
// GraphQL 参数动态发现 + 缓存（替代 lib/xUtils.js 文件 cache）
// ---------------------------------------------------------------------------

function _parseGraphQLUrl(urlStr){
  const out = {};
  try {
    const url = new URL(urlStr);
    const fp = url.searchParams.get('features');
    if (fp) out.features = JSON.parse(fp);
    const vp = url.searchParams.get('variables');
    if (vp) out.variables = JSON.parse(vp);
    const ftp = url.searchParams.get('fieldToggles');
    if (ftp) out.fieldToggles = JSON.parse(ftp);
  } catch (_) {}
  return out;
}

function _scanPerformanceForOp(opName){
  const re = new RegExp('graphql/([A-Za-z0-9_-]+)/' + opName + '\\b');
  try {
    const resources = performance.getEntriesByType('resource');
    for (let i = resources.length - 1; i >= 0; i--) {
      const r = resources[i];
      if (typeof r.name !== 'string') continue;
      const m = r.name.match(re);
      if (m) {
        const parsed = _parseGraphQLUrl(r.name);
        return Object.assign({ queryId: m[1] }, parsed);
      }
    }
  } catch (_) {}
  return null;
}

async function _scanBundlesForOp(opName, maxBundles){
  const max = Math.max(1, Math.min(maxBundles || 6, 10));
  try {
    const scripts = document.querySelectorAll('script[src]');
    const bundleUrls = [];
    for (const script of scripts) {
      const src = script.getAttribute('src') || '';
      if (src.includes('/client-web/') || src.includes('main.') || src.includes('/responsive-web/')) {
        bundleUrls.push(src.startsWith('http') ? src : ('https://' + location.hostname + src));
      }
    }
    const safeOp = opName.replace(/[^A-Za-z0-9_]/g, '');
    const re = new RegExp('queryId:"([A-Za-z0-9_-]+)",operationName:"' + safeOp + '"');
    for (const bundleUrl of bundleUrls.slice(0, max)) {
      try {
        const resp = await fetch(bundleUrl, { credentials: 'include' });
        if (!resp.ok) continue;
        const text = await resp.text();
        const m = text.match(re);
        if (m) return { queryId: m[1] };
      } catch (_) {}
    }
  } catch (_) {}
  return null;
}

function getCachedGraphQLParams(opName){
  const cache = __jseXCache.graphqlByOp[opName];
  if (!cache) return null;
  if (cache.savedAt && (Date.now() - cache.savedAt > __JSE_X_GRAPHQL_TTL_MS)) return null;
  return cache;
}

function setCachedGraphQLParams(opName, params){
  if (!opName || !params || !params.queryId) return;
  __jseXCache.graphqlByOp[opName] = Object.assign({}, params, { savedAt: Date.now() });
}

function invalidateGraphQLCache(opName){
  if (opName) {
    delete __jseXCache.graphqlByOp[opName];
  } else {
    __jseXCache.graphqlByOp = Object.create(null);
  }
}

/**
 * 动态发现 X GraphQL 参数（queryId / features / variables）
 * 顺序：模块缓存 -> performance API -> JS bundle
 * @param {string|string[]} opNames 操作名，可传单个或多个
 * @returns {Promise<Object>} { ok, data: { [opName]: { queryId, features?, variables?, source } } }
 */
async function discoverGraphQLParams(opNames){
  const list = Array.isArray(opNames) ? opNames : [opNames];
  const out = Object.create(null);
  for (const opName of list) {
    if (typeof opName !== 'string' || !opName) continue;
    const cached = getCachedGraphQLParams(opName);
    if (cached) { out[opName] = Object.assign({}, cached, { source: 'cache' }); continue; }
    let found = _scanPerformanceForOp(opName);
    let source = 'performance';
    if (!found || !found.queryId) {
      found = await _scanBundlesForOp(opName);
      source = 'bundle';
    }
    if (found && found.queryId) {
      setCachedGraphQLParams(opName, found);
      out[opName] = Object.assign({}, found, { source });
    } else {
      out[opName] = { queryId: null, source: 'not_found' };
    }
  }
  return okResult(out);
}

// ---------------------------------------------------------------------------
// fetchXGraphQL：自动 bearer + ct0 + 429 backoff
// ---------------------------------------------------------------------------

/**
 * 调用 X.com GraphQL 端点。
 * - 自动注入 bearer token / ct0 csrf
 * - 429 自动等待 retry-after 并重试，连续 3 次后返回 paused（外层处理 5 分钟暂停）
 *
 * @param {Object} opts
 * @param {string} opts.opName 操作名（如 SearchTimeline / UserTweets / TweetDetail）
 * @param {string} opts.queryId  queryId（必传，由调用方先 discoverGraphQLParams 拿到）
 * @param {Object} opts.variables variables 对象
 * @param {Object} [opts.features] features 对象，缺省用 DEFAULT_GRAPHQL_FEATURES
 * @param {Object} [opts.fieldToggles] fieldToggles 对象（部分 op 需要）
 * @param {string} [opts.method='GET'] HTTP 方法
 * @param {Object} [opts.body] POST body（仅 method='POST' 时使用）
 * @param {number} [opts.timeoutMs=15000]
 * @returns {{ok:boolean, statusCode?:number, retryAfter?:number|null, data?:any, error?:string}}
 */
async function fetchXGraphQL(opts){
  const {
    opName,
    queryId,
    variables,
    features,
    fieldToggles,
    method,
    body,
    timeoutMs = 15000,
  } = opts || {};
  if (!opName) return errResult('missing_opName');
  if (!queryId) return errResult('missing_queryId', { opName });
  const ct0 = getCt0Cookie();
  if (!ct0) return errResult('missing_ct0_cookie', { hint: '请先登录 X.com（ct0 cookie 不存在）' });

  const httpMethod = (method || 'GET').toUpperCase();
  const featuresPayload = features || DEFAULT_GRAPHQL_FEATURES;
  const baseUrl = 'https://' + location.hostname + '/i/api/graphql/' + queryId + '/' + opName;
  let url = baseUrl;
  let reqBody = null;
  if (httpMethod === 'GET') {
    const params = new URLSearchParams();
    if (variables != null) params.set('variables', JSON.stringify(variables));
    params.set('features', JSON.stringify(featuresPayload));
    if (fieldToggles) params.set('fieldToggles', JSON.stringify(fieldToggles));
    url = baseUrl + '?' + params.toString();
  } else {
    const payload = Object.assign({ queryId }, body || {});
    if (variables != null && payload.variables == null) payload.variables = variables;
    if (payload.features == null) payload.features = featuresPayload;
    if (fieldToggles && payload.fieldToggles == null) payload.fieldToggles = fieldToggles;
    reqBody = JSON.stringify(payload);
  }

  const headers = {
    'authorization': BEARER_TOKEN,
    'x-csrf-token': ct0,
    'x-twitter-auth-type': 'OAuth2Session',
    'x-twitter-active-user': 'yes',
    'content-type': 'application/json',
  };

  const controller = new AbortController();
  const timer = setTimeout(() => { try { controller.abort(); } catch (_) {} }, Math.max(2000, timeoutMs));
  let response = null;
  try {
    response = await fetch(url, {
      method: httpMethod,
      credentials: 'include',
      signal: controller.signal,
      headers,
      body: httpMethod === 'GET' ? undefined : reqBody,
    });
  } catch (e) {
    clearTimeout(timer);
    const err = (e && e.name === 'AbortError') ? 'timeout' : ((e && e.message) || String(e));
    return errResult('network_error', { message: err, opName, queryId });
  }
  clearTimeout(timer);

  const statusCode = response.status;
  if (!response.ok) {
    const retryAfterRaw = response.headers && response.headers.get && response.headers.get('retry-after');
    const retryAfter = retryAfterRaw ? parseInt(retryAfterRaw, 10) : null;
    let snippet = '';
    try { snippet = (await response.text()).slice(0, 500); } catch (_) {}
    return Object.assign(errResult('http_error', {
      statusCode,
      retryAfter,
      opName,
      queryId,
      bodySnippet: snippet,
    }));
  }

  let data = null;
  try {
    data = await response.json();
  } catch (e) {
    return errResult('non_json_response', { statusCode, opName, queryId });
  }
  return { ok: true, statusCode, data };
}

// ---------------------------------------------------------------------------
// Tweet DOM 解析（搬自 lib/xUtils.js::buildTweetParserSnippet）
// ---------------------------------------------------------------------------

function parseStatNumber(text){
  if (!text) return 0;
  const match = String(text).match(/([\d,.]+[KMB]?)\s/i);
  if (!match) return 0;
  let numStr = match[1].replace(/,/g, '');
  const multiplier = numStr.match(/[KMB]$/i);
  if (multiplier) {
    numStr = numStr.replace(/[KMB]$/i, '');
    const num = parseFloat(numStr);
    switch (multiplier[0].toUpperCase()) {
      case 'K': return Math.round(num * 1000);
      case 'M': return Math.round(num * 1000000);
      case 'B': return Math.round(num * 1000000000);
    }
  }
  return parseInt(numStr, 10) || 0;
}

function parseTweetArticle(article){
  let tweetId = '';
  let tweetUrl = '';
  let authorUsername = '';

  const statusLinks = article.querySelectorAll('a[href*="/status/"]');
  for (const link of statusLinks) {
    const href = link.getAttribute('href') || '';
    const match = href.match(/^\/([\w]+)\/status\/(\d+)/);
    if (match) {
      authorUsername = match[1];
      tweetId = match[2];
      tweetUrl = 'https://x.com' + href;
      break;
    }
  }
  if (!tweetId) return null;

  const isPromoted = article.querySelector('[data-testid="placementTracking"]') !== null
    || (article.innerText || '').includes('Promoted')
    || (article.innerText || '').includes('推广');
  if (isPromoted) return null;

  let authorName = '';
  let authorAvatar = '';
  const userNameElem = article.querySelector('[data-testid="User-Name"]');
  if (userNameElem) {
    const spans = userNameElem.querySelectorAll('span');
    for (const span of spans) {
      const text = (span.textContent || '').trim();
      if (text.startsWith('@')) { authorUsername = text; break; }
    }
    for (const span of spans) {
      const text = (span.textContent || '').trim();
      if (text && !text.startsWith('@') && text.length > 0 && text.length < 60) {
        if (!/^[\d.,]+[万亿KMB]?$/.test(text) && !/^\d+[hm]$/.test(text)) {
          authorName = text; break;
        }
      }
    }
  }
  if (authorUsername && !authorUsername.startsWith('@')) authorUsername = '@' + authorUsername;

  const avatarImg = article.querySelector('img[src*="pbs.twimg.com/profile_images"]');
  if (avatarImg) authorAvatar = avatarImg.getAttribute('src') || '';

  let content = '';
  const tweetTextElem = article.querySelector('[data-testid="tweetText"]');
  if (tweetTextElem) content = (tweetTextElem.textContent || '').trim();

  let publishTime = '';
  const timeElem = article.querySelector('time');
  if (timeElem) publishTime = timeElem.getAttribute('datetime') || '';

  const stats = { replies: 0, retweets: 0, likes: 0, views: 0, bookmarks: 0 };
  const replyBtn = article.querySelector('[data-testid="reply"]');
  const retweetBtn = article.querySelector('[data-testid="retweet"]');
  const likeBtn = article.querySelector('[data-testid="like"]') || article.querySelector('[data-testid="unlike"]');
  const bookmarkBtn = article.querySelector('[data-testid="bookmark"]') || article.querySelector('[data-testid="removeBookmark"]');
  if (replyBtn) stats.replies = parseStatNumber(replyBtn.getAttribute('aria-label'));
  if (retweetBtn) stats.retweets = parseStatNumber(retweetBtn.getAttribute('aria-label'));
  if (likeBtn) stats.likes = parseStatNumber(likeBtn.getAttribute('aria-label'));
  if (bookmarkBtn) stats.bookmarks = parseStatNumber(bookmarkBtn.getAttribute('aria-label'));
  const analyticsLink = article.querySelector('a[href*="/analytics"]');
  if (analyticsLink) stats.views = parseStatNumber(analyticsLink.getAttribute('aria-label'));

  const mediaUrls = [];
  article.querySelectorAll('img[src*="pbs.twimg.com/media"]').forEach((img) => {
    const src = img.getAttribute('src');
    if (src) mediaUrls.push(src);
  });
  article.querySelectorAll('video[poster]').forEach((video) => {
    const poster = video.getAttribute('poster');
    if (poster) mediaUrls.push(poster);
  });

  return {
    tweetId,
    author: { name: authorName, username: authorUsername, avatarUrl: authorAvatar },
    content,
    publishTime,
    stats,
    mediaUrls: Array.from(new Set(mediaUrls)),
    tweetUrl,
  };
}

function collectTweetsFromDom(rootDoc){
  const root = rootDoc || document;
  const tweets = [];
  const seen = new Set();
  const articles = root.querySelectorAll('article[data-testid="tweet"]');
  articles.forEach((article) => {
    try {
      const parsed = parseTweetArticle(article);
      if (parsed && !seen.has(parsed.tweetId)) {
        seen.add(parsed.tweetId);
        tweets.push(parsed);
      }
    } catch (_) {}
  });
  return tweets;
}

// ---------------------------------------------------------------------------
// Tweet GraphQL 解析（搬自 lib/xUtils.js::buildGraphQLTweetParserSnippet）
// ---------------------------------------------------------------------------

function _pickMediaUrlsFromLegacy(legacy){
  const mediaUrls = [];
  const mediaEntities = (legacy && legacy.extended_entities && legacy.extended_entities.media)
    || (legacy && legacy.entities && legacy.entities.media)
    || [];
  for (const media of mediaEntities) {
    if (media.type === 'photo' && media.media_url_https) {
      mediaUrls.push(media.media_url_https);
    } else if ((media.type === 'video' || media.type === 'animated_gif') && media.video_info && media.video_info.variants) {
      const mp4s = media.video_info.variants
        .filter((v) => v.content_type === 'video/mp4')
        .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));
      if (mp4s.length > 0) mediaUrls.push(mp4s[0].url);
    }
  }
  return Array.from(new Set(mediaUrls));
}

function parseSingleTweetResult(tweetResult){
  if (!tweetResult || typeof tweetResult !== 'object') return null;
  const actualTweet = tweetResult.tweet || tweetResult;
  const legacy = actualTweet.legacy;
  if (!legacy) return null;
  if (actualTweet.promotedMetadata) return null;

  const userResult = actualTweet.core && actualTweet.core.user_results && actualTweet.core.user_results.result;
  const userLegacy = userResult && userResult.legacy;
  const userCore = userResult && userResult.core;
  const userAvatar = userResult && userResult.avatar;

  const screenName = (userCore && userCore.screen_name) || (userLegacy && userLegacy.screen_name) || '';
  const tweetId = legacy.id_str || actualTweet.rest_id || '';

  const mediaUrls = [];
  const mediaDetails = [];
  const mediaEntities = (legacy.extended_entities && legacy.extended_entities.media)
    || (legacy.entities && legacy.entities.media)
    || [];
  for (const media of mediaEntities) {
    if (media.type === 'photo' && media.media_url_https) {
      mediaUrls.push(media.media_url_https);
      mediaDetails.push({
        type: 'photo',
        url: media.media_url_https,
        expandedUrl: media.expanded_url || '',
        width: (media.original_info && media.original_info.width) || 0,
        height: (media.original_info && media.original_info.height) || 0,
      });
    } else if (media.type === 'video' || media.type === 'animated_gif') {
      const variants = ((media.video_info && media.video_info.variants) || [])
        .filter((v) => v.content_type === 'video/mp4')
        .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));
      const bestMp4 = variants[0];
      if (bestMp4) mediaUrls.push(bestMp4.url);
      const m3u8 = ((media.video_info && media.video_info.variants) || [])
        .find((v) => v.content_type === 'application/x-mpegURL');
      mediaDetails.push({
        type: media.type,
        posterUrl: media.media_url_https || '',
        duration: (media.video_info && media.video_info.duration_millis) || 0,
        variants: ((media.video_info && media.video_info.variants) || []).map((v) => ({
          url: v.url, contentType: v.content_type, bitrate: v.bitrate || 0,
        })),
        bestMp4Url: (bestMp4 && bestMp4.url) || '',
        m3u8Url: (m3u8 && m3u8.url) || '',
        width: (media.original_info && media.original_info.width) || 0,
        height: (media.original_info && media.original_info.height) || 0,
      });
    }
  }

  let quoteTweet = null;
  const quotedResult = (legacy.quoted_status_result && legacy.quoted_status_result.result)
    || (actualTweet.quoted_status_result && actualTweet.quoted_status_result.result);
  if (quotedResult) {
    try { quoteTweet = parseSingleTweetResult(quotedResult); } catch (_) { quoteTweet = null; }
  }

  let card = null;
  const cardData = actualTweet.card && actualTweet.card.legacy;
  if (cardData) {
    const bindingValues = {};
    (cardData.binding_values || []).forEach((bv) => {
      const val = (bv.value && bv.value.string_value) || (bv.value && bv.value.image_value && bv.value.image_value.url) || '';
      if (val) bindingValues[bv.key] = val;
    });
    card = {
      name: cardData.name || '',
      title: bindingValues.title || '',
      description: bindingValues.description || '',
      url: bindingValues.card_url || bindingValues.url || '',
      thumbnailUrl: bindingValues.thumbnail_image_original || bindingValues.thumbnail_image || '',
      domain: bindingValues.domain || bindingValues.vanity_url || '',
    };
  }

  const noteText = (actualTweet.note_tweet && actualTweet.note_tweet.note_tweet_results
    && actualTweet.note_tweet.note_tweet_results.result && actualTweet.note_tweet.note_tweet_results.result.text) || '';

  return {
    tweetId,
    author: {
      name: (userCore && userCore.name) || (userLegacy && userLegacy.name) || '',
      username: '@' + screenName,
      avatarUrl: (userAvatar && userAvatar.image_url) || (userLegacy && userLegacy.profile_image_url_https) || '',
      isVerified: !!(userResult && userResult.is_blue_verified),
    },
    content: noteText || legacy.full_text || '',
    publishTime: legacy.created_at || '',
    lang: legacy.lang || '',
    stats: {
      replies: legacy.reply_count || 0,
      retweets: legacy.retweet_count || 0,
      likes: legacy.favorite_count || 0,
      views: parseInt((actualTweet.views && actualTweet.views.count) || '', 10) || 0,
      bookmarks: legacy.bookmark_count || 0,
      quotes: legacy.quote_count || 0,
    },
    mediaUrls: Array.from(new Set(mediaUrls)),
    mediaDetails,
    tweetUrl: (screenName && tweetId) ? ('https://x.com/' + screenName + '/status/' + tweetId) : '',
    isRetweet: !!legacy.retweeted_status_result,
    isReply: !!legacy.in_reply_to_status_id_str,
    inReplyToTweetId: legacy.in_reply_to_status_id_str || null,
    inReplyToUser: legacy.in_reply_to_screen_name || null,
    conversationId: legacy.conversation_id_str || '',
    quoteTweet,
    card,
    source: actualTweet.source || '',
  };
}

function extractTweetFromGraphQLNode(node){ return parseSingleTweetResult(node); }

function parseTweetEntries(entries){
  const tweets = [];
  let nextCursor = null;
  if (!Array.isArray(entries)) return { tweets, nextCursor };
  for (const entry of entries) {
    const entryId = (entry && entry.entryId) || '';
    if (entryId.startsWith('cursor-bottom')) {
      nextCursor = (entry.content && entry.content.value) || null;
      continue;
    }
    if (!entryId.startsWith('tweet-') && !entryId.startsWith('profile-conversation')) continue;

    if (entryId.startsWith('profile-conversation')) {
      const items = (entry.content && entry.content.items) || [];
      for (const item of items) {
        const tweetResult = item.item && item.item.itemContent && item.item.itemContent.tweet_results && item.item.itemContent.tweet_results.result;
        if (tweetResult) {
          const parsed = parseSingleTweetResult(tweetResult);
          if (parsed) tweets.push(parsed);
        }
      }
      continue;
    }
    const tweetResult = entry.content && entry.content.itemContent && entry.content.itemContent.tweet_results && entry.content.itemContent.tweet_results.result;
    if (!tweetResult) continue;
    const parsed = parseSingleTweetResult(tweetResult);
    if (parsed) tweets.push(parsed);
  }
  return { tweets, nextCursor };
}

function pickMediaFromTweet(tweet){
  if (!tweet) return [];
  if (Array.isArray(tweet.mediaUrls)) return tweet.mediaUrls;
  if (tweet.legacy) return _pickMediaUrlsFromLegacy(tweet.legacy);
  return [];
}

// ---------------------------------------------------------------------------
// 登录态 / sessionState 公共逻辑
// ---------------------------------------------------------------------------

function readLoginStateDom(){
  try {
    const profileLink = document.querySelector('[data-testid="AppTabBar_Profile_Link"]');
    if (profileLink) {
      const href = profileLink.getAttribute('href') || '';
      const m = /^\/([\w_]+)/.exec(href);
      return { loggedIn: true, name: m ? m[1] : null, source: 'profile-link' };
    }
    const sideAvatar = document.querySelector('div[data-testid="SideNav_AccountSwitcher_Button"] [data-testid^="UserAvatar-Container-"]');
    if (sideAvatar) {
      const tid = sideAvatar.getAttribute('data-testid') || '';
      const m = /^UserAvatar-Container-(.+)$/.exec(tid);
      return { loggedIn: true, name: m ? m[1] : null, source: 'side-avatar' };
    }
    if (document.querySelector('[data-testid="loginButton"]')
        || document.querySelector('a[href="/login"]')
        || document.querySelector('a[data-testid="loginButton"]')) {
      return { loggedIn: false, name: null, source: 'login-button' };
    }
  } catch (_) {}
  return { loggedIn: false, name: null, source: 'unknown' };
}

async function readMeViaApi(){
  const ct0 = getCt0Cookie();
  if (!ct0) return { loggedIn: false, name: null, source: 'no-ct0' };
  let url;
  try {
    url = 'https://' + location.hostname + '/i/api/1.1/account/settings.json';
  } catch (_) { url = 'https://x.com/i/api/1.1/account/settings.json'; }
  try {
    const resp = await fetch(url, {
      credentials: 'include',
      headers: {
        'authorization': BEARER_TOKEN,
        'x-csrf-token': ct0,
        'x-twitter-auth-type': 'OAuth2Session',
        'x-twitter-active-user': 'yes',
      },
    });
    if (!resp.ok) return { loggedIn: false, name: null, source: 'api-' + resp.status };
    const data = await resp.json();
    const name = (data && data.screen_name) || null;
    return { loggedIn: !!name, name, source: 'api' };
  } catch (e) {
    return { loggedIn: false, name: null, source: 'api-error' };
  }
}

async function sessionStateCommon(){
  const dom = readLoginStateDom();
  let api = { loggedIn: false, name: null, source: 'skip' };
  try { api = await readMeViaApi(); } catch (_) {}
  const loggedIn = !!(api.loggedIn || dom.loggedIn);
  const name = api.name || dom.name || null;
  const source = api.loggedIn ? 'api' : (dom.loggedIn ? 'dom' : 'none');
  return okResult({
    loggedIn,
    name,
    source,
    api,
    dom,
    url: location.href,
    hostname: location.hostname,
    timestamp: new Date().toISOString(),
  });
}

// ---------------------------------------------------------------------------
// 通用导航（同源限制）
// ---------------------------------------------------------------------------

/**
 * navigateLocation - INTERACTIVE 档位通用导航：仅 location.assign，绝不模拟点击。
 * @param {string} targetUrl  必须是 *.x.com / *.twitter.com 同源；其它会被拒。
 */
function navigateLocation(targetUrl){
  const fromUrl = location.href;
  if (typeof targetUrl !== 'string' || !targetUrl) {
    return errResult('missing_target_url');
  }
  let parsed;
  try { parsed = new URL(targetUrl, location.href); } catch (_) {
    return errResult('invalid_target_url', { targetUrl });
  }
  if (!/(?:^|\.)(?:x\.com|twitter\.com)$/i.test(parsed.hostname)) {
    return errResult('cross_origin_navigation_forbidden', { hostname: parsed.hostname });
  }
  const to = parsed.toString();
  if (to === fromUrl) {
    return okResult({ noop: true, from: { url: fromUrl }, to: { url: to }, hint: 'already_at_target' });
  }
  try {
    location.assign(to);
  } catch (e) {
    return errResult('location_assign_threw', { message: String((e && e.message) || e), from: { url: fromUrl }, to: { url: to } });
  }
  return okResult({ noop: false, from: { url: fromUrl }, to: { url: to }, hint: 'page_will_reload' });
}

function buildXSearchUrl(opts){
  const o = opts || {};
  const params = new URLSearchParams();
  const ops = [];
  if (o.from) ops.push('from:' + o.from);
  if (o.to) ops.push('to:' + o.to);
  if (o.since) ops.push('since:' + o.since);
  if (o.until) ops.push('until:' + o.until);
  if (o.lang) ops.push('lang:' + o.lang);
  if (typeof o.minLikes === 'number' && o.minLikes > 0) ops.push('min_faves:' + o.minLikes);
  if (typeof o.minRetweets === 'number' && o.minRetweets > 0) ops.push('min_retweets:' + o.minRetweets);
  if (typeof o.minReplies === 'number' && o.minReplies > 0) ops.push('min_replies:' + o.minReplies);
  if (o.excludeReplies) ops.push('-filter:replies');
  if (o.excludeRetweets) ops.push('-filter:retweets');
  if (o.hasLinks) ops.push('filter:links');
  const keyword = String(o.keyword || '').trim();
  const fullQuery = ops.length ? (keyword + ' ' + ops.join(' ')).trim() : keyword;
  params.set('q', fullQuery);
  params.set('src', 'typed_query');
  const sortMap = { top: '', latest: 'live', media: 'image' };
  const sortValue = sortMap[o.sort] != null ? sortMap[o.sort] : '';
  if (sortValue) params.set('f', sortValue);
  return 'https://x.com/search?' + params.toString();
}

function sortToProduct(sort){
  const map = { top: 'Top', latest: 'Latest', media: 'Media' };
  return map[sort] || 'Top';
}
