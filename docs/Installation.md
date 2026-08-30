# Installation and configuration

This page covers every supported way to install CityJSON MCP and Datum. It also explains model configuration, storage, MCP client setup, optional database support, verification, updates, removal, and common installation failures.

## Choose an installation path

| Goal | Recommended path | What is installed on the host |
|---|---|---|
| Use Datum with all 37 tools | Docker with `npm run chat` | Git, Node.js, and Docker |
| Use the MCP server in another AI client | Published Docker image | Docker |
| Develop the interface while using the complete backend image | Docker with repository source mounts | Git, Node.js, and Docker |
| Run every component directly on the host | Manual installation | Node.js, Python, Rust, Java, CMake, and every backend |
| Inspect the interface while some backends are absent | Partial backend host mode | Node.js and any backends being tested |

Docker is recommended for normal use. The image contains compatible backend versions and avoids host language and library conflicts.

## Components installed by the Docker image

The current image contains:

| Component | Image version or source | Purpose |
|---|---|---|
| Node.js | Node 22 runtime | MCP server and Datum server |
| cjio | `0.10.1` | Transformations, subsets, export, upgrade, and CityJSON sequence conversion |
| cjval | Built with Cargo and the binary feature | CityJSON schema and structure validation |
| val3dity | `2.6.0` | Three dimensional geometry validation |
| CityGML Tools | `2.5.0` | CityGML and CityJSON conversion |
| cjdb | `2.3.0` | PostgreSQL and PostGIS import and export |
| Java | OpenJDK 17 runtime | CityGML Tools runtime |

The project keeps cjio and cjdb in separate Python environments because their dependency requirements differ.

## Recommended Docker installation

### 1. Install prerequisites

Install:

* [Git](https://git-scm.com/downloads).
* [Node.js](https://nodejs.org/en/download) version 20 or newer.
* [Docker Desktop](https://docs.docker.com/get-started/introduction/get-docker-desktop/) on macOS or Windows, or Docker Engine with the Compose plugin on Linux.

Start Docker before continuing. Verify the command line tools:

```bash
git --version
node --version
npm --version
docker version
docker compose version
```

### 2. Clone the repository

```bash
git clone https://github.com/Yarroudh/cityjson-mcp.git
cd cityjson-mcp
npm install
```

`npm install` installs the browser dependencies and scripts used by the launcher. It does not install the CityJSON backends on the host.

### 3. Create the environment file

```bash
cp .env.example .env
```

On Windows PowerShell:

```powershell
Copy-Item .env.example .env
```

Do not commit `.env`. It can contain model and database credentials.

### 4. Configure a language model

Datum requires a language model that supports tool calls. The MCP server can run without a separate model when it is connected directly to an AI client.

#### OpenRouter free cloud configuration

Create an [OpenRouter API key](https://openrouter.ai/settings/keys), then use:

```dotenv
MODEL_PROVIDER=openrouter
MODEL_NAME=openrouter/free
MODEL_API_KEY=replace-with-your-key
MODEL_BASE_URL=https://openrouter.ai/api/v1
MODEL_MAX_OUTPUT_TOKENS=4096
MODEL_TEMPERATURE=0.1
CHAT_ENABLE_OLLAMA=false
```

`openrouter/free` is the recommended free cloud starting point. Capacity and request quotas can vary because free endpoints are shared.

#### OpenAI compatible cloud configuration

Use this mode for OpenAI and services that expose an OpenAI Chat Completions compatible endpoint:

```dotenv
MODEL_PROVIDER=openai
MODEL_NAME=provider-model-id
MODEL_API_KEY=replace-with-your-key
MODEL_BASE_URL=https://provider.example/v1
MODEL_MAX_OUTPUT_TOKENS=4096
MODEL_TEMPERATURE=0.1
CHAT_ENABLE_OLLAMA=false
```

Use the exact model identifier and base URL from the provider. The model must support function or tool calls.

#### Anthropic configuration

```dotenv
MODEL_PROVIDER=anthropic
MODEL_NAME=provider-model-id
MODEL_API_KEY=replace-with-your-key
MODEL_BASE_URL=https://api.anthropic.com
MODEL_MAX_OUTPUT_TOKENS=4096
MODEL_TEMPERATURE=0.1
CHAT_ENABLE_OLLAMA=false
```

Datum uses the native Anthropic Messages format for this provider.

#### Bundled Ollama configuration

```dotenv
MODEL_PROVIDER=ollama
MODEL_NAME=qwen3:8b
MODEL_API_KEY=
MODEL_BASE_URL=http://ollama:11434/v1
OLLAMA_BASE_URL=http://ollama:11434/v1
OLLAMA_CONTEXT_LENGTH=16384
CHAT_ENABLE_OLLAMA=true
```

The launcher starts the bundled Ollama container when Ollama is selected. The model files are stored in the `ollama-models` Docker volume. Choose a model that advertises tool support.

#### Native Ollama on macOS

Install [Ollama](https://ollama.com/download), start the application, and pull a tool capable model:

```bash
ollama pull qwen3:8b
curl http://127.0.0.1:11434/api/tags
```

When `npm run chat` detects native Ollama on macOS, it connects the Datum container through `host.docker.internal`. Native Ollama is preferred on macOS because Docker Desktop does not provide GPU access to its Linux containers.

### 5. Start Datum

```bash
npm run chat
```

Open `http://127.0.0.1:3000`.

The launcher:

1. Reads `.env`.
2. Decides whether Ollama is required.
3. Uses native Ollama on macOS when it is enabled and reachable.
4. Pulls missing container images.
5. Starts the Datum service and optional Ollama service without building images.

Useful commands:

```bash
npm run chat:logs
npm run chat:stop
```

Force Ollama on or off for one start:

```bash
npm run chat -- --with-ollama
npm run chat -- --without-ollama
```

Command options take precedence over `CHAT_ENABLE_OLLAMA`, which takes precedence over automatic selection from `MODEL_PROVIDER`.

### 6. Verify the installation

Check the backend bundle inside the image:

```bash
docker run --rm --entrypoint node yarroudh/cityjson-mcp:latest /app/scripts/doctor.mjs
```

The result should report `OK` for cjio, cjval, val3dity, CityGML Tools, and cjdb.

In Datum:

1. Confirm the model appears in the model menu.
2. Import `examples/minimal.city.json` through the browser.
3. Ask for a dataset summary.
4. Open the CityJSON MCP catalog and confirm 37 tools.
5. Open the viewer.
6. Ask Datum to validate the dataset.

## Docker storage and networking

The Compose project uses three volumes:

| Volume | Contents |
|---|---|
| `cityjson-input` | Browser uploads and MCP inbox files |
| `cityjson-data` | Managed source files, derived datasets, reports, and the dataset registry |
| `ollama-models` | Downloaded Ollama models |

`npm run chat:stop` stops the containers without deleting these volumes.

Datum binds only to `127.0.0.1:3000` by default. Ollama is not published on a host port when the bundled container is used. The Compose network allows Datum to reach it internally.

Remote URL import and the live specification, schema, and extension tools require outbound HTTPS access from the MCP process. Local inspection, transformation, and bundled schema outline tools do not require that network access.

To inspect the running services:

```bash
docker compose -f docker/docker-compose.chat.yml ps
docker compose -f docker/docker-compose.chat.yml logs cityjson-chat
```

## Build the complete image locally

Build locally when testing backend changes or when the published image is unavailable:

```bash
npm run docker:cache:val3dity
npm run docker:cache:cjval
npm run docker:build
npm run docker:doctor
```

The separate cache commands preserve the expensive compiler stages. The final image is tagged `yarroudh/cityjson-mcp:latest`.

Use another tag by setting:

```dotenv
CITYJSON_MCP_IMAGE=your-registry/cityjson-mcp:tag
```

The Dockerfile accepts build arguments for val3dity, CityGML Tools, and compiler job counts. Changing versions can create compatibility differences from the tested image.

## Install only the MCP server for another client

Datum is optional. Claude Desktop, Claude Code, Cursor, VS Code, and other clients can start the published image as a standard input and output MCP server.

### Pull and verify

```bash
docker pull yarroudh/cityjson-mcp:latest
docker run --rm --entrypoint node yarroudh/cityjson-mcp:latest /app/scripts/doctor.mjs
```

### Minimal MCP command

```text
docker run --rm -i yarroudh/cityjson-mcp:latest
```

The `-i` option is required because MCP communication uses standard input and output. Do not add a terminal allocation option.

### Add an input inbox and persistent workspace

Create a folder for CityJSON files and use its absolute path:

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
        "--mount",
        "type=volume,source=cityjson-mcp-data,target=/data",
        "--env",
        "CITYJSON_MCP_ALLOWED_ROOTS=/input:/data",
        "--env",
        "CITYJSON_MCP_INPUT=/input",
        "--env",
        "CITYJSON_MCP_WORKSPACE=/data/.cityjson-mcp-workspace",
        "yarroudh/cityjson-mcp:latest"
      ]
    }
  }
}
```

The host folder is read only in this example. Derived datasets are stored in the Docker volume mounted at `/data`.

Add another bind mount at `/output` and include it in `CITYJSON_MCP_ALLOWED_ROOTS` when tools must save directly into a host folder. Do not remove the read only option from an input folder unless writes are intentional.

On Windows, JSON strings must escape backslashes. Forward slash paths such as `C:/CityJSON/input` are often easier to read in client configuration.

Files created in an AI client sandbox do not automatically exist inside the MCP container. Copy the file into the mounted inbox, then call `cityjson_import` with its filename.

### Client configuration locations

| Client | Repository template | Typical destination |
|---|---|---|
| Claude Desktop on macOS | `config/claude-desktop.json` | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| Claude Desktop on Windows | `config/claude-desktop.json` | `%APPDATA%\Claude\claude_desktop_config.json` |
| Claude Code | `config/claude-code.json` | `.mcp.json` in the project |
| Cursor | `config/cursor-mcp.json` | `.cursor/mcp.json` or `~/.cursor/mcp.json` |
| VS Code | `config/vscode-mcp.json` | `.vscode/mcp.json` |

Merge the CityJSON server entry into an existing configuration instead of replacing unrelated servers. Restart or reconnect the MCP server after changing the file.

## Manual host installation

Manual host mode is intended for development. The complete Docker image is easier to reproduce and support.

### Host prerequisites

Install:

* Node.js 20 or newer.
* Python 3 with virtual environment support.
* Rust and Cargo for cjval.
* Java 17 or newer for CityGML Tools.
* CMake and a C++ compiler for val3dity when a package is unavailable.
* Git and curl.
* PostgreSQL with PostGIS only when database tools are needed.

Clone the project and install JavaScript dependencies:

```bash
git clone https://github.com/Yarroudh/cityjson-mcp.git
cd cityjson-mcp
npm install
cp .env.example .env
```

The Python examples below use macOS and Linux activation commands. In Windows PowerShell, create an environment with `py -m venv NAME`, activate it with `NAME\Scripts\Activate.ps1`, and use the executable under `NAME\Scripts` in `.env`.

### Install cjio in an isolated environment

The tested host equivalent is cjio `0.10.1` with export, reprojection, and triangulation dependencies:

```bash
python3 -m venv .venv-cjio
source .venv-cjio/bin/activate
python -m pip install --upgrade pip
python -m pip install "cjio==0.10.1" pandas mapbox-earcut pyproj "triangle @ git+https://github.com/drufat/triangle.git@595b43eb6682992a0b1012b9671bf860c0e6ae56"
deactivate
```

Set the executable path in `.env`:

```dotenv
CJIO_BIN=/absolute/path/to/cityjson-mcp/.venv-cjio/bin/cjio
```

The explicit triangle source revision matches the Docker image and enables triangulation where a packaged wheel is unavailable. It requires Git and a working native compiler toolchain.

### Install cjdb in a separate environment

Do not install cjdb into the cjio environment. The tested cjdb release requires an older cjio dependency range.

```bash
python3 -m venv .venv-cjdb
source .venv-cjdb/bin/activate
python -m pip install --upgrade pip
python -m pip install "cjdb==2.3.0"
deactivate
```

```dotenv
CJDB_BIN=/absolute/path/to/cityjson-mcp/.venv-cjdb/bin/cjdb
```

The official cjdb project also recommends an isolated Python environment.

### Install cjval

Install [Rust](https://www.rust-lang.org/tools/install), then build the command line binary:

```bash
cargo install cjval --features build-binary
cjval --help
```

If Cargo binaries are not on `PATH`, set:

```dotenv
CJVAL_BIN=/absolute/path/to/.cargo/bin/cjval
```

### Install val3dity

On macOS with Homebrew:

```bash
brew tap tudelft3d/software
brew install val3dity
val3dity --version
```

On Linux, install a C++ compiler, CMake, Eigen, GEOS, CGAL, and Boost filesystem and program options. A Debian or Ubuntu example is:

```bash
sudo apt update
sudo apt install build-essential cmake git libcgal-dev libeigen3-dev libgeos++-dev libboost-filesystem-dev libboost-program-options-dev
git clone --depth 1 --branch 2.6.0 https://github.com/tudelft3d/val3dity.git
cmake -S val3dity -B val3dity/build -DCMAKE_BUILD_TYPE=Release
cmake --build val3dity/build --parallel
```

Then set:

```dotenv
VAL3DITY_BIN=/absolute/path/to/val3dity/build/val3dity
```

Windows users can use the executable published by the [val3dity project](https://github.com/tudelft3d/val3dity/releases) or compile with CMake and its required libraries.

### Install CityGML Tools

Install Java 17 or newer. Download and extract the [CityGML Tools release](https://github.com/citygml4j/citygml-tools/releases) for version `2.5.0`, then verify its launcher:

```bash
/absolute/path/to/citygml-tools-2.5.0/citygml-tools --version
```

Set:

```dotenv
CITYGML_TOOLS_BIN=/absolute/path/to/citygml-tools-2.5.0/citygml-tools
```

On Windows, use the launcher supplied in the extracted distribution and enter its absolute path.

### Configure paths for host mode

Use absolute paths for production use:

```dotenv
CITYJSON_MCP_INPUT=/absolute/path/to/cityjson-input
CITYJSON_MCP_WORKSPACE=/absolute/path/to/cityjson-workspace
CITYJSON_MCP_ALLOWED_ROOTS=/absolute/path/to/cityjson-input:/absolute/path/to/cityjson-output
```

macOS and Linux separate allowed roots with a colon. Windows separates them with a semicolon.

### Verify all host backends

```bash
npm run doctor
npm test
npm run check
```

The doctor script checks:

```text
cjio --version
cjval --help
val3dity --version
citygml-tools --version
cjdb --help
```

### Start the host services

Start the MCP server alone:

```bash
npm start
```

Start Datum directly:

```bash
npm run chat:host
```

Datum requires the complete backend bundle by default. For interface inspection during development only:

```dotenv
CHAT_ALLOW_PARTIAL_BACKENDS=true
```

Tools whose backends are missing will still fail.

## PostgreSQL and PostGIS for cjdb

The database tools are optional. They require a PostgreSQL database with the PostGIS extension and a user with suitable schema permissions.

A typical database preparation is:

```bash
createdb cityjson
psql -d cityjson -c 'CREATE EXTENSION IF NOT EXISTS postgis;'
```

Set the password in the Datum or MCP server environment:

```dotenv
PGPASSWORD=replace-with-database-password
```

Do not pass a password in MCP tool arguments. Database tool parameters contain the host, user, database, and schema only.

When Datum runs in Docker and PostgreSQL runs on the host, use `host.docker.internal` as the database host. Ensure PostgreSQL accepts a connection from Docker and use a restricted database role.

## Complete configuration reference

### Model and Datum settings

| Variable | Default | Purpose |
|---|---|---|
| `MODEL_PROVIDER` | `anthropic` | Default model service: `ollama`, `openrouter`, `openai`, or `anthropic` |
| `MODEL_NAME` | none | Exact default model identifier |
| `MODEL_API_KEY` | none | Default model credential |
| `MODEL_BASE_URL` | provider default | Provider API base URL |
| `MODEL_MAX_OUTPUT_TOKENS` | `4096` | Maximum output tokens per model call |
| `MODEL_TEMPERATURE` | `0.1` | Sampling temperature from zero to one |
| `OLLAMA_BASE_URL` | `http://127.0.0.1:11434/v1` | Ollama API URL outside Compose overrides |
| `OLLAMA_CONTEXT_LENGTH` | `16384` | Ollama context size in tokens |
| `CHAT_ENABLE_OLLAMA` | automatic | Persistent bundled or native Ollama selection |
| `CHAT_HOST` | `127.0.0.1` | Datum bind address in host mode |
| `CHAT_PORT` | `3000` | Datum port |
| `CHAT_MAX_UPLOAD_BYTES` | `1073741824` | Maximum size of one browser upload request |
| `CHAT_MAX_UPLOAD_FILES` | `5` | Maximum files in one browser selection |
| `CHAT_MAX_TOOL_ROUNDS` | `12` | Maximum model and tool rounds per answer |
| `CHAT_MAX_TOOL_RESULT_CHARS` | `100000` | Maximum tool result characters sent to the model |
| `CHAT_ALLOW_PARTIAL_BACKENDS` | `false` | Permit Datum startup with missing backends for development inspection |

Datum also recognizes `OPENROUTER_API_KEY`, `OPENAI_API_KEY`, and `ANTHROPIC_API_KEY` when the matching provider is selected. `MODEL_API_KEY` has priority.

### MCP and file settings

| Variable | Default | Purpose |
|---|---|---|
| `CITYJSON_MCP_ALLOWED_ROOTS` | current directory | Roots allowed for direct file operations |
| `CITYJSON_MCP_INPUT` | `./input` | Inbox used by `cityjson_import` |
| `CITYJSON_MCP_WORKSPACE` | `./.cityjson-mcp-workspace` | Managed sources, derived files, reports, and registry |
| `CITYJSON_MCP_COMMAND_TIMEOUT_MS` | `120000` | External command timeout |
| `CITYJSON_MCP_MAX_UPLOAD_BYTES` | 25 MiB | Limit for inline `cityjson_import_text` content |
| `CITYJSON_MCP_MAX_DOWNLOAD_BYTES` | 25 MiB | Standalone inline download limit |
| `CJIO_BIN` | `cjio` | cjio executable or absolute path |
| `CJVAL_BIN` | `cjval` | cjval executable or absolute path |
| `VAL3DITY_BIN` | `val3dity` | val3dity executable or absolute path |
| `CITYGML_TOOLS_BIN` | `citygml-tools` | CityGML Tools executable or absolute path |
| `CJDB_BIN` | `cjdb` | cjdb executable or absolute path |
| `PGPASSWORD` | not set | PostgreSQL password used by cjdb |
| `CITYJSON_MCP_IMAGE` | `yarroudh/cityjson-mcp:latest` | Docker image used by the chat launcher |
| `OLLAMA_IMAGE` | `ollama/ollama:latest` | Bundled Ollama image |

## Update an installation

### Published image installation

```bash
git pull
npm install
docker pull yarroudh/cityjson-mcp:latest
npm run chat:stop
npm run chat
```

The named volumes remain intact.

### Locally built image

Pull source changes, install updated JavaScript packages, rebuild the image, run the doctor command, then restart Datum:

```bash
git pull
npm install
npm run docker:build
npm run docker:doctor
npm run chat:stop
npm run chat
```

### Manual host installation

Run `npm install`, review Dockerfile version changes, update each isolated backend environment deliberately, then run `npm run doctor`, `npm test`, and `npm run check`.

## Stop or remove the installation

Stop Datum without deleting data:

```bash
npm run chat:stop
```

Remove only the pulled images when they are no longer needed:

```bash
docker image rm yarroudh/cityjson-mcp:latest
docker image rm ollama/ollama:latest
```

Docker volumes contain imported files, derived datasets, and Ollama models. Removing volumes permanently deletes that data. Inspect them before any removal:

```bash
docker volume ls
```

For a manual host installation, remove the project folder and the isolated Python environments only after saving any needed files from the configured input and workspace directories.

## Troubleshooting

### Docker reports a read only file system

An error under `/var/lib/docker` or `/var/lib/desktop-containerd` concerns Docker Desktop storage, not the project directory. Quit and restart Docker Desktop, check available disk space, and run `docker info`. If Docker remains read only, use Docker Desktop diagnostics. A Docker factory reset deletes local images, containers, and volumes and should be a final recovery step.

### Docker is installed but unavailable

Start Docker Desktop or the Docker daemon. Confirm both `docker version` and `docker compose version` work in the same terminal used for `npm run chat`.

### An image cannot be pulled

Check network access, Docker registry access, disk space, and the image name. Build locally with `npm run docker:build` when the source is available.

### Port 3000 is already in use

Stop the process using the port or change `CHAT_PORT` for direct host mode. The current Compose file publishes port 3000 explicitly, so changing the Compose port mapping is required for Docker mode.

### A model API key is rejected

Verify that provider, key, model identifier, and base URL belong to the same service. A correct key can still receive quota, billing, capacity, or rate limit errors. Datum accepts a model only after a live tool call test succeeds.

### Ollama is unreachable

For bundled Ollama, use `http://ollama:11434/v1` inside Compose. For direct host mode, use `http://127.0.0.1:11434/v1`. On macOS, start the native Ollama application before `npm run chat` when native acceleration is desired.

### A CityJSON file is not visible to an MCP client

Confirm that the file is inside the host folder mounted at `/input`. Call `cityjson_list_imports`, then call `cityjson_import` with the filename only. Host paths and AI client sandbox paths do not automatically exist in the container.

### A backend is missing

Run `npm run doctor` in host mode or the image doctor command in Docker mode. Set the matching executable override to an absolute path. The backend status tool reports availability without changing files.

### CityGML Tools does not start

Confirm Java 17 or newer and execute the launcher directly with its version option. Check file execution permission on macOS and Linux.

### cjdb cannot connect

Confirm PostgreSQL network access, PostGIS installation, database permissions, `PGPASSWORD`, and the database host visible from the Datum environment.

### The browser shows old interface code

Restart Datum and refresh the page. Application assets use versioned URLs and are served without persistent caching, but an older running container can still serve older source.

## Official backend resources

* [Docker installation](https://docs.docker.com/get-started/introduction/get-docker-desktop/)
* [Node.js downloads](https://nodejs.org/en/download)
* [Ollama downloads](https://ollama.com/download)
* [cjio repository and installation](https://github.com/cityjson/cjio)
* [cjval repository and installation](https://github.com/cityjson/cjval)
* [val3dity repository and installation](https://github.com/tudelft3d/val3dity)
* [CityGML Tools repository and installation](https://github.com/citygml4j/citygml-tools)
* [cjdb repository and installation](https://github.com/cityjson/cjdb)

## Next steps

* Open the [Datum guide](Datum) for the complete interface workflow.
* Review the [37 MCP tools](CityJSON-MCP-Tools).
* Return to the [Wiki Home](Home).
