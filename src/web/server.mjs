#!/usr/bin/env node
import http from 'node:http';
import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadEnvFile, getWebConfig } from './env.mjs';
import { McpGateway } from './mcp-gateway.mjs';
import { createModelClient } from './model-client.mjs';
import { receiveUploads } from './uploads.mjs';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const publicRoot = path.join(projectRoot, 'web');
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml'
};

function sendJson(response, status, value) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(value));
}

async function readJson(request, maxBytes = 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBytes) throw new Error('JSON request body is too large');
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); }
  catch (error) { throw new Error(`Invalid JSON request: ${error.message}`); }
}

function sessionKey(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{8,100}$/.test(value)) throw new Error('A valid sessionId is required');
  return value;
}

function clientKey(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{8,100}$/.test(value)) throw new Error('A valid clientId is required');
  return value;
}

export function configuredModel(baseConfig, input, previousConfig = baseConfig) {
  const provider = typeof input.provider === 'string' ? input.provider.trim().toLowerCase() : '';
  if (!['anthropic', 'openai'].includes(provider)) throw new Error('Model provider must be anthropic or openai');
  const model = typeof input.model === 'string' ? input.model.trim() : '';
  if (!model || model.length > 200) throw new Error('Enter a valid model name');
  const rawBaseUrl = typeof input.baseUrl === 'string' ? input.baseUrl.trim() : '';
  if (!rawBaseUrl || rawBaseUrl.length > 2048) throw new Error('Enter a valid model base URL');
  let parsedUrl;
  try { parsedUrl = new URL(rawBaseUrl); }
  catch { throw new Error('Model base URL must be a valid URL'); }
  if (!['http:', 'https:'].includes(parsedUrl.protocol) || parsedUrl.username || parsedUrl.password) {
    throw new Error('Model base URL must use HTTP(S) and cannot contain credentials');
  }
  const suppliedKey = typeof input.apiKey === 'string' ? input.apiKey.trim() : '';
  const apiKey = suppliedKey || previousConfig.apiKey;
  if (!apiKey || apiKey.length > 10000) throw new Error('Enter a valid API key');
  return { ...baseConfig, provider, model, apiKey, baseUrl: rawBaseUrl.replace(/\/$/, '') };
}

function publicModelConfig(config) {
  return { provider: config.provider, model: config.model, baseUrl: config.baseUrl };
}

export async function ensureRequestedDownloads(message, latestDatasetId, resources, gateway) {
  const requested = /\b(download|save (?:it|this|the (?:result|file|dataset)) locally|give me (?:the |a )?file)\b/i.test(message);
  if (!requested || resources.length > 0 || !latestDatasetId) return resources;
  const fallback = await gateway.call('cityjson_download', { dataset_id: latestDatasetId });
  if (!fallback.isError) resources.push(...(fallback.downloads || []));
  return resources;
}

function attachmentContext(files) {
  if (!files?.length) return '';
  const lines = files.map(file => {
    const summary = file.summary || {};
    return `- ${JSON.stringify(file.originalFilename)}: dataset_id=${summary.datasetId}, stored inbox filename=${JSON.stringify(file.filename)}, size=${file.sizeBytes} bytes, CityObjects=${summary.cityObjectCount ?? 'unknown'}, vertices=${summary.vertexCount ?? 'unknown'}`;
  });
  return `\n\nThe chat host already imported these attachments through MCP. Use their dataset IDs directly:\n${lines.join('\n')}`;
}

async function staticResponse(requestPath, response) {
  const relative = requestPath === '/' ? 'index.html' : requestPath.slice(1);
  const staticFiles = {
    'index.html': path.join(publicRoot, 'index.html'),
    'app.js': path.join(publicRoot, 'app.js'),
    'styles.css': path.join(publicRoot, 'styles.css'),
    'vendor/marked.esm.js': path.join(projectRoot, 'node_modules/marked/lib/marked.esm.js'),
    'vendor/purify.es.mjs': path.join(projectRoot, 'node_modules/dompurify/dist/purify.es.mjs')
  };
  const filename = staticFiles[relative];
  if (!filename) return false;
  const content = await fs.readFile(filename);
  const applicationAsset = ['index.html', 'app.js', 'styles.css'].includes(relative);
  response.writeHead(200, {
    'content-type': MIME_TYPES[path.extname(filename)] || 'application/octet-stream',
    'cache-control': applicationAsset ? 'no-store' : 'public, max-age=86400, immutable'
  });
  response.end(content);
  return true;
}

export async function createChatApplication(config = getWebConfig(), dependencies = {}) {
  await fs.mkdir(config.input, { recursive: true });
  process.env.CITYJSON_MCP_INPUT = config.input;
  const gateway = dependencies.gateway || new McpGateway({ maxToolResultChars: config.maxToolResultChars });
  await gateway.connect();
  let backendResult;
  try {
    backendResult = await gateway.call('cityjson_backend_status');
  } catch (error) {
    await gateway.close();
    throw new Error(`The MCP backend readiness check failed: ${error.message}`);
  }
  if (backendResult.isError || !backendResult.structuredContent?.backends) {
    await gateway.close();
    throw new Error('The MCP backend readiness check failed; the chat application was not started');
  }
  const backends = backendResult.structuredContent.backends;
  const missingBackends = Object.entries(backends)
    .filter(([, status]) => status?.available !== true)
    .map(([name]) => name);
  if (missingBackends.length && !config.allowPartialBackends) {
    await gateway.close();
    throw new Error(`The chat application requires the complete CityJSON backend bundle. Missing: ${missingBackends.join(', ')}. Start it with \`npm run chat\` (Docker), or explicitly set CHAT_ALLOW_PARTIAL_BACKENDS=true for inspection-only host mode.`);
  }
  const defaultModel = dependencies.model || (config.model && config.apiKey
    ? createModelClient(config, dependencies.fetchImpl || fetch)
    : null);
  const sessions = new Map();
  const uploadBatches = new Map();
  const modelConfigurations = new Map();
  const downloadStore = new Map();
  const batchTtlMs = 60 * 60 * 1000;
  const downloadTtlMs = 30 * 60 * 1000;
  const modelConfigurationTtlMs = 8 * 60 * 60 * 1000;

  function modelFor(clientId) {
    return clientId ? modelConfigurations.get(clientId) || { config, client: defaultModel } : { config, client: defaultModel };
  }

  function registerDownloads(resources) {
    return resources.map(resource => {
      const id = crypto.randomUUID();
      const filename = path.basename(resource.filename || 'cityjson-download.json').replace(/[^A-Za-z0-9._-]/g, '_');
      const sizeBytes = resource.sizeBytes ?? Buffer.byteLength(resource.content, 'utf8');
      downloadStore.set(id, { ...resource, filename, sizeBytes, createdAt: Date.now() });
      return { id, filename, mimeType: resource.mimeType, sizeBytes, url: `/api/downloads/${id}` };
    });
  }

  function pruneState() {
    const now = Date.now();
    for (const [id, batch] of uploadBatches) if (now - batch.createdAt > batchTtlMs) uploadBatches.delete(id);
    for (const [id, download] of downloadStore) if (now - download.createdAt > downloadTtlMs) downloadStore.delete(id);
    for (const [id, selected] of modelConfigurations) if (now - selected.updatedAt > modelConfigurationTtlMs) modelConfigurations.delete(id);
    if (sessions.size > 100) sessions.delete(sessions.keys().next().value);
    if (modelConfigurations.size > 100) modelConfigurations.delete(modelConfigurations.keys().next().value);
    if (downloadStore.size > 100) downloadStore.delete(downloadStore.keys().next().value);
  }

  const server = http.createServer(async (request, response) => {
    response.setHeader('x-content-type-options', 'nosniff');
    response.setHeader('x-frame-options', 'DENY');
    response.setHeader('referrer-policy', 'no-referrer');
    response.setHeader('content-security-policy', "default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:; connect-src 'self'");
    const url = new URL(request.url || '/', 'http://localhost');

    try {
      if (request.method === 'GET' && url.pathname === '/api/config') {
        const selected = modelFor(url.searchParams.get('clientId'));
        sendJson(response, 200, {
          ...publicModelConfig(selected.config),
          modelConfigured: Boolean(selected.client),
          maxUploadBytes: config.maxUploadBytes,
          maxUploadFiles: config.maxUploadFiles,
          toolCount: gateway.tools.length,
          tools: gateway.tools.map(tool => ({
            name: tool.name,
            title: tool.title || tool.name,
            description: tool.description || '',
            inputSchema: tool.inputSchema || { type: 'object', properties: {} }
          })),
          backends
        });
        return;
      }

      if (request.method === 'POST' && url.pathname === '/api/model/configure') {
        const body = await readJson(request, 32 * 1024);
        const id = clientKey(body.clientId);
        const previous = modelFor(id).config;
        const selectedConfig = configuredModel(config, body, previous);
        modelConfigurations.set(id, {
          config: selectedConfig,
          client: createModelClient(selectedConfig, dependencies.fetchImpl || fetch),
          updatedAt: Date.now()
        });
        for (const [sessionId, session] of sessions) if (session.clientId === id) sessions.delete(sessionId);
        pruneState();
        sendJson(response, 200, { ...publicModelConfig(selectedConfig), modelConfigured: true });
        return;
      }

      if (request.method === 'POST' && url.pathname === '/api/uploads') {
        const uploaded = await receiveUploads(request, config);
        try {
          const imported = [];
          for (const file of uploaded) {
            const result = await gateway.call('cityjson_import', { filename: file.filename });
            if (result.isError) throw new Error(`Could not import ${file.originalFilename}: ${result.modelContent}`);
            imported.push({ ...file, summary: result.structuredContent });
          }
          const batchId = crypto.randomUUID();
          uploadBatches.set(batchId, { createdAt: Date.now(), files: imported });
          pruneState();
          sendJson(response, 201, { batchId, files: imported });
        } catch (error) {
          await Promise.allSettled(uploaded.map(file => fs.rm(path.join(config.input, file.filename), { force: true })));
          throw error;
        }
        return;
      }

      if (request.method === 'POST' && url.pathname === '/api/chat') {
        const body = await readJson(request);
        const id = sessionKey(body.sessionId);
        const browserId = clientKey(body.clientId);
        const selected = modelFor(browserId);
        if (!selected.client) throw new Error('Configure a model before sending a message');
        if (modelConfigurations.has(browserId)) selected.updatedAt = Date.now();
        const modelFingerprint = `${selected.config.provider}\u0000${selected.config.model}\u0000${selected.config.baseUrl}`;
        const batch = body.batchId ? uploadBatches.get(body.batchId) : undefined;
        if (body.batchId && !batch) throw new Error('The attachment batch is unknown or expired; attach the files again');
        const message = typeof body.message === 'string' ? body.message.trim() : '';
        if (!message && !batch?.files.length) throw new Error('Enter a message or attach a CityJSON file');
        const userMessage = `${message || 'Inspect the attached CityJSON file and summarize it.'}${attachmentContext(batch?.files)}`;
        const storedSession = sessions.get(id);
        const current = storedSession?.modelFingerprint === modelFingerprint ? storedSession : { history: [] };
        let latestDatasetId = batch?.files.at(-1)?.summary?.datasetId || current.latestDatasetId;
        const resources = [];
        const callTool = async (name, args) => {
          const toolResult = await gateway.call(name, args);
          if (!toolResult.isError && typeof toolResult.structuredContent?.datasetId === 'string') {
            latestDatasetId = toolResult.structuredContent.datasetId;
          }
          resources.push(...(toolResult.downloads || []));
          return toolResult;
        };
        const result = await selected.client.runTurn(
          current.history || [],
          userMessage,
          gateway.modelTools(selected.config.provider),
          callTool
        );
        await ensureRequestedDownloads(message, latestDatasetId, resources, gateway);
        sessions.set(id, {
          history: result.history,
          updatedAt: Date.now(),
          clientId: browserId,
          modelFingerprint,
          latestDatasetId
        });
        pruneState();
        sendJson(response, 200, {
          message: result.text,
          trace: result.trace,
          attachments: batch?.files || [],
          downloads: registerDownloads(resources)
        });
        return;
      }

      if (request.method === 'GET' && url.pathname.startsWith('/api/downloads/')) {
        const id = url.pathname.slice('/api/downloads/'.length);
        if (!/^[0-9a-f-]{36}$/.test(id)) throw new Error('Invalid download link');
        const download = downloadStore.get(id);
        if (!download) {
          sendJson(response, 404, { error: 'This download is unavailable or has expired' });
          return;
        }
        response.writeHead(200, {
          'content-type': download.mimeType || 'application/octet-stream',
          'content-length': download.sizeBytes,
          'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(download.filename)}`,
          'cache-control': 'private, no-store'
        });
        if (download.path) {
          const stream = createReadStream(download.path);
          stream.on('error', error => response.destroy(error));
          stream.pipe(response);
        } else {
          response.end(download.content);
        }
        return;
      }

      if (request.method === 'POST' && url.pathname === '/api/session/reset') {
        const body = await readJson(request);
        sessions.delete(sessionKey(body.sessionId));
        sendJson(response, 200, { reset: true });
        return;
      }

      if (request.method === 'GET' && await staticResponse(url.pathname, response)) return;
      sendJson(response, 404, { error: 'Not found' });
    } catch (error) {
      const status = /too large|exceeds|At most/.test(error.message) ? 413 : 400;
      sendJson(response, status, { error: error.message });
    }
  });

  return {
    server,
    gateway,
    async close() {
      if (server.listening) await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
      await gateway.close();
    }
  };
}

export async function startChatApplication() {
  await loadEnvFile(path.join(projectRoot, '.env'));
  const config = getWebConfig();
  const app = await createChatApplication(config);
  await new Promise((resolve, reject) => {
    app.server.once('error', reject);
    app.server.listen(config.port, config.host, resolve);
  });
  console.log(`DATUM listening on http://${config.host}:${config.port} (${config.provider}/${config.model})`);

  const shutdown = async () => {
    const forceExit = setTimeout(() => process.exit(0), 3000);
    forceExit.unref();
    try { await app.close(); }
    finally {
      clearTimeout(forceExit);
      process.exit(0);
    }
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
  return app;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  startChatApplication().catch(error => {
    console.error(`[cityjson-chat] ${error.message}`);
    process.exitCode = 1;
  });
}
