'use strict';

const { randomUUID } = require('crypto');
const { readFileSync, statSync, openSync, readSync, closeSync } = require('fs');
const { extname } = require('path');

const MEDIA_UPLOAD_ENDPOINT = 'https://api.x.com/2/media/upload';
const MEDIA_UPLOAD_INIT_ENDPOINT = 'https://api.x.com/2/media/upload/initialize';
const MEDIA_METADATA_ENDPOINT = 'https://api.x.com/2/media/metadata';
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

/** 按文件魔数嗅探真实图片/视频 MIME（扩展名与内容不符时以内容为准）。 */
function sniffMimeFromBytes(buf) {
  if (!buf || buf.length < 12) return null;
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) return 'image/gif';
  if (buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46
    && buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50) return 'image/webp';
  if (buf[4] === 0x66 && buf[5] === 0x74 && buf[6] === 0x79 && buf[7] === 0x70) return 'video/mp4';
  return null;
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

function getMediaData(result) {
  return result?.data || result || {};
}

function getMediaId(result) {
  const data = getMediaData(result);
  return String(data.id || data.media_id || result?.media_id_string || result?.media_id || '');
}

function mediaUploadAppendUrl(mediaId) {
  return `${MEDIA_UPLOAD_ENDPOINT}/${String(mediaId)}/append`;
}

function mediaUploadFinalizeUrl(mediaId) {
  return `${MEDIA_UPLOAD_ENDPOINT}/${String(mediaId)}/finalize`;
}

function buildMultipartBody(fields, fileField) {
  const boundary = randomUUID().replace(/-/g, '');
  const parts = [];
  for (const [key, val] of Object.entries(fields)) {
    parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="${key}"\r\n\r\n${val}\r\n`);
  }
  if (fileField) {
    parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="${fileField.name}"; filename="${fileField.filename || 'blob'}"\r\nContent-Type: ${fileField.contentType || 'application/octet-stream'}\r\n\r\n`);
  }

  const textParts = Buffer.from(parts.join(''), 'utf-8');
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`, 'utf-8');
  const body = fileField ? Buffer.concat([textParts, fileField.data, tail]) : Buffer.concat([textParts, tail]);
  return { boundary, body };
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

    let sniffedType = null;
    try {
      const fd = openSync(filePath, 'r');
      const head = Buffer.alloc(12);
      readSync(fd, head, 0, 12, 0);
      closeSync(fd);
      sniffedType = sniffMimeFromBytes(head);
    } catch (_) {}

    const resolvedMediaType = mediaType || sniffedType || EXT_TO_MIME[extname(filePath).toLowerCase()] || 'application/octet-stream';
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
        const appendResult = await this._mediaAppend(mediaId, segmentIndex, chunk, resolvedMediaType);
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
      const appendResult = await this._mediaAppend(mediaId, segmentIndex, chunk, mediaType);
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
    const result = await this._postJson(MEDIA_UPLOAD_INIT_ENDPOINT, {
      total_bytes: totalBytes,
      media_type: mediaType,
      media_category: mediaCategory,
    });
    if (result._error) {
      return { success: false, media_id: '', error: `INIT 失败: ${result._error}` };
    }
    const mediaId = getMediaId(result);
    if (!mediaId) {
      return { success: false, media_id: '', error: `INIT 未返回 media_id: ${JSON.stringify(result)}` };
    }
    return { success: true, media_id: mediaId };
  }

  async _mediaAppend(mediaId, segmentIndex, chunk, contentType = 'application/octet-stream') {
    const appendUrl = mediaUploadAppendUrl(mediaId);
    const authHeader = this._buildOauthHeader('POST', appendUrl);
    const fields = {
      segment_index: String(segmentIndex),
    };
    const { boundary, body } = buildMultipartBody(fields, {
      name: 'media',
      filename: 'blob',
      contentType,
      data: chunk,
    });

    try {
      const resp = await fetchWithTimeout(appendUrl, {
        method: 'POST',
        headers: {
          Authorization: authHeader,
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
          'Content-Length': String(body.length),
          'User-Agent': this._userAgent,
        },
        body,
      }, 120000);
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
    const finalizeUrl = mediaUploadFinalizeUrl(mediaId);
    const result = await this._postJson(finalizeUrl, {});
    if (result._error) {
      return { success: false, media_id: '', error: `FINALIZE 失败: ${result._error}` };
    }
    const data = getMediaData(result);
    return {
      success: true,
      media_id: getMediaId(result),
      processing_info: data.processing_info || result.processing_info || null,
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
      current = getMediaData(statusResult).processing_info || statusResult.processing_info;
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
      const resp = await fetchWithTimeout(fullUrl, {
        headers: { Authorization: authHeader, 'User-Agent': this._userAgent },
      }, 30000);
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
      id: String(mediaId),
      metadata: {
        alt_text: { text: String(altText).slice(0, 1000) },
      },
    });
    const authHeader = this._buildOauthHeader('POST', MEDIA_METADATA_ENDPOINT);
    try {
      await fetchWithTimeout(MEDIA_METADATA_ENDPOINT, {
        method: 'POST',
        headers: {
          Authorization: authHeader,
          'Content-Type': 'application/json',
          'User-Agent': this._userAgent,
        },
        body,
      }, 15000);
    } catch (e) {
      this._log('warning', `[official-api] alt text failed: ${e}`);
    }
  }

  async _postJson(url, payload) {
    const authHeader = this._buildOauthHeader('POST', url);
    const body = JSON.stringify(payload || {});

    try {
      const resp = await fetchWithTimeout(url, {
        method: 'POST',
        headers: {
          Authorization: authHeader,
          'Content-Type': 'application/json',
          'User-Agent': this._userAgent,
        },
        body,
      }, 60000);

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

  async _postForm(url, params) {
    const authHeader = this._buildOauthHeader('POST', url);
    const { boundary, body } = buildMultipartBody(params);

    try {
      const resp = await fetchWithTimeout(url, {
        method: 'POST',
        headers: {
          Authorization: authHeader,
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
          'Content-Length': String(body.length),
          'User-Agent': this._userAgent,
        },
        body,
      }, 60000);

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
