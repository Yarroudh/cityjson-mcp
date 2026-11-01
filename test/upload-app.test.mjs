import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { DatasetManager } from '../src/core/dataset-manager.mjs';
import { UploadSessions } from '../src/core/upload-sessions.mjs';
import { registerUploadApp } from '../src/tools/upload-app.mjs';

const samplePath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../examples/minimal.city.json');

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cityjson-app-upload-'));
  const input = path.join(root, 'input');
  const workspace = path.join(root, 'workspace');
  await fs.mkdir(input);
  await fs.mkdir(workspace);
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const policy = {
    input,
    workspace,
    inputPath: filename => path.join(input, filename),
    workspacePath: name => path.join(workspace, name),
    assertReadable: value => value
  };
  return { input, dm: new DatasetManager(policy) };
}

test('the in-chat picker uploads chunks and registers only the original filename', async t => {
  const { input, dm } = await fixture(t);
  const uploads = new UploadSessions(dm);
  const content = await fs.readFile(samplePath);
  const { upload_id } = await uploads.start('buildings.city.json', content.length);
  const midpoint = Math.floor(content.length / 2);
  await uploads.append(upload_id, 0, content.subarray(0, midpoint).toString('base64'));
  await uploads.append(upload_id, midpoint, content.subarray(midpoint).toString('base64'));
  const imported = await uploads.finish(upload_id);
  assert.equal(imported.filename, 'buildings.city.json');
  assert.equal(imported.cityObjectCount, 2);
  assert.equal(dm.get('buildings.city.json').id, imported.datasetId);
  assert.deepEqual(await fs.readdir(input), []);
  assert.deepEqual(await fs.readFile(dm.get('buildings.city.json').path), content);
});

test('upload chunks reject out of order data and invalid CityJSON is removed', async t => {
  const { input, dm } = await fixture(t);
  const uploads = new UploadSessions(dm, { maxBytes: 32 });
  await assert.rejects(() => uploads.start('model.city.json', 33), /at most 32/);
  const invalid = Buffer.from('{"type":"wrong"}');
  const { upload_id } = await uploads.start('model.city.json', invalid.length);
  await assert.rejects(() => uploads.append(upload_id, 1, invalid.toString('base64')), /out of order/);
  await uploads.append(upload_id, 0, invalid.toString('base64'));
  await assert.rejects(() => uploads.finish(upload_id), /Expected root type CityJSON/);
  assert.deepEqual(await fs.readdir(input), []);
});

test('upload tool advertises an MCP App and keeps chunk tools app-only', async t => {
  const { dm } = await fixture(t);
  const tools = new Map();
  const resources = new Map();
  const server = {
    registerTool(name, config, callback) { tools.set(name, { config, callback }); return {}; },
    registerResource(name, uri, config, callback) { resources.set(uri, { config, callback }); return {}; }
  };
  registerUploadApp(server, dm);
  assert.equal(tools.get('cityjson_upload').config._meta.ui.resourceUri, 'ui://cityjson/upload-app.html');
  assert.deepEqual(tools.get('cityjson_upload_chunk').config._meta.ui.visibility, ['app']);
  const resource = resources.get('ui://cityjson/upload-app.html');
  const result = await resource.callback();
  assert.equal(result.contents[0].mimeType, 'text/html;profile=mcp-app');
  assert.match(result.contents[0].text, /type="file"/);
  assert.doesNotMatch(result.contents[0].text, /UPLOAD_APP_BUNDLE/);

  const content = await fs.readFile(samplePath);
  const started = await tools.get('cityjson_upload_start').callback({ filename: 'buildings.city.json', size_bytes: content.length });
  const uploadId = started.structuredContent.upload_id;
  await tools.get('cityjson_upload_chunk').callback({ upload_id: uploadId, offset: 0, bytes: content.toString('base64') });
  const finished = await tools.get('cityjson_upload_finish').callback({ upload_id: uploadId });
  assert.equal(finished.structuredContent.filename, 'buildings.city.json');
  assert.equal(finished.structuredContent.datasetId, undefined);
  assert.doesNotMatch(finished.content[0].text, /cj_[a-f0-9]{12}/);
});
