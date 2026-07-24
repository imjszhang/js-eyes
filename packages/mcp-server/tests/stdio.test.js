'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');

describe('published stdio entrypoint', () => {
  it('initializes and lists tools without requiring a running browser server', async () => {
    const client = new Client({ name: 'stdio-smoke', version: '1.0.0' });
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [
        path.join(__dirname, '..', 'bin', 'js-eyes-mcp.js'),
        '--log-level',
        'silent',
      ],
      env: Object.fromEntries(
        Object.entries(process.env).filter((entry) => typeof entry[1] === 'string'),
      ),
      stderr: 'pipe',
    });
    try {
      await client.connect(transport);
      const tools = await client.listTools();
      assert.equal(tools.tools.length, 11);
      assert.equal(tools.tools[0].name, 'browser_status');
    } finally {
      await client.close();
    }
  });
});
