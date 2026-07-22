'use strict';

class StdioServerTransport {
  constructor(input = process.stdin, output = process.stdout) {
    this.input = input;
    this.output = output;
    this.onmessage = null;
    this.onerror = null;
    this.onclose = null;
    this.started = false;
    this.buffer = '';
    this._onData = (chunk) => this._consume(chunk);
    this._onEnd = () => this.onclose?.();
    this._onError = (error) => this.onerror?.(error);
  }

  async start() {
    if (this.started) throw new Error('stdio transport is already started');
    this.started = true;
    this.input.setEncoding?.('utf8');
    this.input.on('data', this._onData);
    this.input.once('end', this._onEnd);
    this.input.once('error', this._onError);
    this.output.once('error', this._onError);
  }

  _consume(chunk) {
    this.buffer += String(chunk);
    while (true) {
      const newline = this.buffer.indexOf('\n');
      if (newline < 0) break;
      const line = this.buffer.slice(0, newline).replace(/\r$/, '');
      this.buffer = this.buffer.slice(newline + 1);
      if (!line.trim()) continue;
      try {
        this.onmessage?.(JSON.parse(line));
      } catch (error) {
        this.onerror?.(error);
      }
    }
  }

  async send(message) {
    const encoded = `${JSON.stringify(message)}\n`;
    if (this.output.write(encoded)) return;
    await new Promise((resolve, reject) => {
      const cleanup = () => {
        this.output.off('drain', onDrain);
        this.output.off('error', onError);
      };
      const onDrain = () => { cleanup(); resolve(undefined); };
      const onError = (error) => { cleanup(); reject(error); };
      this.output.once('drain', onDrain);
      this.output.once('error', onError);
    });
  }

  async close() {
    if (!this.started) return;
    this.started = false;
    this.input.off('data', this._onData);
    this.input.off('end', this._onEnd);
    this.input.off('error', this._onError);
    this.output.off('error', this._onError);
  }
}

module.exports = { StdioServerTransport };
