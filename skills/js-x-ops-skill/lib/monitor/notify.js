'use strict';

/**
 * monitor notify - 通知渠道分发
 *
 * Phase 1: 只实现 console fallback，feishu/discord/generic_webhook 在 Phase 2 填充。
 * 每个 adapter 契约：async function send({ channel, tweet, options }) -> { ok, detail? }
 * 失败不抛、不阻塞主流程；通过 Promise.allSettled 并发 + 返回 per-channel 结果。
 */

const https = require('https');
const http = require('http');
const crypto = require('crypto');
const { URL } = require('url');
const { formatConsole, formatFeishu, formatDiscord, formatGeneric } = require('./format');
const { appendLog } = require('./logs');

/**
 * 飞书自定义机器人 signature 计算：
 *   stringToSign = timestamp + "\n" + secret
 *   sign = base64(HMAC_SHA256(key=stringToSign, msg=""))
 * 参考：https://open.feishu.cn/document/client-docs/bot-v3/add-custom-bot
 */
function computeFeishuSign(timestamp, secret) {
  const stringToSign = `${timestamp}\n${secret}`;
  const hmac = crypto.createHmac('sha256', stringToSign);
  hmac.update('');
  return hmac.digest('base64');
}

function postJson(urlStr, payload, headers = {}, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    let url;
    try { url = new URL(urlStr); } catch (err) {
      return reject(new Error(`invalid url: ${urlStr}`));
    }
    const mod = url.protocol === 'http:' ? http : https;
    const body = Buffer.from(JSON.stringify(payload), 'utf8');
    const req = mod.request({
      method: 'POST',
      hostname: url.hostname,
      port: url.port || (url.protocol === 'http:' ? 80 : 443),
      path: url.pathname + (url.search || ''),
      headers: Object.assign({
        'Content-Type': 'application/json',
        'Content-Length': body.length,
      }, headers),
      timeout: timeoutMs,
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        resolve({ status: res.statusCode || 0, body: text });
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(new Error(`request timeout after ${timeoutMs}ms`)); });
    req.write(body);
    req.end();
  });
}

/**
 * console adapter：不依赖任何外部系统，永远可用
 */
async function sendConsole(channel, tweet, options) {
  const line = formatConsole(tweet, options);
  // 走 stderr 避免污染 JSON stdout
  process.stderr.write(`[notify:${channel.name || 'console'}] ${line}\n`);
  return { ok: true };
}

/**
 * feishu adapter
 *
 * channel: { type: 'feishu', url, secret? }
 * secret 为可选签名校验串；有 secret 时自动计算 timestamp + sign 注入 payload 顶层。
 * 飞书响应体形如 { code: 0, msg: "success", data: {} }，非 0 视为失败。
 */
async function sendFeishu(channel, tweet, options) {
  if (!channel.url) return { ok: false, error: 'missing_url' };
  try {
    const payload = formatFeishu(tweet, options);
    if (channel.secret) {
      const timestamp = String(Math.floor(Date.now() / 1000));
      payload.timestamp = timestamp;
      payload.sign = computeFeishuSign(timestamp, channel.secret);
    }
    const resp = await postJson(channel.url, payload, {}, options.timeoutMs || 10000);
    if (resp.status < 200 || resp.status >= 300) {
      return { ok: false, status: resp.status, body: resp.body.slice(0, 500) };
    }
    let parsed = null;
    try { parsed = JSON.parse(resp.body); } catch { /* 非 JSON 也当成功处理 */ }
    if (parsed && typeof parsed.code === 'number' && parsed.code !== 0) {
      return { ok: false, status: resp.status, code: parsed.code, msg: parsed.msg || null, body: resp.body.slice(0, 500) };
    }
    return { ok: true, status: resp.status };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/**
 * discord adapter
 *
 * channel: { type: 'discord', url }
 * Discord webhook 成功返回 204 No Content（无 body）。
 */
async function sendDiscord(channel, tweet, options) {
  if (!channel.url) return { ok: false, error: 'missing_url' };
  try {
    const payload = formatDiscord(tweet, options);
    const resp = await postJson(channel.url, payload, {}, options.timeoutMs || 10000);
    if (resp.status >= 200 && resp.status < 300) return { ok: true, status: resp.status };
    return { ok: false, status: resp.status, body: resp.body.slice(0, 500) };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/**
 * generic_webhook adapter
 */
async function sendGenericWebhook(channel, tweet, options) {
  if (!channel.url) return { ok: false, error: 'missing_url' };
  try {
    const payload = formatGeneric(tweet, options);
    const resp = await postJson(channel.url, payload, channel.headers || {}, options.timeoutMs || 10000);
    if (resp.status >= 200 && resp.status < 300) return { ok: true, status: resp.status };
    return { ok: false, status: resp.status, body: resp.body.slice(0, 500) };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

const ADAPTERS = {
  console: sendConsole,
  feishu: sendFeishu,
  discord: sendDiscord,
  generic_webhook: sendGenericWebhook,
};

/**
 * @param {Array} channels   待发送的 channel 对象数组
 * @param {Object} tweet     ops-skill v3 schema tweet
 * @param {Object} options   { summaryLength, timeoutMs, dryNotify, fallbackConsole }
 * @returns {Promise<Array<{ name, type, ok, detail? }>>}
 */
async function dispatch(channels, tweet, options = {}) {
  const list = Array.isArray(channels) ? channels : [];
  if (options.dryNotify) {
    // 只打印，不真的发
    const line = formatConsole(tweet, options);
    process.stderr.write(`[notify:dry] ${line}\n`);
    return list.map((ch) => ({ name: ch.name, type: ch.type, ok: true, dryRun: true }));
  }

  // 没有配置任何 channel 时走 console fallback
  if (list.length === 0) {
    if (options.fallbackConsole !== false) {
      await sendConsole({ name: 'console' }, tweet, options);
      return [{ name: 'console', type: 'console', ok: true, fallback: true }];
    }
    return [];
  }

  const results = await Promise.allSettled(list.map(async (ch) => {
    const adapter = ADAPTERS[ch.type] || null;
    if (!adapter) {
      return { name: ch.name, type: ch.type, ok: false, error: `unknown_channel_type:${ch.type}` };
    }
    try {
      const r = await adapter(ch, tweet, options);
      return { name: ch.name, type: ch.type, ok: !!r.ok, detail: r };
    } catch (err) {
      return { name: ch.name, type: ch.type, ok: false, error: err.message };
    }
  }));

  const finalized = results.map((r, i) => {
    if (r.status === 'fulfilled') return r.value;
    return { name: list[i].name, type: list[i].type, ok: false, error: String(r.reason) };
  });

  // 失败项落日志（单行 JSONL）
  for (const entry of finalized) {
    if (!entry.ok) {
      appendLog({
        event: 'notify_failed',
        channelName: entry.name,
        channelType: entry.type,
        tweetId: tweet.tweetId || null,
        username: (tweet.author && tweet.author.username) || null,
        error: entry.error || null,
        detail: entry.detail || null,
      });
    }
  }

  return finalized;
}

module.exports = {
  dispatch,
  sendConsole,
  sendFeishu,
  sendDiscord,
  sendGenericWebhook,
  ADAPTERS,
  postJson,
};
