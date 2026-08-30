#!/usr/bin/env node
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadEnvFile } from '../src/web/env.mjs';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const composeFile = path.join(projectRoot, 'docker', 'docker-compose.chat.yml');

await loadEnvFile(path.join(projectRoot, '.env'));
const image = process.env.CITYJSON_MCP_IMAGE || 'yarroudh/cityjson-mcp:latest';
const ollamaImage = process.env.OLLAMA_IMAGE || 'ollama/ollama:latest';

function booleanSetting(value, name) {
  if (value === undefined || value === '') return null;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new Error(`${name} must be true or false`);
}

const startupArguments = new Set(process.argv.slice(2));
const supportedArguments = new Set(['--with-ollama', '--without-ollama']);
const unknownArguments = [...startupArguments].filter(argument => !supportedArguments.has(argument));
if (unknownArguments.length) throw new Error(`Unknown chat option: ${unknownArguments.join(', ')}`);
if (startupArguments.has('--with-ollama') && startupArguments.has('--without-ollama')) {
  throw new Error('Use either --with-ollama or --without-ollama, not both');
}

const configuredProvider = String(process.env.MODEL_PROVIDER || '').trim().toLowerCase();
const environmentChoice = booleanSetting(process.env.CHAT_ENABLE_OLLAMA, 'CHAT_ENABLE_OLLAMA');
const enableOllama = startupArguments.has('--with-ollama')
  ? true
  : startupArguments.has('--without-ollama')
    ? false
    : environmentChoice ?? configuredProvider === 'ollama';

function docker(args, options = {}) {
  return spawnSync('docker', args, { cwd: projectRoot, ...options });
}

async function nativeOllamaAvailable() {
  if (process.platform !== 'darwin') return false;
  try {
    const response = await fetch('http://127.0.0.1:11434/api/tags', { signal: AbortSignal.timeout(1_500) });
    return response.ok;
  } catch {
    return false;
  }
}

const useNativeOllama = enableOllama && await nativeOllamaAvailable();
if (!enableOllama) {
  console.log('Ollama is disabled; starting Datum with cloud-model support only.');
  console.log('To start the bundled Ollama service, run: npm run chat -- --with-ollama');
  if (configuredProvider === 'ollama') {
    console.warn('MODEL_PROVIDER is ollama, so configure a cloud model in Datum or update .env before chatting.');
  }
} else if (useNativeOllama) {
  console.log('Ollama is enabled; using native Ollama with Apple Metal acceleration.');
} else {
  console.log('Ollama is enabled; the bundled Ollama image will be used.');
}

for (const requiredImage of [image, ...(enableOllama && !useNativeOllama ? [ollamaImage] : [])]) {
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
  const composeArgs = ['compose', '-f', composeFile, 'up', '-d', '--no-build', '--pull', 'never'];
  if (!enableOllama || useNativeOllama) composeArgs.push('--no-deps', 'cityjson-chat');
  const result = docker(
    composeArgs,
    { stdio: 'inherit', env: {
      ...process.env,
      CITYJSON_MCP_IMAGE: image,
      OLLAMA_IMAGE: ollamaImage,
      ...(useNativeOllama ? { OLLAMA_BASE_URL: 'http://host.docker.internal:11434/v1' } : {})
    } }
  );
  if (result.error?.code === 'ENOENT') console.error('Docker is not installed or is not available on PATH.');
  process.exitCode = result.status || (result.signal ? 1 : 0);
}
