'use strict';

/**
 * monitor notify（xhs 版） - 通知渠道分发
 *
 * 与 X v3.0.6 同形态：console / feishu / discord / generic_webhook 4 个 adapter；
 * 失败不抛、不阻塞主流程；通过 Promise.allSettled 并发收集 per-channel 结果。
 */

const https = require('https');
const http = require('http');
const crypto = require('crypto');
const { URL } = require('url');
const { formatConsole, formatFeishu, formatDiscord, formatGeneric } = require('./format');
const { appendLog } = require('./logs');

function computeFeishuSign(timestamp, secret) {
  const stringToSign = `${timestamp}\n${secret}`;
  const hmac = crypto.createHmac('sha256', stringToSign);
  hmac.update('');
  return hmac.digest('base64');
}

function postJson(urlStr, payload, headers = {}, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    let url;
    try { url = new URL(urlStr); } catch (err) { return reject(new Error(`invalid url: ${urlStr}`)); }
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
      res.on('end', () => resolve({ status: res.statusCode || 0, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error(`request timeout after ${timeoutMs}ms`)));
    req.write(body);
    req.end();
  });
}

async function sendConsole(channel, note, options) {
  const line = formatConsole(note, options);
  process.stderr.write(`[notify:${channel.name || 'console'}] ${line}\n`);
  return { ok: true };
}

async function sendFeishu(channel, note, options) {
  if (!channel.url) return { ok: false, error: 'missing_url' };
  try {
    const payload = formatFeishu(note, options);
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
    try { parsed = JSON.parse(resp.body); } catch {}
    if (parsed && typeof parsed.code === 'number' && parsed.code !== 0) {
      return { ok: false, status: resp.status, code: parsed.code, msg: parsed.msg || null, body: resp.body.slice(0, 500) };
    }
    return { ok: true, status: resp.status };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

async function sendDiscord(channel, note, options) {
  if (!channel.url) return { ok: false, error: 'missing_url' };
  try {
    const payload = formatDiscord(note, options);
    const resp = await postJson(channel.url, payload, {}, options.timeoutMs || 10000);
    if (resp.status >= 200 && resp.status < 300) return { ok: true, status: resp.status };
    return { ok: false, status: resp.status, body: resp.body.slice(0, 500) };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

async function sendGenericWebhook(channel, note, options) {
  if (!channel.url) return { ok: false, error: 'missing_url' };
  try {
    const payload = formatGeneric(note, options);
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

async function dispatch(channels, note, options = {}) {
  const list = Array.isArray(channels) ? channels : [];
  if (options.dryNotify) {
    process.stderr.write(`[notify:dry] ${formatConsole(note, options)}\n`);
    return list.map((ch) => ({ name: ch.name, type: ch.type, ok: true, dryRun: true }));
  }
  if (list.length === 0) {
    if (options.fallbackConsole !== false) {
      await sendConsole({ name: 'console' }, note, options);
      return [{ name: 'console', type: 'console', ok: true, fallback: true }];
    }
    return [];
  }
  const results = await Promise.allSettled(list.map(async (ch) => {
    const adapter = ADAPTERS[ch.type] || null;
    if (!adapter) return { name: ch.name, type: ch.type, ok: false, error: `unknown_channel_type:${ch.type}` };
    try {
      const r = await adapter(ch, note, options);
      return { name: ch.name, type: ch.type, ok: !!r.ok, detail: r };
    } catch (err) {
      return { name: ch.name, type: ch.type, ok: false, error: err.message };
    }
  }));
  const finalized = results.map((r, i) => r.status === 'fulfilled' ? r.value
    : { name: list[i].name, type: list[i].type, ok: false, error: String(r.reason) });
  for (const entry of finalized) {
    if (!entry.ok) {
      appendLog({
        event: 'notify_failed',
        channelName: entry.name,
        channelType: entry.type,
        noteId: note.noteId || null,
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
