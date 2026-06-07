'use strict';

const { createHmac, randomUUID } = require('crypto');
const { OfficialApiMediaClient } = require('./media');

const TWEETS_ENDPOINT = 'https://api.twitter.com/2/tweets';
const USER_ME_ENDPOINT = 'https://api.twitter.com/2/users/me';
const USER_AGENT = 'js-x-ops-skill/3 official-api';

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

class OfficialApiClient {
  constructor({
    apiKey,
    apiSecret,
    accessToken,
    accessTokenSecret,
    logger,
    userAgent = USER_AGENT,
  } = {}) {
    this.apiKey = apiKey || process.env.X_API_KEY || '';
    this.apiSecret = apiSecret || process.env.X_API_SECRET || '';
    this.accessToken = accessToken || process.env.X_ACCESS_TOKEN || '';
    this.accessTokenSecret = accessTokenSecret || process.env.X_ACCESS_TOKEN_SECRET || '';
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

  get isConfigured() {
    return !!(this.apiKey && this.apiSecret && this.accessToken && this.accessTokenSecret);
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
    if (!this.isConfigured) {
      this._readAvailable = false;
      return { available: false, reason: 'api_not_configured' };
    }
    try {
      const params = { 'user.fields': 'id' };
      const url = `${USER_ME_ENDPOINT}?${new URLSearchParams(params).toString()}`;
      const authHeader = this._buildOauthHeader('GET', USER_ME_ENDPOINT, params);
      const resp = await fetch(url, {
        headers: { Authorization: authHeader, 'User-Agent': this._userAgent },
        signal: AbortSignal.timeout(15000),
      });
      if (resp.ok) {
        this._readAvailable = true;
        const body = await resp.json();
        const uid = body?.data?.id;
        if (uid) this._cachedUserId = uid;
        return { available: true, user_id: uid };
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

  async getUserId() {
    if (this._cachedUserId) return this._cachedUserId;
    if (!this.isConfigured) return null;
    try {
      const params = { 'user.fields': 'id' };
      const url = `${USER_ME_ENDPOINT}?${new URLSearchParams(params).toString()}`;
      const authHeader = this._buildOauthHeader('GET', USER_ME_ENDPOINT, params);
      const resp = await fetch(url, {
        headers: { Authorization: authHeader, 'User-Agent': this._userAgent },
        signal: AbortSignal.timeout(15000),
      });
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
    if (!this.isConfigured) return [];
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

      const baseUrl = `https://api.twitter.com/2/users/${uid}/tweets`;
      const qs = new URLSearchParams(params).toString();
      const authHeader = this._buildOauthHeader('GET', baseUrl, params);

      try {
        const resp = await fetch(`${baseUrl}?${qs}`, {
          headers: { Authorization: authHeader, 'User-Agent': this._userAgent },
          signal: AbortSignal.timeout(30000),
        });
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

  async getTweetsByIds(
    tweetIds,
    tweetFields = 'id,text,public_metrics,author_id,created_at',
  ) {
    if (!this.isConfigured || !tweetIds?.length) {
      return { data: [], users: {} };
    }

    const allTweets = [];
    const usersMap = {};

    for (let i = 0; i < tweetIds.length; i += 100) {
      const batch = tweetIds.slice(i, i + 100);
      const params = {
        ids: batch.join(','),
        'tweet.fields': tweetFields,
        expansions: 'author_id',
        'user.fields': 'username,name',
      };

      const qs = new URLSearchParams(params).toString();
      const authHeader = this._buildOauthHeader('GET', TWEETS_ENDPOINT, params);

      try {
        const resp = await fetch(`${TWEETS_ENDPOINT}?${qs}`, {
          headers: { Authorization: authHeader, 'User-Agent': this._userAgent },
          signal: AbortSignal.timeout(30000),
        });
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
    return this._postTweet(body);
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

  async _postTweet(body) {
    if (!this.isConfigured) {
      return { success: false, error: 'X API 未配置（缺少环境变量）', errorCode: 'api_not_configured' };
    }

    const authHeader = this._buildOauthHeader('POST', TWEETS_ENDPOINT);
    const payload = JSON.stringify(body);

    try {
      const resp = await fetch(TWEETS_ENDPOINT, {
        method: 'POST',
        headers: {
          Authorization: authHeader,
          'Content-Type': 'application/json',
          'User-Agent': this._userAgent,
        },
        body: payload,
        signal: AbortSignal.timeout(30000),
      });

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
  USER_ME_ENDPOINT,
};
