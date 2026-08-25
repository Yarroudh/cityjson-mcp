export function jsonResult(value, extra = {}) {
  return {
    content: [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    structuredContent: value,
    ...extra
  };
}

export function errorResult(error) {
  const detail = error?.result ? {
    exitCode: error.result.code,
    stdout: error.result.stdout,
    stderr: error.result.stderr,
    durationMs: error.result.durationMs
  } : undefined;
  return {
    isError: true,
    content: [{ type: 'text', text: JSON.stringify({ error: error.message, detail }, null, 2) }]
  };
}
