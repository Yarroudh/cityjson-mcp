import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function childEnvironment() {
  const modelSecrets = new Set(['MODEL_API_KEY', 'ANTHROPIC_API_KEY', 'OPENAI_API_KEY']);
  return Object.fromEntries(Object.entries(process.env).filter(([key, value]) => typeof value === 'string' && !modelSecrets.has(key)));
}

function modelSafeResult(result, maxChars) {
  let value;
  if (result.structuredContent !== undefined) {
    value = JSON.stringify(result.structuredContent);
  } else {
    value = (result.content || []).map(item => {
      if (item.type === 'text') return item.text;
      if (item.type === 'resource_link') return JSON.stringify({ type: item.type, name: item.name, uri: item.uri });
      if (item.type === 'resource') return JSON.stringify({
        type: item.type,
        uri: item.resource?.uri,
        mimeType: item.resource?.mimeType,
        omitted: 'Embedded resource content is not sent to the model.'
      });
      return JSON.stringify({ type: item.type, omitted: true });
    }).join('\n');
  }
  if (value.length > maxChars) return `${value.slice(0, maxChars)}\n…[tool result truncated by chat host]`;
  return value;
}

export class McpGateway {
  constructor({ maxToolResultChars = 100000 } = {}) {
    this.maxToolResultChars = maxToolResultChars;
    this.client = null;
    this.transport = null;
    this.tools = [];
  }

  async connect() {
    if (this.client) return;
    this.transport = new StdioClientTransport({
      command: process.execPath,
      args: [path.join(projectRoot, 'src/index.mjs')],
      cwd: projectRoot,
      env: childEnvironment(),
      stderr: 'inherit',
      maxBufferSize: 25 * 1024 * 1024
    });
    this.client = new Client({ name: 'cityjson-chat', version: '0.1.0' });
    await this.client.connect(this.transport);
    this.tools = (await this.client.listTools()).tools;
  }

  async call(name, args = {}) {
    if (!this.client) throw new Error('MCP gateway is not connected');
    const raw = await this.client.callTool({ name, arguments: args });
    return {
      isError: raw.isError === true,
      modelContent: modelSafeResult(raw, this.maxToolResultChars),
      structuredContent: raw.structuredContent
    };
  }

  modelTools(provider) {
    if (provider === 'anthropic') {
      return this.tools.map(tool => ({
        name: tool.name,
        description: tool.description || tool.title || tool.name,
        input_schema: tool.inputSchema || { type: 'object', properties: {} }
      }));
    }
    return this.tools.map(tool => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description || tool.title || tool.name,
        parameters: tool.inputSchema || { type: 'object', properties: {} }
      }
    }));
  }

  async close() {
    if (this.client) await this.client.close();
    this.client = null;
    this.transport = null;
    this.tools = [];
  }
}
