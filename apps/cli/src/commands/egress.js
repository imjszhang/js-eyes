'use strict';

const {
  chmodBestEffort,
  ensureRuntimePaths,
  fs,
  loadConfig,
  path,
  print,
  setConfigValue,
} = require('../command-context');

async function commandEgress(positionals, _flags) {
  const action = positionals[1];
  const paths = ensureRuntimePaths();
  const dir = paths.pendingEgressDir;

  function listPending() {
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir)
      .filter((name) => name.endsWith('.json'))
      .map((name) => {
        const file = path.join(dir, name);
        try {
          const data = JSON.parse(fs.readFileSync(file, 'utf8'));
          return { id: name.replace(/\.json$/, ''), file, data };
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  }

  switch (action) {
    case 'list': {
      const items = listPending();
      if (items.length === 0) {
        print(`No pending egress at ${dir}`);
        return;
      }
      print(`Pending egress (${items.length}) at ${dir}`);
      for (const item of items) {
        const host = item.data.host || item.data.params?.url || 'unknown';
        print(`- ${item.id} host=${host} tool=${item.data.tool || 'n/a'} ts=${item.data.ts || 'n/a'}`);
        if (item.data.reason) print(`    reason: ${item.data.reason}`);
      }
      return;
    }
    case 'approve': {
      const id = positionals[2];
      if (!id) throw new Error('用法: `js-eyes egress approve <id>`');
      const file = path.join(dir, `${id}.json`);
      if (!fs.existsSync(file)) throw new Error(`Egress request ${id} not found.`);
      const data = JSON.parse(fs.readFileSync(file, 'utf8'));
      const host = data.host;
      if (!host) throw new Error(`Egress request ${id} has no host field.`);
      const sessionFile = path.join(dir, '.session-allowlist.json');
      let session = [];
      if (fs.existsSync(sessionFile)) {
        try { session = JSON.parse(fs.readFileSync(sessionFile, 'utf8')); } catch {}
      }
      if (!Array.isArray(session)) session = [];
      if (!session.includes(host)) session.push(host);
      fs.writeFileSync(sessionFile, JSON.stringify(session, null, 2) + '\n');
      chmodBestEffort(sessionFile, 0o600);
      fs.rmSync(file, { force: true });
      print(`Approved egress ${id} -> ${host} (session allowlist).`);
      print('Note: session-level approvals do not auto-execute the original call; agent needs to re-invoke it.');
      return;
    }
    case 'allow': {
      const domain = positionals[2];
      if (!domain) throw new Error('用法: `js-eyes egress allow <domain>`');
      const config = loadConfig();
      const security = config.security || {};
      const current = Array.isArray(security.egressAllowlist) ? security.egressAllowlist.slice() : [];
      if (!current.includes(domain)) current.push(domain);
      const nextConfig = setConfigValue('security.egressAllowlist', current);
      print(`Added ${domain} to security.egressAllowlist.`);
      print(`Current allowlist: ${(nextConfig.security?.egressAllowlist || []).join(', ') || '(empty)'}`);
      return;
    }
    case 'clear': {
      const items = listPending();
      let removed = 0;
      for (const item of items) {
        try { fs.rmSync(item.file, { force: true }); removed++; } catch {}
      }
      print(`Cleared ${removed} pending egress record(s).`);
      return;
    }
    default:
      throw new Error('支持的命令: `js-eyes egress list` / `approve <id>` / `allow <domain>` / `clear`');
  }
}

module.exports = { commandEgress };
