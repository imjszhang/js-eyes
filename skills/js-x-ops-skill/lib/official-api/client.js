'use strict';

const { createHmac, randomUUID } = require('crypto');
const fs = require('fs');
const path = require('path');
const { OfficialApiMediaClient } = require('./media');

const X_API_BASE = 'https://api.x.com';
const TWEETS_ENDPOINT = `${X_API_BASE}/2/tweets`;
const TRENDS_BY_WOEID_ENDPOINT = `${X_API_BASE}/2/trends/by/woeid`;
const USER_ME_ENDPOINT = `${X_API_BASE}/2/users/me`;
const USER_BY_USERNAME_ENDPOINT = `${X_API_BASE}/2/users/by/username`;
const USER_AGENT = 'js-x-ops-skill/3 official-api';
let envFilesLoaded = false;

function percentEncode(s) {
  return encodeURIComponent(String(s))
    .replace(/!/g, '%21')
    .replace(/\*/g, '%2A')
    .replace(/'/g, '%27')
    .replace(/\(/g, '%28')
    .replace(/\)/g, '%29');
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithTimeout(url, opts = {}, timeoutMs = 30000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...opts,
      headers: { Connection: 'close', ...(opts.headers || {}) },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

function normalizeBearerToken(token) {
  return String(token || '').replace(/^Bearer\s+/i, '').trim();
}

function unquoteEnvValue(value) {
  const trimmed = String(value || '').trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"'))
    || (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function loadEnvFile(filePath) {
  let raw;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch (_) {
    return;
  }

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const m = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(trimmed);
    if (!m) continue;
    const key = m[1];
    if (process.env[key] !== undefined) continue;
    process.env[key] = unquoteEnvValue(m[2]);
  }
}

function loadEnvFilesOnce() {
  if (envFilesLoaded || process.env.JS_X_SKIP_DOTENV === '1') return;
  envFilesLoaded = true;

  const startDirs = [process.cwd(), __dirname];
  const seen = new Set();
  for (const start of startDirs) {
    let dir = path.resolve(start);
    while (!seen.has(dir)) {
      seen.add(dir);
      loadEnvFile(path.join(dir, '.env'));
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
}

class OfficialApiClient {
  constructor({
    apiKey,
    apiSecret,
    accessToken,
    accessTokenSecret,
    bearerToken,
    logger,
    userAgent = USER_AGENT,
  } = {}) {
    loadEnvFilesOnce();
    this.apiKey = apiKey || process.env.X_API_KEY || '';
    this.apiSecret = apiSecret || process.env.X_API_SECRET || '';
    this.accessToken = accessToken || process.env.X_ACCESS_TOKEN || '';
    this.accessTokenSecret = accessTokenSecret || process.env.X_ACCESS_TOKEN_SECRET || '';
    this.bearerToken = normalizeBearerToken(
      bearerToken || process.env.X_BEARER_TOKEN || process.env.X_API_BEARER_TOKEN || '',
    );
    this._logger = logger || null;
    this._userAgent = userAgent;
    this._cachedUserId = null;
    this._readAvailable = null;
    this._media = new OfficialApiMediaClient({
      isConfigured: () => this.isConfigured,
      buildOauthHeader: (method, url, params) => this._buildOauthHeader(method, url, params),
      userAgent,
      logger,
    });
  }

  get isWriteConfigured() {
    return !!(this.apiKey && this.apiSecret && this.accessToken && this.accessTokenSecret);
  }

  get isReadConfigured() {
    return !!(this.bearerToken || this.isWriteConfigured);
  }

  get isConfigured() {
    return this.isWriteConfigured;
  }

  _log(level, msg) {
    if (this._logger && typeof this._logger[level] === 'function') {
      this._logger[level](msg);
    }
  }

  async checkReadAccess() {
    if (this._readAvailable !== null) {
      return { available: this._readAvailable };
    }
    if (!this.isReadConfigured) {
      this._readAvailable = false;
      return { available: false, reason: 'api_not_configured' };
    }
    try {
      const params = { 'user.fields': 'id' };
      const baseUrl = this.isWriteConfigured ? USER_ME_ENDPOINT : `${USER_BY_USERNAME_ENDPOINT}/xdevelopers`;
      const url = `${baseUrl}?${new URLSearchParams(params).toString()}`;
      const authHeader = this.isWriteConfigured
        ? this._buildOauthHeader('GET', baseUrl, params)
        : this._buildReadAuthHeader('GET', baseUrl, params);
      const resp = await fetchWithTimeout(url, {
        headers: { Authorization: authHeader, 'User-Agent': this._userAgent },
      }, 15000);
      if (resp.ok) {
        this._readAvailable = true;
        const body = await resp.json();
        const uid = body?.data?.id;
        if (uid && this.isWriteConfigured) this._cachedUserId = uid;
        return { available: true, user_id: uid, auth_type: this.isWriteConfigured ? 'oauth1' : 'bearer' };
      }
      let bodyText = '';
      try { bodyText = (await resp.text()).slice(0, 300); } catch (_) {}
      this._readAvailable = false;
      return {
        available: false,
        reason: `HTTP ${resp.status}`,
        status_code: resp.status,
        detail: bodyText,
      };
    } catch (e) {
      this._readAvailable = false;
      return { available: false, reason: String(e) };
    }
  }

  async getUserByUsername(username, { userFields = 'pinned_tweet_id,description,public_metrics' } = {}) {
    const clean = String(username || '').replace(/^@/, '').trim();
    if (!clean) return null;
    if (!this.isReadConfigured && !this.isWriteConfigured) return null;
    try {
      const params = { 'user.fields': userFields };
      const basePath = `${USER_BY_USERNAME_ENDPOINT}/${encodeURIComponent(clean)}`;
      const authHeader = this.isWriteConfigured
        ? this._buildOauthHeader('GET', basePath, params)
        : this._buildReadAuthHeader('GET', basePath, params);
      const url = `${basePath}?${new URLSearchParams(params).toString()}`;
      const resp = await fetchWithTimeout(url, {
        headers: { Authorization: authHeader, 'User-Agent': this._userAgent },
      }, 15000);
      if (!resp.ok) {
        this._log('warning', `[OfficialApiClient] GET ${basePath} -> HTTP ${resp.status}`);
        return null;
      }
      const body = await resp.json();
      return body?.data || null;
    } catch (e) {
      this._log('warning', `[OfficialApiClient] getUserByUsername failed: ${e}`);
      return null;
    }
  }

  async getUserId() {
    if (this._cachedUserId) return this._cachedUserId;
    if (!this.isWriteConfigured) return null;
    try {
      const params = { 'user.fields': 'id' };
      const url = `${USER_ME_ENDPOINT}?${new URLSearchParams(params).toString()}`;
      const authHeader = this._buildOauthHeader('GET', USER_ME_ENDPOINT, params);
      const resp = await fetchWithTimeout(url, {
        headers: { Authorization: authHeader, 'User-Agent': this._userAgent },
      }, 15000);
      if (!resp.ok) {
        this._log('warning', `[OfficialApiClient] GET /2/users/me -> HTTP ${resp.status}`);
        return null;
      }
      const body = await resp.json();
      const uid = body?.data?.id;
      if (uid) this._cachedUserId = uid;
      return uid || null;
    } catch (e) {
      this._log('warning', `[OfficialApiClient] GET /2/users/me failed: ${e}`);
      return null;
    }
  }

  async getUserTweets({
    userId,
    maxResults = 100,
    maxPages = 2,
    excludeRetweets = true,
  } = {}) {
    if (!this.isReadConfigured) return [];
    const uid = userId || await this.getUserId();
    if (!uid) {
      this._log('warning', '[OfficialApiClient] getUserTweets: missing user id');
      return [];
    }

    const allTweets = [];
    let paginationToken = null;

    for (let page = 0; page < maxPages; page++) {
      const params = {
        max_results: String(Math.min(maxResults, 100)),
        'tweet.fields': 'id,text,public_metrics,referenced_tweets,created_at,conversation_id',
      };
      if (excludeRetweets) params.exclude = 'retweets';
      if (paginationToken) params.pagination_token = paginationToken;

      const baseUrl = `${X_API_BASE}/2/users/${uid}/tweets`;
      const qs = new URLSearchParams(params).toString();
      const authHeader = this._buildReadAuthHeader('GET', baseUrl, params);

      try {
        const resp = await fetchWithTimeout(`${baseUrl}?${qs}`, {
          headers: { Authorization: authHeader, 'User-Agent': this._userAgent },
        }, 30000);
        if (!resp.ok) {
          this._log('warning', `[OfficialApiClient] GET /2/users/${uid}/tweets page ${page + 1} -> HTTP ${resp.status}`);
          break;
        }
        const body = await resp.json();
        allTweets.push(...(body.data || []));
        paginationToken = body?.meta?.next_token;
        if (!paginationToken) break;
      } catch (e) {
        this._log('warning', `[OfficialApiClient] GET /2/users/${uid}/tweets failed: ${e}`);
        break;
      }
    }

    return allTweets;
  }

  async getMentions({
    userId,
    maxResults = 100,
    maxPages = 2,
  } = {}) {
    if (!this.isReadConfigured) return [];
    const uid = userId || await this.getUserId();
    if (!uid) {
      this._log('warning', '[OfficialApiClient] getMentions: missing user id');
      return [];
    }

    const allTweets = [];
    let paginationToken = null;

    for (let page = 0; page < maxPages; page++) {
      const params = {
        max_results: String(Math.min(maxResults, 100)),
        'tweet.fields': 'id,text,public_metrics,author_id,created_at,conversation_id,referenced_tweets',
        expansions: 'author_id',
        'user.fields': 'username,name',
      };
      if (paginationToken) params.pagination_token = paginationToken;

      const baseUrl = `${X_API_BASE}/2/users/${uid}/mentions`;
      const qs = new URLSearchParams(params).toString();
      const authHeader = this._buildReadAuthHeader('GET', baseUrl, params);

      try {
        const resp = await fetchWithTimeout(`${baseUrl}?${qs}`, {
          headers: { Authorization: authHeader, 'User-Agent': this._userAgent },
        }, 30000);
        if (!resp.ok) {
          this._log('warning', `[OfficialApiClient] GET /2/users/${uid}/mentions page ${page + 1} -> HTTP ${resp.status}`);
          break;
        }
        const body = await resp.json();
        const users = Object.fromEntries((body?.includes?.users || []).map((user) => [user.id, user]));
        for (const tweet of (body.data || [])) {
          const author = users[tweet.author_id] || {};
          allTweets.push({
            ...tweet,
            author_username: author.username || '',
            author_name: author.name || '',
          });
        }
        paginationToken = body?.meta?.next_token;
        if (!paginationToken) break;
      } catch (e) {
        this._log('warning', `[OfficialApiClient] GET /2/users/${uid}/mentions failed: ${e}`);
        break;
      }
    }

    return allTweets;
  }

  async getTweetsByIds(
    tweetIds,
    {
      tweetFields = 'id,text,public_metrics,author_id,created_at',
      includePrivateMetrics = false,
    } = {},
  ) {
    if (!this.isReadConfigured || !tweetIds?.length) {
      return { data: [], users: {} };
    }

    const allTweets = [];
    const usersMap = {};

    for (let i = 0; i < tweetIds.length; i += 100) {
      const batch = tweetIds.slice(i, i + 100);
      const fields = new Set(String(tweetFields || '')
        .split(',')
        .map((field) => field.trim())
        .filter(Boolean));
      if (includePrivateMetrics) {
        fields.add('organic_metrics');
        fields.add('non_public_metrics');
      }

      const params = {
        ids: batch.join(','),
        'tweet.fields': [...fields].join(','),
        expansions: 'author_id',
        'user.fields': 'username,name',
      };

      const qs = new URLSearchParams(params).toString();
      const authHeader = includePrivateMetrics && this.isWriteConfigured
        ? this._buildOauthHeader('GET', TWEETS_ENDPOINT, params)
        : this._buildReadAuthHeader('GET', TWEETS_ENDPOINT, params);

      try {
        const resp = await fetchWithTimeout(`${TWEETS_ENDPOINT}?${qs}`, {
          headers: { Authorization: authHeader, 'User-Agent': this._userAgent },
        }, 30000);
        if (!resp.ok) {
          this._log('warning', `[OfficialApiClient] GET /2/tweets?ids batch ${Math.floor(i / 100) + 1} -> HTTP ${resp.status}`);
          continue;
        }
        const body = await resp.json();
        allTweets.push(...(body.data || []));
        for (const user of (body?.includes?.users || [])) {
          usersMap[user.id] = { username: user.username || '', name: user.name || '' };
        }
      } catch (e) {
        this._log('warning', `[OfficialApiClient] GET /2/tweets?ids failed: ${e}`);
      }
    }

    return { data: allTweets, users: usersMap };
  }

  async getTrends(woeid = 1) {
    if (!this.isReadConfigured) {
      return {
        ok: false,
        trends: [],
        error: 'X API read credentials are not configured',
        errorCode: 'api_not_configured',
      };
    }

    const id = String(woeid || '').trim() || '1';
    const url = `${TRENDS_BY_WOEID_ENDPOINT}/${encodeURIComponent(id)}`;
    const authHeader = this._buildReadAuthHeader('GET', url, {});

    try {
      const resp = await fetchWithTimeout(url, {
        headers: { Authorization: authHeader, 'User-Agent': this._userAgent },
      }, 15000);

      if (!resp.ok) {
        return await OfficialApiClient.parseHttpError(resp);
      }

      const body = await resp.json();
      const trends = Array.isArray(body?.data) ? body.data : [];
      return {
        ok: true,
        woeid: id,
        trends,
        count: trends.length,
        meta: body?.meta || {},
      };
    } catch (e) {
      return { ok: false, trends: [], error: String(e), errorCode: 'request_failed' };
    }
  }

  async createTweet(text, mediaIds) {
    const body = { text };
    if (mediaIds?.length) body.media = { media_ids: mediaIds.map(String) };
    return this._postTweet(body);
  }

  async createReply(text, inReplyToTweetId, mediaIds) {
    const body = {
      text,
      reply: { in_reply_to_tweet_id: String(inReplyToTweetId) },
    };
    if (mediaIds?.length) body.media = { media_ids: mediaIds.map(String) };
    return this._postTweet(body);
  }

  async createQuote(text, quoteTweetId, mediaIds) {
    const body = { text, quote_tweet_id: String(quoteTweetId) };
    if (mediaIds?.length) body.media = { media_ids: mediaIds.map(String) };
    const result = await this._postTweet(body);
    if (!result.success && result.status_code === 403) {
      result.detail = result.detail || 'Quote-posting requires an Enterprise plan on the X API.';
      result.error = `${result.error}（Quote Post 需要 X API Enterprise 计划）`;
    }
    return result;
  }

  async createThread(tweets) {
    if (!this.isConfigured) {
      return { success: false, tweet_ids: [], errors: ['X API 未配置'] };
    }
    if (!tweets?.length) {
      return { success: false, tweet_ids: [], errors: ['空的帖子列表'] };
    }

    const tweetIds = [];
    const errors = [];
    let prevTweetId = null;

    for (let i = 0; i < tweets.length; i++) {
      const item = tweets[i];
      const text = item.text || '';
      const mediaIds = [...(item.media_ids || [])];

      for (const mediaPath of (item.media_paths || [])) {
        const uploadResult = await this.uploadMedia(mediaPath);
        if (uploadResult.success) {
          mediaIds.push(uploadResult.media_id);
        } else {
          errors.push(`帖 ${i + 1} 媒体上传失败: ${uploadResult.error}`);
        }
      }

      const result = prevTweetId === null
        ? await this.createTweet(text, mediaIds.length ? mediaIds : undefined)
        : await this.createReply(text, prevTweetId, mediaIds.length ? mediaIds : undefined);

      if (result.success) {
        tweetIds.push(result.tweet_id);
        prevTweetId = result.tweet_id;
      } else {
        errors.push(`帖 ${i + 1} 发送失败: ${result.error}`);
        break;
      }

      if (i < tweets.length - 1) await sleep(1000);
    }

    return {
      success: tweetIds.length === tweets.length,
      tweet_ids: tweetIds,
      total: tweets.length,
      sent: tweetIds.length,
      errors,
    };
  }

  async uploadMedia(filePath, opts = {}) {
    return this._media.uploadMedia(filePath, opts);
  }

  async uploadMediaBytes(data, mediaType, opts = {}) {
    return this._media.uploadMediaBytes(data, mediaType, opts);
  }

  async deleteTweet(tweetId) {
    if (!this.isConfigured) {
      return { success: false, error: 'X API 未配置（缺少环境变量）', errorCode: 'api_not_configured' };
    }

    const id = String(tweetId || '').trim();
    if (!id) {
      return { success: false, error: '缺少 tweet id', errorCode: 'bad_arg' };
    }

    const url = `${TWEETS_ENDPOINT}/${encodeURIComponent(id)}`;
    const authHeader = this._buildOauthHeader('DELETE', url);

    try {
      const resp = await fetchWithTimeout(url, {
        method: 'DELETE',
        headers: {
          Authorization: authHeader,
          'User-Agent': this._userAgent,
        },
      }, 30000);

      if (resp.ok) {
        const body = await resp.json();
        return { success: body?.data?.deleted === true, tweet_id: id, data: body?.data || {} };
      }

      return await OfficialApiClient.parseHttpError(resp);
    } catch (e) {
      return { success: false, error: String(e), errorCode: 'request_failed' };
    }
  }

  async _postTweet(body) {
    if (!this.isConfigured) {
      return { success: false, error: 'X API 未配置（缺少环境变量）', errorCode: 'api_not_configured' };
    }

    const authHeader = this._buildOauthHeader('POST', TWEETS_ENDPOINT);
    const payload = JSON.stringify(body);

    try {
      const resp = await fetchWithTimeout(TWEETS_ENDPOINT, {
        method: 'POST',
        headers: {
          Authorization: authHeader,
          'Content-Type': 'application/json',
          'User-Agent': this._userAgent,
        },
        body: payload,
      }, 30000);

      if (resp.ok) {
        const respBody = await resp.json();
        const tweetId = respBody?.data?.id || '';
        return { success: true, tweet_id: String(tweetId), data: respBody?.data || {} };
      }

      return await OfficialApiClient.parseHttpError(resp);
    } catch (e) {
      return { success: false, error: String(e), errorCode: 'request_failed' };
    }
  }

  static async parseHttpError(resp) {
    let detail = '';
    const statusCode = resp.status;
    try {
      const errorBody = await resp.text();
      try {
        const errorJson = JSON.parse(errorBody);
        detail = errorJson.detail || '';
        if (!detail) {
          const errors = errorJson.errors || [];
          if (errors.length) detail = errors[0].message || '';
        }
      } catch (_) {
        detail = errorBody.slice(0, 200);
      }
    } catch (_) {}

    let errorCode = 'api_request_failed';
    if (statusCode === 401) errorCode = 'unauthorized';
    else if (statusCode === 403) errorCode = 'forbidden';
    else if (statusCode === 429) errorCode = 'rate_limited';

    return {
      success: false,
      error: `HTTP ${statusCode}: ${detail || '(no detail)'}`,
      errorCode,
      status_code: statusCode,
      detail,
    };
  }

  _buildOauthHeader(method, url, extraParams) {
    const oauthParams = {
      oauth_consumer_key: this.apiKey,
      oauth_nonce: randomUUID().replace(/-/g, ''),
      oauth_signature_method: 'HMAC-SHA1',
      oauth_timestamp: String(Math.floor(Date.now() / 1000)),
      oauth_token: this.accessToken,
      oauth_version: '1.0',
    };

    const sigParams = { ...oauthParams };
    if (extraParams) Object.assign(sigParams, extraParams);

    const sigBase = OfficialApiClient.buildSignatureBase(method, url, sigParams);
    const signingKey = `${percentEncode(this.apiSecret)}&${percentEncode(this.accessTokenSecret)}`;
    const signature = createHmac('sha1', signingKey).update(sigBase).digest('base64');
    oauthParams.oauth_signature = signature;

    const headerParts = Object.keys(oauthParams)
      .sort()
      .map((k) => `${percentEncode(k)}="${percentEncode(oauthParams[k])}"`)
      .join(', ');
    return `OAuth ${headerParts}`;
  }

  _buildReadAuthHeader(method, url, extraParams) {
    if (this.bearerToken) return `Bearer ${this.bearerToken}`;
    return this._buildOauthHeader(method, url, extraParams);
  }

  static buildSignatureBase(method, url, params) {
    const paramsStr = Object.keys(params)
      .sort()
      .map((k) => `${percentEncode(k)}=${percentEncode(params[k])}`)
      .join('&');
    return `${method.toUpperCase()}&${percentEncode(url)}&${percentEncode(paramsStr)}`;
  }
}

module.exports = {
  OfficialApiClient,
  percentEncode,
  TWEETS_ENDPOINT,
  TRENDS_BY_WOEID_ENDPOINT,
  USER_ME_ENDPOINT,
};
