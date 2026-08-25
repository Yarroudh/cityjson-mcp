import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const indexPath = path.resolve(here, '../../resources/spec/index.json');

function htmlToText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<\/p>|<\/li>|<\/h[1-6]>|<\/tr>|<\/div>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n\s*\n+/g, '\n\n')
    .trim();
}

export class KnowledgeAdapter {
  async index() { return JSON.parse(await fs.readFile(indexPath, 'utf8')); }

  async specRead({ query, maxChars = 60000 } = {}) {
    const index = await this.index();
    const response = await fetch(index.specUrl, { headers: { 'user-agent': 'cityjson-toolbox-mcp/0.1' } });
    if (!response.ok) throw new Error(`Failed to fetch CityJSON spec: HTTP ${response.status}`);
    const text = htmlToText(await response.text());
    if (!query) return { source: index.specUrl, version: index.version, text: text.slice(0, maxChars), truncated: text.length > maxChars };
    const q = query.toLowerCase();
    const idx = text.toLowerCase().indexOf(q);
    if (idx < 0) return { source: index.specUrl, version: index.version, query, found: false, text: '' };
    const radius = Math.floor(maxChars / 2);
    const start = Math.max(0, idx - radius);
    const end = Math.min(text.length, idx + query.length + radius);
    return { source: index.specUrl, version: index.version, query, found: true, text: text.slice(start, end), truncated: start > 0 || end < text.length };
  }

  async extensionsRegistry({ query, maxChars = 50000 } = {}) {
    const url = 'https://raw.githubusercontent.com/cityjson/extensions/main/README.md';
    const response = await fetch(url, { headers: { 'user-agent': 'cityjson-toolbox-mcp/0.1' } });
    if (!response.ok) throw new Error(`Failed to fetch CityJSON Extensions registry: HTTP ${response.status}`);
    const text = await response.text();
    if (!query) return { source: url, text: text.slice(0, maxChars), truncated: text.length > maxChars };
    const idx = text.toLowerCase().indexOf(query.toLowerCase());
    if (idx < 0) return { source: url, query, found: false, text: '' };
    const radius = Math.floor(maxChars / 2);
    const start = Math.max(0, idx - radius);
    const end = Math.min(text.length, idx + query.length + radius);
    return { source: url, query, found: true, text: text.slice(start, end), truncated: start > 0 || end < text.length };
  }

  async extensionSchema(name, version) {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) throw new Error('Extension name must be lowercase letters/numbers with optional hyphens');
    if (!/^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/.test(version)) throw new Error('Extension version must look like a semantic version, e.g. 2.0.0');
    const url = `https://cityjson.github.io/extensions/${name}/${version}/${name}.ext.json`;
    const response = await fetch(url, { headers: { 'user-agent': 'cityjson-toolbox-mcp/0.1' } });
    if (!response.ok) throw new Error(`Failed to fetch extension schema ${name}@${version}: HTTP ${response.status}`);
    let schema;
    try { schema = await response.json(); } catch { throw new Error(`Extension endpoint returned non-JSON for ${name}@${version}`); }
    return { source: url, name, version, schema };
  }

  async schemaRead(name = 'cityjson.schema.json') {
    const index = await this.index();
    if (!index.schemas.includes(name)) throw new Error(`Unknown bundled schema name. Choose one of: ${index.schemas.join(', ')}`);
    const url = index.schemaBaseUrl + name;
    const response = await fetch(url, { headers: { 'user-agent': 'cityjson-toolbox-mcp/0.1' } });
    if (!response.ok) throw new Error(`Failed to fetch schema ${name}: HTTP ${response.status}`);
    const text = await response.text();
    let schema;
    try { schema = JSON.parse(text); } catch { throw new Error(`Schema endpoint returned non-JSON for ${name}`); }
    return { source: url, version: index.version, name, schema };
  }
}
