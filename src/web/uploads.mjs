import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import Busboy from 'busboy';

function safeUploadName(filename) {
  const original = path.basename(filename || 'upload.city.json');
  const cleaned = original.replace(/[^A-Za-z0-9._-]/g, '_').replace(/^\.+/, '') || 'upload.city.json';
  if (!/\.json$/i.test(cleaned)) throw new Error(`Only JSON files are accepted: ${original}`);
  const extension = path.extname(cleaned);
  const stem = path.basename(cleaned, extension).slice(0, 180) || 'upload.city';
  return `${stem}--${crypto.randomUUID().slice(0, 8)}${extension.toLowerCase()}`;
}

export async function receiveUploads(request, { input, maxUploadBytes, maxUploadFiles }) {
  await fsp.mkdir(input, { recursive: true });
  const busboy = Busboy({
    headers: request.headers,
    limits: { files: maxUploadFiles, fileSize: maxUploadBytes, fields: 0, parts: maxUploadFiles }
  });
  const pending = [];
  const uploaded = [];
  let parserError;

  busboy.on('file', (_field, stream, info) => {
    let storedFilename;
    try { storedFilename = safeUploadName(info.filename); }
    catch (error) {
      parserError ||= error;
      stream.resume();
      return;
    }
    const destination = path.join(input, storedFilename);
    let exceeded = false;
    stream.on('limit', () => { exceeded = true; });
    const job = pipeline(stream, fs.createWriteStream(destination, { flags: 'wx' }))
      .then(async () => {
        if (exceeded || stream.truncated) {
          await fsp.rm(destination, { force: true });
          throw new Error(`${info.filename} exceeds the ${maxUploadBytes}-byte upload limit`);
        }
        const stat = await fsp.stat(destination);
        const metadata = { originalFilename: info.filename, filename: storedFilename, sizeBytes: stat.size };
        uploaded.push(metadata);
        return metadata;
      })
      .catch(async error => {
        await fsp.rm(destination, { force: true });
        throw error;
      });
    pending.push(job);
  });
  busboy.on('filesLimit', () => { parserError ||= new Error(`At most ${maxUploadFiles} files can be attached`); });
  busboy.on('error', error => { parserError ||= error; });

  const finished = new Promise((resolve, reject) => {
    busboy.on('close', resolve);
    busboy.on('error', reject);
  });
  request.pipe(busboy);

  try {
    await finished;
    await Promise.all(pending);
    if (parserError) throw parserError;
    if (uploaded.length === 0) throw new Error('No CityJSON files were attached');
    return uploaded;
  } catch (error) {
    await Promise.allSettled(uploaded.map(file => fsp.rm(path.join(input, file.filename), { force: true })));
    throw error;
  }
}
