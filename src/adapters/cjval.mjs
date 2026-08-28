import { runCommand, executableStatus } from '../core/command-runner.mjs';

export class CjvalAdapter {
  constructor(datasetManager) {
    this.dm = datasetManager;
    this.bin = process.env.CJVAL_BIN || 'cjval';
  }
  status() { return executableStatus(this.bin, ['--help']); }

  async validate(datasetId, extensionSchemas = [], options = {}) {
    const ds = this.dm.get(datasetId);
    const args = ['--report', ds.path];
    for (const ext of extensionSchemas) args.push('-e', this.dm.pathPolicy.assertReadable(ext));
    const result = await runCommand(this.bin, args, { allowNonZero: true, signal: options.signal });
    let report = null;
    try { report = JSON.parse(result.stdout.trim()); } catch {}
    return {
      datasetId,
      validator: 'cjval',
      valid: typeof report?.valid === 'boolean' ? report.valid : result.code === 0,
      exitCode: result.code,
      report,
      stdout: report ? undefined : result.stdout.trim(),
      stderr: result.stderr.trim(),
      durationMs: result.durationMs
    };
  }
}
