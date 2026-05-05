#!/usr/bin/env node
'use strict';

/**
 * v3.1 PR-C1 probe 快照 diff
 *
 * 对比两个快照，输出 selector / 字段命中变化。重点：
 *   - 哪个 probe 从 ok → fail（或反过来）
 *   - 每个 probe 的 data 顶层 key 是否新增 / 丢失
 *   - 数值字段（命中数 / count）变化
 *
 * 用法：
 *   node scripts/_dev/diff-snapshot.js <oldSnapshot> <newSnapshot>
 */

const fs = require('fs');

function loadSnapshot(p) {
  const raw = fs.readFileSync(p, 'utf8');
  return JSON.parse(raw);
}

function diffKeys(oldObj, newObj) {
  const oldKeys = new Set(oldObj && typeof oldObj === 'object' ? Object.keys(oldObj) : []);
  const newKeys = new Set(newObj && typeof newObj === 'object' ? Object.keys(newObj) : []);
  const added = [...newKeys].filter((k) => !oldKeys.has(k));
  const removed = [...oldKeys].filter((k) => !newKeys.has(k));
  return { added, removed };
}

function shallowNumericDiff(oldObj, newObj) {
  if (!oldObj || !newObj || typeof oldObj !== 'object' || typeof newObj !== 'object') return [];
  const out = [];
  for (const k of Object.keys(newObj)) {
    if (typeof newObj[k] === 'number' && typeof oldObj[k] === 'number' && newObj[k] !== oldObj[k]) {
      out.push({ key: k, old: oldObj[k], new: newObj[k], delta: newObj[k] - oldObj[k] });
    }
    if (Array.isArray(newObj[k]) && Array.isArray(oldObj[k]) && newObj[k].length !== oldObj[k].length) {
      out.push({ key: k, oldLen: oldObj[k].length, newLen: newObj[k].length, delta: newObj[k].length - oldObj[k].length });
    }
  }
  return out;
}

(function main() {
  const argv = process.argv.slice(2);
  if (argv.length < 2) {
    console.error('用法: node scripts/_dev/diff-snapshot.js <oldSnapshot> <newSnapshot>');
    process.exit(2);
  }
  const oldSnap = loadSnapshot(argv[0]);
  const newSnap = loadSnapshot(argv[1]);

  const oldByName = new Map((oldSnap.probes || []).map((p) => [p.name, p]));
  const newByName = new Map((newSnap.probes || []).map((p) => [p.name, p]));

  const allNames = new Set([...oldByName.keys(), ...newByName.keys()]);
  const probesDiff = [];
  for (const name of allNames) {
    const a = oldByName.get(name) || null;
    const b = newByName.get(name) || null;
    const entry = { name };
    if (!a) { entry.status = 'added'; entry.new = b; probesDiff.push(entry); continue; }
    if (!b) { entry.status = 'removed'; entry.old = a; probesDiff.push(entry); continue; }
    if (!!a.ok !== !!b.ok) entry.okFlip = `${a.ok} → ${b.ok}`;
    const keyDiff = diffKeys(a.data, b.data);
    if (keyDiff.added.length || keyDiff.removed.length) entry.dataKeys = keyDiff;
    const numDiff = shallowNumericDiff(a.data, b.data);
    if (numDiff.length) entry.numericChanges = numDiff;
    if (entry.okFlip || entry.dataKeys || entry.numericChanges) {
      entry.status = 'changed';
      probesDiff.push(entry);
    }
  }

  const summary = {
    old: { capturedAt: oldSnap.capturedAt, okCount: oldSnap.okCount, failCount: oldSnap.failCount },
    new: { capturedAt: newSnap.capturedAt, okCount: newSnap.okCount, failCount: newSnap.failCount },
    okCountDelta: (newSnap.okCount || 0) - (oldSnap.okCount || 0),
    changedProbes: probesDiff.length,
    diffs: probesDiff,
  };
  process.stdout.write(JSON.stringify(summary, null, 2) + '\n');
  process.exit(probesDiff.length > 0 ? 1 : 0);
})();
