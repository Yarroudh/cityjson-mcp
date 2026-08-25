import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { readCityJSON, summarizeCityJSON, objectBBox, queryCityObjects } from '../src/core/cityjson-native.mjs';
import { DatasetManager } from '../src/core/dataset-manager.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const samplePath = path.join(root, 'examples', 'minimal.city.json');

test('summarizes a CityJSON dataset', async () => {
  const json = await readCityJSON(samplePath);
  const summary = summarizeCityJSON(json);
  assert.equal(summary.version, '2.0');
  assert.equal(summary.cityObjectCount, 2);
  assert.equal(summary.typeCounts.Building, 1);
  assert.deepEqual(summary.lods, ['1', '2.2']);
});

test('computes real-world bounding boxes through transform', async () => {
  const json = await readCityJSON(samplePath);
  assert.deepEqual(objectBBox(json, json.CityObjects['building-1']), [100, 200, 0, 110, 210, 0]);
});

test('queries by type, bbox and attribute predicate', async () => {
  const json = await readCityJSON(samplePath);
  const result = queryCityObjects(json, {
    types: ['Building'],
    bbox: [99, 199, 111, 211],
    attributes: { yearOfConstruction: { gte: 2010 } }
  });
  assert.equal(result.totalMatched, 1);
  assert.equal(result.objects[0].id, 'building-1');
});

test('sample is valid JSON', async () => {
  const raw = await fs.readFile(samplePath, 'utf8');
  assert.doesNotThrow(() => JSON.parse(raw));
});

test('imports CityJSON content into the managed workspace', async t => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'cityjson-upload-test-'));
  t.after(() => fs.rm(workspace, { recursive: true, force: true }));
  const dm = new DatasetManager({
    workspace,
    workspacePath: name => path.join(workspace, name),
    assertReadable: value => value
  });
  const content = await fs.readFile(samplePath, 'utf8');
  const uploaded = await dm.importContent(content, '../unsafe name.city.json');
  assert.equal(uploaded.operation, 'upload');
  assert.equal(uploaded.cityObjectCount, 2);
  assert.equal(path.dirname(uploaded.path), workspace);
  assert.equal((await dm.load(uploaded.datasetId)).type, 'CityJSON');
  const downloaded = await dm.downloadContent(uploaded.datasetId, '../clean model.city.json');
  assert.equal(downloaded.filename, 'clean_model.city.json');
  assert.equal(downloaded.mimeType, 'application/json');
  assert.deepEqual(JSON.parse(downloaded.content), JSON.parse(content));
});

test('rejects invalid uploaded content before writing a file', async t => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'cityjson-upload-test-'));
  t.after(() => fs.rm(workspace, { recursive: true, force: true }));
  const dm = new DatasetManager({ workspace, workspacePath: name => path.join(workspace, name) });
  await assert.rejects(() => dm.importContent('{"type":"not-cityjson"}'), /Expected root type CityJSON/);
  assert.deepEqual(await fs.readdir(workspace), []);
});
