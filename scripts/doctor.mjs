import { executableStatus } from '../src/core/command-runner.mjs';

const commands = [
  ['cjio', process.env.CJIO_BIN || 'cjio', ['--version']],
  ['cjval', process.env.CJVAL_BIN || 'cjval', ['--help']],
  ['val3dity', process.env.VAL3DITY_BIN || 'val3dity', ['--version']],
  ['citygml-tools', process.env.CITYGML_TOOLS_BIN || 'citygml-tools', ['--version']],
  ['cjdb', process.env.CJDB_BIN || 'cjdb', ['--help']]
];

let missing = 0;
for (const [name, command, args] of commands) {
  const status = await executableStatus(command, args);
  if (!status.available) missing++;
  console.log(`${status.available ? 'OK ' : '---'} ${name.padEnd(14)} ${status.version || status.error || command}`);
}
console.log('\nThe MCP server can still run with missing optional backends; only the dependent tools will fail.');
process.exitCode = missing ? 0 : 0;
