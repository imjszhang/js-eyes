'use strict';

/**
 * 构建可发布到 npm 的 `js-eyes` 单体包。
 *
 * 本仓库采用 monorepo，CLI 在运行时 require 了 `@js-eyes/*` 工作区子包。
 * 直接 npm publish 需要预先注册 `@js-eyes` 组织，这里选择将子包源码
 * 内联到 `dist/js-eyes/src/vendor/<name>/`，并重写 require 为相对路径，
 * 最终上传单一 `js-eyes` 包，使用户安装体验与 2.1.x 时代保持一致。
 */

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const CLI_ROOT = path.join(REPO_ROOT, 'apps', 'cli');
const PACKAGES_ROOT = path.join(REPO_ROOT, 'packages');
const DIST_ROOT = path.join(REPO_ROOT, 'dist', 'js-eyes');

// 传递闭包：CLI 运行时会实际加载的子包（skill-recording 未被 CLI 使用，忽略）
const BUNDLED_PACKAGES = ['protocol', 'runtime-paths', 'config', 'client-sdk', 'server-core'];

function rmrf(target) {
  if (fs.existsSync(target)) {
    fs.rmSync(target, { recursive: true, force: true });
  }
}

function mkdirp(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function copyFile(src, dst) {
  mkdirp(path.dirname(dst));
  fs.copyFileSync(src, dst);
}

function copyTree(srcDir, dstDir) {
  mkdirp(dstDir);
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    const src = path.join(srcDir, entry.name);
    const dst = path.join(dstDir, entry.name);
    if (entry.isDirectory()) copyTree(src, dst);
    else fs.copyFileSync(src, dst);
  }
}

function listJsFiles(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listJsFiles(p));
    else if (entry.name.endsWith('.js')) out.push(p);
  }
  return out;
}

function toPosixRelative(fromFileDir, toPath) {
  let rel = path.relative(fromFileDir, toPath).split(path.sep).join('/');
  if (!rel.startsWith('.')) rel = './' + rel;
  return rel;
}

function rewriteRequires(file, vendorDir) {
  const original = fs.readFileSync(file, 'utf8');
  const fromDir = path.dirname(file);
  const re = /require\(\s*(['"])@js-eyes\/([^'"]+?)\1\s*\)/g;
  const next = original.replace(re, (_match, quote, spec) => {
    const [name, ...rest] = spec.split('/');
    const sub = rest.join('/');
    const target = sub
      ? path.join(vendorDir, name, sub)
      : path.join(vendorDir, name);
    const rel = toPosixRelative(fromDir, target);
    return `require(${quote}${rel}${quote})`;
  });
  if (next !== original) {
    fs.writeFileSync(file, next);
  }
}

function rewriteReadPackageVersion(cliFile) {
  // CLI 内 readPackageVersion 通过模板字符串 require 子包 package.json，
  // 打包后子包 package.json 不在 node_modules 层级，需改为读取 js-eyes 自身版本。
  const src = fs.readFileSync(cliFile, 'utf8');
  const marker = 'function readPackageVersion(specifier) {';
  const start = src.indexOf(marker);
  if (start < 0) return;

  const braceStart = src.indexOf('{', start);
  let depth = 0;
  let end = braceStart;
  for (; end < src.length; end++) {
    if (src[end] === '{') depth++;
    else if (src[end] === '}') {
      depth--;
      if (depth === 0) break;
    }
  }
  const replacement =
    'function readPackageVersion(_specifier) {\n' +
    '  return pkg.version;\n' +
    '}';
  fs.writeFileSync(cliFile, src.slice(0, start) + replacement + src.slice(end + 1));
}

function buildManifest(version) {
  return {
    name: 'js-eyes',
    version,
    description:
      'JS Eyes user CLI for local server management, diagnostics, and extension downloads',
    main: 'src/cli.js',
    bin: { 'js-eyes': 'bin/js-eyes.js' },
    files: ['bin', 'src', 'README.md', 'LICENSE'],
    engines: { node: '>=22.0.0' },
    license: 'MIT',
    repository: {
      type: 'git',
      url: 'git+https://github.com/imjszhang/JS-Eyes.git',
    },
    homepage: 'https://github.com/imjszhang/JS-Eyes#readme',
    bugs: { url: 'https://github.com/imjszhang/JS-Eyes/issues' },
    keywords: ['js-eyes', 'browser-automation', 'ai', 'cli', 'skills', 'openclaw'],
    dependencies: {
      ws: '^8.19.0',
    },
  };
}

function log(msg) {
  console.log(`[publish-bundle] ${msg}`);
}

async function bundle() {
  const rootPkg = JSON.parse(
    fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8')
  );
  const version = rootPkg.version;
  log(`version: ${version}`);
  log(`dist: ${DIST_ROOT}`);

  rmrf(DIST_ROOT);
  mkdirp(DIST_ROOT);

  copyTree(path.join(CLI_ROOT, 'bin'), path.join(DIST_ROOT, 'bin'));
  copyTree(path.join(CLI_ROOT, 'src'), path.join(DIST_ROOT, 'src'));

  const vendorDir = path.join(DIST_ROOT, 'src', 'vendor');
  mkdirp(vendorDir);

  for (const name of BUNDLED_PACKAGES) {
    const srcPkgDir = path.join(PACKAGES_ROOT, name);
    const manifest = JSON.parse(
      fs.readFileSync(path.join(srcPkgDir, 'package.json'), 'utf8')
    );
    const files = manifest.files && manifest.files.length ? manifest.files : ['index.js'];
    const dstPkgDir = path.join(vendorDir, name);
    mkdirp(dstPkgDir);

    for (const raw of files) {
      const clean = raw.replace(/\/$/, '');
      const src = path.join(srcPkgDir, clean);
      const dst = path.join(dstPkgDir, clean);
      if (!fs.existsSync(src)) {
        log(`  warn: ${name} missing file ${raw}`);
        continue;
      }
      if (fs.statSync(src).isDirectory()) copyTree(src, dst);
      else copyFile(src, dst);
    }

    // 部分子包在运行时 require('./package.json') 读取自身版本，需要保留。
    // 写入精简版，去掉工作区 @js-eyes/* 依赖以免误导。
    const vendorManifest = {
      name: manifest.name,
      version: manifest.version,
      main: manifest.main || 'index.js',
      license: manifest.license || 'MIT',
      private: true,
    };
    fs.writeFileSync(
      path.join(dstPkgDir, 'package.json'),
      JSON.stringify(vendorManifest, null, 2) + '\n'
    );
    log(`  vendored ${name}`);
  }

  const jsFiles = [
    ...listJsFiles(path.join(DIST_ROOT, 'src')),
    ...listJsFiles(path.join(DIST_ROOT, 'bin')),
  ];
  for (const f of jsFiles) rewriteRequires(f, vendorDir);
  log(`  rewrote requires in ${jsFiles.length} files`);

  rewriteReadPackageVersion(path.join(DIST_ROOT, 'src', 'cli.js'));

  fs.writeFileSync(
    path.join(DIST_ROOT, 'package.json'),
    JSON.stringify(buildManifest(version), null, 2) + '\n'
  );

  for (const file of ['README.md', 'LICENSE']) {
    const src = path.join(REPO_ROOT, file);
    if (fs.existsSync(src)) copyFile(src, path.join(DIST_ROOT, file));
  }

  // 确保 CLI 入口可执行
  try {
    fs.chmodSync(path.join(DIST_ROOT, 'bin', 'js-eyes.js'), 0o755);
  } catch {
    // ignore on platforms without chmod
  }

  log('done.');
  return { version, distDir: DIST_ROOT };
}

if (require.main === module) {
  bundle().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = { bundle, DIST_ROOT, BUNDLED_PACKAGES };
