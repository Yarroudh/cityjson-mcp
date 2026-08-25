#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${1:-$ROOT/../cityjson-toolbox-mcp.zip}"
cd "$(dirname "$ROOT")"
rm -f "$OUT"
zip -qr "$OUT" "$(basename "$ROOT")" -x '*/node_modules/*' '*/.cityjson-mcp-workspace/*' '*.DS_Store'
echo "$OUT"
