import fs from 'node:fs/promises';
import path from 'node:path';
import { runCommand, executableStatus } from '../core/command-runner.mjs';

export class CjioAdapter {
  constructor(datasetManager) {
    this.dm = datasetManager;
    this.bin = process.env.CJIO_BIN || 'cjio';
  }

  status() { return executableStatus(this.bin, ['--version']); }

  async transform(datasetId, operation, opArgs = [], suffix = 'city.json') {
    const ds = this.dm.get(datasetId);
    const output = this.dm.makeDerivedPath(datasetId, suffix);
    const args = ['--suppress_msg', ds.path, operation, ...opArgs, 'save', output];
    const result = await runCommand(this.bin, args);
    return { result, derived: await this.dm.registerDerived(output, `cjio:${operation}`, [datasetId]) };
  }

  async subset(datasetId, options) {
    const args = [];
    for (const id of options.ids || []) args.push('--id', id);
    if (options.bbox) args.push('--bbox', ...options.bbox.map(String));
    if (options.radius) args.push('--radius', ...options.radius.map(String));
    if (options.random !== undefined) args.push('--random', String(options.random));
    for (const type of options.types || []) args.push('--cotype', type);
    if (options.exclude) args.push('--exclude');
    if (!args.length) throw new Error('cityjson_subset requires ids, bbox, radius, random, or types');
    return this.transform(datasetId, 'subset', args);
  }

  filterLod(datasetId, lod) { return this.transform(datasetId, 'lod_filter', [String(lod)]); }
  reproject(datasetId, epsg, digit) {
    const args = [String(epsg)];
    if (digit !== undefined) args.push('--digit', String(digit));
    return this.transform(datasetId, 'crs_reproject', args);
  }
  assignCrs(datasetId, epsg) { return this.transform(datasetId, 'crs_assign', [String(epsg)]); }
  translate(datasetId, minxyz) {
    const args = minxyz ? ['--minxyz', ...minxyz.map(String)] : [];
    return this.transform(datasetId, 'crs_translate', args);
  }
  clean(datasetId) { return this.transform(datasetId, 'vertices_clean'); }
  triangulate(datasetId, sloppy = false) { return this.transform(datasetId, 'triangulate', sloppy ? ['--sloppy'] : []); }
  removeTextures(datasetId) { return this.transform(datasetId, 'textures_remove'); }
  removeMaterials(datasetId) { return this.transform(datasetId, 'materials_remove'); }
  renameAttribute(datasetId, oldName, newName) { return this.transform(datasetId, 'attribute_rename', [oldName, newName]); }
  removeAttribute(datasetId, name) { return this.transform(datasetId, 'attribute_remove', [name]); }
  upgrade(datasetId) { return this.transform(datasetId, 'upgrade'); }

  async merge(datasetIds) {
    if (!Array.isArray(datasetIds) || datasetIds.length < 2) throw new Error('cityjson_merge needs at least two dataset IDs');
    const [first, ...rest] = datasetIds.map(id => this.dm.get(id));
    const output = this.dm.makeDerivedPath(datasetIds[0], 'city.json');
    const args = ['--suppress_msg', first.path];
    for (const other of rest) args.push('merge', other.path);
    args.push('save', output);
    const result = await runCommand(this.bin, args);
    return { result, derived: await this.dm.registerDerived(output, 'cjio:merge', datasetIds) };
  }

  async export(datasetId, format, destination, sloppy = false) {
    const ds = this.dm.get(datasetId);
    const output = this.dm.pathPolicy.assertWritable(destination);
    const args = ['--suppress_msg', ds.path, 'export'];
    if (sloppy) args.push('--sloppy');
    args.push(format, output);
    const result = await runCommand(this.bin, args);
    const produced = [];
    try { produced.push(output, ...(format === 'obj' ? [output.replace(/\.obj$/i, '.mtl')] : [])); } catch {}
    const existing = [];
    for (const file of produced) {
      try { await fs.access(file); existing.push(file); } catch {}
    }
    return { datasetId, format, requestedDestination: output, files: existing, stdout: result.stdout, stderr: result.stderr };
  }

  async cityjsonToSeqFile(datasetId) {
    const ds = this.dm.get(datasetId);
    const output = this.dm.makeDerivedPath(datasetId, 'city.jsonl');
    await runCommand(this.bin, ['--suppress_msg', ds.path, 'export', 'jsonl', output]);
    return output;
  }

  async seqFileToCityJSON(seqPath, operation = 'cjio:collect') {
    const output = path.join(this.dm.pathPolicy.workspace, `collect-${Date.now()}-${Math.random().toString(16).slice(2)}.city.json`);
    const stdin = await fs.readFile(seqPath);
    await runCommand(this.bin, ['--suppress_msg', 'stdin', 'save', output], { stdin });
    return this.dm.registerDerived(output, operation, []);
  }
}
