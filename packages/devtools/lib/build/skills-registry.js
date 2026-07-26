'use strict';

const os = require('os');
const { execFileSync } = require('child_process');
const {
  PROJECT_ROOT,
  SITE_OUT_DIR,
  SITE_URL,
  SKILLS_DIR,
  SUB_SKILL_EXCLUDE,
  ensureDir,
  execSync,
  formatSize,
  fs,
  getVersion,
  hashFile,
  path,
  writeShaSidecar,
} = require('./context');
const { loadSkillManifest } = require('@js-eyes/skill-contract');
const { createZipArchive } = require('./zip-archive');

function parseSkillFrontmatter(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return null;

  const lines = match[1].split(/\r?\n/);
  const root = {};
  const stack = [{ obj: root, indent: -1 }];

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    if (!raw.trim() || raw.trim().startsWith('#')) continue;

    const indent = raw.search(/\S/);
    const trimmed = raw.trim();

    while (stack.length > 1 && indent < stack[stack.length - 1].indent) {
      stack.pop();
    }
    const parent = stack[stack.length - 1].obj;

    if (trimmed.startsWith('- ')) {
      const val = parseYamlValue(trimmed.slice(2).trim());
      if (Array.isArray(parent)) parent.push(val);
      continue;
    }

    const colonIdx = trimmed.indexOf(':');
    if (colonIdx === -1) continue;

    const key = trimmed.slice(0, colonIdx).trim();
    const valPart = trimmed.slice(colonIdx + 1).trim();

    if (valPart === '') {
      let nextLine = '';
      for (let j = i + 1; j < lines.length; j++) {
        if (lines[j].trim()) {
          nextLine = lines[j];
          break;
        }
      }
      const nextTrimmed = nextLine.trim();
      const nextIndent = nextLine.search(/\S/);
      if (nextTrimmed.startsWith('- ')) {
        parent[key] = [];
        stack.push({ obj: parent[key], indent: nextIndent >= 0 ? nextIndent : indent + 2 });
      } else {
        parent[key] = {};
        stack.push({ obj: parent[key], indent: nextIndent >= 0 ? nextIndent : indent + 2 });
      }
    } else {
      parent[key] = parseYamlValue(valPart);
    }
  }

  return root;
}

function parseYamlValue(str) {
  if (str === 'true') return true;
  if (str === 'false') return false;
  if (str === 'null') return null;
  if (/^-?\d+$/.test(str)) return parseInt(str, 10);
  if (/^-?\d+\.\d+$/.test(str)) return parseFloat(str);

  let val = str;
  if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
    val = val.slice(1, -1);
  }
  if (
    (val.startsWith('{') && val.endsWith('}')) ||
    (val.startsWith('[') && val.endsWith(']'))
  ) {
    try {
      return JSON.parse(val);
    } catch {
      // Leave as string when it is not valid JSON.
    }
  }
  val = val.replace(/\\U([0-9A-Fa-f]{8})/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)));
  val = val.replace(/\\u([0-9A-Fa-f]{4})/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)));
  return val;
}

function readSubSkillPackageJson(skillDir) {
  const pkgPath = path.join(skillDir, 'package.json');
  if (!fs.existsSync(pkgPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  } catch {
    return null;
  }
}

function resolveMinParentVersion(pkg, fallbackVersion) {
  if (pkg && pkg.jsEyes && typeof pkg.jsEyes.minParentVersion === 'string') {
    return pkg.jsEyes.minParentVersion;
  }
  const peer = pkg && pkg.peerDependencies && pkg.peerDependencies['js-eyes'];
  if (typeof peer === 'string') {
    const m = peer.match(/\d+\.\d+\.\d+/);
    if (m) return m[0];
  }
  return fallbackVersion;
}

function resolveSkillReleasedAt(skillDir, fallbackISO) {
  try {
    const out = execSync(`git log -1 --format=%cI -- "${skillDir}"`, {
      cwd: PROJECT_ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    if (out) return out;
  } catch {}
  return fallbackISO;
}

function resolveSkillChangelogUrl(skillDir, dirName) {
  const changelog = path.join(skillDir, 'CHANGELOG.md');
  if (!fs.existsSync(changelog)) return null;
  return `https://github.com/imjszhang/js-eyes/blob/main/skills/${dirName}/CHANGELOG.md`;
}

function registryRuntime(descriptor) {
  const requirements = descriptor.requirements || {};
  return {
    requiresServer: requirements.server === true,
    requiresBrowserExtension: requirements.browserExtension === true,
    requiresLogin: requirements.login === true,
    platforms: Array.isArray(requirements.platforms)
      ? requirements.platforms.slice()
      : [],
  };
}

const STAGE_COPY_EXCLUDES = new Set([
  '.git',
  'node_modules',
  'package-lock.json',
  'runs',
  'work_dir',
]);

function copyPortableTree(source, destination) {
  ensureDir(destination);
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    if (STAGE_COPY_EXCLUDES.has(entry.name)) continue;
    const sourcePath = path.join(source, entry.name);
    const destinationPath = path.join(destination, entry.name);
    if (entry.isDirectory()) copyPortableTree(sourcePath, destinationPath);
    else if (entry.isFile()) fs.copyFileSync(sourcePath, destinationPath);
  }
}

function copyPortablePackage(source, destination) {
  const pkg = JSON.parse(fs.readFileSync(path.join(source, 'package.json'), 'utf8'));
  ensureDir(destination);
  fs.copyFileSync(path.join(source, 'package.json'), path.join(destination, 'package.json'));

  const entries = new Set(Array.isArray(pkg.files) ? pkg.files : []);
  for (const entry of ['README.md', 'LICENSE', 'CHANGELOG.md']) {
    if (fs.existsSync(path.join(source, entry))) entries.add(entry);
  }
  for (const entry of entries) {
    const sourcePath = path.join(source, entry);
    if (!fs.existsSync(sourcePath)) continue;
    const destinationPath = path.join(destination, entry);
    const stat = fs.statSync(sourcePath);
    if (stat.isDirectory()) copyPortableTree(sourcePath, destinationPath);
    else if (stat.isFile()) {
      ensureDir(path.dirname(destinationPath));
      fs.copyFileSync(sourcePath, destinationPath);
    }
  }
}

function vendorLocalDependencies(sourceDir, stageDir) {
  const packagePath = path.join(stageDir, 'package.json');
  const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
  const sections = ['dependencies', 'optionalDependencies'];
  const vendored = new Map();

  function stageVendor(vendorSource) {
    const source = fs.realpathSync(vendorSource);
    if (vendored.has(source)) return vendored.get(source);
    const vendorPackage = JSON.parse(fs.readFileSync(path.join(source, 'package.json'), 'utf8'));
    const vendorName = vendorPackage.name.split('/').pop();
    const vendorDir = path.join(stageDir, 'vendor', vendorName);
    vendored.set(source, vendorName);
    copyPortablePackage(source, vendorDir);

    let changed = false;
    for (const section of sections) {
      for (const [name, specifier] of Object.entries(vendorPackage[section] || {})) {
        if (!String(specifier).startsWith('file:')) continue;
        const nestedSource = path.resolve(source, String(specifier).slice('file:'.length));
        const nestedName = stageVendor(nestedSource);
        vendorPackage[section][name] = `file:../${nestedName}`;
        changed = true;
      }
    }
    if (changed) {
      fs.writeFileSync(
        path.join(vendorDir, 'package.json'),
        `${JSON.stringify(vendorPackage, null, 2)}\n`,
        'utf8',
      );
    }
    return vendorName;
  }

  let changed = false;
  for (const section of sections) {
    for (const [name, specifier] of Object.entries(pkg[section] || {})) {
      if (!String(specifier).startsWith('file:')) continue;
      const vendorSource = path.resolve(sourceDir, String(specifier).slice('file:'.length));
      const vendorName = stageVendor(vendorSource);
      pkg[section][name] = `file:vendor/${vendorName}`;
      changed = true;
    }
  }
  if (changed) {
    fs.writeFileSync(packagePath, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8');
  }
  return [...vendored.values()].sort();
}

function generatePortableLockfile(stageDir) {
  const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  execFileSync(npmCommand, [
    'install',
    '--package-lock-only',
    '--ignore-scripts',
    '--no-audit',
    '--no-fund',
    '--workspaces=false',
  ], {
    cwd: stageDir,
    stdio: ['ignore', 'ignore', 'pipe'],
    windowsHide: true,
  });
  const lockPath = path.join(stageDir, 'package-lock.json');
  if (!fs.existsSync(lockPath)) {
    throw new Error(`npm did not generate ${lockPath}`);
  }
}

function prepareSubSkillStage(skill, options = {}) {
  const stageDir = fs.mkdtempSync(path.join(os.tmpdir(), `js-eyes-${skill.id}-`));
  try {
    copyPortableTree(skill.dir, stageDir);
    const vendored = vendorLocalDependencies(skill.dir, stageDir);
    if (options.generateLockfile !== false) generatePortableLockfile(stageDir);
    return { stageDir, vendored };
  } catch (error) {
    fs.rmSync(stageDir, { recursive: true, force: true });
    throw error;
  }
}

function discoverSubSkills() {
  if (!fs.existsSync(SKILLS_DIR)) return [];

  const entries = fs.readdirSync(SKILLS_DIR, { withFileTypes: true });
  const skills = [];
  const parentVersion = getVersion();

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const skillDir = path.join(SKILLS_DIR, entry.name);
    const skillMd = path.join(skillDir, 'SKILL.md');
    if (!fs.existsSync(skillMd)) continue;

    const manifestPath = path.join(skillDir, 'skill.manifest.json');
    if (!fs.existsSync(manifestPath)) continue;
    const { descriptor } = loadSkillManifest(skillDir);
    const meta = parseSkillFrontmatter(skillMd);
    if (!meta || !meta.name) continue;

    const tools = descriptor.tools.map((tool) => tool.name);
    const commands = Array.isArray(descriptor.cli?.commands)
      ? descriptor.cli.commands.map((command) => command.name)
      : [];

    const oc = (meta.metadata && meta.metadata.openclaw) || {};
    const pkg = readSubSkillPackageJson(skillDir);
    skills.push({
      id: descriptor.id,
      dir: skillDir,
      dirName: entry.name,
      name: descriptor.name,
      description: descriptor.description || meta.description || '',
      version: descriptor.version,
      emoji: oc.emoji || '',
      homepage: oc.homepage || '',
      requires: oc.requires || {},
      tools,
      commands,
      runtime: registryRuntime(descriptor),
      minParentVersion: resolveMinParentVersion(pkg, parentVersion),
      changelogUrl: resolveSkillChangelogUrl(skillDir, entry.name),
    });
  }
  return skills;
}

async function buildSubSkillZips() {
  const skills = discoverSubSkills();
  if (skills.length === 0) return;

  for (const skill of skills) {
    const outDir = path.join(SITE_OUT_DIR, 'skills', skill.dirName);
    ensureDir(outDir);

    const zipName = `${skill.id}-skill.zip`;
    const outputFile = path.join(outDir, zipName);
    if (fs.existsSync(outputFile)) fs.unlinkSync(outputFile);

    const { sha256, size } = await buildSubSkillZip(skill, outputFile);
    writeShaSidecar(outputFile, sha256);
    skill._sha256 = sha256;
    skill._size = size;
    console.log(`  ✓ Sub-skill bundle: skills/${skill.dirName}/${zipName} (${formatSize(size)}, sha256 ${sha256.slice(0, 12)}…)`);
  }

  return skills;
}

async function buildSubSkillZip(skill, outputFile) {
  ensureDir(path.dirname(outputFile));
  const { stageDir } = prepareSubSkillStage(skill);
  const output = fs.createWriteStream(outputFile);
  const archive = createZipArchive({ zlib: { level: 9 } });

  /** @type {Promise<void>} */
  const archiveComplete = new Promise((resolve, reject) => {
    output.on('close', resolve);
    output.on('error', reject);
    archive.on('error', reject);
    archive.pipe(output);
    archive.glob('**/*', {
      cwd: stageDir,
      dot: false,
      ignore: SUB_SKILL_EXCLUDE,
    });
    archive.finalize();
  });
  try {
    await archiveComplete;
  } finally {
    fs.rmSync(stageDir, { recursive: true, force: true });
  }
  return hashFile(outputFile);
}

async function buildSkillsRegistry(preBuiltSkills) {
  const skills = preBuiltSkills || discoverSubSkills();
  const version = getVersion();
  const generated = new Date().toISOString();
  const toolNameToActionSegment = (name) => String(name || '')
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
  const skillToolActionName = (skillId, toolName) =>
    `skill/${skillId}/${toolNameToActionSegment(toolName) || 'run'}`;

  const registry = {
    version: 1,
    generated,
    baseUrl: SITE_URL,
    parentSkill: { id: 'js-eyes', version },
    skills: skills.map((skill) => {
      const primary = `${SITE_URL}/skills/${skill.dirName}/${skill.id}-skill.zip`;
      let sha256 = skill._sha256;
      let size = skill._size;
      if (!sha256) {
        const zipPath = path.join(SITE_OUT_DIR, 'skills', skill.dirName, `${skill.id}-skill.zip`);
        if (fs.existsSync(zipPath)) {
          const info = hashFile(zipPath);
          sha256 = info.sha256;
          size = info.size;
        }
      }
      const releasedAt = resolveSkillReleasedAt(skill.dir, generated);
      return {
        id: skill.id,
        name: skill.name,
        description: skill.description,
        version: skill.version,
        emoji: skill.emoji,
        requires: skill.requires,
        downloadUrl: primary,
        sha256: sha256 || null,
        size: size || null,
        homepage: skill.homepage,
        tools: skill.tools,
        actions: (skill.tools || []).map((tool) => skillToolActionName(skill.id, tool)),
        commands: skill.commands,
        runtime: skill.runtime,
        minParentVersion: skill.minParentVersion || version,
        releasedAt,
        changelogUrl: skill.changelogUrl || null,
      };
    }),
  };

  const outputFile = path.join(SITE_OUT_DIR, 'skills.json');
  fs.writeFileSync(outputFile, JSON.stringify(registry, null, 2) + '\n', 'utf8');
  console.log(`  ✓ Skills registry: skills.json (${skills.length} skill(s))`);
}

module.exports = {
  buildSkillsRegistry,
  buildSubSkillZip,
  buildSubSkillZips,
  discoverSubSkills,
  parseSkillFrontmatter,
  prepareSubSkillStage,
  registryRuntime,
};
