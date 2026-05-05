'use strict';

// 与 js-x-ops-skill 同形态：把 parseVisualFlags 返回的 deprecatedFlags 数组
// 一次性 stderr 告警（同 flag 不重复）。
const _warnedFlags = new Set();

function warnDeprecatedFlagsOnce(deprecatedFlags) {
  if (!Array.isArray(deprecatedFlags) || deprecatedFlags.length === 0) return;
  const fresh = deprecatedFlags.filter((f) => !_warnedFlags.has(f));
  if (fresh.length === 0) return;
  for (const f of fresh) _warnedFlags.add(f);
  const msg = '[js-xiaohongshu-ops-skill] deprecated visual flag(s) ignored: '
    + fresh.join(', ')
    + '. See @js-eyes/visual-bridge-kit parseVisualFlags / SKILL.md.';
  try { process.stderr.write(msg + '\n'); } catch (_) {}
}

function resetWarnedFlagsForTesting() {
  _warnedFlags.clear();
}

module.exports = {
  warnDeprecatedFlagsOnce,
  resetWarnedFlagsForTesting,
};
