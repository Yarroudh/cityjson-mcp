#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PathPolicy } from './core/path-policy.mjs';
import { DatasetManager } from './core/dataset-manager.mjs';
import { CjioAdapter } from './adapters/cjio.mjs';
import { CjvalAdapter } from './adapters/cjval.mjs';
import { Val3dityAdapter } from './adapters/val3dity.mjs';
import { CitygmlToolsAdapter } from './adapters/citygml-tools.mjs';
import { CjdbAdapter } from './adapters/cjdb.mjs';
import { KnowledgeAdapter } from './adapters/knowledge.mjs';
import { registerTools } from './tools/register-tools.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const referenceIndex = path.resolve(here, '../resources/spec/index.json');

export function createServer() {
  const pathPolicy = new PathPolicy();
  const dm = new DatasetManager(pathPolicy);
  const cjio = new CjioAdapter(dm);
  const cjval = new CjvalAdapter(dm);
  const val3dity = new Val3dityAdapter(dm);
  const citygml = new CitygmlToolsAdapter(dm);
  const cjdb = new CjdbAdapter(dm, cjio);
  const knowledge = new KnowledgeAdapter();

  const server = new McpServer(
    { name: 'cityjson-toolbox-mcp', version: '0.1.0' },
    { instructions: [
      'Use cityjson_open for mounted files or cityjson_upload for content/attachments before tools that require dataset_id.',
      'Use cityjson_download to return an opened or transformed model to the client when no host directory is mounted.',
      'Transformations are immutable: they return a new dataset_id and keep the source unchanged.',
      'Use cityjson_backend_status when an external backend is unavailable.',
      'Use cityjson_validate for a complete structural and geometric check; use the individual validators when you need backend-specific detail.',
      'Prefer cityjson_query over returning entire CityJSON files to the model.',
      'Consult cityjson_spec_read, cityjson_schema_read, or the extension tools when semantics or schemas are relevant.'
    ].join(' ') }
  );

  registerTools(server, { dm, cjio, cjval, val3dity, citygml, cjdb, knowledge, pathPolicy });

  server.registerResource(
    'cityjson-reference-index',
    'cityjson://reference/index',
    {
      title: 'CityJSON 2.0.2 reference index',
      description: 'Specification chapters, schema names and canonical reference URLs.',
      mimeType: 'application/json'
    },
    async uri => ({
      contents: [{
        uri: uri.href,
        mimeType: 'application/json',
        text: await fs.readFile(referenceIndex, 'utf8')
      }]
    })
  );

  return server;
}

serveStdio(() => createServer());
