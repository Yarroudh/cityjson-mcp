# CityJSON reference resources

This directory contains the MCP's bundled reference index for CityJSON 2.0.2.
The complete living specification and JSON schemas are fetched on demand from the canonical CityJSON/TU Delft endpoints by the `cityjson_spec_read` and `cityjson_schema_read` MCP tools. This avoids silently shipping a stale copy while still giving the model a deterministic outline when offline.
