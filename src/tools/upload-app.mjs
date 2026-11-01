import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as z from 'zod/v4';
import { registerAppTool, registerAppResource, RESOURCE_MIME_TYPE } from '@modelcontextprotocol/ext-apps/server';
import { UploadSessions } from '../core/upload-sessions.mjs';
import { jsonResult, errorResult } from '../util/mcp-result.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const uiDirectory = path.resolve(here, '../ui');
const resourceUri = 'ui://cityjson/upload-app.html';
let htmlPromise;

async function uploadHtml() {
  htmlPromise ||= (async () => {
    const [template, bundle] = await Promise.all([
      fs.readFile(path.join(uiDirectory, 'upload-app.html'), 'utf8'),
      fs.readFile(path.join(uiDirectory, 'upload-app.bundle.js'), 'utf8')
    ]);
    return template.replace('/* UPLOAD_APP_BUNDLE */', () => bundle);
  })().catch(error => { htmlPromise = undefined; throw error; });
  return htmlPromise;
}

function safe(handler) {
  return async args => {
    try { return await handler(args || {}); }
    catch (error) { return errorResult(error); }
  };
}

export function registerUploadApp(server, datasetManager) {
  const uploads = new UploadSessions(datasetManager);

  registerAppTool(server, 'cityjson_upload', {
    title: 'Upload a CityJSON file',
    description: 'Open an in-chat file picker to upload a CityJSON file directly. Use this when the user attached or wants to choose a file that is not visible to the MCP server. The file is transferred outside the model context; no project folder or workspace setup is needed. Pass the user’s question so the app can continue after upload.',
    inputSchema: z.object({
      question: z.string().max(4000).optional().describe('The user’s question about the file, to continue after the upload finishes.')
    }),
    _meta: { ui: { resourceUri } }
  }, safe(async () => jsonResult({ message: 'Select or drop a CityJSON .json file in the upload panel.' })));

  const appOnly = { ui: { visibility: ['app'] } };
  registerAppTool(server, 'cityjson_upload_start', {
    title: 'Start CityJSON upload',
    description: 'Start an upload from the CityJSON file picker.',
    inputSchema: z.object({ filename: z.string().min(1).max(255), size_bytes: z.number().int().positive() }),
    _meta: appOnly
  }, safe(async ({ filename, size_bytes }) => jsonResult(await uploads.start(filename, size_bytes))));

  registerAppTool(server, 'cityjson_upload_chunk', {
    title: 'Send CityJSON upload chunk',
    description: 'Send the next chunk from the CityJSON file picker.',
    inputSchema: z.object({
      upload_id: z.string().uuid(),
      offset: z.number().int().nonnegative(),
      bytes: z.string().min(4).max(360000)
    }),
    _meta: appOnly
  }, safe(async ({ upload_id, offset, bytes }) => jsonResult(await uploads.append(upload_id, offset, bytes))));

  registerAppTool(server, 'cityjson_upload_finish', {
    title: 'Finish CityJSON upload',
    description: 'Validate and register the uploaded CityJSON file.',
    inputSchema: z.object({ upload_id: z.string().uuid() }),
    _meta: appOnly
  }, safe(async ({ upload_id }) => jsonResult(await uploads.finish(upload_id))));

  registerAppTool(server, 'cityjson_upload_cancel', {
    title: 'Cancel CityJSON upload',
    description: 'Discard an unfinished CityJSON upload.',
    inputSchema: z.object({ upload_id: z.string().uuid() }),
    _meta: appOnly
  }, safe(async ({ upload_id }) => {
    await uploads.discard(upload_id);
    return jsonResult({ cancelled: true });
  }));

  registerAppResource(server, resourceUri, resourceUri, { mimeType: RESOURCE_MIME_TYPE }, async () => ({
    contents: [{ uri: resourceUri, mimeType: RESOURCE_MIME_TYPE, text: await uploadHtml() }]
  }));
}
