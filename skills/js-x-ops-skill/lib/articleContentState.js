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
    for (const [k, v] of Object.entries(entityMap)) {
      if (v && typeof v === 'object' && v.value && v.value.type) {
        out[String(v.key != null ? v.key : k)] = v.value;
      } else {
        out[String(k)] = v;
      }
    }
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

function buildMediaByIdMap(articleRoot) {
  const map = {};
  if (!articleRoot || typeof articleRoot !== 'object') return map;
  const candidates = [];
  if (articleRoot.cover_media) candidates.push(articleRoot.cover_media);
  if (Array.isArray(articleRoot.media_entities)) candidates.push(...articleRoot.media_entities);

  for (const media of candidates) {
    if (!media || typeof media !== 'object') continue;
    const asset = resolveMediaAssetFromInfo(media.media_info || media);
    if (!asset) continue;
    for (const key of ['media_id', 'media_key', 'id']) {
      const id = media[key];
      if (typeof id === 'string' && id) map[id] = asset;
    }
  }
  return map;
}

function buildArticleMediaUrlMap(articleRoot) {
  const map = {};
  const byId = buildMediaByIdMap(articleRoot);
  for (const [id, asset] of Object.entries(byId)) {
    if (asset && asset.url) map[id] = asset.url;
  }
  return map;
}

/** MEDIA entity 缺 media_id 时，用相邻 LINK entity 的 url 兜底（baoyu / X 常见形态） */
function buildMediaLinkMap(entityMap) {
  const linkMap = {};
  if (!entityMap || typeof entityMap !== 'object') return linkMap;

  const mediaEntries = [];
  const linkEntries = [];
  for (const [idx, entry] of Object.entries(entityMap)) {
    const entity = unwrapEntity(entry);
    if (!entity) continue;
    const type = entityType(entity);
    const logicalKey = parseInt(entry && entry.key, 10);
    const keyNum = Number.isFinite(logicalKey) ? logicalKey : parseInt(idx, 10);
    if (!Number.isFinite(keyNum)) continue;
    if (type === 'IMAGE' || type === 'MEDIA') {
      mediaEntries.push({ key: keyNum, idx: parseInt(idx, 10) });
    } else if (type === 'LINK') {
      const url = deepGet(entity, 'data', 'url');
      if (typeof url === 'string' && url.trim()) {
        linkEntries.push({ key: keyNum, url: url.trim() });
      }
    }
  }

  if (!mediaEntries.length || !linkEntries.length) return linkMap;
  mediaEntries.sort((a, b) => a.key - b.key);
  linkEntries.sort((a, b) => a.key - b.key);
  const pool = linkEntries.slice();
  for (const media of mediaEntries) {
    if (!pool.length) break;
    let linkIdx = pool.findIndex((l) => l.key > media.key);
    if (linkIdx === -1) linkIdx = 0;
    const link = pool.splice(linkIdx, 1)[0];
    linkMap[media.key] = link.url;
    linkMap[media.idx] = link.url;
  }
  return linkMap;
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

function resolveMediaItemAsset(item, mediaUrlMap, mediaByIdMap, mediaLinkMap, entityKey) {
  const ids = [];
  if (item && typeof item === 'object') {
    for (const k of ['mediaId', 'media_id', 'localMediaId', 'local_media_id']) {
      const v = item[k];
      if (typeof v === 'string' && v) ids.push(v);
    }
  }
  for (const id of ids) {
    if (mediaByIdMap[id]) return mediaByIdMap[id];
    if (mediaUrlMap[id]) {
      return { type: 'photo', url: mediaUrlMap[id], posterUrl: mediaUrlMap[id] };
    }
  }
  if (entityKey != null && mediaLinkMap[entityKey]) {
    const url = mediaLinkMap[entityKey];
    return { type: 'photo', url, posterUrl: url, source: 'media_link_map' };
  }
  return null;
}

function pushInlineMediaAsset(asset, caption, mediaDetails, mediaUrls, lines) {
  if (!asset || !asset.url) return false;
  const alt = caption || (asset.type === 'video' ? 'video' : 'image');
  if (asset.type === 'video') {
    lines.push(`[${alt}](${asset.url})`);
  } else {
    lines.push(caption ? `![${caption}](${asset.url})` : `![image](${asset.url})`);
  }
  if (!mediaUrls.includes(asset.url)) mediaUrls.push(asset.url);
  if (!mediaDetails.some((d) => d.url === asset.url)) {
    mediaDetails.push(Object.assign({
      caption: caption || '',
      source: 'content_state',
    }, asset));
  }
  return true;
}

function extractAtomicMedia(block, entityMap, lookup, mediaUrlMap, mediaByIdMap, mediaLinkMap, mediaDetails, mediaUrls) {
  const lines = [];
  let resolved = 0;
  let expected = 0;
  const ranges = block.entity_ranges || block.entityRanges || [];
  for (const er of ranges || []) {
    const entity = unwrapEntity(resolveEntityEntry(er && er.key, entityMap, lookup));
    if (!entity) continue;
    const type = entityType(entity);
    if (type !== 'IMAGE' && type !== 'MEDIA') continue;
    expected += 1;

    let asset = resolveMediaAssetFromInfo(deepGet(entity, 'data'))
      || resolveMediaAssetFromInfo(entity);
    if (!asset) {
      const mediaItems = deepGet(entity, 'data', 'mediaItems')
        || deepGet(entity, 'data', 'media_items') || [];
      for (const item of mediaItems) {
        asset = resolveMediaItemAsset(item, mediaUrlMap, mediaByIdMap, mediaLinkMap, er && er.key);
        if (asset) break;
      }
    }
    if (!asset) {
      const fallback = deepGet(entity, 'data', 'url');
      if (typeof fallback === 'string') {
        asset = { type: 'photo', url: fallback, posterUrl: fallback };
      }
    }
    if (!asset && er && er.key != null && mediaLinkMap[er.key]) {
      const url = mediaLinkMap[er.key];
      asset = { type: 'photo', url, posterUrl: url };
    }

    const caption = findArticleCaption(entity);
    if (pushInlineMediaAsset(asset, caption, mediaDetails, mediaUrls, lines)) {
      resolved += 1;
    }
  }
  return { lines, resolved, expected };
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
    return {
      contentMarkdown: '',
      mediaDetails: [],
      mediaUrls: [],
      atomicBlockCount: 0,
      expectedInlineMedia: false,
      expectedInlineMediaCount: 0,
      resolvedInlineMediaCount: 0,
    };
  }

  let entityMap = normalizeArticleEntityMap(contentState.entityMap);
  if (!Object.keys(entityMap).length && Array.isArray(contentState.entities)) {
    entityMap = normalizeEntitiesArray(contentState.entities);
  }
  const lookup = buildEntityLookup(entityMap);
  const mediaByIdMap = buildMediaByIdMap(articleRoot || {});
  const mediaUrlMap = buildArticleMediaUrlMap(articleRoot || {});
  const mediaLinkMap = buildMediaLinkMap(entityMap);
  const mediaDetails = [];
  const mediaUrls = [];
  const parts = [];
  let orderedCounter = 0;
  let atomicBlockCount = 0;
  let expectedInlineMediaCount = 0;
  let resolvedInlineMediaCount = 0;

  for (const block of blocks) {
    if (!block || typeof block !== 'object') continue;
    const blockType = block.type || 'unstyled';

    if (blockType === 'atomic') {
      atomicBlockCount += 1;
      parts.push(...extractAtomicMarkdown(block, entityMap, lookup));
      const atomicMedia = extractAtomicMedia(
        block, entityMap, lookup, mediaUrlMap, mediaByIdMap, mediaLinkMap, mediaDetails, mediaUrls,
      );
      parts.push(...atomicMedia.lines);
      expectedInlineMediaCount += atomicMedia.expected;
      resolvedInlineMediaCount += atomicMedia.resolved;
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
    expectedInlineMedia: expectedInlineMediaCount > 0,
    expectedInlineMediaCount,
    resolvedInlineMediaCount,
  };
}

function resolveCoverUrl(articleRoot) {
  if (!articleRoot || typeof articleRoot !== 'object') return '';
  const info = articleRoot.cover_media && articleRoot.cover_media.media_info;
  return findArticleImageUrl(info) || findArticleImageUrl(articleRoot.cover_media) || '';
}

function pickRicherContentState(a, b) {
  const blocksA = (a && a.blocks && a.blocks.length) || 0;
  const blocksB = (b && b.blocks && b.blocks.length) || 0;
  if (blocksB > blocksA) return b;
  if (blocksA > blocksB) return a;
  const entsA = Object.keys(normalizeArticleEntityMap(a && a.entityMap)).length;
  const entsB = Object.keys(normalizeArticleEntityMap(b && b.entityMap)).length;
  return entsB > entsA ? b : a;
}

function mergeMediaEntities(listA, listB) {
  const out = [];
  const seen = new Set();
  for (const ent of [].concat(listA || [], listB || [])) {
    if (!ent || typeof ent !== 'object') continue;
    const id = ent.media_id || ent.media_key || ent.id || '';
    const key = id || JSON.stringify(ent);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(ent);
  }
  return out;
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

  const csArt = artResult && artResult.content_state;
  const csRich = rich && (rich.content_state || rich.rich_content_state);
  const contentState = pickRicherContentState(csArt, csRich);

  const mediaEntities = mergeMediaEntities(
    artResult && artResult.media_entities,
    rich && rich.media_entities,
  );

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
    : {
      contentMarkdown: '',
      mediaDetails: [],
      mediaUrls: [],
      atomicBlockCount: 0,
      expectedInlineMedia: false,
      expectedInlineMediaCount: 0,
      resolvedInlineMediaCount: 0,
    };

  const rootMediaDetails = buildMediaDetailsFromArticleRoot(source);
  const coverUrl = resolveCoverUrl(source);

  const mediaDetails = [];
  const seenUrls = new Set();
  const pushDetail = (d) => {
    if (!d || !d.url || seenUrls.has(d.url)) return;
    seenUrls.add(d.url);
    mediaDetails.push(d);
  };
  // content_state 解析出的 inline 媒体优先（避免被 media_entities 去重吞掉）
  for (const d of rendered.mediaDetails) pushDetail(d);
  for (const d of rootMediaDetails) pushDetail(d);

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
  const expectedInlineMediaCount = rendered.expectedInlineMediaCount || 0;
  const resolvedInlineMediaCount = rendered.resolvedInlineMediaCount || 0;
  const expectedInlineMedia = expectedInlineMediaCount > 0;
  const inlineMediaComplete = !expectedInlineMedia
    || resolvedInlineMediaCount >= expectedInlineMediaCount;
  const bodyLen = Math.max(contentMarkdown.trim().length, plainText.trim().length);
  const complete = bodyLen > 50
    && inlineMediaComplete
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
    expectedInlineMediaCount,
    resolvedInlineMediaCount,
    inlineMediaComplete,
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
    buildMediaLinkMap,
    buildMediaByIdMap,
    isArticleGraphQLComplete,
    findArticleImageUrl,
  };
}
