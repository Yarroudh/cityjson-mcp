#!/usr/bin/env node
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const composeFile = path.join(projectRoot, 'docker', 'docker-compose.chat.yml');
const image = process.env.CITYJSON_MCP_IMAGE || 'yarroudh/cityjson-mcp:latest';
const ollamaImage = process.env.OLLAMA_IMAGE || 'ollama/ollama:latest';

function docker(args, options = {}) {
  return spawnSync('docker', args, { cwd: projectRoot, ...options });
}

for (const requiredImage of [image, ollamaImage]) {
  if (process.exitCode) break;
  const inspected = docker(['image', 'inspect', requiredImage], { stdio: 'ignore' });
  if (inspected.error?.code === 'ENOENT') {
    console.error('Docker is not installed or is not available on PATH.');
    process.exitCode = 1;
  } else if (inspected.status !== 0) {
    console.log(`Docker image ${requiredImage} is not available locally. Pulling it now.`);
    const pulled = docker(['pull', requiredImage], { stdio: 'inherit' });
    if (pulled.status !== 0) {
      const hint = requiredImage === image ? ' Run npm run docker:build to build the CityJSON image locally.' : '';
      console.error(`Could not pull ${requiredImage}.${hint}`);
      process.exitCode = pulled.status || 1;
    }
  }
}

if (!process.exitCode) {
  const result = docker(
    ['compose', '-f', composeFile, 'up', '-d', '--no-build', '--pull', 'never'],
    { stdio: 'inherit', env: { ...process.env, CITYJSON_MCP_IMAGE: image, OLLAMA_IMAGE: ollamaImage } }
  );
  if (result.error?.code === 'ENOENT') console.error('Docker is not installed or is not available on PATH.');
  process.exitCode = result.status || (result.signal ? 1 : 0);
}
