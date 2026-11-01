import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

const MAX_CHUNK_BYTES = 256 * 1024;
const SESSION_TTL_MS = 30 * 60 * 1000;

export class UploadSessions {
  constructor(datasetManager, { maxBytes = Number(process.env.CITYJSON_MCP_MAX_DIRECT_UPLOAD_BYTES || 100 * 1024 * 1024) } = {}) {
    if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) throw new Error('CITYJSON_MCP_MAX_DIRECT_UPLOAD_BYTES must be a positive integer');
    this.dm = datasetManager;
    this.maxBytes = maxBytes;
    this.sessions = new Map();
  }

  async discard(uploadId) {
    const session = this.sessions.get(uploadId);
    if (!session) return;
    this.sessions.delete(uploadId);
    await fs.rm(session.path, { force: true });
  }

  async expire() {
    const cutoff = Date.now() - SESSION_TTL_MS;
    for (const [uploadId, session] of this.sessions) {
      if (session.createdAt < cutoff && !session.busy) await this.discard(uploadId);
    }
  }

  async start(filename, sizeBytes) {
    if (typeof filename !== 'string' || !filename.trim() || !/\.json$/i.test(filename)) {
      throw new Error('Choose a CityJSON .json file');
    }
    if (!Number.isSafeInteger(sizeBytes) || sizeBytes <= 0 || sizeBytes > this.maxBytes) {
      throw new Error(`The selected file must be at most ${this.maxBytes} bytes`);
    }
    await this.expire();
    const uploadId = crypto.randomUUID();
    const storedFilename = `app-${uploadId}.json`;
    const filePath = path.join(this.dm.pathPolicy.input, storedFilename);
    await fs.writeFile(filePath, '', { flag: 'wx' });
    this.sessions.set(uploadId, {
      path: filePath,
      storedFilename,
      displayFilename: path.basename(filename),
      sizeBytes,
      receivedBytes: 0,
      createdAt: Date.now(),
      busy: false
    });
    return { upload_id: uploadId, chunk_bytes: MAX_CHUNK_BYTES };
  }

  async append(uploadId, offset, base64) {
    const session = this.sessions.get(uploadId);
    if (!session) throw new Error('Upload expired. Select the file again.');
    if (session.busy) throw new Error('Upload is already processing a chunk');
    if (!Number.isSafeInteger(offset) || offset !== session.receivedBytes) throw new Error('Upload chunks arrived out of order');
    if (typeof base64 !== 'string' || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(base64)) {
      throw new Error('Invalid upload chunk');
    }
    const bytes = Buffer.from(base64, 'base64');
    if (!bytes.length || bytes.length > MAX_CHUNK_BYTES || session.receivedBytes + bytes.length > session.sizeBytes) {
      throw new Error('Upload chunk exceeds the declared file size or chunk limit');
    }
    session.busy = true;
    try {
      await fs.appendFile(session.path, bytes);
      session.receivedBytes += bytes.length;
      return { received_bytes: session.receivedBytes, total_bytes: session.sizeBytes };
    } finally {
      session.busy = false;
    }
  }

  async finish(uploadId) {
    const session = this.sessions.get(uploadId);
    if (!session) throw new Error('Upload expired. Select the file again.');
    if (session.busy) throw new Error('Upload is still receiving a chunk');
    if (session.receivedBytes !== session.sizeBytes) throw new Error('Upload is incomplete');
    session.busy = true;
    try {
      return await this.dm.importFile(session.storedFilename, session.displayFilename);
    } finally {
      await this.discard(uploadId);
    }
  }
}
