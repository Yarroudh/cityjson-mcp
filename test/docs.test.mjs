import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const names = ['architecture', 'workflow', 'validation', 'client-setup'];

test('README embeds each Mermaid diagram and links its PNG export', async () => {
  const readme = await fs.readFile(path.join(root, 'README.md'), 'utf8');
  for (const name of names) {
    const source = (await fs.readFile(path.join(root, 'diagrams', `${name}.mmd`), 'utf8')).trim();
    assert.ok(readme.includes(`\`\`\`mermaid\n${source}\n\`\`\``), `${name} Mermaid source must be embedded`);
    assert.ok(readme.includes(`[Download PNG — high resolution](diagrams/${name}.png)`), `${name} PNG link must exist`);
  }
});

test('diagram PNGs are present and non-trivial high-resolution exports', async () => {
  for (const name of names) {
    const file = path.join(root, 'diagrams', `${name}.png`);
    const stat = await fs.stat(file);
    assert.ok(stat.size > 100_000, `${name}.png should be a substantial high-resolution image`);
    const header = await fs.readFile(file);
    assert.deepEqual([...header.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  }
});
