import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { runCommand, executableStatus } from '../core/command-runner.mjs';

async function listFilesRecursive(dir) {
  const out = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...await listFilesRecursive(p)); else out.push(p);
  }
  return out;
}

export class CitygmlToolsAdapter {
  constructor(datasetManager) {
    this.dm = datasetManager;
    this.bin = process.env.CITYGML_TOOLS_BIN || 'citygml-tools';
  }
  status() { return executableStatus(this.bin, ['--version']); }

  async toCityJSON(source, options = {}) {
    const input = this.dm.pathPolicy.assertReadable(source);
    const outDir = this.dm.pathPolicy.workspacePath(`citygml-to-cityjson-${crypto.randomUUID().slice(0, 8)}`);
    await fs.mkdir(outDir, { recursive: true });
    const args = ['to-cityjson', '--output', outDir];
    if (options.jsonLines) args.push('--json-lines');
    args.push(input);
    const result = await runCommand(this.bin, args);
    const files = (await listFilesRecursive(outDir)).filter(p => /\.(json|jsonl)$/i.test(p));
    if (!files.length) throw new Error(`citygml-tools completed but no CityJSON output was found in ${outDir}`);
    const cityJsonFile = files.find(p => !/\.jsonl$/i.test(p));
    const derived = cityJsonFile ? await this.dm.registerDerived(cityJsonFile, 'citygml-tools:to-cityjson', []) : null;
    return { input, outputDirectory: outDir, files, derived, stdout: result.stdout, stderr: result.stderr };
  }

  async fromCityJSON(datasetId, options = {}) {
    const ds = this.dm.get(datasetId);
    const outDir = options.outputDirectory
      ? this.dm.pathPolicy.assertWritable(path.join(options.outputDirectory, '.probe')).replace(/[\\/]\.probe$/, '')
      : this.dm.pathPolicy.workspacePath(`cityjson-to-citygml-${crypto.randomUUID().slice(0, 8)}`);
    await fs.mkdir(outDir, { recursive: true });
    const args = ['from-cityjson', '--output', outDir];
    if (options.crsName) args.push('--crs-name', options.crsName);
    args.push(ds.path);
    const result = await runCommand(this.bin, args);
    const files = (await listFilesRecursive(outDir)).filter(p => /\.(gml|xml)$/i.test(p));
    return { datasetId, outputDirectory: outDir, files, stdout: result.stdout, stderr: result.stderr };
  }
}
