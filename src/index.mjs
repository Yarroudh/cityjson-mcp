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
import { registerUploadApp } from './tools/upload-app.mjs';

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
      'When the user names a CityJSON file in a configured project or data folder, call cityjson_open with that filename. Use a relative path only when names are ambiguous. Pass returned filenames in the dataset_id tool parameter for follow-up calls. Refer to files by name in every user-facing answer; never mention tool parameter names or opaque internal handles.',
      'If a client already provided the complete text of a small CityJSON attachment in the model context, call cityjson_import_text with that text and its original filename; do not ask the user to select it again. If the attachment text is missing, incomplete, or large, call cityjson_upload in an MCP Apps compatible client with the user’s question to open the in-chat picker. The upload app transfers file bytes without including them in the model context. After either import reports a filename, use that filename in dataset_id tool parameters and in answers.',
      'For files placed in the input inbox by a host application, call cityjson_import with the inbox filename. Use cityjson_list_imports only when needed. Do not ask users to manage the inbox or workspace.',
      'Do not put large or incomplete attachments into MCP arguments.',
      'A chat attachment is not automatically a server-visible file. Clients that cannot show MCP Apps must provide a file bridge or a shared path for larger files.',
      'Use cityjson_download to return an opened or transformed model to the client when no host directory is mounted.',
      'Transformations create a new named file and keep the source unchanged.',
      'Use cityjson_backend_status when an external backend is unavailable.',
      'Use cityjson_validate for a complete structural and geometric check; use the individual validators when you need backend-specific detail.',
      'Prefer cityjson_query over returning entire CityJSON files to the model.',
      'Consult cityjson_spec_read, cityjson_schema_read, or the extension tools when semantics or schemas are relevant.'
    ].join(' ') }
  );

  registerTools(server, { dm, cjio, cjval, val3dity, citygml, cjdb, knowledge, pathPolicy });
  registerUploadApp(server, dm);

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

serveStdio(() => createServer(), {
  onerror: error => console.error('[cityjson-mcp]', error)
});
