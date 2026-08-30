# Docker

`Dockerfile` builds the complete MCP runtime with `cjio`, `cjdb`, `cjval`, `val3dity`, and `citygml-tools`. Users only need Docker Desktop; Python, Rust, Java, CGAL, and the backend CLIs stay inside the image.

Pull the published image:

```bash
docker pull yarroudh/cityjson-mcp:latest
docker run --rm --entrypoint node yarroudh/cityjson-mcp:latest /app/scripts/doctor.mjs
```

For a source build, cache the two slow compiler stages before building the rest:

```bash
npm run docker:cache:val3dity
npm run docker:cache:cjval
npm run docker:build
```

The full build has a cache barrier. Python, Java, and application layers do not start until both compiler stages have completed and entered Docker's cache. If a later layer fails, rerun `npm run docker:build`; Docker reuses the compiler layers.

Both compiler stages use four jobs by default. Override either value when needed:

```bash
docker build -f docker/Dockerfile --target val3dity-builder \
  --build-arg VAL3DITY_BUILD_JOBS=6 \
  -t cityjson-mcp-val3dity-builder .

docker build -f docker/Dockerfile --target cjval-builder \
  --build-arg CJVAL_BUILD_JOBS=6 \
  -t cityjson-mcp-cjval-builder .
```

Claude Desktop can launch the published image over stdio. Replace the source path with the absolute directory containing the CityJSON files:

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

Use inbox filenames with `cityjson_import`; `cityjson_list_imports` discovers them without exposing absolute paths. The mount is read only. Derived datasets and reports are written to `/data` inside Docker. Use `cityjson_download` to return a result to the client.

`cityjson_import_text` is available only for small JSON documents already present as text. Chat paths such as `/mnt/user-data/...` do not exist inside this container.

For direct browser attachments, start the included one-page chat application:

```bash
npm run chat
```

The launcher starts cloud-only by default unless `MODEL_PROVIDER=ollama`. Use `npm run chat -- --with-ollama` to add the Ollama companion or `npm run chat -- --without-ollama` to force cloud-only startup. The selected mode is printed before any image pull.

Open <http://127.0.0.1:3000>, or the port configured with `CHAT_PORT` in `.env`. The application streams attachments into `/input`, calls `cityjson_import` over MCP, and sends only the returned dataset handle to the model.

Configure the model from the page, or optionally provide a default with `MODEL_PROVIDER`, `MODEL_NAME`, `MODEL_API_KEY`, and `MODEL_BASE_URL` in the repository `.env`.

The page supports local Ollama plus OpenRouter, OpenAI-compatible, and Anthropic cloud models. OpenRouter can discover its current tool-capable catalog from the model dialog. Datum connects directly to the configured provider API and requires the corresponding provider key.

A local PostGIS development database for `cjdb` is available with:

```bash
docker compose -f docker/docker-compose.postgis.yml up -d
```

The password in the compose file is deliberately a local-development password. Replace it before using the service outside an isolated developer workstation.
