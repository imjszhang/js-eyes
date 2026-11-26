'use strict';

const { z } = require('zod');

const LATEST_PROTOCOL_VERSION = '2025-11-25';
const SUPPORTED_PROTOCOL_VERSIONS = new Set([
  '2025-11-25',
  '2025-06-18',
  '2025-03-26',
  '2024-11-05',
  '2024-10-07',
]);

function jsonRpcError(id, code, message, data) {
  return {
    jsonrpc: '2.0',
    id: id ?? null,
    error: {
      code,
      message,
      ...(data === undefined ? {} : { data }),
    },
  };
}

class NativeMcpServer {
  constructor(serverInfo, options = {}) {
    this.serverInfo = serverInfo;
    this.instructions = options.instructions || '';
    this.tools = new Map();
    this.transport = null;
    this.closed = false;
  }

  registerTool(name, config, handler) {
    if (this.tools.has(name)) throw new Error(`MCP tool already registered: ${name}`);
    this.tools.set(name, { name, config, handler });
  }

  async connect(transport) {
    if (this.transport) throw new Error('MCP server is already connected');
    this.transport = transport;
    transport.onmessage = (message) => {
      this._handleMessage(message).catch(() => {});
    };
    transport.onerror = () => {};
    transport.onclose = () => {
      this.closed = true;
    };
    await transport.start();
  }

  async close() {
    if (this.closed && !this.transport) return;
    this.closed = true;
    const transport = this.transport;
    this.transport = null;
    if (transport) await transport.close();
  }

  _toolDescriptor(tool) {
    return {
      name: tool.name,
      ...(tool.config.title ? { title: tool.config.title } : {}),
      ...(tool.config.description ? { description: tool.config.description } : {}),
      inputSchema: z.toJSONSchema(tool.config.inputSchema),
      ...(tool.config.annotations ? { annotations: tool.config.annotations } : {}),
    };
  }

  async _handleMessage(message) {
    if (!message || message.jsonrpc !== '2.0' || typeof message.method !== 'string') return;
    if (!Object.prototype.hasOwnProperty.call(message, 'id')) return;
    const { id, method, params = {} } = message;
    try {
      if (method === 'initialize') {
        const requested = params.protocolVersion;
        const protocolVersion = SUPPORTED_PROTOCOL_VERSIONS.has(requested)
          ? requested
          : LATEST_PROTOCOL_VERSION;
        await this.transport.send({
          jsonrpc: '2.0',
          id,
          result: {
            protocolVersion,
            capabilities: { tools: { listChanged: false } },
            serverInfo: this.serverInfo,
            ...(this.instructions ? { instructions: this.instructions } : {}),
          },
        });
        return;
      }
      if (method === 'ping') {
        await this.transport.send({ jsonrpc: '2.0', id, result: {} });
        return;
      }
      if (method === 'tools/list') {
        await this.transport.send({
          jsonrpc: '2.0',
          id,
          result: { tools: Array.from(this.tools.values(), (tool) => this._toolDescriptor(tool)) },
        });
        return;
      }
      if (method === 'tools/call') {
        const tool = this.tools.get(params.name);
        if (!tool) {
          await this.transport.send(jsonRpcError(id, -32602, `Unknown tool: ${params.name}`));
          return;
        }
        const validated = tool.config.inputSchema.safeParse(params.arguments || {});
        if (!validated.success) {
          await this.transport.send(jsonRpcError(id, -32602, 'Invalid tool arguments', {
            issues: validated.error.issues.map((issue) => ({
              path: issue.path,
              code: issue.code,
              message: issue.message,
            })),
          }));
          return;
        }
        const result = await tool.handler(validated.data);
        await this.transport.send({ jsonrpc: '2.0', id, result });
        return;
      }
      await this.transport.send(jsonRpcError(id, -32601, `Method not found: ${method}`));
    } catch (error) {
      await this.transport.send(jsonRpcError(id, -32603, 'Internal MCP server error', {
        message: String(error && error.message ? error.message : error).slice(0, 500),
      }));
    }
  }
}

module.exports = {
  LATEST_PROTOCOL_VERSION,
  NativeMcpServer,
  SUPPORTED_PROTOCOL_VERSIONS,
  jsonRpcError,
};
