# CityJSON MCP

<p align="center">
  <img src="web/favicon.svg" width="96" height="96" alt="CityJSON MCP logo">
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="MIT license"></a>
  <img src="https://img.shields.io/badge/Node.js-20%2B-339933.svg" alt="Node.js 20 or newer">
  <img src="https://img.shields.io/badge/CityJSON-2.0.2-e0a05b.svg" alt="CityJSON 2.0.2">
  <img src="https://img.shields.io/badge/MCP_tools-37-5c6ac4.svg" alt="37 MCP tools">
  <a href="https://hub.docker.com/r/yarroudh/cityjson-mcp"><img src="https://img.shields.io/badge/Docker-yarroudh%2Fcityjson--mcp-2496ed.svg" alt="Docker image"></a>
  <a href="https://doi.org/10.5281/zenodo.22151334"><img src="https://zenodo.org/badge/DOI/10.5281/zenodo.22151334.svg" alt="DOI"></a>
</p>

CityJSON MCP provides a web chat application and an MCP server for CityJSON files. It supports inspection, queries, validation, transformations, export, CityGML conversion, and cjdb/PostGIS operations.

The Docker image includes:

- `cjio` for CityJSON transformations and export.
- `cjval` for syntax, schema, and structural validation.
- `val3dity` for 3D geometry validation.
- `citygml-tools` for CityGML and CityJSON conversion.
- `cjdb` for PostgreSQL/PostGIS import and export.

## Demo

The following video is a demo of Datum, the chat application in this repository. It shows importing a CityJSON file, inspecting it, creating a subset, and downloading the derived dataset.

![Datum demo](assets/Demo.mp4)

## Quick start: Datum chat application

Datum is the main application in this repository. It accepts CityJSON attachments in the browser, imports them through MCP, and lets a configured model call the CityJSON tools.

### Requirements

- Docker Desktop or Docker Engine with Docker Compose.
- Node.js 20 or newer.
- An API key for a model that supports tool calls.

### 1. Install the JavaScript dependencies

```bash
npm install
```

### 2. Create `.env`

Copy the example file:

```bash
cp .env.example .env
```

Set these values before starting Datum:

```dotenv
MODEL_PROVIDER=openai
MODEL_NAME=gemini-3.7-flash
MODEL_API_KEY=replace-with-your-api-key
MODEL_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai
MODEL_TEMPERATURE=0.1
```

The model settings mean:

| Variable | Required | Description |
|---|---:|---|
| `MODEL_PROVIDER` | yes | Model API selection: `openai`, `anthropic`, or `ollama`. Ollama uses its OpenAI-compatible Chat Completions endpoint internally. |
| `MODEL_NAME` | yes | Exact model identifier sent to the provider, for example `gemini-3.7-flash`. The model must support tool calls. |
| `MODEL_API_KEY` | except Ollama | API credential issued by the model provider. Local Ollama needs no key. Do not commit `.env`. |
| `MODEL_BASE_URL` | yes | Base URL for the provider API. |
| `MODEL_TEMPERATURE` | no | Sampling temperature. Datum defaults to `0.1`. |

The `.env` model is the default model in Datum. Users can add other models from the model menu. Models added through the interface remain in server memory for up to eight hours. Their API keys are not returned to the browser or passed to MCP tools.

### Free model for testing

Gemini 3.7 Flash is the recommended model for initial testing. Google lists free input and output tokens for this model on the Gemini API free tier. The free tier has rate limits, availability depends on region, and Google states that free-tier content may be used to improve its products. Do not send confidential datasets through a free-tier account without reviewing the provider's data terms.

Create and configure a Gemini API key:

1. Open the [Google AI Studio API Keys page](https://aistudio.google.com/app/apikey). Google's [API key guide](https://ai.google.dev/gemini-api/docs/api-key) explains project and key management.
2. Sign in and accept the Gemini API terms if prompted.
3. Select **Create API key**. New keys created in AI Studio are restricted to the Gemini API.
4. Copy the key.
5. Create `.env` from `.env.example` and set:

   ```dotenv
   MODEL_PROVIDER=openai
   MODEL_NAME=gemini-3.7-flash
   MODEL_API_KEY=paste-your-gemini-api-key-here
   MODEL_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai
   MODEL_TEMPERATURE=0.1
   ```

6. Run `npm run chat`, open <http://127.0.0.1:3000>, import a CityJSON file, and select one of the suggested questions.

The base URL above is Google's documented [OpenAI compatibility endpoint](https://ai.google.dev/gemini-api/docs/openai), which is why `MODEL_PROVIDER` remains `openai`.

Check the [Gemini API pricing page](https://ai.google.dev/gemini-api/docs/pricing) and [rate-limit documentation](https://ai.google.dev/gemini-api/docs/rate-limits) because free-tier quotas can change.

### Local models with Ollama

Install [Ollama](https://ollama.com/download), start it, and pull a model that supports tool calling. For example:

```bash
ollama pull qwen3:8b
```

Because `npm run chat` runs Datum in Docker, configure the host bridge address in `.env`:

```dotenv
MODEL_PROVIDER=ollama
MODEL_NAME=qwen3:8b
MODEL_API_KEY=
MODEL_BASE_URL=http://host.docker.internal:11434/v1
MODEL_TEMPERATURE=0.1
```

Then run `npm run chat`. You can also add Ollama from Datum's model menu and use **Load installed Ollama models** to discover models already present on the server. When running Datum directly with `npm run chat:host`, use `http://127.0.0.1:11434/v1` instead.

The Docker configuration maps `host.docker.internal` on Linux as well as Docker Desktop. Ollama binds to `127.0.0.1:11434` by default; if a Linux container still cannot connect, configure Ollama to listen on an address reachable from Docker. Do not expose an unauthenticated Ollama server to an untrusted network.

Local model quality and memory requirements vary. Datum validates new configurations with a tool-call test, but larger CityJSON workflows still require a model that can reliably select tools and produce valid arguments.

### Other model services

Datum can use any model that supports tool calls through one of its two API formats. Examples:

| Service | `MODEL_PROVIDER` | Example model | `MODEL_BASE_URL` |
|---|---|---|---|
| Ollama | `ollama` | `qwen3:8b` | `http://host.docker.internal:11434/v1` |
| Google Gemini | `openai` | `gemini-3.7-flash` | `https://generativelanguage.googleapis.com/v1beta/openai` |
| DeepSeek | `openai` | `deepseek-v4-pro` | `https://api.deepseek.com` |
| OpenAI GPT | `openai` | a current GPT model with Chat Completions tool calling | `https://api.openai.com/v1` |
| Anthropic Claude | `anthropic` | a current Claude model with tool use | `https://api.anthropic.com` |

Model names and availability change. Confirm the exact model identifier in the provider documentation:

- [DeepSeek models and pricing](https://api-docs.deepseek.com/quick_start/pricing/)
- [Gemini models](https://ai.google.dev/gemini-api/docs/models)
- [OpenAI models](https://platform.openai.com/docs/models)
- [Claude models](https://docs.anthropic.com/en/docs/about-claude/models/overview)

### 3. Start Datum

```bash
npm run chat
```

Open <http://127.0.0.1:3000>.

The command starts the container in detached mode and returns to the terminal. Use these commands to view logs or stop the application:

```bash
npm run chat:logs
npm run chat:stop
```

`npm run chat` uses this image-selection sequence:

1. Check whether `yarroudh/cityjson-mcp:latest` exists locally.
2. Pull it from Docker Hub only when it is not available locally.
3. Start the chat application in detached mode without building an image.

The application binds to `127.0.0.1:3000`. Docker volumes store imported files and derived datasets.

### Optional: build the image locally

Build the image before `npm run chat` when you want to run local source changes:

```bash
npm run docker:build
npm run docker:doctor
npm run chat
```

The `val3dity` and `cjval` build stages take the most time. They can be cached separately:

```bash
npm run docker:cache:val3dity
npm run docker:cache:cjval
npm run docker:build
```

Set `CITYJSON_MCP_IMAGE` to use another image name:

```bash
CITYJSON_MCP_IMAGE=example/cityjson-mcp:tag npm run chat
```

## Use the MCP server without Datum

The MCP server can run separately in Claude Desktop, Claude Code, Cursor, VS Code, or another client that supports local stdio MCP servers. A separate model API key is not required by the MCP server because the client supplies the model.

### Pull and verify the image

```bash
docker pull yarroudh/cityjson-mcp:latest
docker run --rm --entrypoint node yarroudh/cityjson-mcp:latest /app/scripts/doctor.mjs
```

The doctor command should report `OK` for `cjio`, `cjval`, `val3dity`, `citygml-tools`, and `cjdb`.

### Configure a file inbox

MCP tool calls do not contain ordinary chat attachments. Mount a host folder as `/input` for files that must be available to the MCP server. Replace `/absolute/path/to/cityjson-files` with an existing absolute path:

```json
{
  "mcpServers": {
    "cityjson": {
      "command": "docker",
      "args": [
        "run",
        "--rm",
        "-i",
        "--mount",
        "type=bind,source=/absolute/path/to/cityjson-files,target=/input,readonly",
        "--env",
        "CITYJSON_MCP_ALLOWED_ROOTS=/input:/data",
        "--env",
        "CITYJSON_MCP_INPUT=/input",
        "yarroudh/cityjson-mcp:latest"
      ]
    }
  }
}
```

Place `model.city.json` in the mounted folder, then ask the client:

> Import `model.city.json` and summarize it.

The model should call `cityjson_import` with the filename. It should not send the full file through `cityjson_import_text`.

Paths created by a chat client, such as `/mnt/user-data/...`, do not automatically exist in the MCP container. Use the mounted inbox or a client that implements attachment handling, such as Datum.

### Claude Desktop

The template is [config/claude-desktop.json](config/claude-desktop.json). Add the inbox mount from the previous example when working with files.

Claude Desktop configuration locations:

- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`

Merge the `mcpServers.cityjson` entry into the existing file. Fully quit and reopen Claude Desktop. In a chat, enable the `cityjson` connector and allow its tools.

### Claude Code

Copy the template into the project where Claude Code runs:

```bash
cp config/claude-code.json .mcp.json
```

Add the inbox mount to `.mcp.json` when required, then restart or reconnect the MCP server.

### Cursor

The template is [config/cursor-mcp.json](config/cursor-mcp.json).

Use one of these locations:

- Project: `.cursor/mcp.json`
- Global: `~/.cursor/mcp.json`

Restart the MCP server after changing the file.

### VS Code

The template is [config/vscode-mcp.json](config/vscode-mcp.json). Copy its `servers.cityjson` entry into `.vscode/mcp.json`, then start or restart the server from the MCP server-management commands in VS Code.

### Other MCP clients

Use this command for any client that supports a local stdio MCP server:

```text
docker run --rm -i yarroudh/cityjson-mcp:latest
```

Add the `/input` mount shown above when the server must read local files.

## File and dataset handling

- Datum streams browser attachments to the MCP input directory and calls `cityjson_import` automatically.
- Standalone MCP clients use a mounted `/input` directory.
- `cityjson_import` copies a source file into the managed workspace and returns a `dataset_id`.
- `cityjson_open` opens an authorized server-visible path.
- `cityjson_import_text` accepts small CityJSON documents supplied as text.
- `cityjson_download` returns a source or derived dataset.
- Dataset handles remain valid only while the MCP server process is running.
- Derived files remain in the managed workspace until they are deleted externally.

## Tool catalog

The server exposes 37 tools.

### Dataset management and inspection

| Tool | Backend | Purpose |
|---|---|---|
| `cityjson_backend_status` | native | Report backend availability and path settings. |
| `cityjson_list_imports` | native | List JSON files in the input directory. |
| `cityjson_import` | native | Import an input file and return a `dataset_id`. |
| `cityjson_import_text` | native | Import a small CityJSON document supplied as text. |
| `cityjson_open` | native | Open a CityJSON file from an authorized path. |
| `cityjson_download` | native | Return a source or derived CityJSON file. |
| `cityjson_save` | native | Copy a dataset to an authorized destination. |
| `cityjson_info` | native | Return version, counts, LoDs, attributes, metadata, transform, and extensions. |
| `cityjson_list_objects` | native | List CityObjects with pagination and type filters. |
| `cityjson_get_object` | native | Return one CityObject and its computed bounding box. |
| `cityjson_query` | native | Query by IDs, types, bounding box, and attribute predicates. |

### Validation

| Tool | Backend | Purpose |
|---|---|---|
| `cityjson_validate_schema` | cjval | Validate JSON syntax, schemas, extensions, and structural consistency. |
| `cityjson_validate_geometry` | val3dity | Validate supported 3D geometry primitives. |
| `cityjson_validate` | cjval + val3dity | Run both validators and return one result. |

### Transformations

Each tool in this table returns a new dataset handle.

| Tool | Backend | Purpose |
|---|---|---|
| `cityjson_subset` | cjio | Select or exclude objects by IDs, type, bounding box, radius, or random count. |
| `cityjson_filter_lod` | cjio | Keep one level of detail. |
| `cityjson_reproject` | cjio | Transform coordinates to a target EPSG CRS. |
| `cityjson_assign_crs` | cjio | Assign an EPSG CRS without changing coordinates. |
| `cityjson_translate` | cjio | Translate coordinates. |
| `cityjson_clean_vertices` | cjio | Remove duplicate and unused vertices. |
| `cityjson_triangulate` | cjio | Triangulate surfaces. |
| `cityjson_merge` | cjio | Merge two or more datasets. |
| `cityjson_attribute_rename` | cjio | Rename an attribute. |
| `cityjson_attribute_remove` | cjio | Remove an attribute. |
| `cityjson_remove_textures` | cjio | Remove textures. |
| `cityjson_remove_materials` | cjio | Remove materials. |
| `cityjson_upgrade` | cjio | Upgrade an older supported CityJSON version. |

### Export, conversion, and database

| Tool | Backend | Purpose |
|---|---|---|
| `cityjson_export` | cjio | Export to JSONL, OBJ, STL, GLB, or B3DM. |
| `citygml_to_cityjson` | citygml-tools | Convert CityGML to CityJSON or CityJSONSeq. |
| `cityjson_to_citygml` | citygml-tools | Convert CityJSON to CityGML. |
| `cityjson_db_import` | cjio + cjdb | Import a dataset into PostgreSQL/PostGIS. |
| `cityjson_db_export` | cjdb + cjio | Export all or selected objects from cjdb. |

### Specification and schemas

| Tool | Source | Purpose |
|---|---|---|
| `cityjson_spec_outline` | bundled index | Return the CityJSON specification outline and schema names. |
| `cityjson_spec_read` | cityjson.org | Read part of the CityJSON specification. |
| `cityjson_schema_read` | cityjson.org | Read a CityJSON JSON Schema. |
| `cityjson_extensions_registry` | CityJSON registry | List or search registered extensions. |
| `cityjson_extension_schema` | CityJSON registry | Read a registered extension schema. |

## Example prompts

### Inspect a file

> Import `tile.city.json`. Report the version, CRS, object counts by type, LoDs, attributes, and extensions. Do not modify the dataset.

Expected tools: `cityjson_import`, `cityjson_info`.

### Validate a file

> Import `tile.city.json`. Run structural and geometric validation. Separate cjval findings from val3dity findings and list affected object IDs.

Expected tools: `cityjson_import`, `cityjson_validate`.

### Create a subset

> Import `city.city.json`. Keep Building and BuildingPart objects inside bbox `[85000, 446000, 86000, 447000]`, keep LoD 2.2, reproject to EPSG:28992, validate the result, and give me the resulting file.

Expected tools: `cityjson_import`, `cityjson_subset`, `cityjson_filter_lod`, `cityjson_reproject`, `cityjson_validate`, `cityjson_download`.

### Clean and download

> Import `tile.city.json`. Remove duplicate and unused vertices, validate the derived dataset, and return it as `tile-clean.city.json`. Do not overwrite the source.

Expected tools: `cityjson_import`, `cityjson_clean_vertices`, `cityjson_validate`, `cityjson_download`.

## Configuration reference

| Variable | Default | Purpose |
|---|---|---|
| `MODEL_PROVIDER` | `anthropic` | Model API selection: `anthropic`, `openai`, or `ollama`. |
| `MODEL_NAME` | none | Default Datum model identifier. |
| `MODEL_API_KEY` | none | Default Datum model API key. |
| `MODEL_BASE_URL` | provider default | Model API base URL. |
| `MODEL_MAX_OUTPUT_TOKENS` | `4096` | Maximum output tokens per model call. |
| `MODEL_TEMPERATURE` | `0.1` | Model sampling temperature. |
| `CHAT_HOST` | `127.0.0.1` | Datum bind address outside Docker. |
| `CHAT_PORT` | `3000` | Datum port. |
| `CHAT_MAX_UPLOAD_BYTES` | `1073741824` | Maximum upload size. |
| `CHAT_MAX_UPLOAD_FILES` | `5` | Maximum files per upload. |
| `CHAT_MAX_TOOL_ROUNDS` | `12` | Maximum tool-call rounds per response. |
| `CITYJSON_MCP_ALLOWED_ROOTS` | current directory | Authorized filesystem roots. Use `:` on macOS/Linux and `;` on Windows. |
| `CITYJSON_MCP_INPUT` | `./input` | Input directory used by `cityjson_import`. |
| `CITYJSON_MCP_WORKSPACE` | `./.cityjson-mcp-workspace` | Managed source and derived datasets. |
| `CITYJSON_MCP_COMMAND_TIMEOUT_MS` | `120000` | External command timeout. |
| `CITYJSON_MCP_MAX_DOWNLOAD_BYTES` | `26214400` | Maximum inline MCP download size. Datum streams downloads directly. |
| `CJIO_BIN` | `cjio` | Optional cjio executable override. |
| `CJVAL_BIN` | `cjval` | Optional cjval executable override. |
| `VAL3DITY_BIN` | `val3dity` | Optional val3dity executable override. |
| `CITYGML_TOOLS_BIN` | `citygml-tools` | Optional citygml-tools executable override. |
| `CJDB_BIN` | `cjdb` | Optional cjdb executable override. |

Set `PGPASSWORD` in the process environment for cjdb. Database tool arguments do not accept a password.

## Run without Docker

Running without Docker requires Node.js and the backend executables used by the requested tools.

```bash
npm install
npm run doctor
npm test
npm run check
npm start
```

Backend installation sources:

- [cjio](https://github.com/cityjson/cjio)
- [cjval](https://github.com/cityjson/cjval)
- [val3dity](https://github.com/tudelft3d/val3dity)
- [citygml-tools](https://github.com/citygml4j/citygml-tools)
- [cjdb](https://github.com/cityjson/cjdb)

Use `npm run chat:host` only when all required backends are installed locally. Datum checks backend availability during startup. `CHAT_ALLOW_PARTIAL_BACKENDS=true` allows startup with missing backends for development tests.

## Security

- File operations are limited to `CITYJSON_MCP_ALLOWED_ROOTS`, the input directory, and the managed workspace.
- Browser uploads receive generated storage names.
- MCP tools do not expose arbitrary shell commands.
- External commands use argument arrays with `shell: false`.
- Tool inputs are validated with Zod schemas.
- Database passwords remain in the process environment.
- cjdb export accepts only a single `SELECT` statement, but this check is not a database security boundary. Use a database role with limited permissions.
- Commands have time and output limits.
- Treat installation of any local MCP server as installation of local code.

## Contributing

1. Fork the repository and create a branch for one change.
2. Install dependencies with `npm install`.
3. Make the change. Keep MCP tool inputs typed and do not add shell-string execution.
4. Add or update tests for changed behavior.
5. Run:

   ```bash
   npm test
   npm run check
   ```

6. If the change affects a Docker backend, build the image and run `npm run docker:doctor`.
7. Update the README and `.env.example` when configuration or user-visible behavior changes.
8. Open a pull request that states what changed, why it changed, and how it was tested.

Do not include API keys, database passwords, private CityJSON datasets, generated workspaces, or `.env` files in a contribution.

## Next

- [ ] Add explicit Ollama setup and model presets for local models.
- [x] Stream model responses and tool progress to the browser.
- [x] Add cancellation and progress reporting for long validation and conversion jobs.
- [x] Add an optional 3D preview for imported and derived datasets.

## Tests

Run the test suite:

```bash
npm test
```

Run syntax checks for project `.mjs` files:

```bash
npm run check
```

Verify every executable in the Docker image:

```bash
npm run docker:doctor
```

## Known limitations

- Dataset handles are process-local. Restarting the MCP server invalidates existing `dataset_id` values.
- Native inspection loads regular CityJSON JSON files into memory.
- `cityjson_query` computes bounding boxes from geometry stored directly on each object. It does not combine all child geometry into a parent bounding box.
- Specification, schema, and extension lookup tools require network access, except for `cityjson_spec_outline`.
- Derived workspace files are not deleted automatically.
- Exact export and conversion behavior depends on the installed backend versions.
- `val3dity` is GPL-3.0 software and runs as a separate executable. Review upstream licenses before redistributing a modified image.

## Upstream projects

- [CityJSON specification](https://www.cityjson.org/specs/)
- [CityJSON specification repository](https://github.com/cityjson/specs)
- [CityJSON Extensions registry](https://github.com/cityjson/extensions)
- [cjio](https://github.com/cityjson/cjio)
- [cjval](https://github.com/cityjson/cjval)
- [val3dity](https://github.com/tudelft3d/val3dity)
- [citygml-tools](https://github.com/citygml4j/citygml-tools)
- [cjdb](https://github.com/cityjson/cjdb)
- [Model Context Protocol TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk)

## Citation

If you use this project in your research, please cite it as follows.

### APA

> Yarroudh. (2026). Yarroudh/cityjson-mcp: CityJSON MCP & Datum Chat Application (Version 0.2.0) [Computer software]. Zenodo. https://doi.org/10.5281/zenodo.22151334

### IEEE

> [1] Yarroudh, Yarroudh/cityjson-mcp: CityJSON MCP & Datum Chat Application (Version 0.2.0). (Aug. 28, 2026). Zenodo. doi: 10.5281/zenodo.22151334.

### BibTeX

```bibtex
@software{yarroudh2026cityjsonmcp,
  author    = {Yarroudh},
  title     = {Yarroudh/cityjson-mcp: CityJSON MCP \& Datum Chat Application},
  year      = {2026},
  version   = {0.2.0},
  publisher = {Zenodo},
  doi       = {10.5281/zenodo.22151334},
  url       = {https://doi.org/10.5281/zenodo.22151334}
}
```

## License

This repository uses the MIT License. See [LICENSE](LICENSE).

The bundled image invokes external programs under their own licenses. This repository does not relicense those programs.
