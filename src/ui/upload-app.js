import { App } from '@modelcontextprotocol/ext-apps';

const app = new App({ name: 'CityJSON upload', version: '0.1.0' });
const fileInput = document.getElementById('file');
const progress = document.getElementById('progress');
const status = document.getElementById('status');
let question = '';
let uploading = false;

app.ontoolinput = params => { question = params.arguments?.question || ''; };

function resultValue(result) {
  if (result.isError) {
    const text = result.content?.find(item => item.type === 'text')?.text || 'Upload failed';
    let message = text;
    try { message = JSON.parse(text).error || text; } catch {}
    throw new Error(message);
  }
  return result.structuredContent || {};
}

function encodeBytes(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 32768) binary += String.fromCharCode(...bytes.subarray(i, i + 32768));
  return btoa(binary);
}

async function upload(file) {
  if (!file || uploading) return;
  uploading = true;
  fileInput.disabled = true;
  progress.hidden = false;
  progress.value = 0;
  status.textContent = `Uploading ${file.name}…`;
  let uploadId;
  try {
    const start = resultValue(await app.callServerTool({
      name: 'cityjson_upload_start',
      arguments: { filename: file.name, size_bytes: file.size }
    }));
    uploadId = start.upload_id;
    const chunkBytes = start.chunk_bytes;
    for (let offset = 0; offset < file.size; offset += chunkBytes) {
      const bytes = new Uint8Array(await file.slice(offset, offset + chunkBytes).arrayBuffer());
      resultValue(await app.callServerTool({
        name: 'cityjson_upload_chunk',
        arguments: { upload_id: uploadId, offset, bytes: encodeBytes(bytes) }
      }));
      progress.value = Math.round(((offset + bytes.length) / file.size) * 100);
    }
    const imported = resultValue(await app.callServerTool({
      name: 'cityjson_upload_finish',
      arguments: { upload_id: uploadId }
    }));
    status.textContent = `${imported.filename} is ready. Continuing your question…`;
    try {
      const message = await app.sendMessage({
        role: 'user',
        content: [{ type: 'text', text: `I uploaded ${imported.filename}. ${question || 'Please continue with my question about this file.'}` }]
      });
      if (message.isError) throw new Error('The chat could not continue automatically');
    } catch {
      status.textContent = `${imported.filename} is ready. Ask about it by this filename.`;
    }
  } catch (error) {
    status.textContent = error.message || 'Upload failed';
    if (uploadId) {
      await app.callServerTool({ name: 'cityjson_upload_cancel', arguments: { upload_id: uploadId } }).catch(() => {});
    }
  } finally {
    fileInput.disabled = false;
    uploading = false;
  }
}

fileInput.addEventListener('change', () => upload(fileInput.files?.[0]));
const dropZone = document.querySelector('main');
dropZone.addEventListener('dragover', event => { event.preventDefault(); });
dropZone.addEventListener('drop', event => {
  event.preventDefault();
  upload(event.dataTransfer.files?.[0]);
});

app.connect().catch(error => { status.textContent = error.message || 'Upload app could not connect'; });
