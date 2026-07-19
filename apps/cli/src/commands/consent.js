'use strict';

const {
  chmodBestEffort,
  ensureRuntimePaths,
  fs,
  path,
  print,
} = require('../command-context');

async function commandConsent(positionals) {
  const action = positionals[1];
  const id = positionals[2];
  const paths = ensureRuntimePaths();
  const consentsDir = paths.consentsDir;
  if (!fs.existsSync(consentsDir)) {
    print(`No pending consents at ${consentsDir}`);
    return;
  }

  function listPending() {
    return fs.readdirSync(consentsDir).filter((name) => name.endsWith('.json')).map((name) => {
      const filePath = path.join(consentsDir, name);
      try {
        const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        return { id: name.replace(/\.json$/, ''), filePath, data };
      } catch {
        return null;
      }
    }).filter(Boolean);
  }

  switch (action) {
    case 'list': {
      const items = listPending();
      if (items.length === 0) {
        print('No pending consent requests.');
        return;
      }
      for (const item of items) {
        const status = item.data.status || 'pending';
        print(`- ${item.id} [${status}] tool=${item.data.toolName || 'n/a'} requestedAt=${item.data.requestedAt || 'n/a'}`);
        if (item.data.summary) print(`    ${item.data.summary}`);
      }
      return;
    }
    case 'approve':
    case 'deny': {
      if (!id) throw new Error(`用法: \`js-eyes consent ${action} <id>\``);
      const filePath = path.join(consentsDir, `${id}.json`);
      if (!fs.existsSync(filePath)) {
        throw new Error(`Consent ${id} not found.`);
      }
      const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      data.status = action === 'approve' ? 'approved' : 'denied';
      data.decidedAt = new Date().toISOString();
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n');
      chmodBestEffort(filePath, 0o600);
      print(`Consent ${id} ${data.status}.`);
      return;
    }
    default:
      throw new Error('用法: `js-eyes consent list|approve <id>|deny <id>`');
  }
}

module.exports = { commandConsent };
