'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { TWEET_STATUS_RE } = require('./draftJsBuilder');

const REMOTE_MAX_BYTES = 5 * 1024 * 1024;
const IMAGE_REF_PREFIX = '__ARTICLE_IMAGE__:';

function isRemoteUrl(value) {
  return /^https?:\/\//i.test(String(value || '').trim());
}

function isLocalPath(value) {
  const v = String(value || '').trim();
  if (!v || isRemoteUrl(v)) return false;
  return true;
}

function toArticleMediaRef(uploadResult) {
  const category = String(uploadResult.media_category || uploadResult.mediaCategory || 'tweet_image');
  return {
    media_id: String(uploadResult.media_id || ''),
    media_category: category.toUpperCase(),
  };
}

function scanMarkdownImages(markdown) {
  const refs = [];
  const re = /!\[([^\]]*)\]\(([^)]+)\)/g;
  let m;
  while ((m = re.exec(String(markdown || ''))) !== null) {
    const alt = m[1];
    const target = m[2].trim();
    if (TWEET_STATUS_RE.test(target)) continue;
    refs.push({ alt, target, full: m[0] });
  }
  return refs;
}

async function fetchRemoteImage(url) {
  const resp = await fetch(url, { headers: { 'User-Agent': 'js-x-ops-skill/3.7 article-media' } });
  if (!resp.ok) {
    throw new Error(`remote image fetch failed HTTP ${resp.status}`);
  }
  const contentType = String(resp.headers.get('content-type') || '').split(';')[0].trim();
  if (!contentType.startsWith('image/')) {
    throw new Error(`remote URL is not an image: ${contentType || 'unknown'}`);
  }
  const buf = Buffer.from(await resp.arrayBuffer());
  if (buf.length > REMOTE_MAX_BYTES) {
    throw new Error(`remote image too large: ${(buf.length / 1024 / 1024).toFixed(1)}MB`);
  }
  const ext = contentType === 'image/png' ? '.png'
    : contentType === 'image/webp' ? '.webp'
      : contentType === 'image/gif' ? '.gif'
        : '.jpg';
  const tmpPath = path.join(os.tmpdir(), `js-x-ops-article-${Date.now()}${ext}`);
  fs.writeFileSync(tmpPath, buf);
  return { tmpPath, contentType };
}

async function resolveArticleMedia(client, {
  markdown,
  coverPath,
  fetchRemoteImages = false,
  baseDir = process.cwd(),
}) {
  let resolvedMarkdown = String(markdown || '');
  const inlineMediaMap = {};
  const errors = [];

  const refs = scanMarkdownImages(resolvedMarkdown);
  let refIndex = 0;

  for (const ref of refs) {
    const target = ref.target;
    let uploadPath = null;
    let tmpPath = null;

    try {
      if (isLocalPath(target)) {
        uploadPath = path.isAbsolute(target) ? target : path.resolve(baseDir, target);
        if (!fs.existsSync(uploadPath)) {
          errors.push(`local image not found: ${target}`);
          continue;
        }
      } else if (isRemoteUrl(target)) {
        if (!fetchRemoteImages) continue;
        const fetched = await fetchRemoteImage(target);
        uploadPath = fetched.tmpPath;
        tmpPath = fetched.tmpPath;
      } else {
        continue;
      }

      const upload = await client.uploadMedia(uploadPath);
      if (!upload.success) {
        errors.push(`upload failed for ${target}: ${upload.error}`);
        continue;
      }

      const mediaRef = toArticleMediaRef({
        media_id: upload.media_id,
        media_category: upload.media_category || 'tweet_image',
      });
      const key = `img${refIndex++}`;
      inlineMediaMap[key] = mediaRef;
      resolvedMarkdown = resolvedMarkdown.replace(
        ref.full,
        `![${ref.alt}](${IMAGE_REF_PREFIX}${key})`,
      );
    } catch (e) {
      errors.push(`${target}: ${e.message || String(e)}`);
    } finally {
      if (tmpPath) {
        try { fs.unlinkSync(tmpPath); } catch (_) {}
      }
    }
  }

  let coverMedia = null;
  if (coverPath) {
    const absCover = path.isAbsolute(coverPath) ? coverPath : path.resolve(baseDir, coverPath);
    if (!fs.existsSync(absCover)) {
      errors.push(`cover image not found: ${coverPath}`);
    } else {
      const upload = await client.uploadMedia(absCover);
      if (!upload.success) {
        errors.push(`cover upload failed: ${upload.error}`);
      } else {
        coverMedia = toArticleMediaRef({
          media_id: upload.media_id,
          media_category: upload.media_category || 'tweet_image',
        });
      }
    }
  }

  if (errors.length) {
    return {
      ok: false,
      errors,
      markdown: resolvedMarkdown,
      inlineMediaMap,
      coverMedia,
    };
  }

  return {
    ok: true,
    markdown: resolvedMarkdown,
    inlineMediaMap,
    coverMedia,
  };
}

module.exports = {
  IMAGE_REF_PREFIX,
  REMOTE_MAX_BYTES,
  isRemoteUrl,
  isLocalPath,
  toArticleMediaRef,
  scanMarkdownImages,
  resolveArticleMedia,
};
