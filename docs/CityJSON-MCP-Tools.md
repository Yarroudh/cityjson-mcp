# CityJSON MCP tool reference

This page documents the 38 user-facing tools exposed by the standalone CityJSON MCP server. Four additional upload transport tools are visible only to the in-chat upload app. Datum uses 37 tools because its browser handles uploads directly.

## How the toolbox works

### Dataset handles and immutable transformations

Most tools accept the filename returned by `cityjson_open`, an import, or a transformation in the `dataset_id` parameter. The parameter name is technical; assistants should refer to files by name when speaking to users. The server stores snapshots and derived files in its managed workspace and persists the registry there.

Transformations create a new managed file and return its filename; they do not overwrite the source. A typical workflow is:

```text
cityjson_open("model.city.json")
  → cityjson_info / cityjson_query
  → transformation(s)
  → cityjson_validate
  → cityjson_download
```

### Backends

| Backend | Used for |
|---|---|
| Native JavaScript | Parsing, summaries, object lookup, filtering queries, bounding boxes, dataset bookkeeping |
| `cjio` | Subsetting, LoD/CRS/vertex/appearance/attribute transformations, merging and export |
| `cjval` | JSON syntax, schema, extension and structural validation |
| `val3dity` | 3D geometry validation |
| CityGML Tools | CityGML ↔ CityJSON conversion |
| `cjdb` | PostgreSQL/PostGIS import and export; uses `cjio` for CityJSONSeq conversion |
| Network reference adapter | CityJSON specification, schemas and extension registry |

Tools do not normally invoke other MCP tools. Instead, the client chains tools into workflows. Where a tool internally combines multiple engines, most notably `cityjson_validate` and the database tools, this is called out explicitly below.

### Paths and security

- `cityjson_upload` opens a file picker in MCP Apps compatible clients and sends file chunks directly to the server.
- `cityjson_import` accepts a filename from the configured input inbox, not a path.
- `cityjson_open`, `cityjson_save`, export and conversion paths must be inside `CITYJSON_MCP_ALLOWED_ROOTS`, the input directory, or the managed workspace as applicable.
- Database passwords are never accepted as tool parameters. Set `PGPASSWORD` in the server environment.
- External commands run without a shell, have a timeout, and have bounded output.
- Normal results are returned both as JSON text and as MCP `structuredContent`. Failures return `isError: true` with an error message and, for failed commands, exit/stdout/stderr details.

## Quick index

### Server and dataset lifecycle

1. [`cityjson_backend_status`](#cityjson_backend_status)
2. [`cityjson_open`](#cityjson_open)
3. [`cityjson_list_imports`](#cityjson_list_imports)
4. [`cityjson_import`](#cityjson_import)
5. [`cityjson_upload`](#cityjson_upload)
6. [`cityjson_import_text`](#cityjson_import_text)
7. [`cityjson_download`](#cityjson_download)
8. [`cityjson_info`](#cityjson_info)
9. [`cityjson_save`](#cityjson_save)

### Native inspection and query

10. [`cityjson_list_objects`](#cityjson_list_objects)
11. [`cityjson_get_object`](#cityjson_get_object)
12. [`cityjson_query`](#cityjson_query)

### Validation

13. [`cityjson_validate_schema`](#cityjson_validate_schema)
14. [`cityjson_validate_geometry`](#cityjson_validate_geometry)
15. [`cityjson_validate`](#cityjson_validate)

### Transformation and export

16. [`cityjson_subset`](#cityjson_subset)
17. [`cityjson_filter_lod`](#cityjson_filter_lod)
18. [`cityjson_reproject`](#cityjson_reproject)
19. [`cityjson_assign_crs`](#cityjson_assign_crs)
20. [`cityjson_translate`](#cityjson_translate)
21. [`cityjson_clean_vertices`](#cityjson_clean_vertices)
22. [`cityjson_triangulate`](#cityjson_triangulate)
23. [`cityjson_merge`](#cityjson_merge)
24. [`cityjson_attribute_rename`](#cityjson_attribute_rename)
25. [`cityjson_attribute_remove`](#cityjson_attribute_remove)
26. [`cityjson_remove_textures`](#cityjson_remove_textures)
27. [`cityjson_remove_materials`](#cityjson_remove_materials)
28. [`cityjson_upgrade`](#cityjson_upgrade)
29. [`cityjson_export`](#cityjson_export)

### CityGML and database

30. [`citygml_to_cityjson`](#citygml_to_cityjson)
31. [`cityjson_to_citygml`](#cityjson_to_citygml)
32. [`cityjson_db_import`](#cityjson_db_import)
33. [`cityjson_db_export`](#cityjson_db_export)

### Specification, schemas and extensions

34. [`cityjson_spec_outline`](#cityjson_spec_outline)
35. [`cityjson_spec_read`](#cityjson_spec_read)
36. [`cityjson_schema_read`](#cityjson_schema_read)
37. [`cityjson_extensions_registry`](#cityjson_extensions_registry)
38. [`cityjson_extension_schema`](#cityjson_extension_schema)

## Server and dataset lifecycle

### `cityjson_backend_status`

Checks whether each external executable is installed and callable. Use it first when an operation that depends on a backend fails.

**Engine:** path policy plus executable probes for cjio, cjval, val3dity, CityGML Tools and cjdb.

**Parameters:** none (`{}`).

**How it works:** runs a short version or help command for every backend with a probe timeout of five seconds. It does not open or modify a dataset.

**Returns:** allowed roots, input/workspace paths, platform, and for every backend an `available` flag, command name, version/first output line or error.

**Related workflow:** call this before retrying a failed validator, transformation, conversion or database tool.

### `cityjson_open`

Opens an existing CityJSON file from a configured project or data folder by filename, relative path, or full server-visible path.

**Engine:** native parser and dataset manager.

| Parameter | Type | Required | Description |
|---|---|---:|---|
| `source` | string | yes | Filename or relative path in an allowed root, or full server-visible path. |

**How it works:** resolves the name within allowed roots, rejects ambiguous names and paths outside those roots, copies the file to the managed workspace, parses it, and registers the snapshot. Later edits to the source file do not change the opened snapshot.

**Returns:** filename, byte size, version, object/vertex counts, type counts, LoDs, attributes, metadata, transform and extensions. The internal handle is not returned to MCP clients.

**Use with:** `cityjson_info`, query/validation/transformation tools, then `cityjson_download`. An IDE can use the filename returned by this tool for subsequent calls. Datum handles browser attachments through its own upload bridge and `cityjson_import`.

### `cityjson_list_imports`

Lists candidate JSON files in the configured input inbox.

**Engine:** native filesystem access.

**Parameters:** none (`{}`).

**How it works:** lists regular files ending in `.json` while ignoring letter case, collects their sizes and modification times, then sorts newest first and by filename.

**Returns:** inbox path, file count and `files[]` containing `filename`, `sizeBytes` and `modifiedAt`.

**Use with:** pass one returned filename to `cityjson_import`. It does not parse or register the files.

### `cityjson_import`

Imports a CityJSON file from the configured input inbox into the managed workspace.

**Engine:** native filesystem/parser and dataset manager.

| Parameter | Type | Required | Default | Description |
|---|---|---:|---|---|
| `filename` | string from 1 to 255 characters | no | none | Inbox filename only; paths are rejected. |
| `display_filename` | string from 1 to 255 characters | no | none | Original filename when an upload bridge used a generated inbox name. |

**How it works:** if `filename` is omitted, import succeeds only when exactly one JSON file exists. The source is copied to a uniquely named workspace file, parsed, summarized and registered. Invalid copies are removed.

**Returns:** filename, size, operation and CityJSON summary. The inbox storage name and internal handle are not returned to MCP clients.

**Use with:** this is the internal entry point for Datum's browser attachments and other clients with an input inbox bridge. For normal IDE project files, use `cityjson_open`.

### `cityjson_upload`

Opens an in-chat CityJSON file picker in MCP Apps compatible clients, including Claude Desktop. No project folder needs to be configured.

| Parameter | Type | Required | Description |
|---|---|---:|---|
| `question` | string | no | The user's question to continue after the file is uploaded. |

**How it works:** the user chooses or drops a `.json` file in the app. The app transfers chunks directly to the MCP server using four app-only tools, then the server parses and registers the file. The full JSON does not enter the model context. The default limit is 100 MiB, configurable with `CITYJSON_MCP_MAX_DIRECT_UPLOAD_BYTES`.

**Returns:** an upload panel. After upload, the app continues the conversation using the registered filename. If the client cannot display MCP Apps, use a small JSON text import or an optional shared folder.

### `cityjson_import_text`

Imports a complete CityJSON document supplied directly as MCP text.

**Engine:** native parser and dataset manager.

| Parameter | Type | Required | Default | Description |
|---|---|---:|---|---|
| `content` | string | yes | none | Complete UTF 8 CityJSON JSON text. |
| `filename` | string from 1 to 200 characters | no | `import.city.json` | Display filename for the workspace copy. |

**How it works:** checks `CITYJSON_MCP_MAX_UPLOAD_BYTES` (25 MiB by default), parses before writing, sanitizes the filename, creates a unique workspace file and registers it.

**Returns:** filename, size, operation and summary. Internal workspace paths and handles are not returned to MCP clients.

**Use with:** small complete JSON documents already available as text, including small chat attachments that the client exposes to the model. Use `cityjson_upload` for missing, incomplete, or large attachment text.

### `cityjson_download`

Prepares a managed CityJSON dataset for delivery to the client.

**Engine:** dataset manager and MCP resource responses.

| Parameter | Type | Required | Description |
|---|---|---:|---|
| `dataset_id` | string | yes | Filename returned by an open, import, or transformation tool. |
| `filename` | string from 1 to 200 characters | no | Suggested download filename; unsafe characters are replaced. |

**How it works:** resolves the managed file and creates a `cityjson://download/...` resource link. Datum's web host streams the file from its managed path. A standalone MCP client also receives the JSON as an embedded resource, provided it is below `CITYJSON_MCP_MAX_DOWNLOAD_BYTES` (25 MiB by default).

**Returns:** filename, MIME type, byte size, resource link and optionally embedded content.

**Use with:** the final step after transformations. Calling it does not alter the dataset.

### `cityjson_info`

Returns a compact summary of the dataset without placing the complete model in context.

**Engine:** native parser and dataset manager.

| Parameter | Type | Required | Description |
|---|---|---:|---|
| `dataset_id` | string | yes | Filename returned by an open, import, or transformation tool. |

**How it works:** reloads the registered file and scans its CityObjects and geometry metadata.

**Returns:** filename, size, CityJSON version, object and vertex counts, counts per object type, distinct LoDs, attribute names, metadata, transform and extensions.

**Use with:** call immediately after import/open and before choosing query, transformation or validation steps.

### `cityjson_save`

Copies a managed CityJSON dataset to an explicit destination on the server.

**Engine:** dataset manager and path policy.

| Parameter | Type | Required | Default | Description |
|---|---|---:|---|---|
| `dataset_id` | string | yes | none | Filename returned by an open, import, or transformation tool. |
| `destination` | string | yes | none | Writable path inside an allowed root/workspace. |
| `overwrite` | boolean | no | `false` | Permit replacement of an existing file. |

**How it works:** validates the destination and creates its parent directory. With `overwrite: false`, an existing destination causes an error; otherwise the managed source is copied.

**Returns:** source filename and `savedTo` path.

**Use with:** workflows that use folders mounted on the server. For ordinary chat delivery use `cityjson_download`.

## Native inspection and query

### `cityjson_list_objects`

Lists compact CityObject records with optional type filtering and pagination.

**Engine:** native JavaScript query engine.

| Parameter | Type | Required | Default | Description |
|---|---|---:|---|---|
| `dataset_id` | string | yes | none | Filename returned by an open, import, or transformation tool. |
| `types` | string[] | no | all | Exact CityObject types to include. |
| `limit` | integer from 1 to 5000 | no | `100` | Maximum returned objects. |
| `offset` | integer ≥ 0 | no | `0` | Number of matches to skip. |

**How it works:** scans `CityObjects`, filters exact types and returns ID, type, all attributes, distinct LoDs, parent/child IDs. Bounding boxes remain `null` because no spatial filter requested their calculation.

**Returns:** `totalMatched`, `offset`, `limit`, and `objects[]`.

**Use with:** discover IDs/types before `cityjson_get_object` or `cityjson_subset`.

### `cityjson_get_object`

Returns one complete CityObject plus its 3D bounding box in real world coordinates.

**Engine:** native JavaScript parser and geometry traversal.

| Parameter | Type | Required | Description |
|---|---|---:|---|
| `dataset_id` | string | yes | Filename returned by an open, import, or transformation tool. |
| `object_id` | string | yes | Exact key in `CityObjects`. |

**How it works:** looks up the object, recursively collects vertex indices referenced directly by its geometry boundaries, dequantizes vertices using `transform.scale` and `transform.translate`, and computes `[minX,minY,minZ,maxX,maxY,maxZ]`. It does not aggregate child geometry into a parent.

**Returns:** object ID, bounding box (or `null` when no referenced vertices exist) and the complete CityObject JSON.

**Use with:** inspect a selected result from `cityjson_list_objects` or `cityjson_query`.

### `cityjson_query`

Queries CityObjects by IDs, types, 2D spatial intersection and attribute predicates.

**Engine:** native JavaScript query engine.

| Parameter | Type | Required | Default | Description |
|---|---|---:|---|---|
| `dataset_id` | string | yes | none | Filename returned by an open, import, or transformation tool. |
| `ids` | string[] | no | all | Exact object IDs. |
| `types` | string[] | no | all | Exact object types. |
| `bbox` | `[minX,minY,maxX,maxY]` | no | none | 2D intersection box in the dataset CRS. |
| `attributes` | object | no | `{}` | Attribute predicates described below. |
| `limit` | integer from 1 to 5000 | no | `100` | Maximum returned records. |
| `offset` | integer ≥ 0 | no | `0` | Matches to skip. |

Attribute values can be matched directly or with `{eq}`, `{neq}`, `{gt}`, `{gte}`, `{lt}`, `{lte}`, `{contains}` or `{in: [...]}`. Multiple ID/type/spatial/attribute conditions are combined with AND. Bounding boxes are computed only when `bbox` is supplied and use directly referenced geometry.

**Returns:** total count before pagination and compact object records. When spatial filtering is used, each record includes its calculated 3D bbox.

**Use with:** prefer this over downloading/returning a whole model; pass matching IDs to `cityjson_subset`.

## Validation

### `cityjson_validate_schema`

Runs structural CityJSON validation with the official `cjval` command.

**Engine:** `cjval`.

| Parameter | Type | Required | Default | Description |
|---|---|---:|---|---|
| `dataset_id` | string | yes | none | Filename returned by an open, import, or transformation tool. |
| `extension_schemas` | string[] | no | `[]` | Readable extension schema paths on the server. |

**How it works:** executes cjval in report mode and supplies every allowed extension schema. Validator exit codes other than zero are captured as validation results rather than transport failures. Progress notifications are emitted when requested by the MCP client.

**Returns:** `valid`, exit code, parsed report when available, fallback stdout/stderr and duration.

**Use with:** use alone for schema/structure detail or as part of `cityjson_validate` for a complete check.

### `cityjson_validate_geometry`

Runs CityJSON 3D geometry validation with `val3dity`.

**Engine:** `val3dity`.

| Parameter | Type | Required | Default | Description |
|---|---|---:|---|---|
| `dataset_id` | string | yes | none | Filename returned by an open, import, or transformation tool. |
| `verbose` | boolean | no | `false` | Request a verbose val3dity report. |

**How it works:** writes a report JSON file in the managed workspace and parses it. Validation exit codes other than zero remain valid tool responses. It derives validity from the report when possible and builds a compact summary.

**Returns:** validity, exit code, full report or path, standard output, standard error, duration and `reportSummary` with all invalid object IDs, error code counts and feature and primitive overviews.

**Use with:** feed `reportSummary.invalidObjectIds` to `cityjson_subset` to isolate invalid objects.

### `cityjson_validate`

Runs complete structural and geometric validation concurrently.

**Engines:** internally calls the same `cjval` adapter used by `cityjson_validate_schema` and the same `val3dity` adapter used by `cityjson_validate_geometry`. It does not issue nested MCP calls.

| Parameter | Type | Required | Description |
|---|---|---:|---|
| `dataset_id` | string | yes | Filename returned by an open, import, or transformation tool. |

**How it works:** starts both validators in parallel, reports two progress steps, and uses `Promise.allSettled` so one backend failure does not erase the other result.

**Returns:** `complete` only when both validators produced boolean validity; combined `valid` (`true`, `false`, or `null`); and separate `schema` and `geometry` results. The geometry result includes the complete summary of invalid IDs.

**Use with:** recommended default validator after import or transformation. Use the individual tools when extension schemas or verbose geometry output are required.

## Transformation and export

All transformation tools in this section use `cjio`, keep their source files unchanged, write a new workspace file and return its filename, except `cityjson_export`, which writes an external format and returns file paths.

### `cityjson_subset`

Creates a subset selected by one or more spatial, semantic or random criteria.

| Parameter | Type | Required | Default | Description |
|---|---|---:|---|---|
| `dataset_id` | string | yes | none | Source filename. |
| `ids` | string[] | conditionally | none | Object IDs supplied to the cjio ID filter. |
| `bbox` | `[minX,minY,maxX,maxY]` | conditionally | none | Bounding box in the dataset CRS. |
| `radius` | `[x,y,radius]` | conditionally | none | Center and positive radius. |
| `random` | positive integer | conditionally | none | Random object count. |
| `types` | string[] | conditionally | none | CityObject types supplied to the cjio type filter. |
| `exclude` | boolean | no | `false` | Invert/exclude the selected set. |

At least one of `ids`, `bbox`, `radius`, `random` or `types` must be provided. Multiple arguments are passed together to `cjio subset`; exact combination behavior follows cjio.

**Returns:** new filename, dataset summary, backend and command summary.

**Use with:** IDs from `cityjson_query` or invalid IDs from validation; then validate and download the derived filename.

### `cityjson_filter_lod`

Keeps one level of detail with `cjio lod_filter`.

| Parameter | Type | Required | Description |
|---|---|---:|---|
| `dataset_id` | string | yes | Source filename. |
| `lod` | string that is not empty | yes | LoD identifier exactly as understood by cjio, e.g. `2.2`. |

**Returns:** a new filename and dataset summary plus backend and command details.

**Use with:** inspect available values using `cityjson_info` first.

### `cityjson_reproject`

Reprojects coordinates with `cjio crs_reproject`.

| Parameter | Type | Required | Description |
|---|---|---:|---|
| `dataset_id` | string | yes | Source filename; it must already define a CRS. |
| `epsg` | positive integer | yes | Target EPSG code. |
| `digit` | integer from 1 to 12 | no | Coordinate precision supplied to cjio. |

**How it works:** transforms coordinate values and updates CRS metadata.

**Returns:** new filename and dataset summary plus command details.

**Use with:** if the source lacks CRS metadata and you know it, first call `cityjson_assign_crs`.

### `cityjson_assign_crs`

Assigns or updates CRS metadata with `cjio crs_assign` without reprojecting coordinates.

| Parameter | Type | Required | Description |
|---|---|---:|---|
| `dataset_id` | string | yes | Source filename. |
| `epsg` | positive integer | yes | EPSG code describing the existing coordinates. |

**Returns:** a new filename and dataset summary.

**Important:** use only when the coordinate values already use that CRS. Use `cityjson_reproject` to change coordinate values.

### `cityjson_translate`

Translates model coordinates with `cjio crs_translate`.

| Parameter | Type | Required | Description |
|---|---|---:|---|
| `dataset_id` | string | yes | Source filename. |
| `minxyz` | `[x,y,z]` | no | Requested minimum coordinates supplied to cjio; when omitted cjio uses its default model minimum behavior. |

**Returns:** a new filename and dataset summary.

**Use with:** coordinate normalization or relocation workflows; inspect the transform and metadata afterward.

### `cityjson_clean_vertices`

Runs `cjio vertices_clean` to remove duplicate and unreferenced/orphan vertices and remap indices.

| Parameter | Type | Required |
|---|---|---:|
| `dataset_id` | string | yes |

**Returns:** a new filename and dataset summary.

**Use with:** run before export or after operations that change geometry, then validate the result.

### `cityjson_triangulate`

Triangulates surfaces with `cjio triangulate`.

| Parameter | Type | Required | Default | Description |
|---|---|---:|---|---|
| `dataset_id` | string | yes | none | Source filename. |
| `sloppy` | boolean | no | `false` | Enables the less robust cjio fallback behavior. |

**Returns:** a new filename and dataset summary.

**Use with:** keep `sloppy: false` first; retry with `true` only when robust triangulation fails. Validate afterward.

### `cityjson_merge`

Merges two or more managed CityJSON datasets with cjio.

| Parameter | Type | Required | Description |
|---|---|---:|---|
| `dataset_ids` | string[] (minimum 2) | yes | Source filenames, in merge order. |

**How it works:** opens the first dataset as the cjio pipeline source, applies `merge <path>` for every remaining dataset, saves and registers one derived file with all source IDs as parents.

**Returns:** a new filename and dataset summary and command details.

**Use with:** datasets should have compatible CRS/semantics; inspect and validate the merged result.

### `cityjson_attribute_rename`

Renames one attribute across CityObjects using `cjio attribute_rename`.

| Parameter | Type | Required |
|---|---|---:|
| `dataset_id` | string | yes |
| `old_name` | string that is not empty | yes |
| `new_name` | string that is not empty | yes |

**Returns:** a new filename and dataset summary.

**Use with:** inspect `attributeNames` via `cityjson_info`, transform, then query the new name to verify.

### `cityjson_attribute_remove`

Removes one attribute across CityObjects using `cjio attribute_remove`.

| Parameter | Type | Required |
|---|---|---:|
| `dataset_id` | string | yes |
| `name` | string that is not empty | yes |

**Returns:** a new filename and dataset summary.

**Use with:** data minimization or schema cleanup; the source file remains unchanged.

### `cityjson_remove_textures`

Removes all texture data with `cjio textures_remove`.

| Parameter | Type | Required |
|---|---|---:|
| `dataset_id` | string | yes |

**Returns:** a new filename and dataset summary.

**Use with:** reduce file size or prepare exports that contain only geometry. This removes textures globally, not selectively.

### `cityjson_remove_materials`

Removes all material data with `cjio materials_remove`.

| Parameter | Type | Required |
|---|---|---:|
| `dataset_id` | string | yes |

**Returns:** a new filename and dataset summary.

**Use with:** create datasets without appearance data. This removes materials globally, not selectively.

### `cityjson_upgrade`

Upgrades an older supported CityJSON document with `cjio upgrade`.

| Parameter | Type | Required |
|---|---|---:|
| `dataset_id` | string | yes |

**How it works:** the installed cjio version determines supported source versions and the target version.

**Returns:** a new filename and dataset summary.

**Use with:** inspect the resulting `version` and run `cityjson_validate`.

### `cityjson_export`

Exports a managed CityJSON dataset to another file format.

**Engine:** `cjio export`.

| Parameter | Type | Required | Default | Description |
|---|---|---:|---|---|
| `dataset_id` | string | yes | none | Source filename. |
| `format` | enum | yes | none | `jsonl`, `obj`, `stl`, `glb` or `b3dm`. |
| `destination` | string | yes | none | Writable output path on the server. |
| `sloppy` | boolean | no | `false` | Enables the less robust cjio export behavior. |

**How it works:** validates the destination, invokes cjio, then reports files that actually exist. OBJ export also checks for a sibling `.mtl` file.

**Returns:** source filename, format, requested destination, produced files and command output.

**Important:** exported formats are not registered as CityJSON dataset handles. Use the host filesystem/output mount to retrieve them.

## CityGML and database

### `citygml_to_cityjson`

Converts CityGML 1.0/2.0/3.0 GML/XML to CityJSON.

**Engine:** CityGML Tools conversion to CityJSON plus the dataset manager.

| Parameter | Type | Required | Default | Description |
|---|---|---:|---|---|
| `source` | string | yes | none | Readable CityGML file path inside an allowed root. |
| `json_lines` | boolean | no | `false` | Request CityJSONSeq/JSON Lines output. |

**How it works:** creates a unique workspace output directory, runs the converter and recursively lists generated `.json` and `.jsonl` files. A regular `.json` output is automatically parsed and registered; output that contains only JSON Lines is not.

**Returns:** input, output directory, produced files, optional `derived` dataset summary, stdout/stderr.

**Use with:** when `derived` exists, use its `filename` with the normal inspection/validation tools.

### `cityjson_to_citygml`

Converts a managed CityJSON dataset to CityGML.

**Engine:** CityGML Tools conversion from CityJSON.

| Parameter | Type | Required | Description |
|---|---|---:|---|
| `dataset_id` | string | yes | Source filename. |
| `crs_name` | string | no | CRS name override supplied to the converter. |
| `output_directory` | string | no | Writable destination directory; otherwise a unique workspace directory is used. |

**How it works:** creates and validates the output directory, runs the converter, then recursively lists `.gml` and `.xml` outputs. The installed converter version controls the default encoding.

**Returns:** source filename, output directory, produced files and command output.

### `cityjson_db_import`

Imports a managed dataset into PostgreSQL/PostGIS through cjdb.

**Engines:** internally uses `cjio export jsonl` to create CityJSONSeq, then `cjdb import`.

| Parameter | Type | Required | Default | Description |
|---|---|---:|---|---|
| `dataset_id` | string | yes | none | Source filename. |
| `connection.host` | string | yes | none | PostgreSQL host. |
| `connection.user` | string | yes | none | PostgreSQL user. |
| `connection.database` | string | yes | none | Database name. |
| `connection.schema` | identifier string | yes | none | Schema beginning with a letter or underscore, followed by letters, numbers or underscores. |
| `attribute_indexes` | string[] | no | `[]` | Full attribute indexes supplied to cjdb. |
| `partial_attribute_indexes` | string[] | no | `[]` | Partial attribute indexes supplied to cjdb. |

**How it works:** exports the dataset to a managed `.city.jsonl` file, then imports that file with the supplied connection options. Passwords come from `PGPASSWORD`.

**Returns:** source filename, connection details without the password, intermediate CityJSONSeq path and command output.

**Side effects:** writes to the target database and creates an intermediate workspace file.

### `cityjson_db_export`

Exports all objects or a subset defined by a SELECT query from cjdb.

**Engines:** `cjdb export`; with `collect: true`, internally uses cjio to collect CityJSONSeq into regular CityJSON.

| Parameter | Type | Required | Default | Description |
|---|---|---:|---|---|
| `connection.host` | string | yes | none | PostgreSQL host. |
| `connection.user` | string | yes | none | PostgreSQL user. |
| `connection.database` | string | yes | none | Database name. |
| `connection.schema` | identifier string | yes | none | Schema beginning with a letter or underscore, followed by letters, numbers or underscores. |
| `query` | string | no | all objects | SELECT that does not modify data and returns `object_id` rows. |
| `collect` | boolean | no | `true` | Collect `.jsonl` into regular CityJSON and register a named file. |

**Query guard:** the query must begin with `SELECT`; semicolons and modifying or administration keywords are rejected. This is defense in depth, not a database security boundary. Use a restricted database role.

**Returns:** connection details without the password, CityJSONSeq path, optional `derived` dataset summary and command output.

**Use with:** when collected, continue with `derived.filename`; with `collect: false`, consume the `.city.jsonl` file from the workspace/output environment.

## Specification, schemas and extensions

### `cityjson_spec_outline`

Returns the bundled CityJSON 2.0.2 reference index.

**Engine:** local bundled resource; no network request.

**Parameters:** none (`{}`).

**Returns:** current reference version, canonical specification/schema URLs, schema names and the bundled outline/chapters.

**Use with:** discover the right source or schema before calling one of the network reference tools.

### `cityjson_spec_read`

Reads the canonical CityJSON 2.0.2 living specification as plain text.

**Engine:** network fetch plus conversion from HTML to text.

| Parameter | Type | Required | Default | Description |
|---|---|---:|---|---|
| `query` | string | no | none | Search term that ignores letter case. |
| `max_chars` | integer from 1000 to 150000 | no | `60000` | Maximum returned text window. |

**How it works:** fetches the canonical specification URL from the bundled index and strips scripts, styles and HTML tags. Without a query it returns the beginning; with a query it returns a centered context window or `found: false`.

**Returns:** source URL, version, text, truncation flag and query/found metadata when applicable.

### `cityjson_schema_read`

Fetches one canonical CityJSON 2.0.2 JSON Schema.

**Engine:** bundled index plus network fetch.

| Parameter | Type | Required | Default |
|---|---|---:|---|
| `name` | enum | no | `cityjson.schema.json` |

Allowed names:

- `cityjson.schema.json`
- `cityjson.min.schema.json`
- `cityjsonfeature.schema.json`
- `cityjsonfeature.min.schema.json`
- `cityobjects.schema.json`
- `geomprimitives.schema.json`
- `geomtemplates.schema.json`
- `metadata.schema.json`
- `appearance.schema.json`

**How it works:** verifies the name against the bundled allowlist, fetches the canonical URL and requires valid JSON.

**Returns:** source URL, CityJSON version, schema name and parsed schema object.

### `cityjson_extensions_registry`

Reads the official CityJSON Extensions registry.

**Engine:** network fetch of the registry repository README.

| Parameter | Type | Required | Default | Description |
|---|---|---:|---|---|
| `query` | string | no | none | Extension or search term that ignores letter case. |
| `max_chars` | integer from 1000 to 100000 | no | `50000` | Maximum returned text window. |

**How it works:** without a query it returns the beginning of the registry; with a query it returns a centered context window or `found: false`.

**Returns:** source URL, text, truncation flag and query/found metadata.

**Use with:** identify a registry extension name/version before `cityjson_extension_schema`.

### `cityjson_extension_schema`

Fetches one registered CityJSON Extension schema from the canonical registry URL.

**Engine:** validated URL construction plus network JSON fetch.

| Parameter | Type | Required | Constraints |
|---|---|---:|---|
| `name` | string | yes | Lowercase letters and numbers, with optional parts separated by single hyphens. |
| `version` | string | yes | Semantic version such as `2.0.0`, optionally with prerelease/build suffix. |

**How it works:** constructs `https://cityjson.github.io/extensions/<name>/<version>/<name>.ext.json`, fetches it and requires JSON. Strict parameter patterns prevent arbitrary URL/path injection.

**Returns:** source URL, extension name/version and parsed schema object.

## Recommended workflows using multiple tools

### Inspect and validate an attachment

```text
For a small complete JSON attachment: cityjson_import_text(content, filename)
For a larger file: cityjson_upload(question) → choose the file in the panel
  → cityjson_info(dataset_id=returned_filename)
  → cityjson_validate(dataset_id=returned_filename)
```

### Extract invalid objects and download them

```text
cityjson_validate(dataset_id=filename)
  → read geometry.reportSummary.invalidObjectIds
  → cityjson_subset(dataset_id=filename, ids)
  → cityjson_download(dataset_id=derived_filename)
```

### Query, transform and deliver

```text
cityjson_query(dataset_id=filename, types/bbox/attributes)
  → cityjson_subset(dataset_id=filename, ids)
  → cityjson_filter_lod(dataset_id=derived_filename, lod)
  → cityjson_reproject(dataset_id=derived_filename, epsg)
  → cityjson_validate(dataset_id=derived_filename)
  → cityjson_download(dataset_id=derived_filename)
```

### Database round trip

```text
upload or open the file by name
  → cityjson_db_import  (internally CityJSON → CityJSONSeq via cjio)
  → cityjson_db_export  (optionally CityJSONSeq → CityJSON via cjio)
  → cityjson_info / cityjson_validate
```

## Environment variables relevant to tools

| Variable | Default | Effect |
|---|---|---|
| `CITYJSON_MCP_ALLOWED_ROOTS` | current directory | Read/write roots (`:` separated on macOS/Linux, `;` on Windows). |
| `CITYJSON_MCP_INPUT` | `./input` | Inbox used by list/import. |
| `CITYJSON_MCP_WORKSPACE` | managed directory | Managed originals, derived files, reports and registry. |
| `CITYJSON_MCP_COMMAND_TIMEOUT_MS` | `120000` | External command timeout. |
| `CITYJSON_MCP_MAX_UPLOAD_BYTES` | 25 MiB | `cityjson_import_text` size limit. |
| `CITYJSON_MCP_MAX_DIRECT_UPLOAD_BYTES` | 100 MiB | In-chat file picker upload size limit. |
| `CITYJSON_MCP_MAX_DOWNLOAD_BYTES` | 25 MiB | Standalone inline download limit. |
| `CJIO_BIN` | `cjio` | cjio executable override. |
| `CJVAL_BIN` | `cjval` | cjval executable override. |
| `VAL3DITY_BIN` | `val3dity` | val3dity executable override. |
| `CITYGML_TOOLS_BIN` | CityGML Tools | Converter executable override. |
| `CJDB_BIN` | `cjdb` | cjdb executable override. |
| `PGPASSWORD` | not set | PostgreSQL password used by cjdb. |

## Maintenance note

The source of truth is [`src/tools/register-tools.mjs`](https://github.com/Yarroudh/cityjson-mcp/blob/main/src/tools/register-tools.mjs), with implementation details in [`src/core/`](https://github.com/Yarroudh/cityjson-mcp/tree/main/src/core) and [`src/adapters/`](https://github.com/Yarroudh/cityjson-mcp/tree/main/src/adapters). When a tool schema or behavior changes, update this page and the test for tool coverage together.
