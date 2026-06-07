'use strict';

const { randomUUID } = require('crypto');
const { readFileSync, statSync } = require('fs');
const { extname } = require('path');

const MEDIA_UPLOAD_ENDPOINT = 'https://upload.twitter.com/1.1/media/upload.json';
const MEDIA_METADATA_ENDPOINT = 'https://upload.twitter.com/1.1/media/metadata/create.json';
const CHUNK_SIZE = 4 * 1024 * 1024;

const MEDIA_CATEGORIES = {
  'image/jpeg': 'tweet_image',
  'image/png': 'tweet_image',
  'image/webp': 'tweet_image',
  'image/gif': 'tweet_gif',
  'video/mp4': 'tweet_video',
  'video/quicktime': 'tweet_video',
};

const MAX_SIZES = {
  tweet_image: 5 * 1024 * 1024,
  tweet_gif: 15 * 1024 * 1024,
  tweet_video: 512 * 1024 * 1024,
};

const EXT_TO_MIME = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class OfficialApiMediaClient {
  constructor({ isConfigured, buildOauthHeader, userAgent = 'js-x-ops-skill/1.0', logger = null } = {}) {
    this.isConfigured = isConfigured || (() => false);
    this._buildOauthHeader = buildOauthHeader;
    this._userAgent = userAgent;
    this._logger = logger;
  }

  _log(level, msg) {
    if (this._logger && typeof this._logger[level] === 'function') {
      this._logger[level](msg);
    }
  }

  async uploadMedia(filePath, { mediaType, altText } = {}) {
    if (!this.isConfigured()) {
      return { success: false, media_id: '', error: 'X API 未配置' };
    }

    let fileSize;
    try {
      fileSize = statSync(filePath).size;
    } catch (_) {
      return { success: false, media_id: '', error: `文件不存在: ${filePath}` };
    }

    const resolvedMediaType = mediaType || EXT_TO_MIME[extname(filePath).toLowerCase()] || 'application/octet-stream';
    const mediaCategory = MEDIA_CATEGORIES[resolvedMediaType] || 'tweet_image';
    const maxSize = MAX_SIZES[mediaCategory] || 5 * 1024 * 1024;

    if (fileSize > maxSize) {
      return {
        success: false,
        media_id: '',
        error: `文件过大: ${(fileSize / 1024 / 1024).toFixed(1)}MB > ${(maxSize / 1024 / 1024).toFixed(0)}MB (${mediaCategory})`,
      };
    }

    const initResult = await this._mediaInit(fileSize, resolvedMediaType, mediaCategory);
    if (!initResult.success) return initResult;
    const mediaId = initResult.media_id;

    try {
      const data = readFileSync(filePath);
      let segmentIndex = 0;
      for (let offset = 0; offset < data.length; offset += CHUNK_SIZE) {
        const chunk = data.subarray(offset, offset + CHUNK_SIZE);
        const appendResult = await this._mediaAppend(mediaId, segmentIndex, chunk);
        if (!appendResult.success) return appendResult;
        segmentIndex++;
      }
    } catch (e) {
      return { success: false, media_id: '', error: `读取文件失败: ${e}` };
    }

    const finalizeResult = await this._mediaFinalize(mediaId);
    if (!finalizeResult.success) return finalizeResult;

    if (finalizeResult.processing_info) {
      const pollResult = await this._mediaPollStatus(mediaId, finalizeResult.processing_info);
      if (!pollResult.success) return pollResult;
    }

    if (altText) await this._mediaSetAltText(mediaId, altText);
    return { success: true, media_id: String(mediaId) };
  }

  async uploadMediaBytes(data, mediaType, { altText } = {}) {
    if (!this.isConfigured()) {
      return { success: false, media_id: '', error: 'X API 未配置' };
    }

    const mediaCategory = MEDIA_CATEGORIES[mediaType] || 'tweet_image';
    const maxSize = MAX_SIZES[mediaCategory] || 5 * 1024 * 1024;
    if (data.length > maxSize) {
      return {
        success: false,
        media_id: '',
        error: `数据过大: ${(data.length / 1024 / 1024).toFixed(1)}MB > ${(maxSize / 1024 / 1024).toFixed(0)}MB`,
      };
    }

    const initResult = await this._mediaInit(data.length, mediaType, mediaCategory);
    if (!initResult.success) return initResult;
    const mediaId = initResult.media_id;

    let segmentIndex = 0;
    for (let offset = 0; offset < data.length; offset += CHUNK_SIZE) {
      const chunk = data.subarray(offset, offset + CHUNK_SIZE);
      const appendResult = await this._mediaAppend(mediaId, segmentIndex, chunk);
      if (!appendResult.success) return appendResult;
      segmentIndex++;
    }

    const finalizeResult = await this._mediaFinalize(mediaId);
    if (!finalizeResult.success) return finalizeResult;
    if (finalizeResult.processing_info) {
      const pollResult = await this._mediaPollStatus(mediaId, finalizeResult.processing_info);
      if (!pollResult.success) return pollResult;
    }
    if (altText) await this._mediaSetAltText(mediaId, altText);
    return { success: true, media_id: String(mediaId) };
  }

  async _mediaInit(totalBytes, mediaType, mediaCategory) {
    const formParams = {
      command: 'INIT',
      total_bytes: String(totalBytes),
      media_type: mediaType,
      media_category: mediaCategory,
    };
    const result = await this._postForm(MEDIA_UPLOAD_ENDPOINT, formParams);
    if (result._error) {
      return { success: false, media_id: '', error: `INIT 失败: ${result._error}` };
    }
    const mediaId = result.media_id_string || String(result.media_id || '');
    if (!mediaId) {
      return { success: false, media_id: '', error: `INIT 未返回 media_id: ${JSON.stringify(result)}` };
    }
    return { success: true, media_id: mediaId };
  }

  async _mediaAppend(mediaId, segmentIndex, chunk) {
    const boundary = randomUUID().replace(/-/g, '');
    const authHeader = this._buildOauthHeader('POST', MEDIA_UPLOAD_ENDPOINT);
    const fields = {
      command: 'APPEND',
      media_id: String(mediaId),
      segment_index: String(segmentIndex),
    };

    const parts = [];
    for (const [key, val] of Object.entries(fields)) {
      parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="${key}"\r\n\r\n${val}\r\n`);
    }
    parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="media"; filename="blob"\r\nContent-Type: application/octet-stream\r\n\r\n`);

    const textParts = Buffer.from(parts.join(''), 'utf-8');
    const tail = Buffer.from(`\r\n--${boundary}--\r\n`, 'utf-8');
    const body = Buffer.concat([textParts, chunk, tail]);

    try {
      const resp = await fetch(MEDIA_UPLOAD_ENDPOINT, {
        method: 'POST',
        headers: {
          Authorization: authHeader,
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
          'Content-Length': String(body.length),
          'User-Agent': this._userAgent,
        },
        body,
        signal: AbortSignal.timeout(120000),
      });
      if (!resp.ok) {
        const errBody = (await resp.text()).slice(0, 300);
        return { success: false, error: `APPEND #${segmentIndex} 失败: HTTP ${resp.status}: ${errBody}` };
      }
      return { success: true };
    } catch (e) {
      return { success: false, error: `APPEND #${segmentIndex} 失败: ${e}` };
    }
  }

  async _mediaFinalize(mediaId) {
    const formParams = { command: 'FINALIZE', media_id: String(mediaId) };
    const result = await this._postForm(MEDIA_UPLOAD_ENDPOINT, formParams);
    if (result._error) {
      return { success: false, media_id: '', error: `FINALIZE 失败: ${result._error}` };
    }
    return {
      success: true,
      media_id: String(result.media_id_string || result.media_id || ''),
      processing_info: result.processing_info || null,
    };
  }

  async _mediaPollStatus(mediaId, processingInfo) {
    const maxWait = 300;
    let elapsed = 0;
    let current = processingInfo;

    while (elapsed < maxWait) {
      const state = current?.state || '';
      if (state === 'succeeded') return { success: true };
      if (state === 'failed') {
        const errMsg = current?.error?.message || '处理失败';
        return { success: false, media_id: '', error: `媒体处理失败: ${errMsg}` };
      }

      const checkAfter = Math.min(current?.check_after_secs || 5, 30);
      await sleep(checkAfter * 1000);
      elapsed += checkAfter;

      const statusResult = await this._mediaStatus(mediaId);
      if (statusResult._error) {
        return { success: false, media_id: '', error: `STATUS 查询失败: ${statusResult._error}` };
      }
      current = statusResult.processing_info;
      if (!current) return { success: true };
    }

    return { success: false, media_id: '', error: `媒体处理超时 (${maxWait}s)` };
  }

  async _mediaStatus(mediaId) {
    const params = { command: 'STATUS', media_id: String(mediaId) };
    const qs = new URLSearchParams(params).toString();
    const fullUrl = `${MEDIA_UPLOAD_ENDPOINT}?${qs}`;
    const authHeader = this._buildOauthHeader('GET', MEDIA_UPLOAD_ENDPOINT, params);

    try {
      const resp = await fetch(fullUrl, {
        headers: { Authorization: authHeader, 'User-Agent': this._userAgent },
        signal: AbortSignal.timeout(30000),
      });
      if (!resp.ok) {
        const body = (await resp.text()).slice(0, 200);
        return { _error: `HTTP ${resp.status}: ${body}` };
      }
      return await resp.json();
    } catch (e) {
      return { _error: String(e) };
    }
  }

  async _mediaSetAltText(mediaId, altText) {
    const body = JSON.stringify({
      media_id: String(mediaId),
      alt_text: { text: String(altText).slice(0, 1000) },
    });
    const authHeader = this._buildOauthHeader('POST', MEDIA_METADATA_ENDPOINT);
    try {
      await fetch(MEDIA_METADATA_ENDPOINT, {
        method: 'POST',
        headers: {
          Authorization: authHeader,
          'Content-Type': 'application/json',
          'User-Agent': this._userAgent,
        },
        body,
        signal: AbortSignal.timeout(15000),
      });
    } catch (e) {
      this._log('warning', `[official-api] alt text failed: ${e}`);
    }
  }

  async _postForm(url, params) {
    const authHeader = this._buildOauthHeader('POST', url, params);
    const body = new URLSearchParams(params).toString();

    try {
      const resp = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: authHeader,
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': this._userAgent,
        },
        body,
        signal: AbortSignal.timeout(60000),
      });

      if (!resp.ok) {
        const bodyText = (await resp.text()).slice(0, 300);
        return { _error: `HTTP ${resp.status}: ${bodyText}` };
      }

      const raw = await resp.text();
      if (!raw) return {};
      return JSON.parse(raw);
    } catch (e) {
      return { _error: String(e) };
    }
  }
}

module.exports = {
  OfficialApiMediaClient,
  MEDIA_UPLOAD_ENDPOINT,
  MEDIA_CATEGORIES,
  MAX_SIZES,
  EXT_TO_MIME,
};
