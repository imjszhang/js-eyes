'use strict';

const _warnedFlags = new Set();

function warnDeprecatedFlagsOnce(deprecatedFlags){
  if (!Array.isArray(deprecatedFlags) || deprecatedFlags.length === 0) return;
  const fresh = deprecatedFlags.filter((f) => !_warnedFlags.has(f));
  if (fresh.length === 0) return;
  for (const f of fresh) _warnedFlags.add(f);
  const msg = '[js-x-ops-skill] deprecated visual flag(s) ignored (post-2.7.0 HTML pivot): '
    + fresh.join(', ')
    + '. See @js-eyes/visual-bridge-kit parseVisualFlags / SKILL.md.';
  try { process.stderr.write(msg + '\n'); } catch (_) {}
}

function resetWarnedFlagsForTesting(){
  _warnedFlags.clear();
}

module.exports = {
  warnDeprecatedFlagsOnce,
  resetWarnedFlagsForTesting,
};
