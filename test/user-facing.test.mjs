import test from 'node:test';
import assert from 'node:assert/strict';
import { jsonResult } from '../src/util/mcp-result.mjs';
import { userFacingText, userFacingEventStream } from '../src/web/user-facing.mjs';

test('MCP results show the filename without exposing internal IDs', () => {
  const result = jsonResult({ datasetId: 'cj_123456abcdef', filename: 'model.city.json', path: '/workspace/cj_123456abcdef.city.json', cityObjectCount: 2 });
  assert.equal('datasetId' in result.structuredContent, false);
  assert.equal('path' in result.structuredContent, false);
  assert.equal(result.content[0].text.includes('cj_123456abcdef'), false);
  assert.match(result.content[0].text, /model\.city\.json/);
});

test('Datum answer text and streamed chunks replace internal references with filenames', () => {
  const filenames = new Map([['cj_123456abcdef', 'model.city.json']]);
  const clean = text => userFacingText(text, filenames, 'model.city.json');
  assert.equal(clean('dataset_id=cj_123456abcdef'), 'file name=model.city.json');
  const events = [];
  const stream = userFacingEventStream(event => events.push(event), clean);
  stream.send({ type: 'text_delta', text: 'The dataset_id is cj_123' });
  stream.send({ type: 'text_delta', text: '456abcdef and has two objects.' });
  stream.flush();
  assert.equal(events.map(event => event.text).join(''), 'The file name is model.city.json and has two objects.');
});
