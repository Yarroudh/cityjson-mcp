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
  assert.match(readme, /MODEL_NAME=openrouter\/free/);
  assert.match(readme, /paid Gemini or DeepSeek/i);
  assert.match(readme, /### Local models with Ollama/);
  assert.match(readme, /### Cloud model providers/);
  assert.match(readme, /MODEL_PROVIDER=openrouter/);
  assert.doesNotMatch(readme, /MODEL_PROVIDER=opencode/);
  assert.doesNotMatch(readme, /MODEL_PROVIDER=zai/);
  assert.match(readme, /MODEL_NAME=gpt-5-nano/);
  assert.match(readme, /http:\/\/ollama:11434\/v1/);
  assert.match(readme, /### Install Ollama manually/);
  assert.match(readme, /OLLAMA_CONTEXT_LENGTH/);
  assert.match(readme, /native Ollama/);
  assert.ok(readme.indexOf('## Quick start: Datum chat application') < readme.indexOf('## Use the MCP server without Datum'));
});

test('README documents the architecture with an inline diagram', async () => {
  const readme = await fs.readFile(path.join(root, 'README.md'), 'utf8');
  assert.match(readme, /^## Architecture$/m);
  assert.match(readme, /```mermaid/);
  assert.doesNotMatch(readme, /diagrams\//);
});

test('README lists every registered MCP tool', async () => {
  const [readme, registration] = await Promise.all([
    fs.readFile(path.join(root, 'README.md'), 'utf8'),
    fs.readFile(path.join(root, 'src', 'tools', 'register-tools.mjs'), 'utf8')
  ]);
  const names = [...registration.matchAll(/server\.registerTool\('([^']+)'/g)].map(match => match[1]);
  assert.equal(names.length, 37);
  for (const name of names) assert.match(readme, new RegExp(`\\b${name}\\b`), `${name} must be documented`);
});

test('detailed tool reference documents every registered MCP tool exactly once', async () => {
  const [reference, registration] = await Promise.all([
    fs.readFile(path.join(root, 'docs', 'CityJSON-MCP-Tools.md'), 'utf8'),
    fs.readFile(path.join(root, 'src', 'tools', 'register-tools.mjs'), 'utf8')
  ]);
  const registered = [...registration.matchAll(/server\.registerTool\('([^']+)'/g)].map(match => match[1]);
  const documented = [...reference.matchAll(/^### `([^`]+)`$/gm)].map(match => match[1]);
  assert.equal(registered.length, 37);
  assert.deepEqual(documented.sort(), registered.sort());
  assert.match(reference, /parameters/i);
  assert.match(reference, /how it works/i);
});

test('wiki documentation includes Home, Datum, and every supplied Datum screenshot', async () => {
  const [home, datum] = await Promise.all([
    fs.readFile(path.join(root, 'docs', 'Home.md'), 'utf8'),
    fs.readFile(path.join(root, 'docs', 'Datum.md'), 'utf8')
  ]);
  assert.match(home, /\[Datum guide\]\(Datum\)/);
  assert.match(home, /\[CityJSON MCP tools reference\]\(CityJSON-MCP-Tools\)/);
  for (const filename of [
    'datum-import.png',
    'datum-conversation.png',
    'datum-tools.png',
    'datum-tool-details.png',
    'datum-viewer.png',
    'datum-models.png',
    'datum-add-model.png'
  ]) {
    assert.match(datum, new RegExp(`assets/${filename.replaceAll('.', '\\.')}`));
    await fs.access(path.join(root, 'docs', 'assets', filename));
  }
  assert.doesNotMatch(datum, /datum-about/i);
});

test('installation guide covers every supported setup path and backend', async () => {
  const [home, installation] = await Promise.all([
    fs.readFile(path.join(root, 'docs', 'Home.md'), 'utf8'),
    fs.readFile(path.join(root, 'docs', 'Installation.md'), 'utf8')
  ]);
  assert.match(home, /\[Installation and configuration\]\(Installation\)/);
  for (const section of [
    'Recommended Docker installation',
    'Install only the MCP server for another client',
    'Manual host installation',
    'PostgreSQL and PostGIS for cjdb',
    'Complete configuration reference',
    'Update an installation',
    'Stop or remove the installation',
    'Troubleshooting'
  ]) assert.match(installation, new RegExp(`^## ${section}$`, 'm'));
  for (const backend of ['cjio', 'cjval', 'val3dity', 'CityGML Tools', 'cjdb']) {
    assert.match(installation, new RegExp(`\\b${backend.replaceAll(' ', '\\s+')}\\b`, 'i'));
  }
  for (const command of ['npm run chat', 'npm run doctor', 'npm test', 'npm run check']) {
    assert.match(installation, new RegExp(command.replaceAll(' ', '\\s+')));
  }
  for (const variable of [
    'MODEL_PROVIDER',
    'MODEL_NAME',
    'MODEL_API_KEY',
    'MODEL_BASE_URL',
    'CHAT_ENABLE_OLLAMA',
    'OLLAMA_CONTEXT_LENGTH',
    'CHAT_MAX_TOOL_ROUNDS',
    'CITYJSON_MCP_ALLOWED_ROOTS',
    'CITYJSON_MCP_INPUT',
    'CITYJSON_MCP_WORKSPACE',
    'CITYJSON_MCP_COMMAND_TIMEOUT_MS',
    'CJIO_BIN',
    'CJVAL_BIN',
    'VAL3DITY_BIN',
    'CITYGML_TOOLS_BIN',
    'CJDB_BIN',
    'PGPASSWORD'
  ]) assert.match(installation, new RegExp(`\\b${variable}\\b`));
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
  assert.match(startup, /ollama\/ollama:latest/);
  assert.match(startup, /nativeOllamaAvailable/);
  assert.match(startup, /CHAT_ENABLE_OLLAMA/);
  assert.match(startup, /--with-ollama/);
  assert.match(startup, /--without-ollama/);
  assert.match(startup, /Ollama is disabled; starting Datum with cloud-model support only/);
  assert.match(startup, /host\.docker\.internal:11434\/v1/);
  assert.ok(startup.indexOf("['image', 'inspect', requiredImage]") < startup.indexOf("['pull', requiredImage]"));
  assert.match(startup, /'up', '-d'/);
  assert.match(startup, /'--no-build'/);
  assert.doesNotMatch(compose, /^\s+build:/m);
  assert.match(compose, /^  ollama:/m);
  assert.match(compose, /ollama-models:\/root\/\.ollama/);
  assert.match(compose, /http:\/\/ollama:11434\/v1/);
  assert.match(compose, /OLLAMA_CONTEXT_LENGTH.*16384/);
  assert.match(compose, /CHAT_PORT:\s+\$\{CHAT_PORT:-3000\}/);
  assert.match(compose, /127\.0\.0\.1:\$\{CHAT_PORT:-3000\}:\$\{CHAT_PORT:-3000\}/);
  for (const source of ['../src:/app/src:ro', '../web:/app/web:ro', '../resources:/app/resources:ro']) {
    assert.match(compose, new RegExp(source.replaceAll('/', '\\/')));
  }
});
