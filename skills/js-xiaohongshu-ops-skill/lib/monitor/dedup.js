'use strict';

/**
 * monitor dedup（xhs 版） - 纯函数，无 I/O
 */

const crypto = require('crypto');

function hashContent(text) {
  return crypto.createHash('sha256').update(String(text || '')).digest('hex').slice(0, 16);
}

function isNewNote(note, hash, knownIds, knownHashes, method = 'id_and_hash') {
  switch (method) {
    case 'id_only': return !knownIds.has(note.noteId);
    case 'hash_only': return !knownHashes.has(hash);
    case 'id_and_hash':
    default:
      return !knownIds.has(note.noteId) && !knownHashes.has(hash);
  }
}

function partitionNewNotes(fetched, state, method = 'id_and_hash', nowIso = new Date().toISOString()) {
  const knownIds = new Set((state.notes || []).map((n) => n.noteId));
  const knownHashes = new Set((state.notes || []).map((n) => n.hash).filter(Boolean));
  const fresh = [];
  const seen = [];

  for (const note of fetched || []) {
    if (!note || !note.noteId) continue;
    const hash = hashContent(note.title || note.content || note.description || '');
    if (isNewNote(note, hash, knownIds, knownHashes, method)) {
      fresh.push({
        note,
        record: {
          noteId: note.noteId,
          hash,
          publishTime: note.publishTime || note.create_time || null,
          discoveredAt: nowIso,
        },
      });
      knownIds.add(note.noteId);
      knownHashes.add(hash);
    } else {
      seen.push(note);
    }
  }
  return { fresh, seen };
}

function pruneExpired(records, historyDays = 30, now = Date.now()) {
  const days = historyDays > 0 ? historyDays : 30;
  const cutoff = now - days * 86400000;
  return (records || []).filter((r) => {
    if (!r || !r.discoveredAt) return true;
    const t = Date.parse(r.discoveredAt);
    if (Number.isNaN(t)) return true;
    return t > cutoff;
  });
}

module.exports = { hashContent, isNewNote, partitionNewNotes, pruneExpired };
