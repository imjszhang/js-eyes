'use strict';

/**
 * monitor format（xhs 版） - note → 各通知渠道 payload
 *
 * 输入 note schema（参考 bridges/note-bridge.js / search-bridge.js）：
 *   { noteId, title, description?, content?, image_urls?[], url, author.{nickname,userId}?,
 *     stats.{likes,comments,collects}?, publishTime?, source: 'dom'|'api' }
 */

function truncate(text, maxLen) {
  const t = String(text || '');
  if (t.length <= maxLen) return { text: t, truncated: false };
  return { text: t.slice(0, maxLen), truncated: true };
}

function noteUrlOf(note) {
  if (note && note.url) return note.url;
  if (note && note.noteId) {
    return 'https://www.xiaohongshu.com/explore/' + note.noteId
      + (note.xsec_token ? `?xsec_token=${encodeURIComponent(note.xsec_token)}` : '');
  }
  return '';
}

function authorOf(note) {
  const a = (note && note.author) || {};
  return {
    nickname: a.nickname || a.name || (note && note.user && note.user.nickname) || '',
    userId: a.userId || a.user_id || (note && note.user && note.user.userId) || '',
  };
}

function snippetOf(note, maxLen) {
  const raw = note && (note.content || note.description || note.title) || '';
  return truncate(raw, maxLen);
}

function formatConsole(note, options = {}) {
  const maxLen = options.summaryLength || 100;
  const { text, truncated } = snippetOf(note, maxLen);
  const author = authorOf(note);
  const url = noteUrlOf(note);
  const lines = [
    `[monitor] 🌸 ${author.nickname ? '@' + author.nickname : '(unknown)'}`,
    `  ${note.title || ''}`,
    `  ${text}${truncated ? '...' : ''}`,
    `  ${url}`,
  ];
  if (note.publishTime) lines.push(`  publishTime: ${note.publishTime}`);
  return lines.join('\n');
}

function formatFeishu(note, options = {}) {
  const maxLen = options.summaryLength || 100;
  const { text, truncated } = snippetOf(note, maxLen);
  const author = authorOf(note);
  const url = noteUrlOf(note);
  const header = `🌸 小红书新笔记${author.nickname ? ' @' + author.nickname : ''}`;
  const body = [
    `**${author.nickname || '(unknown)'}**`,
    '',
    note.title ? `### ${note.title}` : '',
    `${text}${truncated ? '...' : ''}`,
    '',
    `[查看原文](${url})`,
  ].filter(Boolean);
  if (note.publishTime) body.push(`⏰ ${note.publishTime}`);
  return {
    msg_type: 'interactive',
    card: {
      config: { wide_screen_mode: true },
      header: { title: { tag: 'plain_text', content: header }, template: 'red' },
      elements: [{ tag: 'div', text: { tag: 'lark_md', content: body.join('\n') } }],
    },
  };
}

function formatDiscord(note, options = {}) {
  const maxLen = options.summaryLength || 280;
  const { text, truncated } = snippetOf(note, maxLen);
  const author = authorOf(note);
  const url = noteUrlOf(note);
  const stats = (note && note.stats) || {};
  return {
    embeds: [
      {
        title: note.title || '小红书新笔记',
        description: `${text}${truncated ? '...' : ''}`,
        url,
        author: { name: author.nickname || '(unknown)' },
        timestamp: note.publishTime || undefined,
        fields: [
          { name: 'likes', value: String(stats.likes || 0), inline: true },
          { name: 'comments', value: String(stats.comments || 0), inline: true },
          { name: 'collects', value: String(stats.collects || 0), inline: true },
        ],
      },
    ],
  };
}

function formatGeneric(note, options = {}) {
  const maxLen = options.summaryLength || 280;
  const { text, truncated } = snippetOf(note, maxLen);
  const author = authorOf(note);
  return {
    event: 'xhs.new_note',
    timestamp: new Date().toISOString(),
    note: {
      noteId: note.noteId,
      url: noteUrlOf(note),
      title: note.title || null,
      contentSnippet: `${text}${truncated ? '...' : ''}`,
      contentTruncated: truncated,
      publishTime: note.publishTime || null,
      author: { nickname: author.nickname, userId: author.userId },
      stats: note.stats || {},
    },
  };
}

module.exports = {
  formatConsole,
  formatFeishu,
  formatDiscord,
  formatGeneric,
  noteUrlOf,
  truncate,
};
