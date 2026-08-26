import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { parseCityJSON, readCityJSON, summarizeCityJSON } from './cityjson-native.mjs';

export class DatasetManager {
  constructor(pathPolicy) {
    this.pathPolicy = pathPolicy;
    this.datasets = new Map();
  }

  id() { return `cj_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`; }

  async open(source) {
    const filePath = this.pathPolicy.assertReadable(source);
    const json = await readCityJSON(filePath);
    const stat = await fs.stat(filePath);
    const id = this.id();
    this.datasets.set(id, { id, path: filePath, createdAt: new Date().toISOString(), original: true });
    return { datasetId: id, path: filePath, sizeBytes: stat.size, ...summarizeCityJSON(json) };
  }

  async listImports() {
    const entries = await fs.readdir(this.pathPolicy.input, { withFileTypes: true });
    const files = await Promise.all(entries
      .filter(entry => entry.isFile() && /\.json$/i.test(entry.name))
      .map(async entry => {
        const stat = await fs.stat(path.join(this.pathPolicy.input, entry.name));
        return { filename: entry.name, sizeBytes: stat.size, modifiedAt: stat.mtime.toISOString() };
      }));
    files.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt) || a.filename.localeCompare(b.filename));
    return { input: this.pathPolicy.input, count: files.length, files };
  }

  async importFile(requestedFilename) {
    let filename = requestedFilename;
    if (!filename) {
      const available = await this.listImports();
      if (available.files.length === 0) throw new Error('No JSON files are available in the configured input inbox');
      if (available.files.length > 1) {
        throw new Error(`More than one input file is available; choose filename explicitly: ${available.files.map(file => file.filename).join(', ')}`);
      }
      filename = available.files[0].filename;
    }

    const source = this.pathPolicy.inputPath(filename);
    const safeName = path.basename(filename).replace(/[^A-Za-z0-9._-]/g, '_');
    const filePath = this.pathPolicy.workspacePath(`import-${crypto.randomUUID().slice(0, 8)}-${safeName}`);
    await fs.copyFile(source, filePath, fs.constants.COPYFILE_EXCL);
    try {
      const json = await readCityJSON(filePath);
      const stat = await fs.stat(filePath);
      const id = this.id();
      this.datasets.set(id, {
        id,
        path: filePath,
        filename: safeName,
        createdAt: new Date().toISOString(),
        original: true,
        operation: 'import',
        sourceFilename: filename
      });
      return { datasetId: id, filename, sizeBytes: stat.size, operation: 'import', ...summarizeCityJSON(json) };
    } catch (error) {
      await fs.rm(filePath, { force: true });
      throw error;
    }
  }

  async importContent(content, filename = 'upload.city.json') {
    const maxBytes = Number(process.env.CITYJSON_MCP_MAX_UPLOAD_BYTES || 25 * 1024 * 1024);
    const sizeBytes = Buffer.byteLength(content, 'utf8');
    if (sizeBytes > maxBytes) throw new Error(`Uploaded CityJSON exceeds the ${maxBytes}-byte limit`);
    const json = parseCityJSON(content);
    const suffix = path.basename(filename).replace(/[^A-Za-z0-9._-]/g, '_') || 'upload.city.json';
    const filePath = this.pathPolicy.workspacePath(`upload-${crypto.randomUUID().slice(0, 8)}-${suffix}`);
    await fs.writeFile(filePath, content, { encoding: 'utf8', flag: 'wx' });
    const id = this.id();
    this.datasets.set(id, { id, path: filePath, filename: suffix, createdAt: new Date().toISOString(), original: true, operation: 'upload' });
    return { datasetId: id, path: filePath, sizeBytes, operation: 'upload', ...summarizeCityJSON(json) };
  }

  async downloadContent(id, requestedFilename) {
    const ds = this.get(id);
    const maxBytes = Number(process.env.CITYJSON_MCP_MAX_DOWNLOAD_BYTES || 25 * 1024 * 1024);
    const stat = await fs.stat(ds.path);
    if (stat.size > maxBytes) throw new Error(`Downloaded CityJSON exceeds the ${maxBytes}-byte limit`);
    const content = await fs.readFile(ds.path, 'utf8');
    parseCityJSON(content);
    const fallback = ds.filename || `${id}.city.json`;
    const filename = path.basename(requestedFilename || fallback).replace(/[^A-Za-z0-9._-]/g, '_') || `${id}.city.json`;
    return { datasetId: id, filename, mimeType: 'application/json', sizeBytes: stat.size, content };
  }

  get(id) {
    const ds = this.datasets.get(id);
    if (!ds) throw new Error(`Unknown dataset_id: ${id}. Open or upload the file first.`);
    return ds;
  }

  async inspect(id) {
    const ds = this.get(id);
    const json = await readCityJSON(ds.path);
    const stat = await fs.stat(ds.path);
    return { datasetId: id, path: ds.path, sizeBytes: stat.size, ...summarizeCityJSON(json) };
  }

  async load(id) { return readCityJSON(this.get(id).path); }

  async registerDerived(filePath, operation, parents = []) {
    const resolved = this.pathPolicy.assertReadable(filePath);
    const json = await readCityJSON(resolved);
    const stat = await fs.stat(resolved);
    const id = this.id();
    this.datasets.set(id, { id, path: resolved, createdAt: new Date().toISOString(), original: false, operation, parents });
    return { datasetId: id, path: resolved, operation, parentDatasetIds: parents, sizeBytes: stat.size, ...summarizeCityJSON(json) };
  }

  async save(id, destination, overwrite = false) {
    const ds = this.get(id);
    const output = this.pathPolicy.assertWritable(destination);
    if (!overwrite) {
      try { await fs.access(output); throw new Error(`Destination already exists: ${output}`); }
      catch (e) { if (e.code !== 'ENOENT') throw e; }
    }
    await fs.copyFile(ds.path, output);
    return { datasetId: id, source: ds.path, savedTo: output };
  }

  makeDerivedPath(id, suffix = 'city.json') {
    const token = crypto.randomUUID().slice(0, 8);
    return path.join(this.pathPolicy.workspace, `${id}-${token}.${suffix}`);
  }
}
