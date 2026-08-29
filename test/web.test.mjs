import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { Readable, Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { cleanModelText, createModelClient, SYSTEM_PROMPT } from '../src/web/model-client.mjs';
import { receiveUploads } from '../src/web/uploads.mjs';
import { McpGateway, modelSafeResult } from '../src/web/mcp-gateway.mjs';
import { summarizeReport } from '../src/adapters/val3dity.mjs';
import { getWebConfig } from '../src/web/env.mjs';
import { configuredModel, createChatApplication, ensureRequestedDownloads } from '../src/web/server.mjs';
import { runCommand } from '../src/core/command-runner.mjs';
import { followUpSuggestions, inferSuggestionState, initialSuggestions, SUGGESTION_COUNT } from '../web/suggestions.js';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const samplePath = path.join(projectRoot, 'examples', 'minimal.city.json');

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
}

function sseResponse(events, status = 200) {
  const body = events.map(event => `data: ${event === '[DONE]' ? event : JSON.stringify(event)}\n\n`).join('');
  return new Response(body, { status, headers: { 'content-type': 'text/event-stream' } });
}

function ndjsonEvents(response) {
  return response.body.toString('utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
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

test('ollama uses the OpenAI adapter without requiring a local API key', () => {
  const config = getWebConfig({
    MODEL_PROVIDER: 'ollama',
    MODEL_NAME: 'qwen3:8b',
    MODEL_BASE_URL: 'http://host.docker.internal:11434/v1'
  });
  assert.equal(config.provider, 'openai');
  assert.equal(config.service, 'ollama');
  assert.equal(config.apiKey, 'ollama');
  const selected = configuredModel(config, {
    provider: 'ollama',
    model: 'qwen3:8b',
    apiKey: '',
    baseUrl: 'http://host.docker.internal:11434/v1'
  }, { ...config, apiKey: null });
  assert.equal(selected.provider, 'openai');
  assert.equal(selected.service, 'ollama');
  assert.equal(selected.apiKey, 'ollama');
});

test('ollama discovery reports an actionable connection error', async t => {
  const input = await fs.mkdtemp(path.join(os.tmpdir(), 'cityjson-ollama-error-'));
  const gateway = {
    tools: [], async connect() {}, async close() {}, modelTools() { return []; },
    async call(name) {
      if (name === 'cityjson_backend_status') return {
        isError: false,
        structuredContent: { backends: Object.fromEntries(['cjio', 'cjval', 'val3dity', 'citygmlTools', 'cjdb'].map(key => [key, { available: true }])) }
      };
      throw new Error(`Unexpected tool ${name}`);
    }
  };
  const config = getWebConfig({ CITYJSON_MCP_INPUT: input });
  const app = await createChatApplication(config, { gateway, fetchImpl: async () => { throw new TypeError('fetch failed'); } });
  t.after(async () => {
    await app.close();
    await fs.rm(input, { recursive: true, force: true });
  });
  const response = await applicationRequest(app.server, 'GET', '/api/models/discover?provider=ollama&baseUrl=http%3A%2F%2Fhost.docker.internal%3A11434%2Fv1');
  assert.equal(response.status, 400);
  assert.match(JSON.parse(response.body).error, /Could not connect to Ollama at http:\/\/host\.docker\.internal:11434/);
  assert.match(JSON.parse(response.body).error, /Make sure Ollama is running/);
});

test('provider rejects values that are not supported API styles', () => {
  assert.throws(() => getWebConfig({
    MODEL_PROVIDER: 'deepseek',
    MODEL_NAME: 'deepseek-v4-pro',
    MODEL_API_KEY: 'test'
  }), /MODEL_PROVIDER must be anthropic, openai, or ollama/);
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

test('val3dity reports keep every invalid object in compact model context', () => {
  const report = {
    validity: false,
    all_errors: [102, 104],
    dataset_errors: [],
    features_overview: [{ type: 'Building', total: 2, valid: 0 }],
    primitives_overview: [{ type: 'MultiSurface', total: 2, valid: 0 }],
    features: [
      { id: 'object-1', type: 'Building', validity: false, errors: [
        { code: 102, description: 'CONSECUTIVE_POINTS_SAME', id: 'face-1' },
        { code: 102, description: 'CONSECUTIVE_POINTS_SAME', id: 'face-2' }
      ] },
      { id: 'object-2', type: 'Building', validity: false, errors: [
        { code: 104, description: 'RING_SELF_INTERSECTION', id: 'face-3' }
      ] }
    ]
  };
  const reportSummary = summarizeReport(report);
  assert.deepEqual(reportSummary.invalidObjectIds, ['object-1', 'object-2']);
  assert.deepEqual(reportSummary.invalidFeatures[0].errorsByCode, [
    { code: 102, description: 'CONSECUTIVE_POINTS_SAME', count: 2 }
  ]);
  const content = modelSafeResult({ structuredContent: {
    geometry: { validator: 'val3dity', report, reportSummary }
  } }, 2_000);
  assert.doesNotMatch(content, /tool result truncated/);
  assert.match(content, /"invalidObjectIds":\["object-1","object-2"\]/);
  assert.match(content, /"omittedFromModelContext":true/);
  assert.doesNotMatch(content, /face-1/);
});

test('model connection validation rejects a response without the required tool call', async () => {
  const client = createModelClient({
    provider: 'openai', apiKey: 'test', model: 'text-only-model', baseUrl: 'https://example.test/v1',
    maxOutputTokens: 100, maxToolRounds: 3, temperature: 0.1
  }, async () => jsonResponse({ choices: [{ message: { role: 'assistant', content: 'Connection works.' } }] }));
  await assert.rejects(client.testConnection(), /did not complete the required tool-call test/);
});

test('ollama connection validation uses deterministic model capabilities', async () => {
  let request;
  const client = createModelClient({
    provider: 'openai', service: 'ollama', apiKey: 'ollama', model: 'qwen3:4b',
    baseUrl: 'http://host.docker.internal:11434/v1', maxOutputTokens: 4096,
    maxToolRounds: 3, temperature: 0.1
  }, async (url, options) => {
    request = { url, options };
    return jsonResponse({ capabilities: ['completion', 'tools', 'thinking'] });
  });
  await client.testConnection();
  assert.equal(request.url, 'http://host.docker.internal:11434/api/show');
  assert.deepEqual(JSON.parse(request.options.body), { model: 'qwen3:4b' });
  assert.equal(request.options.headers.authorization, undefined);
});

test('ollama connection validation rejects models without tool capability', async () => {
  const client = createModelClient({
    provider: 'openai', service: 'ollama', apiKey: 'ollama', model: 'embedding-only',
    baseUrl: 'http://localhost:11434/v1', maxOutputTokens: 4096,
    maxToolRounds: 3, temperature: 0.1
  }, async () => jsonResponse({ capabilities: ['embedding'] }));
  await assert.rejects(client.testConnection(), /does not advertise tool-calling support/);
});

test('HTML versions application assets to prevent cached UI mismatches', async () => {
  const [html, app] = await Promise.all([
    fs.readFile(path.join(projectRoot, 'web', 'index.html'), 'utf8'),
    fs.readFile(path.join(projectRoot, 'web', 'app.js'), 'utf8')
  ]);
  assert.match(html, /styles\.css\?v=20/);
  assert.match(html, /app\.js\?v=30/);
  for (const suggestedModel of ['qwen3:4b', 'llama3.2:3b', 'deepseek-r1:1.5b', 'functiongemma:270m']) {
    assert.match(html, new RegExp(suggestedModel.replace('.', '\\.')));
  }
  assert.doesNotMatch(html, /llama3\.2:1b/);
  assert.match(html, /favicon\.svg\?v=1/);
  assert.match(app, /messageActionButton\('Retry question', MESSAGE_ICONS\.retry/);
  assert.match(app, /messageActionButton\('Copy message', MESSAGE_ICONS\.copy/);
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
    assert.ok(contrastRatio(cssVariable(block, 'user-bubble'), cssVariable(block, 'user-text')) >= 7);
    if (theme === 'light') assert.equal(cssVariable(block, 'user-bubble'), '#ffffff');
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
  const resources = await ensureRequestedDownloads('Create a Building subset and download it.', 'cj_derived', [], gateway, 'cj_source');
  assert.deepEqual(calls, [{ name: 'cityjson_download', args: { dataset_id: 'cj_derived' } }]);
  assert.equal(resources[0].filename, 'subset.city.json');
});

test('download fallback never offers the original file for an uncompleted subset request', async () => {
  const gateway = { async call() { assert.fail('Original dataset must not be downloaded'); } };
  await assert.rejects(
    ensureRequestedDownloads('Get a subset and prepare a file to download.', 'cj_original', [], gateway, 'cj_original'),
    /transformation was not completed/
  );
});

test('retrying a question restores its server-side history checkpoint and discards later turns', async t => {
  const input = await fs.mkdtemp(path.join(os.tmpdir(), 'datum-retry-test-'));
  const histories = [];
  const model = {
    async runTurn(history, message) {
      histories.push({ length: history.length, message });
      return {
        text: `Reply to ${message}`,
        history: [...history, { role: 'user', content: message }, { role: 'assistant', content: `Reply to ${message}` }],
        trace: []
      };
    }
  };
  const gateway = {
    tools: [],
    async connect() {},
    async call(name) {
      if (name !== 'cityjson_backend_status') throw new Error(`Unexpected tool ${name}`);
      return {
        isError: false,
        structuredContent: {
          backends: Object.fromEntries(['cjio', 'cjval', 'val3dity', 'citygmlTools', 'cjdb'].map(key => [key, { available: true }]))
        }
      };
    },
    async close() {},
    modelTools() { return []; }
  };
  const config = getWebConfig({
    MODEL_PROVIDER: 'openai',
    MODEL_NAME: 'checkpoint-model',
    MODEL_API_KEY: 'test-secret',
    CITYJSON_MCP_INPUT: input
  });
  const app = await createChatApplication(config, { gateway, model });
  t.after(async () => {
    await app.close();
    await fs.rm(input, { recursive: true, force: true });
  });
  const body = { sessionId: 'retry-session-123', clientId: 'retry-client-123' };

  assert.equal((await applicationRequest(app.server, 'POST', '/api/chat', { ...body, message: 'First question' })).status, 200);
  assert.equal((await applicationRequest(app.server, 'POST', '/api/chat', { ...body, message: 'Second question' })).status, 200);
  assert.equal((await applicationRequest(app.server, 'POST', '/api/chat', { ...body, message: 'First question', retryTurn: 0 })).status, 200);
  assert.equal((await applicationRequest(app.server, 'POST', '/api/chat', { ...body, message: 'New follow-up' })).status, 200);

  assert.deepEqual(histories, [
    { length: 0, message: 'First question' },
    { length: 2, message: 'Second question' },
    { length: 0, message: 'First question' },
    { length: 2, message: 'New follow-up' }
  ]);
});

test('chat restores and explicitly scopes an expired conversation dataset instead of listing the inbox', async t => {
  const input = await fs.mkdtemp(path.join(os.tmpdir(), 'datum-dataset-recovery-'));
  const calls = [];
  let receivedMessage = '';
  const model = {
    async runTurn(history, message) {
      receivedMessage = message;
      return { text: 'Subset created.', history: [], trace: [] };
    }
  };
  const gateway = {
    tools: [],
    async connect() {},
    async call(name, args) {
      calls.push({ name, args });
      if (name === 'cityjson_backend_status') return {
        isError: false,
        structuredContent: { backends: Object.fromEntries(['cjio', 'cjval', 'val3dity', 'citygmlTools', 'cjdb'].map(key => [key, { available: true }])) }
      };
      if (name === 'cityjson_info') return { isError: true, modelContent: 'Unknown dataset_id' };
      if (name === 'cityjson_import') return { isError: false, structuredContent: { datasetId: 'cj_restored' } };
      throw new Error(`Unexpected tool ${name}`);
    },
    async close() {},
    modelTools() { return []; }
  };
  const config = getWebConfig({
    MODEL_PROVIDER: 'openai', MODEL_NAME: 'test-model', MODEL_API_KEY: 'test-secret', CITYJSON_MCP_INPUT: input
  });
  const app = await createChatApplication(config, { gateway, model });
  t.after(async () => {
    await app.close();
    await fs.rm(input, { recursive: true, force: true });
  });
  const response = await applicationRequest(app.server, 'POST', '/api/chat', {
    sessionId: 'recovery-session-123', clientId: 'recovery-client-123', message: 'Get a Building subset.',
    datasetId: 'cj_expired', storedFilename: 'import-123-model.city.json', originalFilename: 'model.city.json'
  });
  assert.equal(response.status, 200);
  assert.equal(JSON.parse(response.body).datasetId, 'cj_restored');
  assert.match(receivedMessage, /Active conversation dataset: dataset_id=cj_restored/);
  assert.match(receivedMessage, /exact current model/);
  assert.deepEqual(calls.slice(1), [
    { name: 'cityjson_info', args: { dataset_id: 'cj_expired' } },
    { name: 'cityjson_import', args: { filename: 'import-123-model.city.json' } }
  ]);
});

test('viewer restores a pre-registry imported dataset after a server restart', async t => {
  const input = await fs.mkdtemp(path.join(os.tmpdir(), 'datum-viewer-recovery-'));
  const calls = [];
  const gateway = {
    tools: [], async connect() {}, async close() {}, modelTools() { return []; },
    async call(name, args) {
      calls.push({ name, args });
      if (name === 'cityjson_backend_status') return {
        isError: false,
        structuredContent: { backends: Object.fromEntries(['cjio', 'cjval', 'val3dity', 'citygmlTools', 'cjdb'].map(key => [key, { available: true }])) }
      };
      if (name === 'cityjson_download' && args.dataset_id === 'cj_expired') return { isError: true, modelContent: 'Unknown dataset_id' };
      if (name === 'cityjson_import') return { isError: false, structuredContent: { datasetId: 'cj_restored' } };
      if (name === 'cityjson_download' && args.dataset_id === 'cj_restored') return {
        isError: false,
        downloads: [{ filename: 'minimal.city.json', mimeType: 'application/json', sizeBytes: 1, path: samplePath }]
      };
      throw new Error(`Unexpected tool ${name}`);
    }
  };
  const config = getWebConfig({ MODEL_PROVIDER: 'openai', MODEL_NAME: 'test', MODEL_API_KEY: 'test', CITYJSON_MCP_INPUT: input });
  const app = await createChatApplication(config, { gateway, model: {} });
  t.after(async () => { await app.close(); await fs.rm(input, { recursive: true, force: true }); });
  const response = await applicationRequest(app.server, 'POST', '/api/datasets/view', {
    datasetId: 'cj_expired', storedFilename: 'stored-model.city.json', datasetIsDerived: false
  });
  assert.equal(response.status, 200);
  const body = JSON.parse(response.body);
  assert.equal(body.datasetId, 'cj_restored');
  assert.equal(body.cityjson.type, 'CityJSON');
  assert.deepEqual(calls.slice(1), [
    { name: 'cityjson_download', args: { dataset_id: 'cj_expired' } },
    { name: 'cityjson_import', args: { filename: 'stored-model.city.json' } },
    { name: 'cityjson_download', args: { dataset_id: 'cj_restored' } }
  ]);
});

test('chat API adds, edits, selects, and deletes model profiles and downloads imported datasets', async t => {
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
  const modelTestRequests = [];
  const fetchImpl = async (url, options) => {
    if (url.endsWith('/api/tags')) return jsonResponse({ models: [{ name: 'qwen3:8b' }, { name: 'gpt-oss:20b' }] });
    if (url.endsWith('/api/pull')) {
      const body = JSON.parse(options.body);
      modelTestRequests.push({ url, body });
      return new Response([
        JSON.stringify({ status: 'pulling manifest' }),
        JSON.stringify({ status: 'downloading', completed: 50, total: 100 }),
        JSON.stringify({ status: 'success' })
      ].join('\n'), { status: 200, headers: { 'content-type': 'application/x-ndjson' } });
    }
    const body = JSON.parse(options.body);
    modelTestRequests.push({ url, body });
    if (body.model === 'invalid-model') return jsonResponse({ error: { message: 'Invalid API key or model' } }, 401);
    if (url.endsWith('/v1/messages')) {
      return jsonResponse({ content: [{ type: 'tool_use', id: 'test-1', name: 'datum_connection_test', input: { status: 'ok' } }] });
    }
    return jsonResponse({
      choices: [{ message: { role: 'assistant', content: null, tool_calls: [{
        id: 'test-2', type: 'function', function: { name: 'datum_connection_test', arguments: '{"status":"ok"}' }
      }] } }]
    });
  };
  const app = await createChatApplication(config, { gateway, model: {}, fetchImpl });
  t.after(async () => {
    await app.close();
    await fs.rm(input, { recursive: true, force: true });
  });
  const clientId = 'browser-client-123';

  const initialResult = await applicationRequest(app.server, 'GET', `/api/config?clientId=${clientId}`);
  const initial = JSON.parse(initialResult.body);
  assert.equal(initial.activeModelId, 'default');
  assert.equal(initial.models.length, 1);

  const discoveryResponse = await applicationRequest(app.server, 'GET', '/api/models/discover?provider=ollama&baseUrl=http%3A%2F%2Fhost.docker.internal%3A11434%2Fv1');
  assert.equal(discoveryResponse.status, 200);
  assert.deepEqual(JSON.parse(discoveryResponse.body).models, ['qwen3:8b', 'gpt-oss:20b']);

  const pullResponse = await applicationRequest(app.server, 'POST', '/api/models/pull', {
    model: 'qwen3:4b',
    baseUrl: 'http://host.docker.internal:11434/v1'
  });
  assert.equal(pullResponse.status, 200);
  const pullEvents = ndjsonEvents(pullResponse);
  assert.deepEqual(pullEvents.map(event => event.type), ['progress', 'progress', 'progress', 'complete']);
  assert.equal(pullEvents[1].percent, 50);
  assert.equal(pullEvents[2].percent, 100);
  assert.equal(modelTestRequests.at(-1).url, 'http://host.docker.internal:11434/api/pull');
  assert.deepEqual(modelTestRequests.at(-1).body, { name: 'qwen3:4b', stream: true });

  const rejectedResponse = await applicationRequest(app.server, 'POST', '/api/models', {
    clientId,
    provider: 'openai',
    model: 'invalid-model',
    apiKey: 'invalid-secret',
    baseUrl: 'https://example.test/v1'
  });
  assert.equal(rejectedResponse.status, 400);
  assert.match(JSON.parse(rejectedResponse.body).error, /Invalid API key or model/);
  const afterRejection = JSON.parse((await applicationRequest(app.server, 'GET', `/api/config?clientId=${clientId}`)).body);
  assert.equal(afterRejection.models.length, 1);

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
  assert.equal(modelTestRequests.at(-1).body.tool_choice.name, 'datum_connection_test');
  const customModel = added.models.find(model => !model.isDefault);
  assert.ok(customModel);

  const editedResponse = await applicationRequest(app.server, 'PUT', `/api/models/${customModel.id}`, {
    clientId,
    provider: 'openai',
    model: 'edited-model',
    apiKey: '',
    baseUrl: 'https://example.test/v1'
  });
  assert.equal(editedResponse.status, 200);
  const edited = JSON.parse(editedResponse.body);
  assert.equal(edited.model, 'edited-model');
  assert.equal(edited.models.find(model => model.id === customModel.id).baseUrl, 'https://example.test/v1');
  assert.equal('apiKey' in edited.models.find(model => model.id === customModel.id), false);
  assert.equal(modelTestRequests.at(-1).body.tool_choice, 'auto');

  const selectedResult = await applicationRequest(app.server, 'POST', '/api/models/select', { clientId, modelId: 'default' });
  const selected = JSON.parse(selectedResult.body);
  assert.equal(selected.activeModelId, 'default');
  assert.equal(selected.models.length, 2);

  const deletedResult = await applicationRequest(app.server, 'DELETE', `/api/models/${customModel.id}`, { clientId });
  assert.equal(deletedResult.status, 200);
  const deleted = JSON.parse(deletedResult.body);
  assert.equal(deleted.activeModelId, 'default');
  assert.equal(deleted.models.length, 1);

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

test('OpenAI-compatible model adapter streams text deltas', async () => {
  const events = [];
  const client = createModelClient({
    provider: 'openai', apiKey: 'test', model: 'stream-model', baseUrl: 'https://example.test/v1',
    maxOutputTokens: 100, maxToolRounds: 3, temperature: 0.1
  }, async (url, options) => {
    assert.equal(JSON.parse(options.body).stream, true);
    return sseResponse([
      { choices: [{ delta: { role: 'assistant', content: 'Validation ' }, finish_reason: null }] },
      { choices: [{ delta: { content: 'complete.' }, finish_reason: 'stop' }] },
      '[DONE]'
    ]);
  });
  const result = await client.runTurn([], 'Validate it', [], async () => assert.fail('No tool expected'), {
    onEvent: event => events.push(event)
  });
  assert.equal(result.text, 'Validation complete.');
  assert.deepEqual(events.map(event => event.text), ['Validation ', 'complete.']);
});

test('OpenAI-compatible model adapter does not resend empty reasoning-only assistant messages', async () => {
  const requests = [];
  const responses = [
    sseResponse([
      { choices: [{ delta: { reasoning_content: 'Internal reasoning without a final answer.' }, finish_reason: null }] },
      { choices: [{ delta: {}, finish_reason: 'stop' }] },
      '[DONE]'
    ]),
    sseResponse([
      { choices: [{ delta: { content: 'The selected object has invalid rings.' }, finish_reason: 'stop' }] },
      '[DONE]'
    ])
  ];
  const client = createModelClient({
    provider: 'openai', apiKey: 'test', model: 'deepseek-test', baseUrl: 'https://example.test',
    maxOutputTokens: 100, maxToolRounds: 3, temperature: 0.1
  }, async (url, options) => {
    const body = JSON.parse(options.body);
    requests.push(body);
    if (requests.length === 2) {
      const invalid = body.messages.find(item => item.role === 'assistant' && !item.content && !item.tool_calls?.length);
      assert.equal(invalid, undefined);
      assert.match(body.messages.at(-1).content, /final answer/i);
    }
    return responses.shift();
  });
  const result = await client.runTurn(
    [{ role: 'user', content: 'Validate it' }, { role: 'assistant', content: 'Validation complete.' }],
    'Inspect one invalid object',
    [],
    async () => assert.fail('No tool expected'),
    { onEvent() {} }
  );
  assert.equal(result.text, 'The selected object has invalid rings.');
  assert.equal(requests.length, 2);
});

test('OpenAI-compatible model adapter assembles streamed tool-call fragments', async () => {
  const responses = [
    sseResponse([
      { choices: [{ delta: { tool_calls: [{ index: 0, id: 'call-1', type: 'function', function: { name: 'cityjson_', arguments: '{"dataset' } }] }, finish_reason: null }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, function: { name: 'info', arguments: '_id":"cj_test"}' } }] }, finish_reason: 'tool_calls' }] },
      '[DONE]'
    ]),
    sseResponse([
      { choices: [{ delta: { content: 'Two objects.' }, finish_reason: 'stop' }] },
      '[DONE]'
    ])
  ];
  const calls = [];
  const client = createModelClient({
    provider: 'openai', apiKey: 'test', model: 'stream-model', baseUrl: 'https://example.test/v1',
    maxOutputTokens: 100, maxToolRounds: 3, temperature: 0.1
  }, async () => responses.shift());
  const result = await client.runTurn([], 'Inspect it', [], async (name, args) => {
    calls.push({ name, args });
    return { isError: false, modelContent: '{"cityObjectCount":2}' };
  }, { onEvent() {} });
  assert.deepEqual(calls, [{ name: 'cityjson_info', args: { dataset_id: 'cj_test' } }]);
  assert.equal(result.text, 'Two objects.');
});

test('Anthropic model adapter streams text deltas', async () => {
  const events = [];
  const client = createModelClient({
    provider: 'anthropic', apiKey: 'test', model: 'stream-model', baseUrl: 'https://example.test',
    maxOutputTokens: 100, maxToolRounds: 3, temperature: 0.1
  }, async (url, options) => {
    assert.equal(JSON.parse(options.body).stream, true);
    return sseResponse([
      { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Geometry ' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'checked.' } },
      { type: 'message_delta', delta: { stop_reason: 'end_turn' } }
    ]);
  });
  const result = await client.runTurn([], 'Check it', [], async () => assert.fail('No tool expected'), {
    onEvent: event => events.push(event)
  });
  assert.equal(result.text, 'Geometry checked.');
  assert.deepEqual(events.map(event => event.text), ['Geometry ', 'checked.']);
});

test('Anthropic model adapter assembles streamed tool input', async () => {
  const responses = [
    sseResponse([
      { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'tool-1', name: 'cityjson_info', input: {} } },
      { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"dataset_id":' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '"cj_test"}' } },
      { type: 'message_delta', delta: { stop_reason: 'tool_use' } }
    ]),
    sseResponse([
      { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Two objects.' } },
      { type: 'message_delta', delta: { stop_reason: 'end_turn' } }
    ])
  ];
  const calls = [];
  const client = createModelClient({
    provider: 'anthropic', apiKey: 'test', model: 'stream-model', baseUrl: 'https://example.test',
    maxOutputTokens: 100, maxToolRounds: 3, temperature: 0.1
  }, async () => responses.shift());
  const result = await client.runTurn([], 'Inspect it', [], async (name, args) => {
    calls.push({ name, args });
    return { isError: false, modelContent: '{"cityObjectCount":2}' };
  }, { onEvent() {} });
  assert.deepEqual(calls, [{ name: 'cityjson_info', args: { dataset_id: 'cj_test' } }]);
  assert.equal(result.text, 'Two objects.');
});

test('chat API streams progress and final response events as NDJSON', async t => {
  const input = await fs.mkdtemp(path.join(os.tmpdir(), 'datum-stream-test-'));
  const model = {
    async runTurn(history, message, tools, callTool, { onEvent }) {
      onEvent({ type: 'tool_start', id: 'tool-1', name: 'cityjson_validate' });
      onEvent({ type: 'tool_progress', id: 'tool-1', name: 'cityjson_validate', progress: 1, total: 2, message: 'Structural validation complete' });
      onEvent({ type: 'tool_end', id: 'tool-1', name: 'cityjson_validate', durationMs: 12, isError: false });
      onEvent({ type: 'text_delta', text: 'All checks passed.' });
      return { text: 'All checks passed.', history: [], trace: [{ name: 'cityjson_validate', durationMs: 12, isError: false }] };
    }
  };
  const gateway = {
    tools: [], async connect() {}, async close() {}, modelTools() { return []; },
    async call(name) {
      if (name !== 'cityjson_backend_status') throw new Error(`Unexpected tool ${name}`);
      return { isError: false, structuredContent: { backends: Object.fromEntries(['cjio', 'cjval', 'val3dity', 'citygmlTools', 'cjdb'].map(key => [key, { available: true }])) } };
    }
  };
  const config = getWebConfig({ MODEL_PROVIDER: 'openai', MODEL_NAME: 'test', MODEL_API_KEY: 'test', CITYJSON_MCP_INPUT: input });
  const app = await createChatApplication(config, { gateway, model });
  t.after(async () => { await app.close(); await fs.rm(input, { recursive: true, force: true }); });
  const response = await applicationRequest(app.server, 'POST', '/api/chat', {
    sessionId: 'stream-session-123', clientId: 'stream-client-123', message: 'Validate it', stream: true
  });
  assert.equal(response.status, 200);
  assert.match(response.headers['content-type'], /application\/x-ndjson/);
  const events = ndjsonEvents(response);
  assert.deepEqual(events.map(event => event.type), ['status', 'tool_start', 'tool_progress', 'tool_end', 'text_delta', 'complete']);
  assert.equal(events.at(-1).message, 'All checks passed.');
});

test('chat cancellation aborts an active streamed turn', async t => {
  const input = await fs.mkdtemp(path.join(os.tmpdir(), 'datum-cancel-test-'));
  let turnStarted;
  const started = new Promise(resolve => { turnStarted = resolve; });
  const model = {
    async runTurn(history, message, tools, callTool, { signal }) {
      turnStarted();
      await new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
      assert.fail('Cancelled turn must not complete');
    }
  };
  const gateway = {
    tools: [], async connect() {}, async close() {}, modelTools() { return []; },
    async call(name) {
      if (name !== 'cityjson_backend_status') throw new Error(`Unexpected tool ${name}`);
      return { isError: false, structuredContent: { backends: Object.fromEntries(['cjio', 'cjval', 'val3dity', 'citygmlTools', 'cjdb'].map(key => [key, { available: true }])) } };
    }
  };
  const config = getWebConfig({ MODEL_PROVIDER: 'openai', MODEL_NAME: 'test', MODEL_API_KEY: 'test', CITYJSON_MCP_INPUT: input });
  const app = await createChatApplication(config, { gateway, model });
  t.after(async () => { await app.close(); await fs.rm(input, { recursive: true, force: true }); });
  const ids = { sessionId: 'cancel-session-123', clientId: 'cancel-client-123' };
  const pending = applicationRequest(app.server, 'POST', '/api/chat', { ...ids, message: 'Run validation', stream: true });
  await started;
  const cancellation = await applicationRequest(app.server, 'POST', '/api/chat/cancel', ids);
  assert.deepEqual(JSON.parse(cancellation.body), { cancelled: true });
  const response = await pending;
  assert.equal(ndjsonEvents(response).at(-1).type, 'cancelled');
});

test('command runner terminates a child process when its signal is aborted', async () => {
  const controller = new AbortController();
  const pending = runCommand(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { signal: controller.signal, timeoutMs: 10_000 });
  setTimeout(() => controller.abort(new DOMException('Cancelled by test', 'AbortError')), 20);
  await assert.rejects(pending, error => error.name === 'AbortError');
});

test('OpenAI-compatible model adapter recovers when the first post-tool response is empty', async () => {
  const responses = [
    { choices: [{ message: { role: 'assistant', content: null, tool_calls: [{ id: 'call-1', type: 'function', function: { name: 'cityjson_validate', arguments: '{"dataset_id":"cj_test"}' } }] } }] },
    { choices: [{ message: { role: 'assistant', content: '', reasoning_content: 'Internal analysis only.' } }] },
    { choices: [{ message: { role: 'assistant', content: 'Validation found no structural errors.' } }] }
  ];
  const requests = [];
  const client = createModelClient({
    provider: 'openai', apiKey: 'test', model: 'deepseek-v4-pro', baseUrl: 'https://api.deepseek.com',
    maxOutputTokens: 100, maxToolRounds: 4, temperature: 0.1
  }, async (url, options) => {
    requests.push(JSON.parse(options.body));
    return jsonResponse(responses.shift());
  });
  const result = await client.runTurn([], 'Validate it', [], async () => ({
    isError: false,
    modelContent: '{"valid":true,"errors":[]}'
  }));
  assert.equal(result.text, 'Validation found no structural errors.');
  assert.equal(requests[2].tool_choice, 'none');
  assert.match(requests[2].messages.at(-1).content, /provide the final answer/i);
  assert.equal(result.trace.length, 1);
});

test('OpenAI-compatible model adapter continues answers stopped by the output-token limit', async () => {
  const responses = [
    { choices: [{ finish_reason: 'length', message: { role: 'assistant', content: 'Affected object: `GML' } }] },
    { choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: 'ID_123`. The ring is invalid.' } }] }
  ];
  const requests = [];
  const client = createModelClient({
    provider: 'openai', apiKey: 'test', model: 'deepseek-v4-pro', baseUrl: 'https://api.deepseek.com',
    maxOutputTokens: 100, maxToolRounds: 3, temperature: 0.1
  }, async (url, options) => {
    requests.push(JSON.parse(options.body));
    return jsonResponse(responses.shift());
  });
  const result = await client.runTurn([], 'Explain every issue', [], async () => assert.fail('No tool call expected'));
  assert.equal(result.text, 'Affected object: `GMLID_123`. The ring is invalid.');
  assert.equal(requests[1].tool_choice, 'none');
  assert.match(requests[1].messages.at(-1).content, /continue the answer exactly/i);
});

test('Anthropic model adapter continues answers stopped by the output-token limit', async () => {
  const responses = [
    { stop_reason: 'max_tokens', content: [{ type: 'text', text: 'First part ' }] },
    { stop_reason: 'end_turn', content: [{ type: 'text', text: 'and final part.' }] }
  ];
  const requests = [];
  const client = createModelClient({
    provider: 'anthropic', apiKey: 'test', model: 'test-model', baseUrl: 'https://example.test',
    maxOutputTokens: 100, maxToolRounds: 3, temperature: 0.1
  }, async (url, options) => {
    requests.push(JSON.parse(options.body));
    return jsonResponse(responses.shift());
  });
  const result = await client.runTurn([], 'Explain every issue', [], async () => assert.fail('No tool call expected'));
  assert.equal(result.text, 'First part and final part.');
  assert.equal(requests[1].tools, undefined);
  assert.match(requests[1].messages.at(-1).content, /continue the answer exactly/i);
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
