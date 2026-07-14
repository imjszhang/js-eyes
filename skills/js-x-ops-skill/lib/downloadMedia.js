'use strict';

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const https = require('https');
const http = require('http');
const { spawn } = require('child_process');
const { classifyStream } = require('./media');

const DEFAULT_REFERER = 'https://x.com/';

let ffmpegAvailableCache = null;

function detectFfmpeg() {
  if (ffmpegAvailableCache !== null) return Promise.resolve(ffmpegAvailableCache);
  return new Promise((resolve) => {
    const proc = spawn('ffmpeg', ['-version'], { stdio: 'ignore' });
    proc.on('error', () => { ffmpegAvailableCache = false; resolve(false); });
    proc.on('close', (code) => { ffmpegAvailableCache = code === 0; resolve(ffmpegAvailableCache); });
  });
}

function photoExtension(url) {
  try {
    const fmt = new URL(url).searchParams.get('format');
    if (fmt === 'png') return '.png';
    if (fmt === 'webp') return '.webp';
    if (fmt === 'gif') return '.gif';
  } catch { /* ignore */ }
  const lower = String(url).toLowerCase();
  if (lower.includes('.png')) return '.png';
  if (lower.includes('.webp')) return '.webp';
  return '.jpg';
}

function downloadFile(url, filePath, { referer = DEFAULT_REFERER } = {}) {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https:') ? https : http;
    const stream = fs.createWriteStream(filePath);
    const reqOpts = { headers: { Referer: referer, 'User-Agent': 'Mozilla/5.0' } };
    const req = protocol.get(url, reqOpts, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        stream.close();
        fsp.unlink(filePath).catch(() => {});
        const loc = res.headers.location;
        if (!loc) return reject(new Error('Redirect without location'));
        const next = loc.startsWith('http') ? loc : new URL(loc, url).href;
        return downloadFile(next, filePath, { referer }).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        stream.close();
        fsp.unlink(filePath).catch(() => {});
        return reject(new Error(`HTTP ${res.statusCode}`));
      }
      res.pipe(stream);
      stream.on('finish', () => { stream.close(); resolve(filePath); });
      stream.on('error', (e) => { stream.close(); fsp.unlink(filePath).catch(() => {}); reject(e); });
    });
    req.on('error', (e) => { stream.close(); fsp.unlink(filePath).catch(() => {}); reject(e); });
  });
}

function downloadHls(url, filePath, { referer = DEFAULT_REFERER, timeoutMs = 120000 } = {}) {
  return new Promise((resolve, reject) => {
    const args = ['-y', '-headers', `Referer: ${referer}\r\n`, '-i', url, '-c', 'copy', filePath];
    const proc = spawn('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    const timer = setTimeout(() => { proc.kill('SIGKILL'); reject(new Error('ffmpeg timeout')); }, timeoutMs);
    proc.stderr.on('data', (c) => { stderr += c.toString(); });
    proc.on('error', (err) => { clearTimeout(timer); reject(err); });
    proc.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0 && fs.existsSync(filePath)) resolve(filePath);
      else reject(new Error(stderr.trim() || `ffmpeg exit ${code}`));
    });
  });
}

async function downloadOneItem(item, outDir, counters, opts) {
  const referer = opts.referer || DEFAULT_REFERER;
  const base = item.type === 'photo' ? `photo_${counters.photo += 1}` : `video_${counters.video += 1}`;
  const result = {
    type: item.type,
    url: item.url,
    streamType: item.streamType || classifyStream(item.url),
    localPath: null,
    ok: false,
    error: null,
  };
  try {
    if (item.type === 'photo') {
      const rel = `${base}${photoExtension(item.url)}`;
      await downloadFile(item.url, path.join(outDir, rel), { referer });
      result.localPath = rel;
      result.ok = true;
      return result;
    }
    if (result.streamType === 'hls') {
      if (!(await detectFfmpeg())) {
        result.error = 'hls_requires_ffmpeg';
        return result;
      }
      const rel = `${base}.mp4`;
      await downloadHls(item.url, path.join(outDir, rel), { referer, timeoutMs: opts.hlsTimeoutMs });
      result.localPath = rel;
      result.ok = true;
      return result;
    }
    const ext = item.url.includes('.webm') ? '.webm' : '.mp4';
    const rel = `${base}${ext}`;
    await downloadFile(item.url, path.join(outDir, rel), { referer });
    result.localPath = rel;
    result.ok = true;
    return result;
  } catch (err) {
    result.error = err.message || String(err);
    return result;
  }
}

async function runPool(items, worker, concurrency) {
  const results = new Array(items.length);
  let idx = 0;
  async function run() {
    while (idx < items.length) {
      const i = idx++;
      results[i] = await worker(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length || 1) }, () => run()));
  return results;
}

async function downloadMedia(items, outDir, opts = {}) {
  const concurrency = opts.concurrency ?? 2;
  const logger = opts.logger || (() => {});
  if (!fs.existsSync(outDir)) await fsp.mkdir(outDir, { recursive: true });
  const counters = { photo: 0, video: 0 };
  const results = await runPool(items, (item) => downloadOneItem(item, outDir, counters, opts), concurrency);
  for (const r of results) {
    if (r.ok) logger(`媒体已下载: ${path.join(outDir, r.localPath)}`);
    else if (r.error) logger(`媒体下载失败 (${r.url}): ${r.error}`);
  }
  return results;
}

module.exports = {
  DEFAULT_REFERER,
  detectFfmpeg,
  downloadFile,
  downloadHls,
  downloadMedia,
};
