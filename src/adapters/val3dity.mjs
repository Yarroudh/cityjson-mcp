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
      reportSummary: summarizeReport(report),
      stdout: result.stdout.trim(),
      stderr: result.stderr.trim(),
      durationMs: result.durationMs
    };
  }
}

export function summarizeReport(report) {
  if (!report || typeof report !== 'object') return null;
  const invalidFeatures = (Array.isArray(report.features) ? report.features : [])
    .filter(feature => feature?.validity === false || (Array.isArray(feature?.errors) && feature.errors.length > 0))
    .map(feature => {
      const errors = Array.isArray(feature.errors) ? feature.errors : [];
      const grouped = new Map();
      for (const error of errors) {
        const code = error?.code ?? 'unknown';
        const current = grouped.get(code) || { code, description: error?.description || '', count: 0 };
        current.count += 1;
        grouped.set(code, current);
      }
      return {
        id: feature.id,
        type: feature.type,
        errorCount: errors.length,
        errorCodes: [...grouped.keys()],
        errorsByCode: [...grouped.values()]
      };
    });
  return {
    validity: report.validity,
    allErrorCodes: Array.isArray(report.all_errors) ? report.all_errors : [],
    datasetErrors: Array.isArray(report.dataset_errors) ? report.dataset_errors : [],
    invalidFeatureCount: invalidFeatures.length,
    invalidObjectIds: invalidFeatures.map(feature => feature.id).filter(Boolean),
    invalidFeatures,
    featuresOverview: report.features_overview || [],
    primitivesOverview: report.primitives_overview || []
  };
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
