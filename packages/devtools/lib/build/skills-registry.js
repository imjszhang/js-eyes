'use strict';

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

function loadSkillContract(skillDir) {
  const contractPath = path.resolve(skillDir, 'skill.contract.js');
  if (!fs.existsSync(contractPath)) return null;
  delete require.cache[require.resolve(contractPath)];
  return require(contractPath);
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

    const contract = loadSkillContract(skillDir);
    if (!contract) continue;
    const meta = parseSkillFrontmatter(skillMd);
    if (!meta || !meta.name) continue;

    const tools = Array.isArray(contract?.openclaw?.tools)
      ? contract.openclaw.tools.map((tool) => tool.name)
      : [];
    const commands = Array.isArray(contract?.cli?.commands)
      ? contract.cli.commands.map((command) => command.name)
      : [];

    const oc = (meta.metadata && meta.metadata.openclaw) || {};
    const pkg = readSubSkillPackageJson(skillDir);
    skills.push({
      id: meta.name,
      dir: skillDir,
      dirName: entry.name,
      name: contract?.name || meta.name,
      description: meta.description || '',
      version: contract?.version || meta.version || '1.0.0',
      emoji: oc.emoji || '',
      homepage: oc.homepage || '',
      requires: oc.requires || {},
      tools,
      commands,
      runtime: contract?.runtime || {},
      minParentVersion: resolveMinParentVersion(pkg, parentVersion),
      changelogUrl: resolveSkillChangelogUrl(skillDir, entry.name),
    });
  }
  return skills;
}

async function buildSubSkillZips() {
  const skills = discoverSubSkills();
  if (skills.length === 0) return;

  const archiver = require('archiver');

  for (const skill of skills) {
    const outDir = path.join(SITE_OUT_DIR, 'skills', skill.dirName);
    ensureDir(outDir);

    const zipName = `${skill.id}-skill.zip`;
    const outputFile = path.join(outDir, zipName);
    if (fs.existsSync(outputFile)) fs.unlinkSync(outputFile);

    const output = fs.createWriteStream(outputFile);
    const archive = archiver('zip', { zlib: { level: 9 } });

    /** @type {Promise<void>} */
    const archiveComplete = new Promise((resolve, reject) => {
      output.on('close', () => resolve());
      archive.on('error', reject);
      archive.pipe(output);
      archive.glob('**/*', {
        cwd: skill.dir,
        dot: false,
        ignore: SUB_SKILL_EXCLUDE,
      });
      archive.finalize();
    });
    await archiveComplete;

    const stats = fs.statSync(outputFile);
    const { sha256 } = hashFile(outputFile);
    writeShaSidecar(outputFile, sha256);
    skill._sha256 = sha256;
    skill._size = stats.size;
    console.log(`  ✓ Sub-skill bundle: skills/${skill.dirName}/${zipName} (${formatSize(stats.size)}, sha256 ${sha256.slice(0, 12)}…)`);
  }

  return skills;
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

module.exports = { buildSkillsRegistry, buildSubSkillZips, discoverSubSkills, parseSkillFrontmatter };
