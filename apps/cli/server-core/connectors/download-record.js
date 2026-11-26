'use strict';

function hostFromUrl(url) {
  try {
    return new URL(String(url || '')).hostname || '';
  } catch {
    return '';
  }
}

function basenameOf(filePath) {
  const raw = String(filePath || '');
  const parts = raw.split(/[/\\]/);
  return parts[parts.length - 1] || '';
}

function publicDownload(item = {}) {
  return {
    id: String(item.id || ''),
    basename: basenameOf(item.basename || item.filename || item.path || ''),
    state: item.state || 'in_progress',
    bytes: Number(item.bytes || item.fileSize || 0) || 0,
    mime: item.mime || '',
    urlHost: item.urlHost || hostFromUrl(item.url),
  };
}

function publicDownloadList(items) {
  return { downloads: (Array.isArray(items) ? items : []).map(publicDownload) };
}

module.exports = {
  basenameOf,
  hostFromUrl,
  publicDownload,
  publicDownloadList,
};
