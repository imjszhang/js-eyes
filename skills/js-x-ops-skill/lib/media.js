'use strict';

const ALLOWED_HOSTS = ['pbs.twimg.com', 'video.twimg.com'];

function isAllowedMediaUrl(url) {
  if (!url || typeof url !== 'string') return false;
  try {
    const u = new URL(url);
    return ALLOWED_HOSTS.some((h) => u.hostname === h || u.hostname.endsWith('.' + h));
  } catch {
    return false;
  }
}

function normalizePhotoUrl(src) {
  if (!src || typeof src !== 'string') return null;
  if (!src.includes('pbs.twimg.com/media')) return null;
  if (src.includes('profile_images') || src.includes('avatar') || src.includes('ext_tw_video_thumb')) {
    return null;
  }
  let cleanSrc = src;
  try {
    if (cleanSrc.includes('?')) {
      const urlObj = new URL(cleanSrc);
      urlObj.searchParams.delete('name');
      if (!urlObj.searchParams.has('format')) urlObj.searchParams.set('format', 'jpg');
      urlObj.searchParams.set('name', 'orig');
      cleanSrc = urlObj.toString();
    } else {
      cleanSrc = `${cleanSrc}?format=jpg&name=orig`;
    }
  } catch {
    if (!cleanSrc.includes('?')) cleanSrc = `${cleanSrc}?format=jpg&name=orig`;
  }
  return isAllowedMediaUrl(cleanSrc) ? cleanSrc : null;
}

function classifyStream(url) {
  if (!url || typeof url !== 'string') return 'unknown';
  const lower = url.toLowerCase();
  if (lower.includes('.m3u8') || lower.includes('/pl/')) return 'hls';
  if (lower.includes('.mp4') || lower.includes('.webm')) return 'mp4';
  if (lower.includes('video.twimg.com')) return 'mp4';
  return 'unknown';
}

function pickBestMp4(urls) {
  const mp4s = (urls || []).filter((u) => classifyStream(u) === 'mp4' && isAllowedMediaUrl(u));
  if (mp4s.length <= 1) return mp4s;
  return mp4s.sort((a, b) => {
    const score = (url) => {
      const m = url.match(/(\d+)x(\d+)/);
      if (m) return parseInt(m[1], 10) * parseInt(m[2], 10);
      if (url.includes('1080')) return 1080 * 1920;
      if (url.includes('720')) return 720 * 1280;
      return 0;
    };
    return score(b) - score(a);
  });
}

function dedupeUrls(urls) {
  const seen = new Set();
  const out = [];
  for (const raw of urls || []) {
    const u = String(raw || '').trim();
    if (!u || seen.has(u)) continue;
    seen.add(u);
    out.push(u);
  }
  return out;
}

/**
 * 从推文对象（bridge parseSingleTweetResult 输出）列出可下载媒体项
 * @param {object} tweet
 * @returns {Array<{type:string,url:string,streamType:string}>}
 */
function listMediaFromTweet(tweet) {
  if (!tweet || typeof tweet !== 'object') return [];
  const items = [];
  const seen = new Set();

  const push = (type, url, streamType) => {
    if (!url || !isAllowedMediaUrl(url) || seen.has(url)) return;
    seen.add(url);
    items.push({ type, url, streamType: streamType || classifyStream(url) });
  };

  const details = Array.isArray(tweet.mediaDetails) ? tweet.mediaDetails : [];
  for (const d of details) {
    if (d.type === 'photo' && d.url) {
      push('photo', normalizePhotoUrl(d.url) || d.url, 'unknown');
    } else if (d.type === 'video' || d.type === 'animated_gif') {
      const mp4 = d.bestMp4Url || pickBestMp4((d.variants || []).map((v) => v.url))[0];
      if (mp4) push('video', mp4, 'mp4');
      else if (d.m3u8Url) push('video', d.m3u8Url, 'hls');
    }
  }

  if (items.length === 0 && Array.isArray(tweet.mediaUrls)) {
    for (const url of tweet.mediaUrls) {
      if (url.includes('pbs.twimg.com/media')) {
        push('photo', normalizePhotoUrl(url) || url, 'unknown');
      } else if (url.includes('video.twimg.com')) {
        push('video', url, classifyStream(url));
      }
    }
  }

  return items;
}

module.exports = {
  ALLOWED_HOSTS,
  isAllowedMediaUrl,
  normalizePhotoUrl,
  classifyStream,
  pickBestMp4,
  dedupeUrls,
  listMediaFromTweet,
};
