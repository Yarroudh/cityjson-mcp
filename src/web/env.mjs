import fs from 'node:fs/promises';
import path from 'node:path';
import { MODEL_PROVIDER_NAMES, modelProvider, providerApiKey } from './model-providers.mjs';

function unquote(value) {
  const trimmed = value.trim();
  if (trimmed.length >= 2 && ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'")))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

export async function loadEnvFile(filename = path.resolve('.env')) {
  let text;
  try { text = await fs.readFile(filename, 'utf8'); }
  catch (error) {
    if (error.code === 'ENOENT') return;
    throw error;
  }

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line);
    if (!match || process.env[match[1]] !== undefined) continue;
    process.env[match[1]] = unquote(match[2]);
  }
}

function positiveInteger(value, fallback, name) {
  if (value === undefined || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error(`${name} must be a positive integer`);
  return parsed;
}

function booleanValue(value, fallback, name) {
  if (value === undefined || value === '') return fallback;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new Error(`${name} must be true or false`);
}

function numberInRange(value, fallback, name, minimum, maximum) {
  if (value === undefined || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} must be between ${minimum} and ${maximum}`);
  }
  return parsed;
}

export function getWebConfig(env = process.env) {
  const requestedProvider = (env.MODEL_PROVIDER || 'anthropic').toLowerCase();
  const definition = modelProvider(requestedProvider);
  if (!definition) throw new Error(`MODEL_PROVIDER must be one of: ${MODEL_PROVIDER_NAMES.join(', ')}`);
  const service = requestedProvider;
  const provider = definition.apiStyle;
  const apiKey = env.MODEL_API_KEY || providerApiKey(env, service);
  const model = env.MODEL_NAME?.trim() || null;

  return {
    provider,
    service,
    ollamaBaseUrl: env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434/v1',
    ollamaContextLength: positiveInteger(env.OLLAMA_CONTEXT_LENGTH, 16384, 'OLLAMA_CONTEXT_LENGTH'),
    apiKey,
    model,
    baseUrl: env.MODEL_BASE_URL || definition.defaultBaseUrl,
    maxOutputTokens: positiveInteger(env.MODEL_MAX_OUTPUT_TOKENS, 4096, 'MODEL_MAX_OUTPUT_TOKENS'),
    temperature: numberInRange(env.MODEL_TEMPERATURE, 0.1, 'MODEL_TEMPERATURE', 0, 1),
    maxToolRounds: positiveInteger(env.CHAT_MAX_TOOL_ROUNDS, 12, 'CHAT_MAX_TOOL_ROUNDS'),
    maxToolResultChars: positiveInteger(env.CHAT_MAX_TOOL_RESULT_CHARS, 100000, 'CHAT_MAX_TOOL_RESULT_CHARS'),
    allowPartialBackends: booleanValue(env.CHAT_ALLOW_PARTIAL_BACKENDS, false, 'CHAT_ALLOW_PARTIAL_BACKENDS'),
    host: env.CHAT_HOST || '127.0.0.1',
    port: positiveInteger(env.CHAT_PORT, 3000, 'CHAT_PORT'),
    input: path.resolve(env.CITYJSON_MCP_INPUT || path.join(process.cwd(), 'input')),
    maxUploadBytes: positiveInteger(env.CHAT_MAX_UPLOAD_BYTES, 1024 * 1024 * 1024, 'CHAT_MAX_UPLOAD_BYTES'),
    maxUploadFiles: positiveInteger(env.CHAT_MAX_UPLOAD_FILES, 5, 'CHAT_MAX_UPLOAD_FILES')
  };
}
