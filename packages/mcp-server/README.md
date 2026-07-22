# @js-eyes/mcp-server

Native stdio Model Context Protocol facade for JS Eyes browser automation.

```json
{
  "mcpServers": {
    "js-eyes": {
      "command": "npx",
      "args": ["-y", "@js-eyes/mcp-server"]
    }
  }
}
```

The existing JS Eyes server and browser extension must be running. The default
safe profile excludes raw JavaScript, cookies, CSS injection, and file upload.
Use `--tool-profile full` only with a trusted MCP host.

Full documentation: <https://github.com/imjszhang/js-eyes/blob/main/docs/mcp.md>
