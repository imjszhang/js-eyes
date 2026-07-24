'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SKILLS_ROOT = path.join(ROOT, 'skills');
const VERIFY = process.argv.includes('--check');
const PROCESS_SKILLS = new Set(['js-bilibili-ops-skill', 'js-youtube-ops-skill']);
const BROWSER_CAPABILITIES = Object.freeze({
  'js-browser-ops-skill': ['tabs.read', 'page.read', 'navigation', 'script.execute', 'screenshot'],
  'js-github-ops-skill': ['tabs.read', 'navigation', 'script.execute'],
  'js-hn-ops-skill': ['tabs.read', 'navigation', 'script.execute'],
  'js-jike-ops-skill': ['tabs.read', 'page.read', 'navigation', 'script.execute'],
  'js-reddit-ops-skill': ['tabs.read', 'page.read', 'navigation', 'script.execute', 'screenshot'],
  'js-wechat-ops-skill': ['tabs.read', 'page.read', 'navigation', 'script.execute'],
  'js-x-ops-skill': ['tabs.read', 'navigation', 'script.execute', 'screenshot'],
  'js-xiaohongshu-ops-skill': ['tabs.read', 'page.read', 'navigation', 'script.execute', 'screenshot', 'cookies.read'],
  'js-zhihu-ops-skill': ['tabs.read', 'page.read', 'navigation', 'script.execute', 'screenshot'],
});

function riskFor(tool) {
  if (tool.destructive || /_(create|publish)_/.test(tool.name)) return 'destructive';
  if (tool.interactive || /_navigate_|browser_(click|fill_form|scroll)$/.test(tool.name)) return 'interactive';
  if (/_monitor_(add|remove)_/.test(tool.name)) return 'administrative';
  return 'read';
}

function buildManifest(skillDir) {
  const packageJson = require(path.join(skillDir, 'package.json'));
  const contract = require(path.join(skillDir, 'skill.contract.js'));
  const processSkill = PROCESS_SKILLS.has(packageJson.name);
  const browserCapabilities = BROWSER_CAPABILITIES[packageJson.name] || [];
  const platforms = contract.runtime?.platforms || [];
  const tools = contract.openclaw?.tools || contract.tools || [];
  return {
    manifestVersion: 2,
    id: packageJson.name,
    name: contract.name || packageJson.name,
    version: packageJson.version,
    publisher: 'js-eyes',
    description: packageJson.description,
    entry: './skill.entry.js',
    compatibility: {
      jsEyes: '>=2.8.5 <3',
      contractApi: '^2.0.0',
      runtimeApi: '^2.0.0',
      node: '>=22',
    },
    requirements: {
      server: !processSkill,
      browserExtension: !processSkill,
      login: false,
      platforms,
    },
    capabilities: {
      browser: browserCapabilities,
      network: {
        direct: processSkill || packageJson.name === 'js-x-ops-skill',
        hosts: packageJson.name === 'js-x-ops-skill'
          ? ['x.com', 'api.x.com', 'upload.twitter.com']
          : (processSkill ? platforms : []),
      },
      filesystem: packageJson.name === 'js-x-ops-skill' ? ['skillData', 'userFiles'] : ['skillData'],
      process: processSkill ? ['spawn'] : [],
      secrets: packageJson.name === 'js-x-ops-skill' ? ['xApiCredentials'] : [],
      background: false,
    },
    cli: contract.cli || null,
    tools: tools.map((tool) => {
      const inputSchema = tool.parameters || tool.inputSchema || { type: 'object', properties: {} };
      const schemaText = JSON.stringify(inputSchema);
      const capabilities = browserCapabilities
        .filter((capability) => capability !== 'screenshot'
          || tool.name.includes('screenshot')
          || /visual|record/i.test(schemaText))
        .filter((capability) => capability !== 'cookies.read' || tool.name === 'xhs_get_note')
        .map((capability) => `browser.${capability}`);
      if (processSkill) capabilities.push('network.direct', 'process.spawn');
      if (packageJson.name === 'js-x-ops-skill' && /x_(create|publish)_article/.test(tool.name)) {
        capabilities.push('network.direct', 'secrets.xApiCredentials', 'filesystem.userFiles');
      }
      if (/_monitor_/.test(tool.name)) capabilities.push('filesystem.skillData');
      return {
        name: tool.name,
        title: tool.label || tool.title || tool.name,
        description: tool.description || '',
        risk: riskFor(tool),
        capabilities,
        inputSchema,
      };
    }),
  };
}

let stale = false;
for (const name of fs.readdirSync(SKILLS_ROOT).sort()) {
  const skillDir = path.join(SKILLS_ROOT, name);
  if (!fs.existsSync(path.join(skillDir, 'skill.contract.js'))) continue;
  const manifestPath = path.join(skillDir, 'skill.manifest.json');
  const expected = `${JSON.stringify(buildManifest(skillDir), null, 2)}\n`;
  const actual = fs.existsSync(manifestPath) ? fs.readFileSync(manifestPath, 'utf8') : '';
  if (actual === expected) continue;
  stale = true;
  if (VERIFY) console.error(`stale skill manifest: ${path.relative(ROOT, manifestPath)}`);
  else fs.writeFileSync(manifestPath, expected);
}

if (VERIFY && stale) process.exitCode = 1;
