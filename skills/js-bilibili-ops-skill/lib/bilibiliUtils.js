'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const fsPromises = fs.promises;
const YTDLP_PATH = path.join(__dirname, '..', '.venv', 'Scripts', 'yt-dlp.exe');

function extractVideoId(url) {
  const patterns = [
    /bilibili\.com\/video\/(BV[a-zA-Z0-9]{10})/i,
    /bilibili\.com\/video\/(av\d+)/i,
    /b23\.tv\/([a-zA-Z0-9]+)/i,
    /m\.bilibili\.com\/video\/(BV[a-zA-Z0-9]{10})/i,
    /m\.bilibili\.com\/video\/(av\d+)/i,
  ];

  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) {
      const value = match[1];
      return /^av/i.test(value) ? value.toUpperCase() : value;
    }
  }
  return null;
}

function pickFirst(value, fallback = '') {
  return value == null ? fallback : value;
}

function getUserSiteYtDlpPath() {
  const appData = process.env.APPDATA;
  if (!appData) {
    return null;
  }

  const pythonRoot = path.join(appData, 'Python');
  if (!fs.existsSync(pythonRoot)) {
    return null;
  }

  const entries = fs.readdirSync(pythonRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .reverse();

  for (const entry of entries) {
    const candidate = path.join(pythonRoot, entry, 'Scripts', 'yt-dlp.exe');
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

function getYtDlpCommand() {
  if (process.env.YTDLP_PATH && fs.existsSync(process.env.YTDLP_PATH)) {
    return { command: process.env.YTDLP_PATH, prefixArgs: [] };
  }
  if (fs.existsSync(YTDLP_PATH)) {
    return { command: YTDLP_PATH, prefixArgs: [] };
  }
  const userSiteYtDlp = getUserSiteYtDlpPath();
  if (userSiteYtDlp) {
    return { command: userSiteYtDlp, prefixArgs: [] };
  }
  return { command: 'python', prefixArgs: ['-m', 'yt_dlp'] };
}

async function checkYtDlp() {
  const runner = getYtDlpCommand();
  return new Promise((resolve) => {
    const proc = spawn(runner.command, [...runner.prefixArgs, '--version'], { shell: false, stdio: 'ignore' });
    proc.on('close', (code) => resolve(code === 0));
    proc.on('error', () => resolve(false));
  });
}

function spawnCollect(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, {
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      ...options,
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => {
      stdout += data.toString();
    });
    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });
    proc.on('close', (code) => resolve({ code, stdout, stderr }));
    proc.on('error', (error) => reject(new Error(`启动命令失败: ${error.message}`)));
  });
}

async function ensureYtDlpAvailable() {
  const available = await checkYtDlp();
  if (!available) {
    throw new Error('未找到 yt-dlp，请先安装 yt-dlp 或通过 YTDLP_PATH 指定路径');
  }
}

function isCookieError(stderr = '') {
  return /Failed to decrypt with DPAPI|cookies-from-browser|could not find firefox profile|could not find chrome cookies|could not find edge cookies|browser cookies/i.test(stderr);
}

async function runYtDlp(args, options = {}) {
  await ensureYtDlpAvailable();

  const runner = getYtDlpCommand();
  const fullArgs = [...runner.prefixArgs, ...args, '--no-update'];
  const result = await spawnCollect(runner.command, fullArgs);

  if (result.code !== 0 && options.allowCookieFallback && isCookieError(result.stderr)) {
    const sanitizedArgs = [];
    for (let i = 0; i < args.length; i += 1) {
      if (args[i] === '--cookies-from-browser') {
        i += 1;
        continue;
      }
      sanitizedArgs.push(args[i]);
    }
    return spawnCollect(runner.command, [...runner.prefixArgs, ...sanitizedArgs, '--no-update']);
  }

  return result;
}

async function getVideoInfo(url, options = {}) {
  const args = [url, '--dump-json', '--no-download', '--no-playlist'];
  if (!options.noCookies && options.cookiesFromBrowser) {
    args.push('--cookies-from-browser', options.cookiesFromBrowser);
  }

  const { code, stdout, stderr } = await runYtDlp(args, {
    allowCookieFallback: !options.noCookies && !!options.cookiesFromBrowser,
  });
  if (code !== 0 || !stdout.trim()) {
    throw new Error(`yt-dlp 退出码: ${code}\n${stderr}`.trim());
  }

  try {
    return JSON.parse(stdout);
  } catch (error) {
    throw new Error(`解析视频信息失败: ${error.message}`);
  }
}

function cleanSubtitleContent(content, format) {
  const lines = content.split('\n');
  const textLines = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    if (format === 'vtt') {
      if (
        trimmed.startsWith('WEBVTT') ||
        trimmed.startsWith('Kind:') ||
        trimmed.startsWith('Language:') ||
        /^\d{2}:\d{2}:\d{2}[\.,]\d{3}\s*-->\s*\d{2}:\d{2}:\d{2}[\.,]\d{3}/.test(trimmed) ||
        /^\d+$/.test(trimmed)
      ) {
        continue;
      }
      const cleanLine = trimmed.replace(/<[^>]+>/g, '').trim();
      if (cleanLine && !textLines.includes(cleanLine)) {
        textLines.push(cleanLine);
      }
      continue;
    }

    if (
      /^\d+$/.test(trimmed) ||
      /^\d{2}:\d{2}:\d{2},\d{3}\s*-->\s*\d{2}:\d{2}:\d{2},\d{3}/.test(trimmed)
    ) {
      continue;
    }
    if (!textLines.includes(trimmed)) {
      textLines.push(trimmed);
    }
  }

  return textLines.join('\n');
}

async function getSubtitles(url, videoId, options = {}) {
  const tempDir = path.join(os.tmpdir(), `bili-subs-${videoId}-${Date.now()}`);

  try {
    await fsPromises.mkdir(tempDir, { recursive: true });

    const args = [
      url,
      '--write-subs',
      '--write-auto-subs',
      '--sub-langs', options.subLangs || 'zh-Hans,zh-Hant,ai-zh',
      '--skip-download',
      '--no-playlist',
      '-o', path.join(tempDir, '%(id)s.%(ext)s'),
    ];

    if (!options.noCookies && options.cookiesFromBrowser) {
      args.push('--cookies-from-browser', options.cookiesFromBrowser);
    }

    await runYtDlp(args, {
      allowCookieFallback: !options.noCookies && !!options.cookiesFromBrowser,
    });

    const subtitles = {};
    const files = await fsPromises.readdir(tempDir);
    for (const file of files) {
      const match = file.match(/\.([a-zA-Z-]+)\.(vtt|srt|json3|srv[123]|ttml)$/);
      if (!match) {
        continue;
      }
      const langCode = match[1];
      const format = match[2];
      try {
        const content = await fsPromises.readFile(path.join(tempDir, file), 'utf-8');
        subtitles[langCode] = cleanSubtitleContent(content, format);
      } catch (_) {}
    }

    return subtitles;
  } finally {
    try {
      await fsPromises.rm(tempDir, { recursive: true, force: true });
    } catch (_) {}
  }
}

function normalizeVideoData(videoInfo, subtitles, sourceUrl) {
  return {
    id: pickFirst(videoInfo.id, ''),
    title: pickFirst(videoInfo.title, ''),
    description: pickFirst(videoInfo.description, ''),
    channel: pickFirst(videoInfo.channel || videoInfo.uploader, ''),
    channel_id: pickFirst(videoInfo.channel_id || videoInfo.uploader_id, ''),
    channel_url: pickFirst(videoInfo.channel_url || videoInfo.uploader_url, ''),
    duration: videoInfo.duration ?? null,
    duration_string: pickFirst(videoInfo.duration_string, ''),
    view_count: videoInfo.view_count ?? null,
    like_count: videoInfo.like_count ?? null,
    comment_count: videoInfo.comment_count ?? null,
    tags: Array.isArray(videoInfo.tags) ? videoInfo.tags : [],
    categories: Array.isArray(videoInfo.categories) ? videoInfo.categories : [],
    thumbnail: pickFirst(videoInfo.thumbnail, ''),
    thumbnails: Array.isArray(videoInfo.thumbnails) ? videoInfo.thumbnails : [],
    upload_date: pickFirst(videoInfo.upload_date, ''),
    is_live: !!videoInfo.is_live,
    was_live: !!videoInfo.was_live,
    availability: pickFirst(videoInfo.availability, ''),
    webpage_url: pickFirst(videoInfo.webpage_url || videoInfo.original_url, sourceUrl),
    source_url: sourceUrl,
    subtitles: subtitles || {},
  };
}

async function getBilibiliVideoDetails(url, options = {}) {
  const videoId = extractVideoId(url);
  if (!videoId) {
    throw new Error(`无法解析视频 ID: ${url}`);
  }

  const cookiesFromBrowser = options.noCookies ? null : (options.cookiesFromBrowser || 'firefox');
  const videoInfo = await getVideoInfo(url, {
    cookiesFromBrowser,
    noCookies: !!options.noCookies,
  });

  let subtitles = {};
  if (options.includeSubtitles !== false) {
    subtitles = await getSubtitles(url, videoId, {
      cookiesFromBrowser,
      noCookies: !!options.noCookies,
      subLangs: options.subLangs,
    });
  }

  return {
    platform: 'bilibili',
    timestamp: new Date().toISOString(),
    data: normalizeVideoData(videoInfo, subtitles, url),
  };
}

async function getBilibiliSubtitlesResult(url, options = {}) {
  const videoId = extractVideoId(url);
  if (!videoId) {
    throw new Error(`无法解析视频 ID: ${url}`);
  }

  const cookiesFromBrowser = options.noCookies ? null : (options.cookiesFromBrowser || 'firefox');
  const subtitles = await getSubtitles(url, videoId, {
    cookiesFromBrowser,
    noCookies: !!options.noCookies,
    subLangs: options.subLangs,
  });

  return {
    platform: 'bilibili',
    timestamp: new Date().toISOString(),
    data: {
      id: videoId,
      source_url: url,
      subtitles,
      subtitle_languages: Object.keys(subtitles || {}),
    },
  };
}

module.exports = {
  extractVideoId,
  getBilibiliSubtitlesResult,
  getBilibiliVideoDetails,
};
