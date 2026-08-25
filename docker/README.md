# Docker notes

`Dockerfile` builds the complete MCP runtime with `cjio`, `cjdb`, `cjval`, `val3dity`, and `citygml-tools`. Users only need Docker Desktop; Python, Rust, Java, CGAL, and the backend CLIs stay inside the image.

Build:

```bash
docker build -f docker/Dockerfile -t cityjson-toolbox-mcp .
npm run docker:doctor
```

To ensure the two slow compiler stages are safely cached before the rest of the image is attempted:

```bash
npm run docker:cache:val3dity
npm run docker:cache:cjval
npm run docker:build
```

The full build also has a cache barrier: Python, Java, and application layers do not start until both compiler stages have completed and been committed to Docker's cache.

Both compiler stages use four jobs by default. Override either value when needed:

```bash
docker build -f docker/Dockerfile --target val3dity-builder \
  --build-arg VAL3DITY_BUILD_JOBS=6 \
  -t cityjson-toolbox-val3dity-builder .

docker build -f docker/Dockerfile --target cjval-builder \
  --build-arg CJVAL_BUILD_JOBS=6 \
  -t cityjson-toolbox-cjval-builder .
```

Claude Desktop can launch it directly over stdio (replace the host data path):

```json
{
  "mcpServers": {
    "cityjson": {
      "command": "docker",
      "args": ["run", "--rm", "-i", "-v", "/absolute/path/to/citydata:/data", "cityjson-toolbox-mcp"]
    }
  }
}
```

Use `/data/...` paths in MCP calls.

A local PostGIS development database for `cjdb` is available with:

```bash
docker compose -f docker/docker-compose.postgis.yml up -d
```

The password in the compose file is deliberately a local-development password. Replace it before using the service outside an isolated developer workstation.
