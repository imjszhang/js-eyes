'use strict';

function parseVersion(value) {
  const match = String(value || '').trim().match(/^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:[-+].*)?$/);
  return match ? [Number(match[1]), Number(match[2] || 0), Number(match[3] || 0)] : null;
}

function compareVersions(left, right) {
  const a = parseVersion(left);
  const b = parseVersion(right);
  if (!a || !b) return null;
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] < b[index] ? -1 : 1;
  }
  return 0;
}

function satisfiesComparator(version, comparator) {
  const value = comparator.trim();
  if (!value || value === '*') return true;
  if (value.startsWith('^')) {
    const base = value.slice(1);
    const parsed = parseVersion(base);
    const current = parseVersion(version);
    if (!parsed || !current) return false;
    if (compareVersions(version, base) < 0) return false;
    const upper = parsed[0] > 0
      ? `${parsed[0] + 1}.0.0`
      : parsed[1] > 0
        ? `0.${parsed[1] + 1}.0`
        : `0.0.${parsed[2] + 1}`;
    return compareVersions(version, upper) < 0;
  }
  const match = value.match(/^(>=|<=|>|<|=)?\s*(\d+(?:\.\d+){0,2}(?:[-+][^\s]+)?)$/);
  if (!match) return false;
  const comparison = compareVersions(version, match[2]);
  if (comparison == null) return false;
  switch (match[1] || '=') {
    case '>=': return comparison >= 0;
    case '<=': return comparison <= 0;
    case '>': return comparison > 0;
    case '<': return comparison < 0;
    default: return comparison === 0;
  }
}

function satisfiesRange(version, range) {
  if (!range || range === '*') return true;
  return String(range).trim().split(/\s+/).every((part) => satisfiesComparator(version, part));
}

function checkCompatibility(requirements = {}, host = {}) {
  const mapping = [
    ['jsEyes', host.jsEyes],
    ['contractApi', host.contractApi],
    ['runtimeApi', host.runtimeApi],
    ['browserProtocol', host.browserProtocol],
    ['node', host.node],
  ];
  const failures = [];
  for (const [name, actual] of mapping) {
    const range = requirements[name];
    if (!range) continue;
    if (!actual || !satisfiesRange(actual, range)) failures.push({ name, required: range, actual: actual || null });
  }
  return Object.freeze({ compatible: failures.length === 0, failures: Object.freeze(failures) });
}

module.exports = { checkCompatibility, compareVersions, parseVersion, satisfiesRange };
