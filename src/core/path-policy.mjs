import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

function splitRoots(value) {
  if (!value) return [process.cwd()];
  const delimiter = process.platform === 'win32' ? ';' : ':';
  return value.split(delimiter).map(s => s.trim()).filter(Boolean);
}

export class PathPolicy {
  constructor() {
    this.roots = splitRoots(process.env.CITYJSON_MCP_ALLOWED_ROOTS).map(p => path.resolve(p));
    const defaultWorkspace = path.join(process.cwd(), '.cityjson-mcp-workspace');
    this.workspace = path.resolve(process.env.CITYJSON_MCP_WORKSPACE || defaultWorkspace);
    fs.mkdirSync(this.workspace, { recursive: true });
  }

  describe() {
    return { allowedRoots: this.roots, workspace: this.workspace, platform: os.platform() };
  }

  assertReadable(inputPath) {
    const resolved = path.resolve(inputPath);
    const inAllowedRoot = this.roots.some(root => resolved === root || resolved.startsWith(root + path.sep));
    const inWorkspace = resolved === this.workspace || resolved.startsWith(this.workspace + path.sep);
    if (!inAllowedRoot && !inWorkspace) {
      throw new Error(`Path is outside allowed roots: ${resolved}`);
    }
    if (!fs.existsSync(resolved)) throw new Error(`Path does not exist: ${resolved}`);
    return resolved;
  }

  assertWritable(outputPath) {
    const resolved = path.resolve(outputPath);
    const parent = path.dirname(resolved);
    const inAllowedRoot = this.roots.some(root => resolved === root || resolved.startsWith(root + path.sep));
    const inWorkspace = resolved === this.workspace || resolved.startsWith(this.workspace + path.sep);
    if (!inAllowedRoot && !inWorkspace) {
      throw new Error(`Output path is outside allowed roots: ${resolved}`);
    }
    fs.mkdirSync(parent, { recursive: true });
    return resolved;
  }

  workspacePath(name) {
    const safe = name.replace(/[^A-Za-z0-9._-]/g, '_');
    return path.join(this.workspace, safe);
  }
}
