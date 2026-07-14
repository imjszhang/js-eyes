'use strict';

/**
 * 解析 X Article GraphQL 的 DraftJS content_state（blocks + entityMap/entities）
 * 与 cover_media / media_entities，产出 Markdown 正文与 mediaDetails。
 *
 * 浏览器 bridge 通过 common.js @@include 本文件（module.exports 在浏览器中通常不存在）。
 */

function deepGet(data, ...keys) {
  let cur = data;
  for (const key of keys) {
    if (cur == null) return null;
    if (typeof key === 'number') {
      if (!Array.isArray(cur) || key < 0 || key >= cur.length) return null;
      cur = cur[key];
    } else {
      cur = cur[key];
    }
  }
  return cur;
}

function findArticleImageUrl(value) {
  if (value == null) return null;
  if (typeof value === 'string') {
    const s = value.trim();
    if (/^https:\/\/pbs\.twimg\.com\//i.test(s) || /\.(jpg|jpeg|png|gif|webp)(\?|$)/i.test(s)) {
      return s;
    }
    return null;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findArticleImageUrl(item);
      if (found) return found;
    }
    return null;
  }
  if (typeof value !== 'object') return null;
  const keys = [
    'original_img_url', 'originalImgUrl', 'original_url', 'originalUrl',
    'media_url_https', 'mediaUrlHttps', 'media_url', 'mediaUrl', 'url', 'src', 'uri',
  ];
  for (const k of keys) {
    const candidate = value[k];
    if (typeof candidate === 'string' && candidate.trim()) {
      const found = findArticleImageUrl(candidate);
      if (found) return found;
    }
  }
  if (value.preview_image) {
    const found = findArticleImageUrl(value.preview_image);
    if (found) return found;
  }
  for (const nested of Object.values(value)) {
    const found = findArticleImageUrl(nested);
    if (found) return found;
  }
  return null;
}

function resolveVideoUrl(info) {
  if (!info || typeof info !== 'object') return null;
  const variants = info.variants || [];
  const mp4s = variants
    .filter((v) => v && String(v.content_type || '').includes('video'))
    .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));
  if (mp4s.length) return mp4s[0].url || null;
  const any = variants.find((v) => v && typeof v.url === 'string');
  return any ? any.url : null;
}

function resolveMediaAssetFromInfo(info) {
  if (!info || typeof info !== 'object') return null;
  const posterUrl = findArticleImageUrl(info.preview_image) || findArticleImageUrl(info);
  const videoUrl = resolveVideoUrl(info);
  if (videoUrl) {
    return { type: 'video', url: videoUrl, posterUrl: posterUrl || '', bestMp4Url: videoUrl };
  }
  const imageUrl = findArticleImageUrl(info);
  if (imageUrl) {
    return { type: 'photo', url: imageUrl, posterUrl: imageUrl };
  }
  return null;
}

function normalizeArticleEntityMap(entityMap) {
  if (!entityMap) return {};
  if (typeof entityMap === 'object' && !Array.isArray(entityMap)) {
    const out = {};
    for (const [k, v] of Object.entries(entityMap)) out[String(k)] = v;
    return out;
  }
  if (Array.isArray(entityMap)) {
    const out = {};
    for (const item of entityMap) {
      if (!item || typeof item !== 'object') continue;
      const key = item.key;
      const value = item.value;
      if (key == null || value == null) continue;
      out[String(key)] = value;
    }
    return out;
  }
  return {};
}

function normalizeEntitiesArray(entities) {
  const map = {};
  if (!Array.isArray(entities)) return map;
  for (const ent of entities) {
    if (!ent || ent.key == null) continue;
    map[String(ent.key)] = ent.value != null ? ent.value : ent;
  }
  return map;
}

function buildEntityLookup(entityMap) {
  const byIndex = {};
  const byLogicalKey = {};
  if (!entityMap) return { byIndex, byLogicalKey };
  for (const [idx, entry] of Object.entries(entityMap)) {
    byIndex[idx] = entry;
    const logicalKey = parseInt(entry && entry.key, 10);
    if (Number.isFinite(logicalKey) && byLogicalKey[logicalKey] == null) {
      byLogicalKey[logicalKey] = entry;
    }
  }
  return { byIndex, byLogicalKey };
}

function resolveEntityEntry(entityKey, entityMap, lookup) {
  if (entityKey == null) return null;
  const k = String(entityKey);
  if (lookup && lookup.byLogicalKey[entityKey] != null) return lookup.byLogicalKey[entityKey];
  if (lookup && lookup.byIndex[k] != null) return lookup.byIndex[k];
  if (entityMap && entityMap[k] != null) return entityMap[k];
  return null;
}

function unwrapEntity(entry) {
  if (!entry || typeof entry !== 'object') return null;
  if (entry.value && typeof entry.value === 'object' && entry.value.type) return entry.value;
  if (entry.type) return entry;
  return entry.value || entry;
}

function entityType(entity) {
  return String((entity && entity.type) || '').toUpperCase();
}

function buildArticleMediaUrlMap(articleRoot) {
  const map = {};
  if (!articleRoot || typeof articleRoot !== 'object') return map;
  const candidates = [];
  if (articleRoot.cover_media) candidates.push(articleRoot.cover_media);
  const mediaEntities = articleRoot.media_entities;
  if (Array.isArray(mediaEntities)) candidates.push(...mediaEntities);

  for (const media of candidates) {
    if (!media || typeof media !== 'object') continue;
    const info = media.media_info || media;
    const imageUrl = findArticleImageUrl(info) || findArticleImageUrl(media);
    if (!imageUrl) continue;
    for (const key of ['media_id', 'media_key', 'id']) {
      const id = media[key];
      if (typeof id === 'string' && id) map[id] = imageUrl;
    }
  }
  return map;
}

function buildMediaDetailsFromArticleRoot(articleRoot) {
  const details = [];
  const seen = new Set();
  if (!articleRoot || typeof articleRoot !== 'object') return details;

  const push = (asset) => {
    if (!asset || !asset.url || seen.has(asset.url)) return;
    seen.add(asset.url);
    details.push(asset);
  };

  if (articleRoot.cover_media) {
    const asset = resolveMediaAssetFromInfo(articleRoot.cover_media.media_info || articleRoot.cover_media);
    if (asset) push(Object.assign({ source: 'cover_media' }, asset));
  }

  for (const ent of (articleRoot.media_entities || [])) {
    const asset = resolveMediaAssetFromInfo(ent && ent.media_info);
    if (asset) push(Object.assign({ source: 'media_entities', mediaId: ent.media_id || '' }, asset));
  }

  return details;
}

function findArticleCaption(entity) {
  if (!entity || typeof entity !== 'object') return '';
  for (const k of ['caption', 'alt', 'alt_text', 'altText', 'title', 'name']) {
    const v = deepGet(entity, 'data', k) || entity[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return '';
}

function renderArticleTextBlock(block, entityMap, lookup) {
  const text = typeof block.text === 'string' ? block.text : '';
  if (!text) return '';
  const ranges = block.entity_ranges || block.entityRanges || [];
  if (!Array.isArray(ranges) || !ranges.length) return text;

  let rendered = text;
  const linkRanges = [];
  for (const er of ranges) {
    if (!er || typeof er !== 'object') continue;
    const entity = unwrapEntity(resolveEntityEntry(er.key, entityMap, lookup));
    if (!entity || entityType(entity) !== 'LINK') continue;
    const offset = er.offset;
    const length = er.length;
    const url = deepGet(entity, 'data', 'url');
    if (!Number.isInteger(offset) || !Number.isInteger(length) || length <= 0) continue;
    if (typeof url !== 'string' || !url.trim()) continue;
    linkRanges.push({ offset, length, url: url.trim() });
  }

  for (const { offset, length, url } of linkRanges.sort((a, b) => b.offset - a.offset)) {
    if (offset < 0 || offset + length > rendered.length) continue;
    const label = rendered.slice(offset, offset + length);
    if (!label) continue;
    const safeLabel = label.replace(/\[/g, '\\[').replace(/\]/g, '\\]');
    const safeUrl = url.replace(/\)/g, '%29');
    rendered = rendered.slice(0, offset) + `[${safeLabel}](${safeUrl})` + rendered.slice(offset + length);
  }
  return rendered;
}

function extractAtomicMarkdown(block, entityMap, lookup) {
  const parts = [];
  const ranges = block.entity_ranges || block.entityRanges || [];
  for (const er of ranges || []) {
    const entity = unwrapEntity(resolveEntityEntry(er && er.key, entityMap, lookup));
    if (!entity || entityType(entity) !== 'MARKDOWN') continue;
    const md = deepGet(entity, 'data', 'markdown');
    if (typeof md === 'string' && md.trim()) parts.push(md.trim());
  }
  return parts;
}

function extractAtomicImages(block, entityMap, lookup, mediaUrlMap, mediaDetails, mediaUrls) {
  const lines = [];
  const ranges = block.entity_ranges || block.entityRanges || [];
  for (const er of ranges || []) {
    const entity = unwrapEntity(resolveEntityEntry(er && er.key, entityMap, lookup));
    if (!entity) continue;
    const type = entityType(entity);
    if (type !== 'IMAGE' && type !== 'MEDIA') continue;

    let imageUrl = findArticleImageUrl(entity) || findArticleImageUrl(deepGet(entity, 'data'));
    if (!imageUrl) {
      const mediaItems = deepGet(entity, 'data', 'mediaItems')
        || deepGet(entity, 'data', 'media_items') || [];
      for (const item of mediaItems) {
        const mediaId = (item && (item.mediaId || item.media_id)) || '';
        if (mediaId && mediaUrlMap[mediaId]) {
          imageUrl = mediaUrlMap[mediaId];
          break;
        }
      }
    }
    if (!imageUrl) {
      const fallback = deepGet(entity, 'data', 'url');
      if (typeof fallback === 'string') imageUrl = fallback;
    }
    if (!imageUrl) continue;

    const caption = findArticleCaption(entity);
    lines.push(caption ? `![${caption}](${imageUrl})` : `![image](${imageUrl})`);

    if (!mediaUrls.includes(imageUrl)) mediaUrls.push(imageUrl);
    if (!mediaDetails.some((d) => d.url === imageUrl)) {
      mediaDetails.push({
        type: 'photo',
        url: imageUrl,
        caption,
        source: 'content_state',
      });
    }
  }
  return lines;
}

function extractAtomicPostEmbed(block, entityMap, lookup) {
  const lines = [];
  const ranges = block.entity_ranges || block.entityRanges || [];
  for (const er of ranges || []) {
    const entity = unwrapEntity(resolveEntityEntry(er && er.key, entityMap, lookup));
    if (!entity || entityType(entity) !== 'POST') continue;
    const postId = deepGet(entity, 'data', 'post_id') || deepGet(entity, 'data', 'postId');
    if (postId) lines.push(`{{tweet:${postId}}}`);
  }
  return lines;
}

function renderContentStateToMarkdown(contentState, articleRoot) {
  const blocks = (contentState && contentState.blocks) || [];
  if (!Array.isArray(blocks) || !blocks.length) {
    return { contentMarkdown: '', mediaDetails: [], mediaUrls: [], atomicBlockCount: 0, expectedInlineMedia: false };
  }

  let entityMap = normalizeArticleEntityMap(contentState.entityMap);
  if (!Object.keys(entityMap).length && Array.isArray(contentState.entities)) {
    entityMap = normalizeEntitiesArray(contentState.entities);
  }
  const lookup = buildEntityLookup(entityMap);
  const mediaUrlMap = buildArticleMediaUrlMap(articleRoot || {});
  const mediaDetails = [];
  const mediaUrls = [];
  const parts = [];
  let orderedCounter = 0;
  let atomicBlockCount = 0;
  let expectedInlineMedia = false;

  for (const block of blocks) {
    if (!block || typeof block !== 'object') continue;
    const blockType = block.type || 'unstyled';

    if (blockType === 'atomic') {
      atomicBlockCount += 1;
      const ranges = block.entity_ranges || block.entityRanges || [];
      for (const er of ranges || []) {
        const entity = unwrapEntity(resolveEntityEntry(er && er.key, entityMap, lookup));
        const type = entityType(entity);
        if (type === 'IMAGE' || type === 'MEDIA') expectedInlineMedia = true;
      }
      parts.push(...extractAtomicMarkdown(block, entityMap, lookup));
      parts.push(...extractAtomicImages(block, entityMap, lookup, mediaUrlMap, mediaDetails, mediaUrls));
      parts.push(...extractAtomicPostEmbed(block, entityMap, lookup));
      orderedCounter = 0;
      continue;
    }

    const text = renderArticleTextBlock(block, entityMap, lookup);
    if (!text) continue;
    if (blockType !== 'ordered-list-item') orderedCounter = 0;

    if (blockType === 'header-one') parts.push(`# ${text}`);
    else if (blockType === 'header-two') parts.push(`## ${text}`);
    else if (blockType === 'header-three') parts.push(`### ${text}`);
    else if (blockType === 'header-four') parts.push(`#### ${text}`);
    else if (blockType === 'blockquote') parts.push(`> ${text}`);
    else if (blockType === 'unordered-list-item') parts.push(`- ${text}`);
    else if (blockType === 'ordered-list-item') {
      orderedCounter += 1;
      parts.push(`${orderedCounter}. ${text}`);
    } else if (blockType === 'code-block') parts.push(`\`\`\`\n${text}\n\`\`\``);
    else parts.push(text);
  }

  return {
    contentMarkdown: parts.join('\n\n').trim(),
    mediaDetails,
    mediaUrls,
    atomicBlockCount,
    expectedInlineMedia,
  };
}

function resolveCoverUrl(articleRoot) {
  if (!articleRoot || typeof articleRoot !== 'object') return '';
  const info = articleRoot.cover_media && articleRoot.cover_media.media_info;
  return findArticleImageUrl(info) || findArticleImageUrl(articleRoot.cover_media) || '';
}

/**
 * 从 TweetDetail 节点合并 article_results + article_rich_content
 */
function extractArticleGraphQLSource(actualTweet) {
  if (!actualTweet || typeof actualTweet !== 'object') return null;

  const artResult = deepGet(actualTweet, 'article', 'article_results', 'result')
    || deepGet(actualTweet, 'article', 'result')
    || null;
  const rich = actualTweet.article_rich_content || actualTweet.article_results || null;

  const pick = (a, b) => {
    if (a != null && a !== '') return a;
    return b != null && b !== '' ? b : '';
  };

  const contentState = (artResult && artResult.content_state)
    || (rich && (rich.content_state || rich.rich_content_state))
    || null;

  const mediaEntities = []
    .concat(Array.isArray(artResult && artResult.media_entities) ? artResult.media_entities : [])
    .concat(Array.isArray(rich && rich.media_entities) ? rich.media_entities : []);

  const root = {
    title: pick(artResult && artResult.title, rich && rich.title),
    preview_text: pick(artResult && artResult.preview_text, rich && rich.preview_text),
    plain_text: pick(artResult && artResult.plain_text, rich && rich.plain_text),
    content_state: contentState,
    media_entities: mediaEntities,
    cover_media: (artResult && artResult.cover_media) || (rich && rich.cover_media) || null,
    rest_id: pick(artResult && artResult.rest_id, rich && rich.rest_id),
  };

  if (!root.content_state && !root.plain_text && !root.title) return null;
  return root;
}

function parseArticleContentFromTweet(actualTweet) {
  const source = extractArticleGraphQLSource(actualTweet);
  if (!source) return null;

  const rendered = source.content_state
    ? renderContentStateToMarkdown(source.content_state, source)
    : { contentMarkdown: '', mediaDetails: [], mediaUrls: [], atomicBlockCount: 0, expectedInlineMedia: false };

  const rootMediaDetails = buildMediaDetailsFromArticleRoot(source);
  const coverUrl = resolveCoverUrl(source);

  const mediaDetails = [];
  const seenUrls = new Set();
  const pushDetail = (d) => {
    if (!d || !d.url || seenUrls.has(d.url)) return;
    seenUrls.add(d.url);
    mediaDetails.push(d);
  };
  for (const d of rootMediaDetails) pushDetail(d);
  for (const d of rendered.mediaDetails) pushDetail(d);

  const mediaUrls = [];
  const seenMedia = new Set();
  for (const u of [...rendered.mediaUrls, ...mediaDetails.map((d) => d.url)]) {
    if (u && !seenMedia.has(u)) {
      seenMedia.add(u);
      mediaUrls.push(u);
    }
  }

  const plainText = source.plain_text || '';
  const contentMarkdown = rendered.contentMarkdown || plainText;
  const hasContentState = !!(source.content_state && source.content_state.blocks && source.content_state.blocks.length);
  const expectedInlineMedia = rendered.expectedInlineMedia;
  const hasInlineMedia = mediaDetails.some((d) => d.source === 'content_state');
  const bodyLen = Math.max(contentMarkdown.trim().length, plainText.trim().length);
  const complete = bodyLen > 50
    && (!expectedInlineMedia || hasInlineMedia)
    && (!source.cover_media || !!coverUrl);

  return {
    title: source.title || '',
    previewText: source.preview_text || '',
    plainText,
    contentMarkdown,
    content: contentMarkdown,
    coverUrl,
    mediaDetails,
    mediaUrls,
    articleId: String(source.rest_id || ''),
    parsedFromContentState: hasContentState,
    atomicBlockCount: rendered.atomicBlockCount,
    expectedInlineMedia,
    complete,
    source: hasContentState ? 'graphql_content_state' : 'graphql_plain_text',
  };
}

function isArticleGraphQLComplete(articleContent) {
  if (!articleContent) return false;
  return articleContent.complete === true;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    parseArticleContentFromTweet,
    extractArticleGraphQLSource,
    renderContentStateToMarkdown,
    normalizeArticleEntityMap,
    buildArticleMediaUrlMap,
    isArticleGraphQLComplete,
    findArticleImageUrl,
  };
}
