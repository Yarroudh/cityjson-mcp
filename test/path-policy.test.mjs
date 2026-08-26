import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PathPolicy } from '../src/core/path-policy.mjs';

test('PathPolicy permits configured root and rejects outside files', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'cityjson-mcp-test-'));
  const allowed = path.join(tmp, 'allowed');
  const input = path.join(tmp, 'input');
  const workspace = path.join(tmp, 'workspace');
  const outside = path.join(tmp, 'outside');
  await fs.mkdir(allowed, { recursive: true });
  await fs.mkdir(input, { recursive: true });
  await fs.mkdir(outside, { recursive: true });
  const insideFile = path.join(allowed, 'a.city.json');
  const outsideFile = path.join(outside, 'b.city.json');
  await fs.writeFile(insideFile, '{}');
  await fs.writeFile(outsideFile, '{}');

  const oldRoots = process.env.CITYJSON_MCP_ALLOWED_ROOTS;
  const oldInput = process.env.CITYJSON_MCP_INPUT;
  const oldWorkspace = process.env.CITYJSON_MCP_WORKSPACE;
  process.env.CITYJSON_MCP_ALLOWED_ROOTS = allowed;
  process.env.CITYJSON_MCP_INPUT = input;
  process.env.CITYJSON_MCP_WORKSPACE = workspace;
  try {
    const policy = new PathPolicy();
    assert.equal(policy.assertReadable(insideFile), path.resolve(insideFile));
    assert.throws(() => policy.assertReadable(outsideFile), /outside allowed roots/);
    const inboxFile = path.join(input, 'inbox.city.json');
    await fs.writeFile(inboxFile, '{}');
    assert.equal(policy.inputPath('inbox.city.json'), await fs.realpath(inboxFile));
    assert.throws(() => policy.inputPath('../outside/b.city.json'), /filename.*not a path/);
  } finally {
    if (oldRoots === undefined) delete process.env.CITYJSON_MCP_ALLOWED_ROOTS; else process.env.CITYJSON_MCP_ALLOWED_ROOTS = oldRoots;
    if (oldInput === undefined) delete process.env.CITYJSON_MCP_INPUT; else process.env.CITYJSON_MCP_INPUT = oldInput;
    if (oldWorkspace === undefined) delete process.env.CITYJSON_MCP_WORKSPACE; else process.env.CITYJSON_MCP_WORKSPACE = oldWorkspace;
    await fs.rm(tmp, { recursive: true, force: true });
  }
});
