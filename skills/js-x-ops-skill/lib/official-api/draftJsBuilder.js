'use strict';

const TWEET_STATUS_RE = /(?:https?:\/\/)?(?:www\.)?(?:x\.com|twitter\.com)\/[\w_]+\/status\/(\d+)/i;
const TWEET_MACRO_RE = /^\{\{tweet:(\d+)\}\}$/;

function createEmptyState() {
  return { blocks: [], entities: [] };
}

function nextEntityKey(state) {
  return String(state.entities.length);
}

function makeEntity(type, data, mutability = 'mutable') {
  return { type, mutability, data };
}

function parseInlineMarkdown(line) {
  const tokens = [];
  let i = 0;
  while (i < line.length) {
    if (line.startsWith('{{tweet:', i)) {
      const end = line.indexOf('}}', i);
      if (end !== -1) {
        const id = line.slice(i + 8, end).trim();
        if (/^\d+$/.test(id)) {
          tokens.push({ kind: 'tweet', postId: id });
          i = end + 2;
          continue;
        }
      }
    }

    if (line[i] === '!' && line[i + 1] === '[') {
      const closeAlt = line.indexOf(']', i + 2);
      const openUrl = closeAlt !== -1 ? line.indexOf('(', closeAlt) : -1;
      const closeUrl = openUrl !== -1 ? line.indexOf(')', openUrl) : -1;
      if (closeAlt !== -1 && openUrl === closeAlt + 1 && closeUrl !== -1) {
        const alt = line.slice(i + 2, closeAlt);
        const url = line.slice(openUrl + 1, closeUrl);
        const statusMatch = url.match(TWEET_STATUS_RE);
        if (statusMatch) {
          tokens.push({ kind: 'tweet', postId: statusMatch[1] });
        } else if (url.startsWith('__ARTICLE_IMAGE__:')) {
          tokens.push({ kind: 'image_ref', ref: url.slice('__ARTICLE_IMAGE__:'.length), alt });
        } else {
          tokens.push({ kind: 'text', text: line.slice(i, closeUrl + 1) });
        }
        i = closeUrl + 1;
        continue;
      }
    }

    if (line[i] === '[') {
      const closeText = line.indexOf(']', i + 1);
      const openUrl = closeText !== -1 ? line.indexOf('(', closeText) : -1;
      const closeUrl = openUrl !== -1 ? line.indexOf(')', openUrl) : -1;
      if (closeText !== -1 && openUrl === closeText + 1 && closeUrl !== -1) {
        const text = line.slice(i + 1, closeText);
        const url = line.slice(openUrl + 1, closeUrl);
        tokens.push({ kind: 'link', text, url });
        i = closeUrl + 1;
        continue;
      }
    }

    if (line.startsWith('**', i)) {
      const end = line.indexOf('**', i + 2);
      if (end !== -1) {
        tokens.push({ kind: 'styled', text: line.slice(i + 2, end), style: 'bold' });
        i = end + 2;
        continue;
      }
    }

    if (line.startsWith('~~', i)) {
      const end = line.indexOf('~~', i + 2);
      if (end !== -1) {
        tokens.push({ kind: 'styled', text: line.slice(i + 2, end), style: 'strikethrough' });
        i = end + 2;
        continue;
      }
    }

    if (line[i] === '*' && line[i + 1] !== '*') {
      const end = line.indexOf('*', i + 1);
      if (end !== -1) {
        tokens.push({ kind: 'styled', text: line.slice(i + 1, end), style: 'italic' });
        i = end + 1;
        continue;
      }
    }

    const nextSpecial = (() => {
      const indices = ['[', '!', '*', '~', '{'].map((ch) => line.indexOf(ch, i)).filter((idx) => idx !== -1);
      return indices.length ? Math.min(...indices) : -1;
    })();
    const end = nextSpecial === -1 ? line.length : nextSpecial;
    if (end > i) tokens.push({ kind: 'text', text: line.slice(i, end) });
    i = end === i ? i + 1 : end;
  }
  return tokens;
}

function collectTags(text) {
  const mentions = [];
  const hashtags = [];
  const mentionRe = /@([\w_]{1,15})/g;
  const hashtagRe = /#([\w_]+)/g;
  let m;
  while ((m = mentionRe.exec(text)) !== null) {
    mentions.push({ from_index: m.index, to_index: m.index + m[0].length, text: m[0] });
  }
  while ((m = hashtagRe.exec(text)) !== null) {
    hashtags.push({ from_index: m.index, to_index: m.index + m[0].length, text: m[0] });
  }
  return { mentions, hashtags };
}

function appendTextBlock(state, text, type = 'unstyled', extra = {}) {
  const block = {
    text,
    type,
    inline_style_ranges: extra.inline_style_ranges || [],
    entity_ranges: extra.entity_ranges || [],
    data: extra.data || {},
  };
  const tags = collectTags(text);
  if (tags.mentions.length) block.data.mentions = tags.mentions;
  if (tags.hashtags.length) block.data.hashtags = tags.hashtags;
  state.blocks.push(block);
}

function appendInlineBlock(state, line, type = 'unstyled') {
  const tokens = parseInlineMarkdown(line);
  let text = '';
  const inline_style_ranges = [];
  const entity_ranges = [];
  let hasAtomic = false;

  for (const token of tokens) {
    if (token.kind === 'tweet') {
      appendPostEmbedBlock(state, { postId: token.postId });
      hasAtomic = true;
      continue;
    }
    if (token.kind === 'image_ref') {
      appendImageBlock(state, {
        ref: token.ref,
        caption: token.alt || '',
        media: token.media,
      });
      hasAtomic = true;
      continue;
    }

    const offset = text.length;
    if (token.kind === 'text') {
      text += token.text;
    } else if (token.kind === 'styled') {
      text += token.text;
      inline_style_ranges.push({ offset, length: token.text.length, style: token.style });
    } else if (token.kind === 'link') {
      const key = nextEntityKey(state);
      state.entities.push({
        key,
        value: makeEntity('link', { url: token.url }, 'mutable'),
      });
      text += token.text;
      entity_ranges.push({ offset, length: token.text.length, key: Number(key) });
    }
  }

  if (hasAtomic && !text) return;
  if (!text && type !== 'atomic') return;
  appendTextBlock(state, text, type, { inline_style_ranges, entity_ranges });
}

function appendImageBlock(state, { ref, caption = '', mediaId, mediaCategory, media }) {
  const key = nextEntityKey(state);
  const mediaItems = media
    ? [{ media_id: media.media_id, media_category: media.media_category }]
    : (mediaId ? [{ media_id: mediaId, media_category: mediaCategory || 'TWEET_IMAGE' }] : []);
  state.entities.push({
    key,
    value: makeEntity('image', {
      caption: caption || '',
      media_items: mediaItems,
    }, 'immutable'),
  });
  state.blocks.push({
    text: ' ',
    type: 'atomic',
    inline_style_ranges: [],
    entity_ranges: [{ offset: 0, length: 1, key: Number(key) }],
    data: ref ? { article_image_ref: ref } : {},
  });
}

function appendPostEmbedBlock(state, { postId }) {
  const key = nextEntityKey(state);
  state.entities.push({
    key,
    value: makeEntity('post', { post_id: String(postId) }, 'immutable'),
  });
  state.blocks.push({
    text: ' ',
    type: 'atomic',
    inline_style_ranges: [],
    entity_ranges: [{ offset: 0, length: 1, key: Number(key) }],
    data: {},
  });
}

function emptyDraftJsParagraph(text = '') {
  return {
    content_state: {
      blocks: [{ text, type: 'unstyled', inline_style_ranges: [], entity_ranges: [], data: {} }],
      entities: [],
    },
  };
}

function classifyLine(line) {
  const trimmed = line.trimEnd();
  if (!trimmed.trim()) return { kind: 'blank' };

  const tweetMacro = trimmed.trim().match(TWEET_MACRO_RE);
  if (tweetMacro) return { kind: 'tweet', postId: tweetMacro[1] };

  const header = trimmed.match(/^(#{1,3})\s+(.+)$/);
  if (header) {
    const level = header[1].length;
    const type = level === 1 ? 'header-one' : level === 2 ? 'header-two' : 'header-three';
    return { kind: 'block', type, text: header[2] };
  }

  const quote = trimmed.match(/^>\s?(.*)$/);
  if (quote) return { kind: 'block', type: 'blockquote', text: quote[1] };

  const unordered = trimmed.match(/^[-*]\s+(.+)$/);
  if (unordered) return { kind: 'block', type: 'unordered-list-item', text: unordered[1] };

  const ordered = trimmed.match(/^\d+\.\s+(.+)$/);
  if (ordered) return { kind: 'block', type: 'ordered-list-item', text: ordered[1] };

  const imageOnly = trimmed.match(/^!\[([^\]]*)\]\(([^)]+)\)$/);
  if (imageOnly) {
    const alt = imageOnly[1];
    const url = imageOnly[2];
    const statusMatch = url.match(TWEET_STATUS_RE);
    if (statusMatch) return { kind: 'tweet', postId: statusMatch[1] };
    if (url.startsWith('__ARTICLE_IMAGE__:')) {
      return { kind: 'image', ref: url.slice('__ARTICLE_IMAGE__:'.length), alt };
    }
    return { kind: 'image_skip', alt, url };
  }

  return { kind: 'block', type: 'unstyled', text: trimmed };
}

function applyImageMedia(state, imageMediaMap = {}) {
  for (const block of state.blocks) {
    const ref = block.data?.article_image_ref;
    if (!ref) continue;
    const media = imageMediaMap[ref];
    if (!media) continue;
    const range = block.entity_ranges?.[0];
    if (range == null) continue;
    const entity = state.entities.find((e) => Number(e.key) === range.key);
    if (!entity || entity.value.type !== 'image') continue;
    entity.value.data.media_items = [{
      media_id: media.media_id,
      media_category: media.media_category,
    }];
    delete block.data.article_image_ref;
  }
}

function markdownToDraftJs(markdown, { imageMediaMap } = {}) {
  const state = createEmptyState();
  const lines = String(markdown || '').replace(/\r\n/g, '\n').split('\n');

  for (const line of lines) {
    const info = classifyLine(line);
    if (info.kind === 'blank') continue;
    if (info.kind === 'tweet') {
      appendPostEmbedBlock(state, { postId: info.postId });
      continue;
    }
    if (info.kind === 'image') {
      appendImageBlock(state, {
        ref: info.ref,
        caption: info.alt,
        media: imageMediaMap?.[info.ref],
      });
      continue;
    }
    if (info.kind === 'image_skip') {
      appendTextBlock(state, info.alt ? `[${info.alt}]` : '[image skipped]', 'unstyled');
      continue;
    }
    appendInlineBlock(state, info.text, info.type);
  }

  if (state.blocks.length === 0) {
    appendTextBlock(state, '', 'unstyled');
  }

  applyImageMedia(state, imageMediaMap);

  return {
    content_state: {
      blocks: state.blocks,
      entities: state.entities,
    },
  };
}

module.exports = {
  markdownToDraftJs,
  emptyDraftJsParagraph,
  appendImageBlock,
  appendPostEmbedBlock,
  parseInlineMarkdown,
  classifyLine,
  TWEET_STATUS_RE,
};
