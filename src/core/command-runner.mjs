import { spawn } from 'node:child_process';

export class CommandError extends Error {
  constructor(message, result) {
    super(message);
    this.name = 'CommandError';
    this.result = result;
  }
}

export async function runCommand(command, args = [], options = {}) {
  const timeoutMs = options.timeoutMs ?? Number(process.env.CITYJSON_MCP_COMMAND_TIMEOUT_MS || 120000);
  const maxOutput = options.maxOutput ?? 4 * 1024 * 1024;
  const started = Date.now();
  options.signal?.throwIfAborted();

  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: { ...process.env, ...(options.env || {}) },
      shell: false,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe']
    });

    let stdout = Buffer.alloc(0);
    let stderr = Buffer.alloc(0);
    let killedForOutput = false;
    let aborted = false;
    const abort = () => {
      aborted = true;
      child.kill('SIGKILL');
    };
    options.signal?.addEventListener('abort', abort, { once: true });

    const append = (current, chunk) => {
      const next = Buffer.concat([current, Buffer.from(chunk)]);
      if (next.length > maxOutput) {
        killedForOutput = true;
        child.kill('SIGKILL');
        return next.subarray(0, maxOutput);
      }
      return next;
    };

    child.stdout.on('data', chunk => { stdout = append(stdout, chunk); });
    child.stderr.on('data', chunk => { stderr = append(stderr, chunk); });
    child.on('error', reject);

    if (options.stdin !== undefined) {
      child.stdin.end(options.stdin);
    } else {
      child.stdin.end();
    }

    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', abort);
      const result = {
        command,
        args,
        code,
        signal,
        stdout: stdout.toString('utf8'),
        stderr: stderr.toString('utf8'),
        durationMs: Date.now() - started
      };
      if (killedForOutput) {
        reject(new CommandError(`Command output exceeded ${maxOutput} bytes`, result));
        return;
      }
      if (aborted) {
        reject(options.signal?.reason instanceof Error
          ? options.signal.reason
          : new DOMException('Command cancelled', 'AbortError'));
        return;
      }
      if (signal === 'SIGKILL' && result.durationMs >= timeoutMs) {
        reject(new CommandError(`Command timed out after ${timeoutMs} ms`, result));
        return;
      }
      if (code !== 0 && !options.allowNonZero) {
        reject(new CommandError(`Command failed with exit code ${code}: ${command}`, result));
        return;
      }
      resolve(result);
    });
  });
}

export async function executableStatus(command, versionArgs = ['--version']) {
  try {
    const result = await runCommand(command, versionArgs, { timeoutMs: 5000, allowNonZero: true, maxOutput: 64 * 1024 });
    return {
      available: true,
      command,
      exitCode: result.code,
      version: (result.stdout || result.stderr).trim().split('\n')[0] || null
    };
  } catch (error) {
    return { available: false, command, error: error.message };
  }
}
