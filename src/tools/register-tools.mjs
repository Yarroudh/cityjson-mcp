import * as z from 'zod/v4';
import { jsonResult, errorResult } from '../util/mcp-result.mjs';
import { queryCityObjects, objectBBox } from '../core/cityjson-native.mjs';

const datasetId = z.string().min(3).describe('Dataset handle returned by cityjson_import, cityjson_open, cityjson_import_text, or another transformation tool.');
const bbox = z.tuple([z.number(), z.number(), z.number(), z.number()]).describe('2D bbox [minX, minY, maxX, maxY] in the dataset CRS.');
const dbConnection = z.object({
  host: z.string().min(1),
  user: z.string().min(1),
  database: z.string().min(1),
  schema: z.string().min(1).regex(/^[A-Za-z_][A-Za-z0-9_]*$/)
});

function safe(handler) {
  return async args => {
    try { return await handler(args || {}); }
    catch (error) { return errorResult(error); }
  };
}

function commandSummary(result) {
  if (!result) return undefined;
  return { durationMs: result.durationMs, stderr: result.stderr?.trim() || undefined, stdout: result.stdout?.trim() || undefined };
}

export function registerTools(server, deps) {
  const { dm, cjio, cjval, val3dity, citygml, cjdb, knowledge, pathPolicy } = deps;

  server.registerTool('cityjson_backend_status', {
    title: 'CityJSON backend status',
    description: 'Check which external CityJSON/CityGML engines are installed and callable. Run this first when a backend-dependent operation fails.',
    inputSchema: z.object({})
  }, safe(async () => jsonResult({
    pathPolicy: pathPolicy.describe(),
    backends: {
      cjio: await cjio.status(),
      cjval: await cjval.status(),
      val3dity: await val3dity.status(),
      citygmlTools: await citygml.status(),
      cjdb: await cjdb.status()
    }
  })));

  server.registerTool('cityjson_open', {
    title: 'Open CityJSON from a Docker mount',
    description: 'Open a CityJSON file by a full server-visible path inside an allowed root. This is an advanced path-based operation. For files delivered to the configured input inbox, use cityjson_import with a filename instead.',
    inputSchema: z.object({
      source: z.string().min(1).describe('Full server-visible path inside an allowed root. This cannot be a path from a chat attachment.')
    })
  }, safe(async ({ source }) => jsonResult(await dm.open(source))));

  server.registerTool('cityjson_list_imports', {
    title: 'List CityJSON input files',
    description: 'List JSON files in the configured input inbox. Use this when the user did not name an attached/imported file or when cityjson_import reports multiple candidates. Returns filenames only; never ask the user for an absolute path.',
    inputSchema: z.object({})
  }, safe(async () => jsonResult(await dm.listImports())));

  server.registerTool('cityjson_import', {
    title: 'Import CityJSON from the input inbox',
    description: 'Import a CityJSON file already placed in the configured input inbox and return an immutable dataset handle. Pass only its filename, never an absolute path. If filename is omitted, the import succeeds only when the inbox contains exactly one JSON file.',
    inputSchema: z.object({
      filename: z.string().min(1).max(255).optional().describe('Filename shown by cityjson_list_imports or supplied by the chat application attachment metadata.')
    })
  }, safe(async ({ filename }) => jsonResult(await dm.importFile(filename))));

  server.registerTool('cityjson_import_text', {
    title: 'Import a small CityJSON text document',
    description: 'Fallback for small programmatically supplied CityJSON documents only. The complete JSON travels through the MCP request, so never use it for normal chat attachments or large models; use cityjson_import instead.',
    inputSchema: z.object({
      content: z.string().min(2).describe('Complete UTF-8 CityJSON document as JSON text.'),
      filename: z.string().min(1).max(200).default('import.city.json').describe('Display filename used for the managed workspace copy.')
    })
  }, safe(async ({ content, filename }) => jsonResult(await dm.importContent(content, filename))));

  server.registerTool('cityjson_upload', {
    title: 'Import small CityJSON text (legacy)',
    description: 'Deprecated compatibility alias for cityjson_import_text. This is not a binary file upload and must not be used for normal attachments or large models.',
    inputSchema: z.object({
      content: z.string().min(2).describe('Complete UTF-8 CityJSON document as JSON text.'),
      filename: z.string().min(1).max(200).default('upload.city.json').describe('Display filename used for the managed workspace copy.')
    })
  }, safe(async ({ content, filename }) => jsonResult(await dm.importContent(content, filename))));

  server.registerTool('cityjson_download', {
    title: 'Download CityJSON content',
    description: 'Return the complete JSON text of an opened or transformed dataset as an embedded application/json resource so the client can save or present it as a downloadable file.',
    inputSchema: z.object({
      dataset_id: datasetId,
      filename: z.string().min(1).max(200).optional().describe('Optional suggested download filename.')
    })
  }, safe(async ({ dataset_id, filename }) => {
    const result = await dm.downloadContent(dataset_id, filename);
    const metadata = { datasetId: result.datasetId, filename: result.filename, mimeType: result.mimeType, sizeBytes: result.sizeBytes };
    return {
      content: [
        { type: 'text', text: JSON.stringify(metadata, null, 2) },
        {
          type: 'resource',
          resource: {
            uri: `cityjson://download/${encodeURIComponent(result.filename)}`,
            mimeType: result.mimeType,
            text: result.content
          }
        }
      ],
      structuredContent: metadata
    };
  }));

  server.registerTool('cityjson_info', {
    title: 'Inspect CityJSON',
    description: 'Return metadata, object counts, types, LoDs, attribute names, transform and extensions for an opened dataset.',
    inputSchema: z.object({ dataset_id: datasetId })
  }, safe(async ({ dataset_id }) => jsonResult(await dm.inspect(dataset_id))));

  server.registerTool('cityjson_save', {
    title: 'Save CityJSON',
    description: 'Copy an opened/derived CityJSON dataset to an explicit destination path.',
    inputSchema: z.object({ dataset_id: datasetId, destination: z.string().min(1), overwrite: z.boolean().default(false) })
  }, safe(async ({ dataset_id, destination, overwrite }) => jsonResult(await dm.save(dataset_id, destination, overwrite))));

  server.registerTool('cityjson_list_objects', {
    title: 'List CityObjects',
    description: 'List CityObjects with IDs, types, selected attributes and LoDs. Supports filtering by CityObject type and pagination.',
    inputSchema: z.object({ dataset_id: datasetId, types: z.array(z.string()).optional(), limit: z.number().int().min(1).max(5000).default(100), offset: z.number().int().min(0).default(0) })
  }, safe(async ({ dataset_id, types, limit, offset }) => {
    const json = await dm.load(dataset_id);
    return jsonResult(queryCityObjects(json, { types, limit, offset }));
  }));

  server.registerTool('cityjson_get_object', {
    title: 'Get CityObject',
    description: 'Return one complete CityObject and a computed real-world bounding box derived from referenced vertices.',
    inputSchema: z.object({ dataset_id: datasetId, object_id: z.string().min(1) })
  }, safe(async ({ dataset_id, object_id }) => {
    const json = await dm.load(dataset_id);
    const object = json.CityObjects[object_id];
    if (!object) throw new Error(`CityObject not found: ${object_id}`);
    return jsonResult({ id: object_id, bbox: objectBBox(json, object), object });
  }));

  server.registerTool('cityjson_query', {
    title: 'Query CityObjects',
    description: 'Query CityObjects natively by IDs, types, 2D bbox and attribute predicates. Attribute predicates support eq, neq, gt, gte, lt, lte, contains and in.',
    inputSchema: z.object({
      dataset_id: datasetId,
      ids: z.array(z.string()).optional(),
      types: z.array(z.string()).optional(),
      bbox: bbox.optional(),
      attributes: z.record(z.string(), z.any()).optional(),
      limit: z.number().int().min(1).max(5000).default(100),
      offset: z.number().int().min(0).default(0)
    })
  }, safe(async ({ dataset_id, ...query }) => jsonResult(queryCityObjects(await dm.load(dataset_id), query))));

  server.registerTool('cityjson_validate_schema', {
    title: 'Validate CityJSON syntax and schema',
    description: 'Validate a dataset with the official cjval validator: JSON syntax, CityJSON schemas, extensions and additional structural consistency checks.',
    inputSchema: z.object({ dataset_id: datasetId, extension_schemas: z.array(z.string()).default([]) })
  }, safe(async ({ dataset_id, extension_schemas }) => jsonResult(await cjval.validate(dataset_id, extension_schemas))));

  server.registerTool('cityjson_validate_geometry', {
    title: 'Validate 3D geometry',
    description: 'Validate CityJSON 3D primitives with val3dity according to ISO 19107 concepts and CityJSON-specific geometric checks. Produces a detailed JSON report when available.',
    inputSchema: z.object({ dataset_id: datasetId, verbose: z.boolean().default(false) })
  }, safe(async ({ dataset_id, verbose }) => jsonResult(await val3dity.validate(dataset_id, { verbose }))));

  server.registerTool('cityjson_validate', {
    title: 'Validate CityJSON completely',
    description: 'Run cjval and val3dity and return one combined structural + geometric validation result.',
    inputSchema: z.object({ dataset_id: datasetId })
  }, safe(async ({ dataset_id }) => {
    const [schema, geometry] = await Promise.allSettled([cjval.validate(dataset_id), val3dity.validate(dataset_id)]);
    const schemaResult = schema.status === 'fulfilled' ? schema.value : { valid: null, error: schema.reason?.message };
    const geometryResult = geometry.status === 'fulfilled' ? geometry.value : { valid: null, error: geometry.reason?.message };
    const complete = typeof schemaResult.valid === 'boolean' && typeof geometryResult.valid === 'boolean';
    const valid = complete ? (schemaResult.valid === true && geometryResult.valid === true) : null;
    return jsonResult({ datasetId: dataset_id, complete, valid, schema: schemaResult, geometry: geometryResult });
  }));

  server.registerTool('cityjson_subset', {
    title: 'Create CityJSON subset',
    description: 'Create a derived CityJSON subset with cjio using IDs, bbox, radius, random count or CityObject types. Returns a new dataset_id.',
    inputSchema: z.object({
      dataset_id: datasetId,
      ids: z.array(z.string()).optional(),
      bbox: bbox.optional(),
      radius: z.tuple([z.number(), z.number(), z.number().positive()]).optional(),
      random: z.number().int().positive().optional(),
      types: z.array(z.string()).optional(),
      exclude: z.boolean().default(false)
    })
  }, safe(async ({ dataset_id, ...options }) => {
    const r = await cjio.subset(dataset_id, options);
    return jsonResult({ ...r.derived, backend: 'cjio', command: commandSummary(r.result) });
  }));

  server.registerTool('cityjson_filter_lod', {
    title: 'Filter CityJSON LoD',
    description: 'Keep only one level of detail using cjio lod_filter. Returns a new dataset_id.',
    inputSchema: z.object({ dataset_id: datasetId, lod: z.string().min(1) })
  }, safe(async ({ dataset_id, lod }) => {
    const r = await cjio.filterLod(dataset_id, lod); return jsonResult({ ...r.derived, backend: 'cjio', command: commandSummary(r.result) });
  }));

  server.registerTool('cityjson_reproject', {
    title: 'Reproject CityJSON',
    description: 'Reproject coordinates to a target EPSG CRS with cjio. The source dataset must already define a CRS. Returns a new dataset_id.',
    inputSchema: z.object({ dataset_id: datasetId, epsg: z.number().int().positive(), digit: z.number().int().min(1).max(12).optional() })
  }, safe(async ({ dataset_id, epsg, digit }) => {
    const r = await cjio.reproject(dataset_id, epsg, digit); return jsonResult({ ...r.derived, backend: 'cjio', command: commandSummary(r.result) });
  }));

  server.registerTool('cityjson_assign_crs', {
    title: 'Assign CityJSON CRS',
    description: 'Assign/update the EPSG reference without changing coordinate values using cjio. Returns a new dataset_id.',
    inputSchema: z.object({ dataset_id: datasetId, epsg: z.number().int().positive() })
  }, safe(async ({ dataset_id, epsg }) => { const r = await cjio.assignCrs(dataset_id, epsg); return jsonResult({ ...r.derived, backend: 'cjio' }); }));

  server.registerTool('cityjson_translate', {
    title: 'Translate CityJSON coordinates',
    description: 'Translate CityJSON coordinates with cjio. With minxyz, coordinates are shifted relative to the supplied minimum; without it cjio uses the model minimum.',
    inputSchema: z.object({ dataset_id: datasetId, minxyz: z.tuple([z.number(), z.number(), z.number()]).optional() })
  }, safe(async ({ dataset_id, minxyz }) => { const r = await cjio.translate(dataset_id, minxyz); return jsonResult({ ...r.derived, backend: 'cjio' }); }));

  server.registerTool('cityjson_clean_vertices', {
    title: 'Clean CityJSON vertices',
    description: 'Remove duplicate and orphan vertices with cjio vertices_clean. Returns a new dataset_id.',
    inputSchema: z.object({ dataset_id: datasetId })
  }, safe(async ({ dataset_id }) => { const r = await cjio.clean(dataset_id); return jsonResult({ ...r.derived, backend: 'cjio' }); }));

  server.registerTool('cityjson_triangulate', {
    title: 'Triangulate CityJSON',
    description: 'Triangulate surfaces with cjio. Use sloppy=true only when the robust triangulator fails.',
    inputSchema: z.object({ dataset_id: datasetId, sloppy: z.boolean().default(false) })
  }, safe(async ({ dataset_id, sloppy }) => { const r = await cjio.triangulate(dataset_id, sloppy); return jsonResult({ ...r.derived, backend: 'cjio' }); }));

  server.registerTool('cityjson_merge', {
    title: 'Merge CityJSON datasets',
    description: 'Merge two or more opened CityJSON datasets with cjio. Returns a new dataset_id.',
    inputSchema: z.object({ dataset_ids: z.array(datasetId).min(2) })
  }, safe(async ({ dataset_ids }) => { const r = await cjio.merge(dataset_ids); return jsonResult({ ...r.derived, backend: 'cjio' }); }));

  server.registerTool('cityjson_attribute_rename', {
    title: 'Rename CityJSON attribute',
    description: 'Rename an attribute across CityObjects with cjio.',
    inputSchema: z.object({ dataset_id: datasetId, old_name: z.string().min(1), new_name: z.string().min(1) })
  }, safe(async ({ dataset_id, old_name, new_name }) => { const r = await cjio.renameAttribute(dataset_id, old_name, new_name); return jsonResult({ ...r.derived, backend: 'cjio' }); }));

  server.registerTool('cityjson_attribute_remove', {
    title: 'Remove CityJSON attribute',
    description: 'Remove an attribute across CityObjects with cjio.',
    inputSchema: z.object({ dataset_id: datasetId, name: z.string().min(1) })
  }, safe(async ({ dataset_id, name }) => { const r = await cjio.removeAttribute(dataset_id, name); return jsonResult({ ...r.derived, backend: 'cjio' }); }));

  server.registerTool('cityjson_remove_textures', {
    title: 'Remove CityJSON textures',
    description: 'Remove all textures with cjio. Returns a new dataset_id.',
    inputSchema: z.object({ dataset_id: datasetId })
  }, safe(async ({ dataset_id }) => { const r = await cjio.removeTextures(dataset_id); return jsonResult({ ...r.derived, backend: 'cjio' }); }));

  server.registerTool('cityjson_remove_materials', {
    title: 'Remove CityJSON materials',
    description: 'Remove all materials with cjio. Returns a new dataset_id.',
    inputSchema: z.object({ dataset_id: datasetId })
  }, safe(async ({ dataset_id }) => { const r = await cjio.removeMaterials(dataset_id); return jsonResult({ ...r.derived, backend: 'cjio' }); }));

  server.registerTool('cityjson_upgrade', {
    title: 'Upgrade CityJSON',
    description: 'Upgrade an older supported CityJSON file to the version supported by the installed cjio.',
    inputSchema: z.object({ dataset_id: datasetId })
  }, safe(async ({ dataset_id }) => { const r = await cjio.upgrade(dataset_id); return jsonResult({ ...r.derived, backend: 'cjio' }); }));

  server.registerTool('cityjson_export', {
    title: 'Export CityJSON',
    description: 'Export an opened CityJSON dataset with cjio to jsonl, obj, stl, glb or b3dm.',
    inputSchema: z.object({ dataset_id: datasetId, format: z.enum(['jsonl','obj','stl','glb','b3dm']), destination: z.string().min(1), sloppy: z.boolean().default(false) })
  }, safe(async args => jsonResult(await cjio.export(args.dataset_id, args.format, args.destination, args.sloppy))));

  server.registerTool('citygml_to_cityjson', {
    title: 'Convert CityGML to CityJSON',
    description: 'Convert a CityGML 1.0/2.0/3.0 GML/XML dataset to CityJSON using citygml-tools. A regular CityJSON output is automatically opened and returned as a dataset_id.',
    inputSchema: z.object({ source: z.string().min(1), json_lines: z.boolean().default(false) })
  }, safe(async ({ source, json_lines }) => jsonResult(await citygml.toCityJSON(source, { jsonLines: json_lines }))));

  server.registerTool('cityjson_to_citygml', {
    title: 'Convert CityJSON to CityGML',
    description: 'Convert an opened CityJSON dataset to CityGML using citygml-tools. The installed citygml-tools version controls the default target encoding.',
    inputSchema: z.object({ dataset_id: datasetId, crs_name: z.string().optional(), output_directory: z.string().optional() })
  }, safe(async ({ dataset_id, crs_name, output_directory }) => jsonResult(await citygml.fromCityJSON(dataset_id, { crsName: crs_name, outputDirectory: output_directory }))));

  server.registerTool('cityjson_db_import', {
    title: 'Import CityJSON into cjdb',
    description: 'Convert the dataset to CityJSONSeq with cjio and import it into PostgreSQL/PostGIS using cjdb. PostgreSQL password should be supplied through PGPASSWORD, not tool arguments.',
    inputSchema: z.object({ dataset_id: datasetId, connection: dbConnection, attribute_indexes: z.array(z.string()).default([]), partial_attribute_indexes: z.array(z.string()).default([]) })
  }, safe(async ({ dataset_id, connection, attribute_indexes, partial_attribute_indexes }) => jsonResult(await cjdb.importDataset(dataset_id, connection, { attributeIndexes: attribute_indexes, partialAttributeIndexes: partial_attribute_indexes }))));

  server.registerTool('cityjson_db_export', {
    title: 'Export CityJSON from cjdb',
    description: 'Export all objects or a read-only SELECT-defined subset from cjdb to CityJSONSeq and optionally collect it into a normal CityJSON dataset handle.',
    inputSchema: z.object({ connection: dbConnection, query: z.string().optional().describe('Optional SELECT query that returns object_id rows. Mutating SQL and semicolons are rejected.'), collect: z.boolean().default(true) })
  }, safe(async ({ connection, query, collect }) => jsonResult(await cjdb.exportDataset(connection, { query, collect }))));

  server.registerTool('cityjson_spec_outline', {
    title: 'CityJSON specification outline',
    description: 'Return the bundled outline and canonical URLs for the current CityJSON specification and schemas.',
    inputSchema: z.object({})
  }, safe(async () => jsonResult(await knowledge.index())));

  server.registerTool('cityjson_spec_read', {
    title: 'Read CityJSON specification',
    description: 'Fetch the canonical CityJSON 2.0.2 living specification and return either the beginning or a context window around a search query.',
    inputSchema: z.object({ query: z.string().optional(), max_chars: z.number().int().min(1000).max(150000).default(60000) })
  }, safe(async ({ query, max_chars }) => jsonResult(await knowledge.specRead({ query, maxChars: max_chars }))));

  server.registerTool('cityjson_schema_read', {
    title: 'Read CityJSON JSON Schema',
    description: 'Fetch one canonical CityJSON 2.0.2 JSON Schema by name.',
    inputSchema: z.object({ name: z.enum(['cityjson.schema.json','cityjson.min.schema.json','cityjsonfeature.schema.json','cityjsonfeature.min.schema.json','cityobjects.schema.json','geomprimitives.schema.json','geomtemplates.schema.json','metadata.schema.json','appearance.schema.json']).default('cityjson.schema.json') })
  }, safe(async ({ name }) => jsonResult(await knowledge.schemaRead(name))));

  server.registerTool('cityjson_extensions_registry', {
    title: 'Browse CityJSON Extensions registry',
    description: 'Fetch the official CityJSON Extensions registry and optionally return context around a search term.',
    inputSchema: z.object({ query: z.string().optional(), max_chars: z.number().int().min(1000).max(100000).default(50000) })
  }, safe(async ({ query, max_chars }) => jsonResult(await knowledge.extensionsRegistry({ query, maxChars: max_chars }))));

  server.registerTool('cityjson_extension_schema', {
    title: 'Read a CityJSON Extension schema',
    description: 'Fetch a registered CityJSON Extension schema from the canonical cityjson.github.io registry URL.',
    inputSchema: z.object({ name: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/), version: z.string().regex(/^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/) })
  }, safe(async ({ name, version }) => jsonResult(await knowledge.extensionSchema(name, version))));
}
