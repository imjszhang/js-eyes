'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const {
  createDebugState,
  recordDomStat,
  recordStep,
} = require('@js-eyes/skill-recording');

const fsPromises = fs.promises;
const DEFAULT_REMOTE_COMPONENTS = process.env.YTDLP_REMOTE_COMPONENTS || 'ejs:github';
const YTDLP_FILENAMES = process.platform === 'win32'
  ? ['yt-dlp.exe', 'yt-dlp.cmd', 'yt-dlp.bat']
  : ['yt-dlp'];
const LOCAL_YTDLP_PATHS = [
  path.join(__dirname, '..', '.venv', 'Scripts', 'yt-dlp.exe'),
  path.join(__dirname, '..', '.venv', 'bin', 'yt-dlp'),
];
const COMMON_YTDLP_PATHS = [
  '/opt/homebrew/bin/yt-dlp',
  '/usr/local/bin/yt-dlp',
];

function extractVideoId(url) {
  const patterns = [
    /youtube\.com\/shorts\/([a-zA-Z0-9_-]{11})/,
    /youtu\.be\/([a-zA-Z0-9_-]{11})/,
    /(?:youtube\.com|m\.youtube\.com)\/watch(?:\?.*?[?&]v=|\?v=|\/)([a-zA-Z0-9_-]{11})/,
    /youtube\.com\/embed\/([a-zA-Z0-9_-]{11})/,
    /youtube\.com\/v\/([a-zA-Z0-9_-]{11})/,
  ];

  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) {
      return match[1];
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

function getBundledYtDlpPath() {
  for (const candidate of LOCAL_YTDLP_PATHS) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

function getPathYtDlpPath() {
  const pathValue = process.env.PATH || '';
  if (!pathValue) {
    return null;
  }

  for (const dir of pathValue.split(path.delimiter)) {
    if (!dir) {
      continue;
    }
    for (const filename of YTDLP_FILENAMES) {
      const candidate = path.join(dir, filename);
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }
  }

  return null;
}

function getCommonYtDlpPath() {
  for (const candidate of COMMON_YTDLP_PATHS) {
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
  const bundledYtDlp = getBundledYtDlpPath();
  if (bundledYtDlp) {
    return { command: bundledYtDlp, prefixArgs: [] };
  }
  const userSiteYtDlp = getUserSiteYtDlpPath();
  if (userSiteYtDlp) {
    return { command: userSiteYtDlp, prefixArgs: [] };
  }
  const pathYtDlp = getPathYtDlpPath();
  if (pathYtDlp) {
    return { command: pathYtDlp, prefixArgs: [] };
  }
  const commonYtDlp = getCommonYtDlpPath();
  if (commonYtDlp) {
    return { command: commonYtDlp, prefixArgs: [] };
  }
  return { command: process.platform === 'win32' ? 'python' : 'python3', prefixArgs: ['-m', 'yt_dlp'] };
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

    proc.on('close', (code) => {
      resolve({ code, stdout, stderr });
    });

    proc.on('error', (error) => {
      reject(new Error(`启动命令失败: ${error.message}`));
    });
  });
}

async function ensureYtDlpAvailable() {
  const available = await checkYtDlp();
  if (!available) {
    throw new Error('未找到 yt-dlp，请先安装 yt-dlp 或通过 YTDLP_PATH 指定路径');
  }
}

function summarizeStderr(stderr = '', limit = 400) {
  const normalized = String(stderr || '').replace(/\s+/g, ' ').trim();
  if (!normalized) {
    return '';
  }
  return normalized.length > limit ? normalized.slice(0, limit) : normalized;
}

function isCookieError(stderr = '') {
  return /Failed to decrypt with DPAPI|cookies-from-browser|could not find firefox profile|could not find chrome cookies|could not find edge cookies|browser cookies/i.test(stderr);
}

function appendYoutubeChallengeArgs(args, options = {}) {
  const nextArgs = [...args, '--js-runtimes', 'node'];
  const remoteComponents = options.remoteComponents === undefined
    ? DEFAULT_REMOTE_COMPONENTS
    : options.remoteComponents;
  if (remoteComponents) {
    nextArgs.push('--remote-components', remoteComponents);
  }
  return nextArgs;
}

async function runYtDlp(args, options = {}) {
  await ensureYtDlpAvailable();

  const runner = getYtDlpCommand();
  const attempts = [];

  async function execute(rawArgs, label) {
    const fullArgs = [...runner.prefixArgs, ...rawArgs, '--no-update'];
    const result = await spawnCollect(runner.command, fullArgs);
    attempts.push({
      label,
      command: runner.command,
      args: fullArgs,
      exitCode: result.code,
      stderrSummary: summarizeStderr(result.stderr),
    });
    return result;
  }

  const result = await execute(args, 'primary');
  let finalResult = result;
  let fallbackUsed = false;

  if (result.code !== 0 && options.allowCookieFallback && isCookieError(result.stderr)) {
    const sanitizedArgs = [];
    for (let i = 0; i < args.length; i += 1) {
      if (args[i] === '--cookies-from-browser') {
        i += 1;
        continue;
      }
      sanitizedArgs.push(args[i]);
    }
    finalResult = await execute(sanitizedArgs, 'cookie_fallback');
    fallbackUsed = true;
  }

  return {
    ...finalResult,
    attempts,
    fallbackUsed,
  };
}

async function getVideoInfo(url, options = {}) {
  const args = appendYoutubeChallengeArgs([url, '--dump-json', '--no-download', '--no-playlist'], options);

  if (!options.noCookies && options.cookiesFromBrowser) {
    args.push('--cookies-from-browser', options.cookiesFromBrowser);
  }

  const processResult = await runYtDlp(args, {
    allowCookieFallback: !options.noCookies && !!options.cookiesFromBrowser,
  });
  if (processResult.code !== 0 || !processResult.stdout.trim()) {
    const error = new Error(`yt-dlp 退出码: ${processResult.code}\n${processResult.stderr}`.trim());
    error.processTrace = processResult.attempts;
    throw error;
  }

  try {
    return {
      videoInfo: JSON.parse(processResult.stdout),
      processTrace: processResult.attempts,
      fallbackUsed: processResult.fallbackUsed,
    };
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
  const tempDir = path.join(os.tmpdir(), `yt-subs-${videoId}-${Date.now()}`);

  try {
    await fsPromises.mkdir(tempDir, { recursive: true });

    const args = appendYoutubeChallengeArgs([
      url,
      '--write-subs',
      '--write-auto-subs',
      '--sub-langs', options.subLangs || 'zh-Hans,zh-Hant,en',
      '--skip-download',
      '--no-playlist',
      '-o', path.join(tempDir, '%(id)s.%(ext)s'),
    ], options);

    if (!options.noCookies && options.cookiesFromBrowser) {
      args.push('--cookies-from-browser', options.cookiesFromBrowser);
    }

    const processResult = await runYtDlp(args, {
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
      const filePath = path.join(tempDir, file);

      try {
        const content = await fsPromises.readFile(filePath, 'utf-8');
        subtitles[langCode] = cleanSubtitleContent(content, format);
      } catch (_) {}
    }

    return {
      subtitles,
      processTrace: processResult.attempts,
      fallbackUsed: processResult.fallbackUsed,
      subtitleFileCount: Object.keys(subtitles).length,
    };
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

async function getYoutubeVideoDetails(url, options = {}) {
  const videoId = extractVideoId(url);
  if (!videoId) {
    throw new Error(`无法解析视频 ID: ${url}`);
  }

  const debugState = createDebugState();
  recordStep(debugState, 'video_details_started', { url, videoId });
  const cookiesFromBrowser = options.noCookies ? null : (options.cookiesFromBrowser || 'firefox');
  const videoInfoResult = await getVideoInfo(url, {
    cookiesFromBrowser,
    noCookies: !!options.noCookies,
    remoteComponents: options.remoteComponents,
  });
  recordStep(debugState, 'video_info_loaded', {
    attemptCount: videoInfoResult.processTrace.length,
    fallbackUsed: videoInfoResult.fallbackUsed,
  });
  recordDomStat(debugState, 'video_info_process', {
    attemptCount: videoInfoResult.processTrace.length,
    fallbackUsed: videoInfoResult.fallbackUsed,
  });

  let subtitles = {};
  let subtitleTrace = [];
  let subtitleFallbackUsed = false;
  let subtitleFileCount = 0;
  if (options.includeSubtitles !== false) {
    const subtitleResult = await getSubtitles(url, videoId, {
      cookiesFromBrowser,
      noCookies: !!options.noCookies,
      subLangs: options.subLangs,
      remoteComponents: options.remoteComponents,
    });
    subtitles = subtitleResult.subtitles;
    subtitleTrace = subtitleResult.processTrace;
    subtitleFallbackUsed = subtitleResult.fallbackUsed;
    subtitleFileCount = subtitleResult.subtitleFileCount;
    recordStep(debugState, 'subtitles_loaded', {
      attemptCount: subtitleTrace.length,
      fallbackUsed: subtitleFallbackUsed,
      subtitleLanguages: Object.keys(subtitles),
    });
    recordDomStat(debugState, 'subtitle_process', {
      attemptCount: subtitleTrace.length,
      fallbackUsed: subtitleFallbackUsed,
      subtitleFileCount,
    });
  }

  const data = normalizeVideoData(videoInfoResult.videoInfo, subtitles, url);
  return {
    platform: 'youtube',
    timestamp: new Date().toISOString(),
    data,
    metrics: {
      videoId,
      includeSubtitles: options.includeSubtitles !== false,
      subtitleLanguageCount: Object.keys(subtitles).length,
      subtitleFileCount,
      videoInfoAttemptCount: videoInfoResult.processTrace.length,
      subtitleAttemptCount: subtitleTrace.length,
      fallbackUsed: videoInfoResult.fallbackUsed || subtitleFallbackUsed,
    },
    debug: {
      steps: [
        ...debugState.steps,
        ...videoInfoResult.processTrace.map((attempt) => ({
          timestamp: new Date().toISOString(),
          step: 'yt_dlp_attempt',
          phase: 'video_info',
          ...attempt,
        })),
        ...subtitleTrace.map((attempt) => ({
          timestamp: new Date().toISOString(),
          step: 'yt_dlp_attempt',
          phase: 'subtitles',
          ...attempt,
        })),
      ],
      domStats: debugState.domStats,
    },
  };
}

async function getYoutubeSubtitlesResult(url, options = {}) {
  const videoId = extractVideoId(url);
  if (!videoId) {
    throw new Error(`无法解析视频 ID: ${url}`);
  }

  const debugState = createDebugState();
  recordStep(debugState, 'subtitles_started', { url, videoId });
  const cookiesFromBrowser = options.noCookies ? null : (options.cookiesFromBrowser || 'firefox');
  const subtitleResult = await getSubtitles(url, videoId, {
    cookiesFromBrowser,
    noCookies: !!options.noCookies,
    subLangs: options.subLangs,
    remoteComponents: options.remoteComponents,
  });
  recordStep(debugState, 'subtitles_loaded', {
    attemptCount: subtitleResult.processTrace.length,
    fallbackUsed: subtitleResult.fallbackUsed,
    subtitleLanguages: Object.keys(subtitleResult.subtitles || {}),
  });
  recordDomStat(debugState, 'subtitle_process', {
    attemptCount: subtitleResult.processTrace.length,
    fallbackUsed: subtitleResult.fallbackUsed,
    subtitleFileCount: subtitleResult.subtitleFileCount,
  });

  return {
    platform: 'youtube',
    timestamp: new Date().toISOString(),
    data: {
      id: videoId,
      source_url: url,
      subtitles: subtitleResult.subtitles,
      subtitle_languages: Object.keys(subtitleResult.subtitles || {}),
    },
    metrics: {
      videoId,
      subtitleLanguageCount: Object.keys(subtitleResult.subtitles || {}).length,
      subtitleFileCount: subtitleResult.subtitleFileCount,
      subtitleAttemptCount: subtitleResult.processTrace.length,
      fallbackUsed: subtitleResult.fallbackUsed,
    },
    debug: {
      steps: [
        ...debugState.steps,
        ...subtitleResult.processTrace.map((attempt) => ({
          timestamp: new Date().toISOString(),
          step: 'yt_dlp_attempt',
          phase: 'subtitles',
          ...attempt,
        })),
      ],
      domStats: debugState.domStats,
    },
  };
}

module.exports = {
  extractVideoId,
  getYtDlpCommand,
  getYoutubeSubtitlesResult,
  getYoutubeVideoDetails,
};
