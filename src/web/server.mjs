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

function beginEventStream(response) {
  response.writeHead(200, {
    'content-type': 'application/x-ndjson; charset=utf-8',
    'cache-control': 'no-cache, no-store',
    connection: 'keep-alive',
    'x-accel-buffering': 'no'
  });
  response.flushHeaders?.();
  return event => {
    if (!response.destroyed && !response.writableEnded) response.write(`${JSON.stringify(event)}\n`);
  };
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

export async function ensureRequestedDownloads(message, latestDatasetId, resources, gateway, sourceDatasetId = latestDatasetId, options = {}) {
  const requested = /\b(download|save (?:it|this|the (?:result|file|dataset)) locally|give me (?:the |a )?file)\b/i.test(message);
  if (!requested || resources.length > 0 || !latestDatasetId) return resources;
  const derivedDatasetRequested = /\b(subset|filter|reproject|transform|triangulat|clean(?:up)?|merge|convert)\b/i.test(message);
  if (derivedDatasetRequested && latestDatasetId === sourceDatasetId) {
    throw new Error('The requested dataset transformation was not completed, so the original file was not offered as the result');
  }
  options.onEvent?.({ type: 'tool_start', id: 'download-fallback', name: 'cityjson_download' });
  const startedAt = Date.now();
  const fallback = await gateway.call('cityjson_download', { dataset_id: latestDatasetId }, options);
  options.onEvent?.({
    type: 'tool_end',
    id: 'download-fallback',
    name: 'cityjson_download',
    durationMs: Date.now() - startedAt,
    isError: fallback.isError === true
  });
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

function activeDatasetContext(datasetId, originalFilename) {
  if (!datasetId) return '';
  const filename = originalFilename ? ` (${JSON.stringify(originalFilename)})` : '';
  return `\n\nActive conversation dataset: dataset_id=${datasetId}${filename}. This is the exact current model for this conversation. Use this dataset ID directly for the user's request. Do not list the inbox, import another file, or ask which dataset they mean.`;
}

async function staticResponse(requestPath, response) {
  const relative = requestPath === '/' ? 'index.html' : requestPath.slice(1);
  const staticFiles = {
    'index.html': path.join(publicRoot, 'index.html'),
    'app.js': path.join(publicRoot, 'app.js'),
    'suggestions.js': path.join(publicRoot, 'suggestions.js'),
    'styles.css': path.join(publicRoot, 'styles.css'),
    'favicon.svg': path.join(publicRoot, 'favicon.svg'),
    'vendor/marked.esm.js': path.join(projectRoot, 'node_modules/marked/lib/marked.esm.js'),
    'vendor/purify.es.mjs': path.join(projectRoot, 'node_modules/dompurify/dist/purify.es.mjs'),
    'vendor/three.module.js': path.join(projectRoot, 'node_modules/three/build/three.module.js'),
    'vendor/three.core.js': path.join(projectRoot, 'node_modules/three/build/three.core.js'),
    'vendor/OrbitControls.js': path.join(projectRoot, 'node_modules/three/examples/jsm/controls/OrbitControls.js'),
    'viewer.js': path.join(publicRoot, 'viewer.js')
  };
  const filename = staticFiles[relative];
  if (!filename) return false;
  let content = await fs.readFile(filename);
  if (relative === 'vendor/OrbitControls.js') {
    content = Buffer.from(content.toString('utf8').replace("from 'three';", "from '/vendor/three.module.js';"));
  }
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
  const defaultProfile = defaultModel && config.model
    ? { id: 'default', config, client: defaultModel, isDefault: true }
    : null;
  const sessions = new Map();
  const uploadBatches = new Map();
  const modelConfigurations = new Map();
  const downloadStore = new Map();
  const activeTurns = new Map();
  const batchTtlMs = 8 * 60 * 60 * 1000;
  const downloadTtlMs = 30 * 60 * 1000;
  const modelConfigurationTtlMs = 8 * 60 * 60 * 1000;

  function configurationFor(clientId, create = false) {
    let state = clientId ? modelConfigurations.get(clientId) : undefined;
    if (!state && create) {
      state = { profiles: new Map(), activeId: defaultProfile?.id || null, updatedAt: Date.now() };
      modelConfigurations.set(clientId, state);
    }
    return state;
  }

  function profilesFor(clientId) {
    const state = configurationFor(clientId);
    return [defaultProfile, ...(state?.profiles.values() || [])].filter(Boolean);
  }

  function modelFor(clientId) {
    const state = configurationFor(clientId);
    const activeId = state?.activeId || defaultProfile?.id || null;
    const selected = activeId === defaultProfile?.id
      ? defaultProfile
      : state?.profiles.get(activeId);
    return selected || defaultProfile || { id: null, config, client: null, isDefault: false };
  }

  function publicModelState(clientId) {
    const selected = modelFor(clientId);
    const models = profilesFor(clientId).map(profile => ({
      id: profile.id,
      ...publicModelConfig(profile.config),
      isDefault: profile.isDefault === true
    }));
    return {
      ...publicModelConfig(selected.config),
      activeModelId: selected.id,
      modelConfigured: Boolean(selected.client),
      models
    };
  }

  function clearClientSessions(clientId) {
    for (const active of activeTurns.values()) {
      if (active.clientId === clientId) active.controller.abort(new DOMException('The model configuration changed', 'AbortError'));
    }
    for (const [sessionId, session] of sessions) if (session.clientId === clientId) sessions.delete(sessionId);
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
    let streamEvent = null;
    let turnController = null;
    let turnCleanup = null;
    response.setHeader('x-content-type-options', 'nosniff');
    response.setHeader('x-frame-options', 'DENY');
    response.setHeader('referrer-policy', 'no-referrer');
    response.setHeader('content-security-policy', "default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:; connect-src 'self'");
    const url = new URL(request.url || '/', 'http://localhost');

    try {
      if (request.method === 'GET' && url.pathname === '/api/config') {
        const browserId = url.searchParams.get('clientId');
        sendJson(response, 200, {
          ...publicModelState(browserId),
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

      if (request.method === 'POST' && ['/api/models', '/api/model/configure'].includes(url.pathname)) {
        const body = await readJson(request, 32 * 1024);
        const id = clientKey(body.clientId);
        const selectedConfig = configuredModel(config, body, { ...config, apiKey: null });
        const selectedClient = createModelClient(selectedConfig, dependencies.fetchImpl || fetch);
        await selectedClient.testConnection();
        const modelId = `model-${crypto.randomUUID()}`;
        const state = configurationFor(id, true);
        state.profiles.set(modelId, {
          id: modelId,
          config: selectedConfig,
          client: selectedClient,
          isDefault: false
        });
        state.activeId = modelId;
        state.updatedAt = Date.now();
        clearClientSessions(id);
        pruneState();
        sendJson(response, 201, publicModelState(id));
        return;
      }

      const modelRoute = /^\/api\/models\/(model-[0-9a-f-]{36})$/.exec(url.pathname);
      if (request.method === 'PUT' && modelRoute) {
        const body = await readJson(request, 32 * 1024);
        const id = clientKey(body.clientId);
        const state = configurationFor(id);
        const profile = state?.profiles.get(modelRoute[1]);
        if (!profile) throw new Error('The selected model is unknown or has expired');
        const selectedConfig = configuredModel(config, body, profile.config);
        const selectedClient = createModelClient(selectedConfig, dependencies.fetchImpl || fetch);
        await selectedClient.testConnection();
        state.profiles.set(profile.id, {
          ...profile,
          config: selectedConfig,
          client: selectedClient
        });
        state.updatedAt = Date.now();
        clearClientSessions(id);
        pruneState();
        sendJson(response, 200, publicModelState(id));
        return;
      }

      if (request.method === 'DELETE' && modelRoute) {
        const body = await readJson(request, 32 * 1024);
        const id = clientKey(body.clientId);
        const state = configurationFor(id);
        if (!state?.profiles.has(modelRoute[1])) throw new Error('The selected model is unknown or has expired');
        state.profiles.delete(modelRoute[1]);
        if (state.activeId === modelRoute[1]) {
          state.activeId = defaultProfile?.id || state.profiles.keys().next().value || null;
        }
        state.updatedAt = Date.now();
        clearClientSessions(id);
        pruneState();
        sendJson(response, 200, publicModelState(id));
        return;
      }

      if (request.method === 'POST' && url.pathname === '/api/models/select') {
        const body = await readJson(request, 32 * 1024);
        const id = clientKey(body.clientId);
        const modelId = typeof body.modelId === 'string' ? body.modelId : '';
        const state = configurationFor(id, true);
        const exists = modelId === defaultProfile?.id || state.profiles.has(modelId);
        if (!exists) throw new Error('The selected model is unknown or has expired');
        state.activeId = modelId;
        state.updatedAt = Date.now();
        clearClientSessions(id);
        pruneState();
        sendJson(response, 200, publicModelState(id));
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

      if (request.method === 'POST' && url.pathname === '/api/chat/cancel') {
        const body = await readJson(request, 32 * 1024);
        const id = sessionKey(body.sessionId);
        const browserId = clientKey(body.clientId);
        const active = activeTurns.get(id);
        if (active && active.clientId === browserId) {
          active.controller.abort(new DOMException('The chat turn was cancelled', 'AbortError'));
          sendJson(response, 200, { cancelled: true });
        } else {
          sendJson(response, 200, { cancelled: false });
        }
        return;
      }

      if (request.method === 'POST' && url.pathname === '/api/chat') {
        const body = await readJson(request);
        const id = sessionKey(body.sessionId);
        const browserId = clientKey(body.clientId);
        if (activeTurns.has(id)) throw new Error('A response is already in progress for this conversation');
        const selected = modelFor(browserId);
        if (!selected.client) throw new Error('Configure a model before sending a message');
        turnController = new AbortController();
        activeTurns.set(id, { clientId: browserId, controller: turnController });
        turnCleanup = () => {
          if (activeTurns.get(id)?.controller === turnController) activeTurns.delete(id);
        };
        if (body.stream === true) {
          streamEvent = beginEventStream(response);
          streamEvent({ type: 'status', phase: 'preparing', message: 'Preparing the conversation' });
          response.once('close', () => {
            if (!response.writableEnded && !turnController.signal.aborted) {
              turnController.abort(new DOMException('The browser disconnected', 'AbortError'));
            }
          });
        }
        if (modelConfigurations.has(browserId)) modelConfigurations.get(browserId).updatedAt = Date.now();
        const modelFingerprint = `${selected.config.provider}\u0000${selected.config.model}\u0000${selected.config.baseUrl}`;
        const batch = body.batchId ? uploadBatches.get(body.batchId) : undefined;
        const requestedDatasetId = typeof body.datasetId === 'string' && /^[A-Za-z0-9_.:-]{3,300}$/.test(body.datasetId.trim())
          ? body.datasetId.trim()
          : null;
        const storedFilename = typeof body.storedFilename === 'string' && body.storedFilename === path.basename(body.storedFilename) && body.storedFilename.length <= 255
          ? body.storedFilename
          : null;
        const originalFilename = typeof body.originalFilename === 'string' && body.originalFilename.length <= 255
          ? body.originalFilename
          : null;
        if (body.batchId && !batch && !requestedDatasetId) throw new Error('The attachment batch is unknown or expired; attach the files again');
        const message = typeof body.message === 'string' ? body.message.trim() : '';
        if (!message && !batch?.files.length) throw new Error('Enter a message or attach a CityJSON file');
        const storedSession = sessions.get(id);
        const current = storedSession?.modelFingerprint === modelFingerprint
          ? storedSession
          : { history: [], turns: [] };
        const retryTurn = Number.isSafeInteger(body.retryTurn) && body.retryTurn >= 0 ? body.retryTurn : null;
        let history = current.history || [];
        let turns = current.turns || [];
        let previousDatasetId = current.latestDatasetId;
        let latestDatasetIsDerived = current.latestDatasetIsDerived ?? body.datasetIsDerived === true;
        if (retryTurn !== null) {
          const checkpoint = turns[retryTurn];
          if (!checkpoint) throw new Error('This question can no longer be retried because its server-side conversation state has expired');
          history = checkpoint.historyBefore;
          previousDatasetId = checkpoint.latestDatasetIdBefore;
          latestDatasetIsDerived = checkpoint.latestDatasetIsDerivedBefore === true;
          turns = turns.slice(0, retryTurn);
        }
        let latestDatasetId = batch?.files.at(-1)?.summary?.datasetId || previousDatasetId || requestedDatasetId;
        if (batch?.files.length) latestDatasetIsDerived = false;
        if (!batch && !previousDatasetId && latestDatasetId) {
          const inspection = await gateway.call('cityjson_info', { dataset_id: latestDatasetId }, { signal: turnController.signal });
          if (inspection.isError) {
            if (latestDatasetIsDerived) throw new Error('The derived dataset for this conversation expired after the server restarted. Recreate the transformation from the original file.');
            if (!storedFilename) throw new Error('The active dataset expired and its source filename is unavailable. Import the file again.');
            const recovered = await gateway.call('cityjson_import', { filename: storedFilename }, { signal: turnController.signal });
            if (recovered.isError || typeof recovered.structuredContent?.datasetId !== 'string') {
              throw new Error(`The active conversation file could not be restored: ${recovered.modelContent || 'import failed'}`);
            }
            latestDatasetId = recovered.structuredContent.datasetId;
            latestDatasetIsDerived = false;
          }
        }
        const userMessage = `${message || 'Inspect the attached CityJSON file and summarize it.'}${attachmentContext(batch?.files)}${activeDatasetContext(latestDatasetId, originalFilename)}`;
        const checkpoint = { historyBefore: history, latestDatasetIdBefore: latestDatasetId, latestDatasetIsDerivedBefore: latestDatasetIsDerived };
        const sourceDatasetId = latestDatasetId;
        const resources = [];
        const callTool = async (name, args, options = {}) => {
          const toolResult = await gateway.call(name, args, options);
          if (!toolResult.isError && typeof toolResult.structuredContent?.datasetId === 'string') {
            const changedDataset = toolResult.structuredContent.datasetId !== latestDatasetId;
            latestDatasetId = toolResult.structuredContent.datasetId;
            if (changedDataset) latestDatasetIsDerived = !['cityjson_import', 'cityjson_import_text', 'cityjson_open'].includes(name);
          }
          resources.push(...(toolResult.downloads || []));
          return toolResult;
        };
        const result = await selected.client.runTurn(
          history,
          userMessage,
          gateway.modelTools(selected.config.provider),
          callTool,
          {
            signal: turnController.signal,
            onEvent: streamEvent || undefined
          }
        );
        await ensureRequestedDownloads(message, latestDatasetId, resources, gateway, sourceDatasetId, {
          signal: turnController.signal,
          onEvent: streamEvent || undefined,
          onProgress: progress => streamEvent?.({ type: 'tool_progress', id: 'download-fallback', name: 'cityjson_download', ...progress })
        });
        sessions.set(id, {
          history: result.history,
          updatedAt: Date.now(),
          clientId: browserId,
          modelFingerprint,
          latestDatasetId,
          latestDatasetIsDerived,
          turns: [...turns, checkpoint]
        });
        pruneState();
        const payload = {
          message: result.text,
          trace: result.trace,
          attachments: batch?.files || [],
          downloads: registerDownloads(resources),
          datasetId: latestDatasetId,
          datasetIsDerived: latestDatasetIsDerived
        };
        if (streamEvent) {
          streamEvent({ type: 'complete', ...payload });
          response.end();
        } else {
          sendJson(response, 200, payload);
        }
        return;
      }

      if (request.method === 'POST' && url.pathname === '/api/datasets/view') {
        const body = await readJson(request, 32 * 1024);
        const datasetId = typeof body.datasetId === 'string' ? body.datasetId.trim() : '';
        if (!/^[A-Za-z0-9_.:-]{3,300}$/.test(datasetId)) throw new Error('A valid datasetId is required');
        const result = await gateway.call('cityjson_download', { dataset_id: datasetId });
        if (result.isError) throw new Error(result.modelContent || 'The dataset could not be prepared for viewing');
        const resource = result.downloads?.[0];
        if (!resource) throw new Error('The dataset did not produce a viewable CityJSON file');
        const content = resource.path ? await fs.readFile(resource.path, 'utf8') : resource.content;
        let cityjson;
        try { cityjson = JSON.parse(content); }
        catch (error) { throw new Error(`The current dataset is not valid JSON: ${error.message}`); }
        sendJson(response, 200, cityjson);
        return;
      }

      if (request.method === 'POST' && url.pathname === '/api/datasets/download') {
        const body = await readJson(request, 32 * 1024);
        const datasetId = typeof body.datasetId === 'string' ? body.datasetId.trim() : '';
        if (!/^[A-Za-z0-9_.:-]{3,300}$/.test(datasetId)) throw new Error('A valid datasetId is required');
        const result = await gateway.call('cityjson_download', { dataset_id: datasetId });
        if (result.isError) throw new Error(result.modelContent || 'The dataset could not be prepared for download');
        const downloads = registerDownloads(result.downloads || []);
        if (!downloads.length) throw new Error('The dataset did not produce a downloadable file');
        pruneState();
        sendJson(response, 200, { downloads });
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
        const id = sessionKey(body.sessionId);
        activeTurns.get(id)?.controller.abort(new DOMException('The conversation was reset', 'AbortError'));
        sessions.delete(id);
        sendJson(response, 200, { reset: true });
        return;
      }

      if (request.method === 'GET' && await staticResponse(url.pathname, response)) return;
      sendJson(response, 404, { error: 'Not found' });
    } catch (error) {
      if (streamEvent) {
        const cancelled = turnController?.signal.aborted || error?.name === 'AbortError';
        streamEvent(cancelled
          ? { type: 'cancelled', message: 'Response cancelled.' }
          : { type: 'error', error: error.message });
        if (!response.writableEnded) response.end();
      } else {
        const status = /too large|exceeds|At most/.test(error.message) ? 413 : 400;
        sendJson(response, status, { error: error.message });
      }
    } finally {
      turnCleanup?.();
    }
  });

  return {
    server,
    gateway,
    async close() {
      for (const active of activeTurns.values()) active.controller.abort(new DOMException('The server is shutting down', 'AbortError'));
      activeTurns.clear();
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
  console.log(`Datum listening on http://${config.host}:${config.port} (${config.provider}/${config.model})`);

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
