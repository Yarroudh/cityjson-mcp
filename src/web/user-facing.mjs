const INTERNAL_DATASET_ID = /\bcj_[a-f0-9]{12}\b/gi;

export function userFacingText(value, filenames = new Map(), fallback = 'the file') {
  let text = String(value || '');
  for (const [id, filename] of filenames) {
    if (!id || !filename) continue;
    text = text.replaceAll(id, filename);
  }
  return text
    .replace(INTERNAL_DATASET_ID, fallback)
    .replace(/\bdataset[_ ]?id\b/gi, 'file name');
}

export function userFacingEventStream(emit, transform) {
  let pending = '';
  return {
    send(event) {
      if (event.type !== 'text_delta') {
        emit(event);
        return;
      }
      pending += event.text || '';
      const lastSpace = Math.max(pending.lastIndexOf(' '), pending.lastIndexOf('\n'), pending.lastIndexOf('\t'));
      if (lastSpace < 0) return;
      const complete = pending.slice(0, lastSpace + 1);
      pending = pending.slice(lastSpace + 1);
      emit({ ...event, text: transform(complete) });
    },
    flush() {
      if (!pending) return;
      emit({ type: 'text_delta', text: transform(pending) });
      pending = '';
    }
  };
}
