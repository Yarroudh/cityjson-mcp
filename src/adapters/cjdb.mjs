import fs from 'node:fs/promises';
import { runCommand, executableStatus } from '../core/command-runner.mjs';

function dbArgs(connection) {
  const args = ['-H', connection.host, '-U', connection.user, '-d', connection.database, '-s', connection.schema];
  return args;
}

function safeSelect(sql) {
  const normalized = sql.trim();
  if (!/^select\b/i.test(normalized)) throw new Error('cjdb export query must be a SELECT statement');
  if (normalized.includes(';')) throw new Error('Semicolons are not allowed in cjdb export queries');
  if (/\b(insert|update|delete|drop|alter|create|grant|revoke|truncate|copy|call|do)\b/i.test(normalized)) {
    throw new Error('Potentially modifying SQL is not allowed');
  }
  return normalized;
}

export class CjdbAdapter {
  constructor(datasetManager, cjioAdapter) {
    this.dm = datasetManager;
    this.cjio = cjioAdapter;
    this.bin = process.env.CJDB_BIN || 'cjdb';
  }
  status() { return executableStatus(this.bin, ['--help']); }

  async importDataset(datasetId, connection, options = {}) {
    const seqPath = await this.cjio.cityjsonToSeqFile(datasetId);
    const args = ['import', ...dbArgs(connection), '-f', seqPath];
    for (const attr of options.attributeIndexes || []) args.push('-x', attr);
    for (const attr of options.partialAttributeIndexes || []) args.push('-px', attr);
    const result = await runCommand(this.bin, args);
    return { datasetId, connection: { ...connection, password: undefined }, cityjsonSeq: seqPath, stdout: result.stdout, stderr: result.stderr };
  }

  async exportDataset(connection, options = {}) {
    const seqPath = this.dm.pathPolicy.workspacePath(`cjdb-export-${Date.now()}-${Math.random().toString(16).slice(2)}.city.jsonl`);
    const args = ['export', ...dbArgs(connection), '-o', seqPath];
    if (options.query) args.push('-q', safeSelect(options.query));
    const result = await runCommand(this.bin, args);
    await fs.access(seqPath);
    const derived = options.collect === false ? null : await this.cjio.seqFileToCityJSON(seqPath, 'cjdb:export');
    return { connection: { ...connection, password: undefined }, cityjsonSeq: seqPath, derived, stdout: result.stdout, stderr: result.stderr };
  }
}
