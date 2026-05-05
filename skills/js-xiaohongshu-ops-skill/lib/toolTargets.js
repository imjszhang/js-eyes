'use strict';

/**
 * 把 xhs 工具参数翻译成"理想的浏览器 URL"（INTERACTIVE 档位 navigate / READ 档位 createUrl 兜底）。
 */

const {
  buildNoteUrl,
  buildSearchUrl,
  buildUserUrl,
  buildHomeUrl,
  processXiaohongshuUrl,
  extractNoteIdFromUrl,
} = require('./xhsUtils');

function noteUrl(args) {
  if (!args) return buildHomeUrl();
  if (args.url) {
    return processXiaohongshuUrl(String(args.url));
  }
  const id = args.noteId || args.id;
  if (id) {
    const params = {};
    if (args.xsec_token) params.xsec_token = args.xsec_token;
    if (args.xsec_source) params.xsec_source = args.xsec_source;
    return buildNoteUrl(id, params);
  }
  return buildHomeUrl();
}

function searchUrl(args) {
  return buildSearchUrl(args || {});
}

function userUrl(args) {
  if (!args) return buildHomeUrl();
  const id = args.userId || args.id;
  if (id) return buildUserUrl(id);
  if (args.url) return processXiaohongshuUrl(String(args.url));
  return buildHomeUrl();
}

function homeUrl() {
  return buildHomeUrl();
}

function noteIdFromInput(input) {
  if (!input) return null;
  const s = String(input).trim();
  if (/^[A-Za-z0-9_-]{12,32}$/.test(s)) return s;
  return extractNoteIdFromUrl(s);
}

module.exports = {
  noteUrl,
  searchUrl,
  userUrl,
  homeUrl,
  noteIdFromInput,
};
