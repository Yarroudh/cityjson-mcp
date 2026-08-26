#!/usr/bin/env node
import http from 'node:http';
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
  if (!['index.html', 'app.js', 'styles.css'].includes(relative)) return false;
  const filename = path.join(publicRoot, relative);
  const content = await fs.readFile(filename);
  response.writeHead(200, {
    'content-type': MIME_TYPES[path.extname(filename)] || 'application/octet-stream',
    'cache-control': relative === 'index.html' ? 'no-cache' : 'public, max-age=3600'
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
  const model = dependencies.model || createModelClient(config, dependencies.fetchImpl || fetch);
  const sessions = new Map();
  const uploadBatches = new Map();
  const batchTtlMs = 60 * 60 * 1000;

  function pruneState() {
    const now = Date.now();
    for (const [id, batch] of uploadBatches) if (now - batch.createdAt > batchTtlMs) uploadBatches.delete(id);
    if (sessions.size > 100) sessions.delete(sessions.keys().next().value);
  }

  const server = http.createServer(async (request, response) => {
    response.setHeader('x-content-type-options', 'nosniff');
    response.setHeader('x-frame-options', 'DENY');
    response.setHeader('referrer-policy', 'no-referrer');
    response.setHeader('content-security-policy', "default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:; connect-src 'self'");
    const url = new URL(request.url || '/', 'http://localhost');

    try {
      if (request.method === 'GET' && url.pathname === '/api/config') {
        sendJson(response, 200, {
          provider: config.provider,
          model: config.model,
          maxUploadBytes: config.maxUploadBytes,
          maxUploadFiles: config.maxUploadFiles,
          toolCount: gateway.tools.length,
          tools: gateway.tools.map(tool => ({ name: tool.name, title: tool.title || tool.name })),
          backends
        });
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
        const batch = body.batchId ? uploadBatches.get(body.batchId) : undefined;
        if (body.batchId && !batch) throw new Error('The attachment batch is unknown or expired; attach the files again');
        const message = typeof body.message === 'string' ? body.message.trim() : '';
        if (!message && !batch?.files.length) throw new Error('Enter a message or attach a CityJSON file');
        const userMessage = `${message || 'Inspect the attached CityJSON file and summarize it.'}${attachmentContext(batch?.files)}`;
        const current = sessions.get(id) || { history: [] };
        const result = await model.runTurn(
          current.history,
          userMessage,
          gateway.modelTools(config.provider),
          (name, args) => gateway.call(name, args)
        );
        sessions.set(id, { history: result.history, updatedAt: Date.now() });
        pruneState();
        sendJson(response, 200, {
          message: result.text,
          trace: result.trace,
          attachments: batch?.files || []
        });
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
    await app.close();
    process.exit(0);
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
