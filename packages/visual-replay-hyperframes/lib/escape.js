'use strict';

// HTML/JS 转义工具

function escapeHtml(s){
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeJsString(s){
  return JSON.stringify(s == null ? '' : String(s));
}

module.exports = { escapeHtml, escapeJsString };
