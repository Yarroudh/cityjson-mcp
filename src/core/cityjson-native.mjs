import fs from 'node:fs/promises';

export async function readCityJSON(filePath) {
  const text = await fs.readFile(filePath, 'utf8');
  return parseCityJSON(text);
}

export function parseCityJSON(text) {
  let json;
  try { json = JSON.parse(text); }
  catch (error) { throw new Error(`Invalid JSON: ${error.message}`); }
  if (json?.type !== 'CityJSON') throw new Error(`Expected root type CityJSON, got ${JSON.stringify(json?.type)}`);
  if (!json.CityObjects || !Array.isArray(json.vertices)) throw new Error('Missing CityObjects or vertices');
  return json;
}

function collectVertexIndices(value, out) {
  if (Array.isArray(value)) {
    for (const item of value) collectVertexIndices(item, out);
  } else if (Number.isInteger(value) && value >= 0) {
    out.add(value);
  }
}

export function dequantizeVertex(vertex, transform) {
  if (!transform?.scale || !transform?.translate) return vertex;
  return vertex.map((v, i) => v * transform.scale[i] + transform.translate[i]);
}

export function objectBBox(cityjson, cityObject) {
  const indices = new Set();
  for (const geom of cityObject.geometry || []) collectVertexIndices(geom.boundaries, indices);
  if (!indices.size) return null;
  const coords = [...indices]
    .map(i => cityjson.vertices[i])
    .filter(Boolean)
    .map(v => dequantizeVertex(v, cityjson.transform));
  if (!coords.length) return null;
  const xs = coords.map(v => v[0]);
  const ys = coords.map(v => v[1]);
  const zs = coords.map(v => v[2]);
  return [Math.min(...xs), Math.min(...ys), Math.min(...zs), Math.max(...xs), Math.max(...ys), Math.max(...zs)];
}

function intersects2d(a, b) {
  return !(a[3] < b[0] || a[0] > b[2] || a[4] < b[1] || a[1] > b[3]);
}

function matchesAttributes(attributes = {}, predicates = {}) {
  for (const [key, expected] of Object.entries(predicates)) {
    const actual = attributes[key];
    if (expected && typeof expected === 'object' && !Array.isArray(expected)) {
      if ('eq' in expected && actual !== expected.eq) return false;
      if ('neq' in expected && actual === expected.neq) return false;
      if ('gte' in expected && !(actual >= expected.gte)) return false;
      if ('lte' in expected && !(actual <= expected.lte)) return false;
      if ('gt' in expected && !(actual > expected.gt)) return false;
      if ('lt' in expected && !(actual < expected.lt)) return false;
      if ('contains' in expected && !String(actual ?? '').includes(String(expected.contains))) return false;
      if ('in' in expected && (!Array.isArray(expected.in) || !expected.in.includes(actual))) return false;
    } else if (actual !== expected) return false;
  }
  return true;
}

export function summarizeCityJSON(cityjson) {
  const typeCounts = {};
  const lods = new Set();
  const attributes = new Set();
  for (const obj of Object.values(cityjson.CityObjects)) {
    typeCounts[obj.type] = (typeCounts[obj.type] || 0) + 1;
    for (const key of Object.keys(obj.attributes || {})) attributes.add(key);
    for (const geom of obj.geometry || []) if (geom.lod !== undefined) lods.add(String(geom.lod));
  }
  return {
    type: cityjson.type,
    version: cityjson.version,
    cityObjectCount: Object.keys(cityjson.CityObjects).length,
    vertexCount: cityjson.vertices.length,
    typeCounts,
    lods: [...lods].sort(),
    attributeNames: [...attributes].sort(),
    metadata: cityjson.metadata || {},
    transform: cityjson.transform || null,
    extensions: cityjson.extensions || {}
  };
}

export function queryCityObjects(cityjson, query = {}) {
  const ids = query.ids ? new Set(query.ids) : null;
  const types = query.types ? new Set(query.types) : null;
  const bbox = query.bbox || null;
  const limit = Math.min(Math.max(query.limit || 100, 1), 5000);
  const offset = Math.max(query.offset || 0, 0);
  const matched = [];

  for (const [id, obj] of Object.entries(cityjson.CityObjects)) {
    if (ids && !ids.has(id)) continue;
    if (types && !types.has(obj.type)) continue;
    if (!matchesAttributes(obj.attributes, query.attributes || {})) continue;
    let calculatedBBox = null;
    if (bbox) {
      calculatedBBox = objectBBox(cityjson, obj);
      if (!calculatedBBox || !intersects2d(calculatedBBox, bbox)) continue;
    }
    matched.push({
      id,
      type: obj.type,
      attributes: obj.attributes || {},
      lods: [...new Set((obj.geometry || []).map(g => String(g.lod)).filter(v => v !== 'undefined'))],
      bbox: calculatedBBox,
      parents: obj.parents || [],
      children: obj.children || []
    });
  }

  return { totalMatched: matched.length, offset, limit, objects: matched.slice(offset, offset + limit) };
}
