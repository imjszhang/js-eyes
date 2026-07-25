'use strict';

/**
 * Static skill discovery helpers used by SkillRegistry.
 * These do not depend on the registry factory closure.
 */

const fs = require('fs');
const path = require('path');
const { computeSkillSourceDigest } = require('@js-eyes/skill-contract');

function isBundledPrimarySkill(skill) {
  if (!skill || skill.source !== 'primary') return false;
  const sourcePath = skill.sourcePath || '';
  if (!sourcePath || path.basename(sourcePath) !== 'skills') return false;
  const bundleRoot = path.dirname(sourcePath);
  return (
    fs.existsSync(path.join(bundleRoot, 'package.json'))
    && fs.existsSync(path.join(bundleRoot, 'skills'))
  );
}

/**
 * 计算 skillDir 内"驱动热更"的关键文件的指纹（mtime 组合）。
 * 任一文件缺失按 0 处理；出错时退化为空字符串（此时 reload 语义保守：会认为"没变"）。
 * 只用 mtime 是因为 chokidar 已经有 awaitWriteFinish 保护；要更强隔离可改 sha1。
 */
function computeSkillFingerprint(skillDir) {
  if (!skillDir) return '';
  try {
    return computeSkillSourceDigest(skillDir, { ignoredDirs: ['.git', 'node_modules'] });
  } catch {
    return '';
  }
}

/**
 * 深度清理 require.cache：删除所有位于 skillDir 下（排除 node_modules）
 * 的已缓存模块，避免热加载时沿用旧模块实例。
 */
function purgeRequireCacheFor(skillDir) {
  if (!skillDir) return 0;
  let normalized;
  try {
    normalized = fs.realpathSync(skillDir);
  } catch (_) {
    normalized = path.resolve(skillDir);
  }
  const prefix = normalized.endsWith(path.sep) ? normalized : normalized + path.sep;
  let purged = 0;
  for (const key of Object.keys(require.cache)) {
    if (!key) continue;
    if (key === normalized || key.startsWith(prefix)) {
      if (key.includes(`${path.sep}node_modules${path.sep}`)) continue;
      delete require.cache[key];
      purged++;
    }
  }
  return purged;
}

module.exports = {
  isBundledPrimarySkill,
  computeSkillFingerprint,
  purgeRequireCacheFor,
};
