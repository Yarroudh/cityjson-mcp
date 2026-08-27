import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { Readable, Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { cleanModelText, createModelClient, SYSTEM_PROMPT } from '../src/web/model-client.mjs';
import { receiveUploads } from '../src/web/uploads.mjs';
import { McpGateway } from '../src/web/mcp-gateway.mjs';
import { getWebConfig } from '../src/web/env.mjs';
import { configuredModel, createChatApplication, ensureRequestedDownloads } from '../src/web/server.mjs';
import { followUpSuggestions, inferSuggestionState, initialSuggestions, SUGGESTION_COUNT } from '../web/suggestions.js';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const samplePath = path.join(projectRoot, 'examples', 'minimal.city.json');

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
}

function applicationRequest(server, method, url, body) {
  const encoded = body === undefined ? null : Buffer.from(JSON.stringify(body));
  const request = Readable.from(encoded ? [encoded] : []);
  request.method = method;
  request.url = url;
  request.headers = encoded ? { 'content-type': 'application/json', 'content-length': String(encoded.length) } : {};
  const chunks = [];
  const headers = {};
  const response = new Writable({ write(chunk, encoding, callback) { chunks.push(Buffer.from(chunk)); callback(); } });
  response.statusCode = 200;
  response.setHeader = (name, value) => { headers[name.toLowerCase()] = value; };
  response.writeHead = (status, values = {}) => {
    response.statusCode = status;
    for (const [name, value] of Object.entries(values)) headers[name.toLowerCase()] = value;
    return response;
  };
  return new Promise((resolve, reject) => {
    response.on('finish', () => resolve({ status: response.statusCode, headers, body: Buffer.concat(chunks) }));
    response.on('error', reject);
    server.emit('request', request, response);
  });
}

function contrastRatio(first, second) {
  const luminance = hex => {
    const channels = hex.slice(1).match(/../g).map(value => parseInt(value, 16) / 255)
      .map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
    return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
  };
  const values = [luminance(first), luminance(second)].sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

function cssVariable(block, name) {
  return new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`).exec(block)?.[1];
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

test('chat host can start its configuration flow without model credentials', () => {
  const config = getWebConfig({});
  assert.equal(config.model, null);
  assert.equal(config.apiKey, null);
});

test('model behavior is low-temperature and suppresses emoji output', () => {
  const config = getWebConfig({});
  assert.equal(config.temperature, 0.1);
  assert.match(SYSTEM_PROMPT, /Never use emojis/);
  assert.equal(cleanModelText('Inspection complete. 🏙️'), 'Inspection complete.');
});

test('HTML versions application assets to prevent cached UI mismatches', async () => {
  const html = await fs.readFile(path.join(projectRoot, 'web', 'index.html'), 'utf8');
  assert.match(html, /styles\.css\?v=6/);
  assert.match(html, /app\.js\?v=6/);
  assert.match(html, /favicon\.svg\?v=1/);
});

test('question suggestions remain available through large follow-up trees', () => {
  const initial = initialSuggestions();
  assert.equal(initial.length, 6);
  assert.ok(SUGGESTION_COUNT >= 100);
  const overview = inferSuggestionState(initial[0].prompt);
  const firstFollowUps = followUpSuggestions(overview);
  assert.equal(firstFollowUps.length, 6);
  assert.ok(firstFollowUps.every(suggestion => suggestion.topic === 'overview'));
  const nextState = inferSuggestionState(firstFollowUps[0].prompt, overview);
  const secondFollowUps = followUpSuggestions(nextState);
  assert.equal(secondFollowUps.length, 6);
  assert.notDeepEqual(secondFollowUps.map(item => item.prompt), firstFollowUps.map(item => item.prompt));
});

test('primary controls and muted text meet readable contrast in both themes', async () => {
  const css = await fs.readFile(path.join(projectRoot, 'web', 'styles.css'), 'utf8');
  for (const theme of ['dark', 'light']) {
    const block = new RegExp(`\\.app\\[data-theme="${theme}"\\] \\{([^}]+)`, 's').exec(css)?.[1];
    assert.ok(block, `${theme} theme variables are present`);
    assert.ok(contrastRatio(cssVariable(block, 'button-bg'), cssVariable(block, 'button-text')) >= 7);
    assert.ok(contrastRatio(cssVariable(block, 'panel'), cssVariable(block, 'muted')) >= 4.5);
  }
});

test('user model configuration changes API settings without requiring the existing key again', () => {
  const base = getWebConfig({
    MODEL_PROVIDER: 'openai',
    MODEL_NAME: 'default-model',
    MODEL_API_KEY: 'existing-secret'
  });
  const selected = configuredModel(base, {
    provider: 'anthropic',
    model: 'claude-test',
    apiKey: '',
    baseUrl: 'https://api.anthropic.com/'
  });
  assert.equal(selected.provider, 'anthropic');
  assert.equal(selected.model, 'claude-test');
  assert.equal(selected.baseUrl, 'https://api.anthropic.com');
  assert.equal(selected.apiKey, 'existing-secret');
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

test('chat turns prepare a derived dataset when the user asks for a download', async () => {
  const calls = [];
  const gateway = {
    async call(name, args) {
      calls.push({ name, args });
      return {
        isError: false,
        downloads: [{ filename: 'subset.city.json', mimeType: 'application/json', sizeBytes: 123, path: samplePath }]
      };
    }
  };
  const resources = await ensureRequestedDownloads('Create a Building subset and download it.', 'cj_derived', [], gateway);
  assert.deepEqual(calls, [{ name: 'cityjson_download', args: { dataset_id: 'cj_derived' } }]);
  assert.equal(resources[0].filename, 'subset.city.json');
});

test('chat API keeps multiple model profiles and downloads imported datasets', async t => {
  const input = await fs.mkdtemp(path.join(os.tmpdir(), 'datum-api-test-'));
  const sample = await fs.readFile(samplePath);
  const gateway = {
    tools: [],
    async connect() {},
    async call(name, args) {
      if (name === 'cityjson_backend_status') {
        return {
          isError: false,
          structuredContent: {
            backends: Object.fromEntries(['cjio', 'cjval', 'val3dity', 'citygmlTools', 'cjdb'].map(key => [key, { available: true }]))
          }
        };
      }
      if (name === 'cityjson_download') {
        assert.equal(args.dataset_id, 'cj_imported');
        return {
          isError: false,
          downloads: [{ filename: 'minimal.city.json', mimeType: 'application/json', sizeBytes: sample.length, path: samplePath }]
        };
      }
      throw new Error(`Unexpected tool ${name}`);
    },
    async close() {},
    modelTools() { return []; }
  };
  const config = getWebConfig({
    MODEL_PROVIDER: 'openai',
    MODEL_NAME: 'default-model',
    MODEL_API_KEY: 'default-secret',
    CITYJSON_MCP_INPUT: input
  });
  const app = await createChatApplication(config, { gateway, model: {} });
  t.after(async () => {
    await app.close();
    await fs.rm(input, { recursive: true, force: true });
  });
  const clientId = 'browser-client-123';

  const initialResult = await applicationRequest(app.server, 'GET', `/api/config?clientId=${clientId}`);
  const initial = JSON.parse(initialResult.body);
  assert.equal(initial.activeModelId, 'default');
  assert.equal(initial.models.length, 1);

  const addedResponse = await applicationRequest(app.server, 'POST', '/api/models', {
    clientId,
    provider: 'anthropic',
    model: 'claude-test',
    apiKey: 'custom-secret',
    baseUrl: 'https://api.anthropic.com'
  });
  assert.equal(addedResponse.status, 201);
  const added = JSON.parse(addedResponse.body);
  assert.equal(added.models.length, 2);
  assert.equal(added.model, 'claude-test');
  assert.equal('apiKey' in added, false);

  const selectedResult = await applicationRequest(app.server, 'POST', '/api/models/select', { clientId, modelId: 'default' });
  const selected = JSON.parse(selectedResult.body);
  assert.equal(selected.activeModelId, 'default');
  assert.equal(selected.models.length, 2);

  const preparedResult = await applicationRequest(app.server, 'POST', '/api/datasets/download', { datasetId: 'cj_imported' });
  const prepared = JSON.parse(preparedResult.body);
  assert.equal(prepared.downloads[0].filename, 'minimal.city.json');
  const downloaded = await applicationRequest(app.server, 'GET', prepared.downloads[0].url);
  assert.deepEqual(downloaded.body, sample);
});

test('Anthropic model adapter relays tool calls and results', async () => {
  const responses = [
    { content: [{ type: 'tool_use', id: 'tool-1', name: 'cityjson_info', input: { dataset_id: 'cj_test' } }] },
    { content: [{ type: 'text', text: 'The model contains two objects.' }] }
  ];
  const calls = [];
  const client = createModelClient({
    provider: 'anthropic', apiKey: 'test', model: 'test-model', baseUrl: 'https://example.test',
    maxOutputTokens: 100, maxToolRounds: 3, temperature: 0.1
  }, async (url, options) => {
    assert.equal(JSON.parse(options.body).temperature, 0.1);
    return jsonResponse(responses.shift());
  });
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
    maxOutputTokens: 100, maxToolRounds: 3, temperature: 0.1
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
  assert.equal(requests[0].body.temperature, 0.1);
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
  const importTool = gateway.tools.find(tool => tool.name === 'cityjson_import');
  assert.ok(importTool);
  assert.match(importTool.description, /input inbox/);
  assert.equal(importTool.inputSchema.type, 'object');
  const imported = await gateway.call('cityjson_import', { filename: 'gateway.city.json' });
  assert.equal(imported.isError, false);
  assert.equal(imported.structuredContent.cityObjectCount, 2);
  const downloaded = await gateway.call('cityjson_download', { dataset_id: imported.structuredContent.datasetId });
  assert.equal(downloaded.isError, false);
  assert.equal(downloaded.downloads.length, 1);
  assert.equal(downloaded.modelContent.includes('_hostPath'), false);
  assert.deepEqual(JSON.parse(await fs.readFile(downloaded.downloads[0].path, 'utf8')), JSON.parse(await fs.readFile(samplePath, 'utf8')));
});
