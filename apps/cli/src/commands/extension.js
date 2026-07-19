'use strict';

const {
  RELEASE_BASE_URL,
  ensureRuntimePaths,
  fs,
  path,
  pkg,
  print,
} = require('../command-context');

function resolveExtensionAsset(browser, version = pkg.version) {
  if (browser !== 'chrome' && browser !== 'firefox') {
    throw new Error(`不支持的扩展类型: ${browser}`);
  }

  const filename = browser === 'chrome'
    ? `js-eyes-chrome-v${version}.zip`
    : `js-eyes-firefox-v${version}.xpi`;

  return {
    browser,
    version,
    filename,
    url: `${RELEASE_BASE_URL}/v${version}/${filename}`,
  };
}

async function commandExtension(positionals, flags) {
  const action = positionals[1];
  const browser = positionals[2];

  if (action !== 'download' || !browser) {
    throw new Error('用法: `js-eyes extension download <chrome|firefox> [--output /path/file]`');
  }

  const paths = ensureRuntimePaths();
  const asset = resolveExtensionAsset(browser);
  const outputPath = flags.output
    ? path.resolve(flags.output)
    : path.join(paths.downloadsDir, asset.filename);

  const response = await fetch(asset.url);
  if (!response.ok) {
    throw new Error(`下载失败: HTTP ${response.status} (${asset.url})`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  fs.writeFileSync(outputPath, buffer);

  print(`Downloaded ${browser} extension`);
  print(`Version: ${asset.version}`);
  print(`Source: ${asset.url}`);
  print(`Saved to: ${outputPath}`);
}

module.exports = { commandExtension, resolveExtensionAsset };
