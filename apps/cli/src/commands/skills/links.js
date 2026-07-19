'use strict';

const {
  clearSnapshotForExtraDir,
  ensureRuntimePaths,
  fs,
  path,
  print,
  setConfigValue,
  snapshotExtraDir,
} = require('../../command-context');

async function handleLink({ config, flags, positionals }) {
const target = positionals[2] || flags.path;
      if (!target) {
        throw new Error('用法: `js-eyes skills link <path>`（path 可以指向单个 skill 目录或包含多个 skill 的父目录）');
      }
      const absTarget = path.resolve(String(target));
      if (!fs.existsSync(absTarget)) {
        throw new Error(`路径不存在: ${absTarget}`);
      }
      const stat = fs.statSync(absTarget);
      if (!stat.isDirectory()) {
        throw new Error(`路径不是目录: ${absTarget}`);
      }
      const existing = Array.isArray(config.extraSkillDirs) ? config.extraSkillDirs.slice() : [];
      const normalized = existing.map((entry) => path.resolve(String(entry)));
      if (normalized.includes(absTarget)) {
        print(`Already linked: ${absTarget}`);
        return;
      }
      existing.push(absTarget);
      setConfigValue('extraSkillDirs', existing);
      print(`Linked ${absTarget}`);
      const verifyEnabled = Boolean(
        config.security && config.security.verifyExtraSkillDirs,
      );
      if (verifyEnabled) {
        try {
          const { snapshot } = snapshotExtraDir(absTarget);
          const fileCount = Object.keys(snapshot.files || {}).length;
          print(`Integrity snapshot recorded (${fileCount} files).`);
        } catch (error) {
          print(`Integrity snapshot FAILED: ${error.message}`);
        }
      }
      print('If the OpenClaw plugin is running, it will hot-load new skills within ~300ms via the config watcher.');
      return;
}

async function handleUnlink({ config, flags, positionals }) {
const target = positionals[2] || flags.path;
      if (!target) {
        throw new Error('用法: `js-eyes skills unlink <path>`');
      }
      const absTarget = path.resolve(String(target));
      const existing = Array.isArray(config.extraSkillDirs) ? config.extraSkillDirs.slice() : [];
      const remaining = existing.filter((entry) => path.resolve(String(entry)) !== absTarget);
      if (remaining.length === existing.length) {
        print(`Not linked: ${absTarget}`);
        return;
      }
      setConfigValue('extraSkillDirs', remaining);
      clearSnapshotForExtraDir(absTarget);
      print(`Unlinked ${absTarget}`);
      print('If the OpenClaw plugin is running, the affected skills will be disposed within ~300ms via the config watcher.');
      return;
}

async function handleRelink({ config, flags, positionals }) {
const target = positionals[2] || flags.path;
      if (!target) {
        throw new Error('用法: `js-eyes skills relink <path>`');
      }
      const absTarget = path.resolve(String(target));
      if (!fs.existsSync(absTarget)) {
        throw new Error(`路径不存在: ${absTarget}`);
      }
      const stat = fs.statSync(absTarget);
      if (!stat.isDirectory()) {
        throw new Error(`路径不是目录: ${absTarget}`);
      }
      const existing = Array.isArray(config.extraSkillDirs) ? config.extraSkillDirs.slice() : [];
      const normalized = existing.map((entry) => path.resolve(String(entry)));
      if (!normalized.includes(absTarget)) {
        existing.push(absTarget);
        setConfigValue('extraSkillDirs', existing);
        print(`Linked ${absTarget}`);
      } else {
        print(`Re-snapshotting ${absTarget}`);
      }
      try {
        const { snapshot } = snapshotExtraDir(absTarget);
        const fileCount = Object.keys(snapshot.files || {}).length;
        print(`Integrity snapshot refreshed (${fileCount} files).`);
      } catch (error) {
        print(`Integrity snapshot FAILED: ${error.message}`);
        process.exitCode = 2;
        return;
      }
      const verifyEnabled = Boolean(
        config.security && config.security.verifyExtraSkillDirs,
      );
      if (!verifyEnabled) {
        print('Note: security.verifyExtraSkillDirs is currently false — the snapshot is stored but not enforced.');
        print('      Enable via: js-eyes config set security.verifyExtraSkillDirs true');
      }
      print('If the OpenClaw plugin is running, it will re-scan within ~300ms via the config watcher.');
      return;
}

async function handleReload({ config }) {
const configFile = ensureRuntimePaths().configFile;
      if (!fs.existsSync(configFile)) {
        // Create an empty (valid) config so the watcher has something to notice.
        setConfigValue('skillsEnabled', (config && config.skillsEnabled) || {});
      } else {
        // Touch mtime to trigger the chokidar watcher without changing content.
        const now = new Date();
        try {
          fs.utimesSync(configFile, now, now);
        } catch (error) {
          throw new Error(`无法更新 ${configFile}: ${error.message}`);
        }
      }
      print(`Touched ${configFile}`);
      print('If the OpenClaw plugin is running, it will reload skills within ~300ms.');
      return;
}

module.exports = { handleLink, handleUnlink, handleRelink, handleReload };
