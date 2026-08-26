import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { createModelClient } from '../src/web/model-client.mjs';
import { receiveUploads } from '../src/web/uploads.mjs';
import { McpGateway } from '../src/web/mcp-gateway.mjs';
import { getWebConfig } from '../src/web/env.mjs';
import { createChatApplication } from '../src/web/server.mjs';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const samplePath = path.join(projectRoot, 'examples', 'minimal.city.json');

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
}

test('provider selects an API style while model vendor and base URL remain independent', () => {
  const config = getWebConfig({
    MODEL_PROVIDER: 'openai',
    MODEL_NAME: 'deepseek-v4-pro',
    MODEL_API_KEY: 'test',
    MODEL_BASE_URL: 'https://api.deepseek.com'
  });
  assert.equal(config.provider, 'openai');
  assert.equal(config.model, 'deepseek-v4-pro');
  assert.equal(config.baseUrl, 'https://api.deepseek.com');
});

test('provider rejects values that are not supported API styles', () => {
  assert.throws(() => getWebConfig({
    MODEL_PROVIDER: 'deepseek',
    MODEL_NAME: 'deepseek-v4-pro',
    MODEL_API_KEY: 'test'
  }), /MODEL_PROVIDER must be anthropic or openai/);
});

test('chat startup refuses to advertise a toolbox whose backends are unavailable', async t => {
  const input = await fs.mkdtemp(path.join(os.tmpdir(), 'cityjson-web-readiness-'));
  t.after(() => fs.rm(input, { recursive: true, force: true }));
  let closed = false;
  const gateway = {
    tools: [],
    async connect() {},
    async call() {
      return {
        isError: false,
        structuredContent: {
          backends: {
            cjio: { available: false },
            cjval: { available: false },
            val3dity: { available: false },
            citygmlTools: { available: false },
            cjdb: { available: false }
          }
        }
      };
    },
    async close() { closed = true; }
  };
  const config = getWebConfig({
    MODEL_PROVIDER: 'openai',
    MODEL_NAME: 'test-model',
    MODEL_API_KEY: 'test',
    CITYJSON_MCP_INPUT: input
  });
  await assert.rejects(
    createChatApplication(config, { gateway, model: {} }),
    /requires the complete CityJSON backend bundle.*cjval.*val3dity/
  );
  assert.equal(closed, true);
});

test('Anthropic model adapter relays tool calls and results', async () => {
  const responses = [
    { content: [{ type: 'tool_use', id: 'tool-1', name: 'cityjson_info', input: { dataset_id: 'cj_test' } }] },
    { content: [{ type: 'text', text: 'The model contains two objects.' }] }
  ];
  const calls = [];
  const client = createModelClient({
    provider: 'anthropic', apiKey: 'test', model: 'test-model', baseUrl: 'https://example.test',
    maxOutputTokens: 100, maxToolRounds: 3
  }, async () => jsonResponse(responses.shift()));
  const result = await client.runTurn([], 'Inspect it', [], async (name, args) => {
    calls.push({ name, args });
    return { isError: false, modelContent: '{"cityObjectCount":2}' };
  });
  assert.equal(result.text, 'The model contains two objects.');
  assert.deepEqual(calls, [{ name: 'cityjson_info', args: { dataset_id: 'cj_test' } }]);
  assert.equal(result.trace.length, 1);
});

test('OpenAI-compatible model adapter relays function calls and results', async () => {
  const responses = [
    { choices: [{ message: { role: 'assistant', content: null, tool_calls: [{ id: 'call-1', type: 'function', function: { name: 'cityjson_info', arguments: '{"dataset_id":"cj_test"}' } }] } }] },
    { choices: [{ message: { role: 'assistant', content: 'Inspection complete.' } }] }
  ];
  const requests = [];
  const calls = [];
  const client = createModelClient({
    provider: 'openai', apiKey: 'test', model: 'deepseek-v4-pro', baseUrl: 'https://api.deepseek.com',
    maxOutputTokens: 100, maxToolRounds: 3
  }, async (url, options) => {
    requests.push({ url, body: JSON.parse(options.body) });
    return jsonResponse(responses.shift());
  });
  const result = await client.runTurn([], 'Inspect it', [], async (name, args) => {
    calls.push({ name, args });
    return { isError: false, modelContent: '{"cityObjectCount":2}' };
  });
  assert.equal(result.text, 'Inspection complete.');
  assert.equal(requests[0].url, 'https://api.deepseek.com/chat/completions');
  assert.equal(requests[1].body.messages.at(-1).role, 'tool');
  assert.deepEqual(calls, [{ name: 'cityjson_info', args: { dataset_id: 'cj_test' } }]);
});

test('multipart receiver streams JSON files into the inbox', async t => {
  const input = await fs.mkdtemp(path.join(os.tmpdir(), 'cityjson-web-upload-'));
  t.after(() => fs.rm(input, { recursive: true, force: true }));
  const content = await fs.readFile(samplePath);
  const boundary = 'cityjson-test-boundary';
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="files"; filename="minimal.city.json"\r\nContent-Type: application/json\r\n\r\n`),
    content,
    Buffer.from(`\r\n--${boundary}--\r\n`)
  ]);
  const request = Readable.from([body]);
  request.headers = {
    'content-type': `multipart/form-data; boundary=${boundary}`,
    'content-length': String(body.length)
  };
  const [uploaded] = await receiveUploads(request, { input, maxUploadBytes: 1024 * 1024, maxUploadFiles: 2 });
  assert.match(uploaded.filename, /^minimal\.city--[a-f0-9]{8}\.json$/);
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(input, uploaded.filename), 'utf8')), JSON.parse(content));
});

test('web MCP gateway discovers tools and imports from the inbox over stdio', async t => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cityjson-gateway-test-'));
  const input = path.join(rootDir, 'input');
  const workspace = path.join(rootDir, 'workspace');
  await fs.mkdir(input);
  await fs.copyFile(samplePath, path.join(input, 'gateway.city.json'));
  const previous = {
    input: process.env.CITYJSON_MCP_INPUT,
    workspace: process.env.CITYJSON_MCP_WORKSPACE,
    roots: process.env.CITYJSON_MCP_ALLOWED_ROOTS
  };
  process.env.CITYJSON_MCP_INPUT = input;
  process.env.CITYJSON_MCP_WORKSPACE = workspace;
  process.env.CITYJSON_MCP_ALLOWED_ROOTS = rootDir;
  const gateway = new McpGateway();
  t.after(async () => {
    await gateway.close();
    await fs.rm(rootDir, { recursive: true, force: true });
    if (previous.input === undefined) delete process.env.CITYJSON_MCP_INPUT; else process.env.CITYJSON_MCP_INPUT = previous.input;
    if (previous.workspace === undefined) delete process.env.CITYJSON_MCP_WORKSPACE; else process.env.CITYJSON_MCP_WORKSPACE = previous.workspace;
    if (previous.roots === undefined) delete process.env.CITYJSON_MCP_ALLOWED_ROOTS; else process.env.CITYJSON_MCP_ALLOWED_ROOTS = previous.roots;
  });

  await gateway.connect();
  assert.ok(gateway.tools.some(tool => tool.name === 'cityjson_import'));
  const imported = await gateway.call('cityjson_import', { filename: 'gateway.city.json' });
  assert.equal(imported.isError, false);
  assert.equal(imported.structuredContent.cityObjectCount, 2);
});
