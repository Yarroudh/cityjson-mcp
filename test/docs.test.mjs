import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('README presents Datum first and contains required setup sections', async () => {
  const readme = await fs.readFile(path.join(root, 'README.md'), 'utf8');
  assert.match(readme, /<img src="web\/favicon\.svg"/);
  assert.match(readme, /img\.shields\.io/);
  assert.match(readme, /## Quick start: Datum chat application/);
  assert.match(readme, /cp \.env\.example \.env/);
  for (const name of ['MODEL_PROVIDER', 'MODEL_NAME', 'MODEL_API_KEY', 'MODEL_BASE_URL']) {
    assert.match(readme, new RegExp(`\\b${name}\\b`));
  }
  assert.match(readme, /## Use the MCP server without Datum/);
  assert.match(readme, /### Claude Desktop/);
  assert.match(readme, /### Claude Code/);
  assert.match(readme, /### Cursor/);
  assert.match(readme, /### VS Code/);
  assert.match(readme, /## Contributing/);
  assert.match(readme, /## Next/);
  assert.match(readme, /gemini-3\.7-flash/);
  assert.match(readme, /Google AI Studio/);
  assert.match(readme, /free-tier content may be used to improve its products/);
  assert.ok(readme.indexOf('## Quick start: Datum chat application') < readme.indexOf('## Use the MCP server without Datum'));
});

test('README does not contain diagram sections or embedded diagrams', async () => {
  const readme = await fs.readFile(path.join(root, 'README.md'), 'utf8');
  assert.doesNotMatch(readme, /^#+\s+Diagrams?\s*$/im);
  assert.doesNotMatch(readme, /```mermaid/);
  assert.doesNotMatch(readme, /diagrams\//);
});

test('README lists every registered MCP tool', async () => {
  const [readme, registration] = await Promise.all([
    fs.readFile(path.join(root, 'README.md'), 'utf8'),
    fs.readFile(path.join(root, 'src', 'tools', 'register-tools.mjs'), 'utf8')
  ]);
  const names = [...registration.matchAll(/server\.registerTool\('([^']+)'/g)].map(match => match[1]);
  assert.equal(names.length, 38);
  for (const name of names) assert.match(readme, new RegExp(`\\b${name}\\b`), `${name} must be documented`);
});

test('chat startup checks the local image before pulling and never builds automatically', async () => {
  const [packageText, startup, compose] = await Promise.all([
    fs.readFile(path.join(root, 'package.json'), 'utf8'),
    fs.readFile(path.join(root, 'scripts', 'start-chat.mjs'), 'utf8'),
    fs.readFile(path.join(root, 'docker', 'docker-compose.chat.yml'), 'utf8')
  ]);
  const packageJson = JSON.parse(packageText);
  assert.equal(packageJson.scripts.chat, 'node scripts/start-chat.mjs');
  assert.equal(packageJson.scripts['chat:logs'], 'docker compose -f docker/docker-compose.chat.yml logs -f cityjson-chat');
  assert.equal(packageJson.scripts['chat:stop'], 'docker compose -f docker/docker-compose.chat.yml down');
  assert.ok(startup.indexOf("['image', 'inspect', image]") < startup.indexOf("['pull', image]"));
  assert.match(startup, /'up', '-d'/);
  assert.match(startup, /'--no-build'/);
  assert.doesNotMatch(compose, /^\s+build:/m);
});
