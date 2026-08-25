# syntax=docker/dockerfile:1
ARG VAL3DITY_VERSION=2.6.0
ARG VAL3DITY_BUILD_JOBS=4
ARG CJVAL_BUILD_JOBS=4

FROM debian:bookworm-slim AS val3dity-builder
ARG VAL3DITY_VERSION
ARG VAL3DITY_BUILD_JOBS
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      build-essential ca-certificates cmake git libcgal-dev libeigen3-dev \
      libgeos++-dev libboost-filesystem-dev libboost-program-options-dev \
 && git clone --depth 1 --branch "${VAL3DITY_VERSION}" https://github.com/tudelft3d/val3dity.git /src/val3dity \
 && cmake -S /src/val3dity -B /src/val3dity/build -DCMAKE_BUILD_TYPE=Release \
 && cmake --build /src/val3dity/build --parallel "${VAL3DITY_BUILD_JOBS}"

FROM rust:1-bookworm AS cjval-builder
ARG CJVAL_BUILD_JOBS
RUN cargo install cjval --features build-binary --root /opt/cjval --jobs "${CJVAL_BUILD_JOBS}"

FROM node:22-bookworm-slim
ARG CITYGML_TOOLS_VERSION=2.5.0

# Cache barrier: finish and commit the expensive compiler stages before any
# comparatively fragile package installation in the runtime stage.
COPY --from=cjval-builder /opt/cjval/bin/cjval /usr/local/bin/cjval
COPY --from=val3dity-builder /src/val3dity/build/val3dity /usr/local/bin/val3dity

RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      build-essential ca-certificates curl unzip python3 python3-dev python3-pip \
      python3-venv openjdk-17-jre-headless \
      libboost-filesystem1.74.0 libboost-program-options1.74.0 \
      libboost-system1.74.0 libgeos-c1v5 libgmp10 libmpfr6 \
 && rm -rf /var/lib/apt/lists/*

# cjdb 2.3 requires cjio <0.10, while the MCP's cjio tools use cjio 0.10.1.
# Isolated environments keep both official CLIs current without resolver backtracking.
# triangle2 has no Linux ARM64 package, so install the compatible `triangle` module
# explicitly with the remaining export/reprojection dependencies.
RUN python3 -m venv /opt/cjio \
 && /opt/cjio/bin/pip install --no-cache-dir \
      'cjio==0.10.1' pandas mapbox-earcut 'triangle==20250106' pyproj \
 && ln -s /opt/cjio/bin/cjio /usr/local/bin/cjio

RUN python3 -m venv /opt/cjdb \
 && /opt/cjdb/bin/pip install --no-cache-dir 'cjdb==2.3.0' \
 && ln -s /opt/cjdb/bin/cjdb /usr/local/bin/cjdb

RUN curl -fL \
      "https://github.com/citygml4j/citygml-tools/releases/download/v${CITYGML_TOOLS_VERSION}/citygml-tools-${CITYGML_TOOLS_VERSION}.zip" \
      -o /tmp/citygml-tools.zip \
 && mkdir -p /opt/citygml-tools \
 && unzip -q /tmp/citygml-tools.zip -d /opt/citygml-tools \
 && test -f "/opt/citygml-tools/citygml-tools-${CITYGML_TOOLS_VERSION}/citygml-tools" \
 && chmod +x "/opt/citygml-tools/citygml-tools-${CITYGML_TOOLS_VERSION}/citygml-tools" \
 && ln -s "/opt/citygml-tools/citygml-tools-${CITYGML_TOOLS_VERSION}/citygml-tools" /usr/local/bin/citygml-tools \
 && rm -f /tmp/citygml-tools.zip

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY src ./src
COPY resources ./resources
COPY scripts/doctor.mjs ./scripts/doctor.mjs

ENV CITYJSON_MCP_ALLOWED_ROOTS=/data \
    CITYJSON_MCP_WORKSPACE=/data/.cityjson-mcp-workspace
VOLUME ["/data"]
ENTRYPOINT ["node", "/app/src/index.mjs"]
