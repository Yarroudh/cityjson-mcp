import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { parseCityJSON, readCityJSON, summarizeCityJSON } from './cityjson-native.mjs';

export class DatasetManager {
  constructor(pathPolicy) {
    this.pathPolicy = pathPolicy;
    this.datasets = new Map();
    this.registryPath = pathPolicy.workspace ? path.join(pathPolicy.workspace, '.datasets.json') : null;
    this.persistQueue = Promise.resolve();
    this.loadRegistry();
  }

  loadRegistry() {
    if (!this.registryPath || !fsSync.existsSync(this.registryPath)) return;
    try {
      const registry = JSON.parse(fsSync.readFileSync(this.registryPath, 'utf8'));
      for (const dataset of registry.datasets || []) {
        if (!dataset || !/^cj_[a-f0-9]{12}$/.test(dataset.id) || typeof dataset.path !== 'string') continue;
        try {
          const filePath = this.pathPolicy.assertReadable
            ? this.pathPolicy.assertReadable(dataset.path)
            : dataset.path;
          if (!fsSync.statSync(filePath).isFile()) continue;
          this.datasets.set(dataset.id, { ...dataset, path: filePath });
        } catch {}
      }
    } catch (error) {
      console.error(`[cityjson-mcp] Could not restore the dataset registry: ${error.message}`);
    }
  }

  async persistRegistry() {
    if (!this.registryPath) return;
    const content = JSON.stringify({ version: 1, datasets: [...this.datasets.values()] }, null, 2);
    this.persistQueue = this.persistQueue.catch(() => {}).then(async () => {
      const temporary = `${this.registryPath}.${process.pid}.${crypto.randomUUID().slice(0, 8)}.tmp`;
      await fs.writeFile(temporary, content, { encoding: 'utf8', flag: 'wx' });
      await fs.rename(temporary, this.registryPath);
    });
    await this.persistQueue;
  }

  async remember(dataset) {
    this.datasets.set(dataset.id, dataset);
    try { await this.persistRegistry(); }
    catch (error) {
      this.datasets.delete(dataset.id);
      throw error;
    }
  }

  id() { return `cj_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`; }

  uniqueFilename(requested) {
    if (![...this.datasets.values()].some(dataset => dataset.filename === requested)) return requested;
    const extension = requested.toLowerCase().endsWith('.city.json') ? '.city.json' : path.extname(requested);
    const stem = extension ? requested.slice(0, -extension.length) : requested;
    return `${stem}-${crypto.randomUUID().slice(0, 8)}${extension}`;
  }

  async resolveOpenSource(source) {
    if (typeof source !== 'string' || !source.trim()) throw new Error('A CityJSON filename is required');
    if (path.isAbsolute(source)) return this.pathPolicy.assertReadable(source);
    const relative = path.normalize(source.trim());
    if (relative === '..' || relative.startsWith(`..${path.sep}`)) throw new Error('File must be inside a configured data folder');
    const roots = this.pathPolicy.roots || [];
    const candidates = [];
    const add = candidate => {
      if (!fsSync.existsSync(candidate)) return;
      const checked = this.pathPolicy.assertReadable(candidate);
      if (fsSync.statSync(checked).isFile() && !candidates.includes(checked)) candidates.push(checked);
    };
    for (const root of roots) add(path.join(root, relative));
    if (path.basename(relative) === relative) {
      const pending = roots.filter(root => fsSync.existsSync(root));
      let scanned = 0;
      while (pending.length) {
        const directory = pending.shift();
        for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
          if (++scanned > 50000) throw new Error('Too many project files to search; use a relative path inside the mounted folder');
          if (entry.isDirectory() && !['.git', 'node_modules', '.cityjson-mcp-workspace'].includes(entry.name)) {
            pending.push(path.join(directory, entry.name));
          } else if (entry.isFile() && entry.name === relative) {
            add(path.join(directory, entry.name));
          }
        }
      }
    }
    if (!candidates.length) throw new Error(`CityJSON file not found in configured data folders: ${source}`);
    if (candidates.length > 1) throw new Error(`More than one file is named ${source}; use its relative path inside the mounted folder`);
    return candidates[0];
  }

  async open(source) {
    const sourcePath = await this.resolveOpenSource(source);
    const filename = this.uniqueFilename(path.basename(sourcePath).replace(/[^A-Za-z0-9._-]/g, '_'));
    const filePath = this.pathPolicy.workspacePath(`open-${crypto.randomUUID().slice(0, 8)}-${filename}`);
    await fs.copyFile(sourcePath, filePath, fs.constants.COPYFILE_EXCL);
    try {
      const json = await readCityJSON(filePath);
      const stat = await fs.stat(filePath);
      const id = this.id();
      await this.remember({ id, path: filePath, filename, createdAt: new Date().toISOString(), original: true, operation: 'open', sourcePath });
      return { datasetId: id, filename, sizeBytes: stat.size, ...summarizeCityJSON(json) };
    } catch (error) {
      await fs.rm(filePath, { force: true });
      throw error;
    }
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

  async importFile(requestedFilename, displayFilename) {
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
    const safeName = this.uniqueFilename(path.basename(displayFilename || filename).replace(/[^A-Za-z0-9._-]/g, '_'));
    const filePath = this.pathPolicy.workspacePath(`import-${crypto.randomUUID().slice(0, 8)}-${safeName}`);
    await fs.copyFile(source, filePath, fs.constants.COPYFILE_EXCL);
    try {
      const json = await readCityJSON(filePath);
      const stat = await fs.stat(filePath);
      const id = this.id();
      await this.remember({
        id,
        path: filePath,
        filename: safeName,
        createdAt: new Date().toISOString(),
        original: true,
        operation: 'import',
        sourceFilename: filename
      });
      return { datasetId: id, filename: safeName, sourceFilename: filename, sizeBytes: stat.size, operation: 'import', ...summarizeCityJSON(json) };
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
    const suffix = this.uniqueFilename(path.basename(filename).replace(/[^A-Za-z0-9._-]/g, '_') || 'upload.city.json');
    const filePath = this.pathPolicy.workspacePath(`upload-${crypto.randomUUID().slice(0, 8)}-${suffix}`);
    await fs.writeFile(filePath, content, { encoding: 'utf8', flag: 'wx' });
    const id = this.id();
    try {
      await this.remember({ id, path: filePath, filename: suffix, createdAt: new Date().toISOString(), original: true, operation: 'upload' });
      return { datasetId: id, filename: suffix, path: filePath, sizeBytes, operation: 'upload', ...summarizeCityJSON(json) };
    } catch (error) {
      await fs.rm(filePath, { force: true });
      throw error;
    }
  }

  async downloadContent(id, requestedFilename) {
    const reference = await this.downloadReference(id, requestedFilename);
    const maxBytes = Number(process.env.CITYJSON_MCP_MAX_DOWNLOAD_BYTES || 25 * 1024 * 1024);
    if (reference.sizeBytes > maxBytes) throw new Error(`Downloaded CityJSON exceeds the ${maxBytes}-byte inline MCP limit`);
    const content = await fs.readFile(reference.path, 'utf8');
    parseCityJSON(content);
    return { ...reference, content };
  }

  async downloadReference(id, requestedFilename) {
    const ds = this.get(id);
    const stat = await fs.stat(ds.path);
    const fallback = ds.filename || `${id}.city.json`;
    const filename = path.basename(requestedFilename || fallback).replace(/[^A-Za-z0-9._-]/g, '_') || `${id}.city.json`;
    return { datasetId: id, filename, mimeType: 'application/json', sizeBytes: stat.size, path: ds.path };
  }

  get(id) {
    const ds = this.datasets.get(id) || [...this.datasets.values()].find(dataset => dataset.filename === id);
    if (!ds) throw new Error('The selected CityJSON file is unavailable. Open or upload it first.');
    return ds;
  }

  async inspect(id) {
    const ds = this.get(id);
    const json = await readCityJSON(ds.path);
    const stat = await fs.stat(ds.path);
    return { datasetId: id, filename: ds.filename || path.basename(ds.path), path: ds.path, sizeBytes: stat.size, ...summarizeCityJSON(json) };
  }

  async load(id) { return readCityJSON(this.get(id).path); }

  async registerDerived(filePath, operation, parents = []) {
    const resolved = this.pathPolicy.assertReadable(filePath);
    const json = await readCityJSON(resolved);
    const stat = await fs.stat(resolved);
    const id = this.id();
    const parentDatasets = parents.map(parent => this.get(parent));
    const parentName = parentDatasets[0]?.filename || 'cityjson';
    const stem = (parentName || 'cityjson').replace(/(?:\.city)?\.json$/i, '').replace(/[^A-Za-z0-9._-]/g, '_');
    const action = operation.replace(/^[^:]*:/, '').replace(/[^A-Za-z0-9_-]/g, '_');
    const filename = this.uniqueFilename(`${stem}-${action}-${crypto.randomUUID().slice(0, 8)}.city.json`);
    const parentIds = parentDatasets.map(parent => parent.id);
    await this.remember({ id, path: resolved, filename, createdAt: new Date().toISOString(), original: false, operation, parents: parentIds });
    return { datasetId: id, filename, path: resolved, operation, parentDatasetIds: parentIds, sizeBytes: stat.size, ...summarizeCityJSON(json) };
  }

  async save(id, destination, overwrite = false) {
    const ds = this.get(id);
    const output = this.pathPolicy.assertWritable(destination);
    if (!overwrite) {
      try { await fs.access(output); throw new Error(`Destination already exists: ${output}`); }
      catch (e) { if (e.code !== 'ENOENT') throw e; }
    }
    await fs.copyFile(ds.path, output);
    return { datasetId: ds.id, filename: ds.filename, savedTo: output };
  }

  makeDerivedPath(_id, suffix = 'city.json') {
    const token = crypto.randomUUID().slice(0, 8);
    return path.join(this.pathPolicy.workspace, `derived-${token}.${suffix}`);
  }
}
