export function jsonResult(value, extra = {}) {
  const publicValue = JSON.parse(JSON.stringify(value, (key, item) =>
    ['datasetId', 'parentDatasetIds', 'path', 'sourcePath', 'sourceFilename'].includes(key) ? undefined : item));
  return {
    content: [{ type: 'text', text: JSON.stringify(publicValue, null, 2) }],
    structuredContent: publicValue,
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
