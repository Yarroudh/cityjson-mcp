import fs from 'node:fs/promises';
import { runCommand, executableStatus } from '../core/command-runner.mjs';

export class Val3dityAdapter {
  constructor(datasetManager) {
    this.dm = datasetManager;
    this.bin = process.env.VAL3DITY_BIN || 'val3dity';
  }
  status() { return executableStatus(this.bin, ['--version']); }

  async validate(datasetId, options = {}) {
    const ds = this.dm.get(datasetId);
    const reportPath = this.dm.makeDerivedPath(datasetId, 'val3dity-report.json');
    const args = [ds.path, '--report', reportPath];
    if (options.verbose) args.push('--verbose');
    const result = await runCommand(this.bin, args, { allowNonZero: true });
    let report = null;
    try { report = JSON.parse(await fs.readFile(reportPath, 'utf8')); } catch {}
    const reportValid = report && typeof report === 'object'
      ? inferValidity(report)
      : null;
    return {
      datasetId,
      validator: 'val3dity',
      valid: reportValid ?? result.code === 0,
      exitCode: result.code,
      reportPath,
      report,
      stdout: result.stdout.trim(),
      stderr: result.stderr.trim(),
      durationMs: result.durationMs
    };
  }
}

function inferValidity(report) {
  if (typeof report.valid === 'boolean') return report.valid;
  if (Array.isArray(report.errors)) return report.errors.length === 0;
  if (Array.isArray(report.features)) {
    const hasInvalid = report.features.some(f => f.valid === false || (Array.isArray(f.errors) && f.errors.length));
    return !hasInvalid;
  }
  return null;
}
