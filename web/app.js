const elements = {
  app: document.querySelector('#app'),
  fileInput: document.querySelector('#file-input'),
  importButton: document.querySelector('#import-button'),
  dropzone: document.querySelector('#dropzone'),
  sidebarEmpty: document.querySelector('#sidebar-empty'),
  conversationList: document.querySelector('#conversation-list'),
  mainHeader: document.querySelector('#main-header'),
  conversationNumber: document.querySelector('#conversation-number'),
  conversationTitle: document.querySelector('#conversation-title'),
  modelMetadata: document.querySelector('#model-metadata'),
  emptyState: document.querySelector('#empty-state'),
  thread: document.querySelector('#thread'),
  composerWrap: document.querySelector('#composer-wrap'),
  form: document.querySelector('#chat-form'),
  message: document.querySelector('#message'),
  sendButton: document.querySelector('#send-button'),
  modelTrigger: document.querySelector('#model-trigger'),
  modelMenu: document.querySelector('#model-menu'),
  modelLabel: document.querySelector('#model-label'),
  modelMenuName: document.querySelector('#model-menu-name'),
  modelMenuProvider: document.querySelector('#model-menu-provider'),
  toolsTrigger: document.querySelector('#tools-trigger'),
  toolsMenu: document.querySelector('#tools-menu'),
  toolCount: document.querySelector('#tool-count'),
  toolList: document.querySelector('#tool-list'),
  backendStatus: document.querySelector('#backend-status'),
  themeToggle: document.querySelector('#theme-toggle'),
  dragOverlay: document.querySelector('#drag-overlay'),
  importOverlay: document.querySelector('#import-overlay'),
  importStatus: document.querySelector('#import-status'),
  errorBanner: document.querySelector('#error-banner'),
  errorMessage: document.querySelector('#error-message'),
  dismissError: document.querySelector('#dismiss-error')
};

let conversations = [];
let activeId = null;
let sendingId = null;
let importing = false;
let runtimeConfig = null;
let sequence = 1;
let dragDepth = 0;

function activeConversation() {
  return conversations.find(conversation => conversation.id === activeId) || null;
}

function formatCount(value) {
  return Number(value || 0).toLocaleString();
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MiB`;
}

function timestamp() {
  return new Date().toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function niceName(filename) {
  return filename.replace(/\.city\.json$/i, '').replace(/\.json$/i, '').replace(/[-_]/g, ' ');
}

function summaryCrs(summary) {
  return summary?.metadata?.referenceSystem || summary?.metadata?.crs || 'CRS not specified';
}

function welcomeMessage(file) {
  const summary = file.summary || {};
  const types = Object.entries(summary.typeCounts || {}).sort((a, b) => b[1] - a[1]);
  const primary = types[0]?.[0] || 'city object';
  const otherTypes = Math.max(types.length - 1, 0);
  const lod = summary.lods?.length ? ` at LoD ${summary.lods.join('/')}` : '';
  return `Imported ${file.originalFilename} through MCP — CityJSON v${summary.version || 'unknown'}, ${formatCount(summary.cityObjectCount)} city objects${lod}, mostly ${primary}${otherTypes ? ` and ${otherTypes} other type${otherTypes === 1 ? '' : 's'}` : ''}. Reference system: ${summaryCrs(summary)}. Ask about specific objects, request a query, or run a connected tool below.`;
}

function showError(message) {
  elements.errorMessage.textContent = message;
  elements.errorBanner.hidden = false;
}

function hideError() {
  elements.errorBanner.hidden = true;
}

async function requestJson(url, options) {
  const response = await fetch(url, options);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `Request failed with ${response.status}`);
  return body;
}

function createActionButton(label, title, handler) {
  const button = document.createElement('button');
  button.type = 'button';
  button.title = title;
  button.setAttribute('aria-label', title);
  button.textContent = label;
  button.addEventListener('click', handler);
  return button;
}

function exportConversation(conversation, event) {
  event.stopPropagation();
  const content = JSON.stringify({
    file: conversation.originalFilename,
    datasetId: conversation.summary.datasetId,
    messages: conversation.messages
  }, null, 2);
  const url = URL.createObjectURL(new Blob([content], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `${conversation.originalFilename.replace(/\.json$/i, '')}-conversation.json`;
  link.click();
  URL.revokeObjectURL(url);
}

async function deleteConversation(conversation, event) {
  event.stopPropagation();
  conversations = conversations.filter(item => item.id !== conversation.id);
  if (activeId === conversation.id) activeId = conversations[0]?.id || null;
  render();
  await requestJson('/api/session/reset', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sessionId: conversation.sessionId })
  }).catch(() => {});
}

function renderConversationList() {
  elements.sidebarEmpty.hidden = conversations.length > 0;
  elements.conversationList.hidden = conversations.length === 0;
  elements.conversationList.replaceChildren();

  for (const conversation of conversations) {
    const card = document.createElement('article');
    card.className = `conversation-card${conversation.id === activeId ? ' active' : ''}`;
    card.tabIndex = 0;
    card.addEventListener('click', () => {
      activeId = conversation.id;
      render();
    });
    card.addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        activeId = conversation.id;
        render();
      }
    });

    const name = document.createElement('div');
    name.className = 'conversation-name';
    name.textContent = conversation.name;
    const divider = document.createElement('div');
    divider.className = 'conversation-divider';
    const meta = document.createElement('div');
    meta.className = 'conversation-meta';
    const facts = document.createElement('span');
    facts.textContent = `${formatCount(conversation.summary.cityObjectCount)} objects · ${conversation.importedAt}`;
    const actions = document.createElement('span');
    actions.className = 'conversation-actions';
    actions.append(
      createActionButton('↓', 'Export conversation', event => exportConversation(conversation, event)),
      createActionButton('×', 'Discard conversation', event => deleteConversation(conversation, event))
    );
    meta.append(facts, actions);
    card.append(name, divider, meta);
    elements.conversationList.append(card);
  }
}

function renderMessage(message) {
  const row = document.createElement('div');
  row.className = `row ${message.role}`;
  const bubble = document.createElement('div');
  bubble.className = `bubble ${message.role}`;
  const label = document.createElement('span');
  label.className = 'bubble-label';
  label.textContent = message.role === 'user' ? 'you' : 'assistant';
  bubble.append(label, document.createTextNode(message.content));

  if (message.file) {
    const files = document.createElement('div');
    files.className = 'message-files';
    const chip = document.createElement('span');
    chip.textContent = `${message.file.name} · ${formatBytes(message.file.sizeBytes)}`;
    files.append(chip);
    bubble.insertBefore(files, bubble.childNodes[1]);
  }

  if (message.trace?.length) {
    const details = document.createElement('details');
    details.className = 'tool-trace';
    const summary = document.createElement('summary');
    summary.textContent = `${message.trace.length} MCP tool call${message.trace.length === 1 ? '' : 's'}`;
    const list = document.createElement('ul');
    for (const call of message.trace) {
      const item = document.createElement('li');
      item.textContent = `${call.name} · ${call.durationMs} ms${call.isError ? ' · error' : ''}`;
      list.append(item);
    }
    details.append(summary, list);
    bubble.append(details);
  }
  row.append(bubble);
  return row;
}

function renderActiveConversation() {
  const active = activeConversation();
  const hasActive = Boolean(active);
  elements.emptyState.hidden = hasActive;
  elements.mainHeader.hidden = !hasActive;
  elements.thread.hidden = !hasActive;
  elements.composerWrap.hidden = !hasActive;
  if (!active) return;

  elements.conversationNumber.textContent = `#${String(active.number).padStart(3, '0')}`;
  elements.conversationTitle.textContent = active.name;
  elements.modelMetadata.textContent = `${summaryCrs(active.summary)} · v${active.summary.version || 'unknown'}`;
  elements.thread.replaceChildren(...active.messages.map(renderMessage));

  if (sendingId === active.id) {
    const row = document.createElement('div');
    row.className = 'row assistant';
    const bubble = document.createElement('div');
    bubble.className = 'bubble assistant';
    const label = document.createElement('span');
    label.className = 'bubble-label';
    label.textContent = 'assistant';
    const dots = document.createElement('span');
    dots.className = 'typing-dots';
    dots.append(document.createElement('span'), document.createElement('span'), document.createElement('span'));
    bubble.append(label, dots);
    row.append(bubble);
    elements.thread.append(row);
  }

  const unavailable = Boolean(sendingId) || importing;
  elements.message.disabled = unavailable;
  elements.message.placeholder = unavailable ? 'Waiting on a reply…' : 'Ask about the model, or request a tool action…';
  elements.sendButton.disabled = unavailable || !elements.message.value.trim();
  requestAnimationFrame(() => { elements.thread.scrollTop = elements.thread.scrollHeight; });
}

function render() {
  renderConversationList();
  renderActiveConversation();
  elements.importButton.disabled = importing;
}

function configureRuntime(config) {
  runtimeConfig = config;
  const modelName = config.model || 'No model configured';
  const providerName = config.provider ? `${config.provider[0].toUpperCase()}${config.provider.slice(1)}` : 'Unknown provider';
  elements.modelLabel.textContent = modelName;
  elements.modelMenuName.textContent = modelName;
  elements.modelMenuProvider.textContent = `${providerName} · API key loaded server-side`;
  elements.toolCount.textContent = `· ${config.toolCount}`;
  const backendEntries = Object.values(config.backends || {});
  const availableBackends = backendEntries.filter(backend => backend?.available === true).length;
  elements.backendStatus.textContent = backendEntries.length
    ? `${availableBackends}/${backendEntries.length} backends`
    : 'status unavailable';
  elements.backendStatus.classList.toggle('on', backendEntries.length > 0 && availableBackends === backendEntries.length);
  elements.backendStatus.classList.toggle('partial', availableBackends !== backendEntries.length);
  elements.toolList.replaceChildren();
  for (const tool of config.tools || []) {
    const action = document.createElement('div');
    action.className = 'connector-action';
    action.textContent = tool.title || tool.name;
    action.title = tool.name;
    elements.toolList.append(action);
  }
}

async function importOneFile(file) {
  if (!file.name.toLowerCase().endsWith('.json')) throw new Error(`${file.name} is not a JSON file`);
  elements.importStatus.textContent = `Streaming ${file.name} into the MCP inbox…`;
  const form = new FormData();
  form.append('files', file, file.name);
  const batch = await requestJson('/api/uploads', { method: 'POST', body: form });
  const imported = batch.files?.[0];
  if (!imported?.summary?.datasetId) throw new Error(`The server did not return a dataset handle for ${file.name}`);
  const id = `conversation-${crypto.randomUUID()}`;
  const conversation = {
    id,
    number: sequence++,
    sessionId: crypto.randomUUID(),
    batchId: batch.batchId,
    batchPending: true,
    name: niceName(imported.originalFilename),
    originalFilename: imported.originalFilename,
    storedFilename: imported.filename,
    sizeBytes: imported.sizeBytes,
    importedAt: timestamp(),
    summary: imported.summary,
    messages: [{ role: 'assistant', content: welcomeMessage(imported), synthetic: true }]
  };
  conversations = [conversation, ...conversations];
  activeId = id;
}

async function importFiles(files) {
  const candidates = [...files];
  if (!candidates.length || importing) return;
  importing = true;
  hideError();
  elements.importOverlay.hidden = false;
  render();
  try {
    for (const file of candidates) await importOneFile(file);
  } catch (error) {
    showError(`Import failed: ${error.message}`);
  } finally {
    importing = false;
    elements.importOverlay.hidden = true;
    elements.fileInput.value = '';
    render();
    elements.message.focus();
  }
}

async function sendMessage() {
  const active = activeConversation();
  const text = elements.message.value.trim();
  if (!active || !text || sendingId || importing) return;
  const usedInitialBatch = active.batchPending;
  active.messages.push({
    role: 'user',
    content: text,
    file: usedInitialBatch ? { name: active.originalFilename, sizeBytes: active.sizeBytes } : undefined
  });
  elements.message.value = '';
  elements.message.style.height = 'auto';
  sendingId = active.id;
  hideError();
  render();

  try {
    const result = await requestJson('/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        sessionId: active.sessionId,
        message: text,
        batchId: usedInitialBatch ? active.batchId : undefined
      })
    });
    active.batchPending = false;
    active.messages.push({ role: 'assistant', content: result.message, trace: result.trace });
  } catch (error) {
    showError(`Reply failed: ${error.message}`);
  } finally {
    sendingId = null;
    render();
    elements.message.focus();
  }
}

function toggleMenu(menu, other) {
  const willOpen = menu.hidden;
  menu.hidden = !willOpen;
  other.hidden = true;
}

elements.importButton.addEventListener('click', () => elements.fileInput.click());
elements.dropzone.addEventListener('click', () => elements.fileInput.click());
elements.fileInput.addEventListener('change', () => importFiles(elements.fileInput.files));
elements.dismissError.addEventListener('click', hideError);

elements.form.addEventListener('submit', event => {
  event.preventDefault();
  sendMessage();
});
elements.message.addEventListener('input', () => {
  elements.message.style.height = 'auto';
  elements.message.style.height = `${Math.min(elements.message.scrollHeight, 120)}px`;
  elements.sendButton.disabled = Boolean(sendingId) || importing || !elements.message.value.trim();
});
elements.message.addEventListener('keydown', event => {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    sendMessage();
  }
});

elements.modelTrigger.addEventListener('click', event => {
  event.stopPropagation();
  toggleMenu(elements.modelMenu, elements.toolsMenu);
});
elements.toolsTrigger.addEventListener('click', event => {
  event.stopPropagation();
  toggleMenu(elements.toolsMenu, elements.modelMenu);
});
document.addEventListener('click', () => {
  elements.modelMenu.hidden = true;
  elements.toolsMenu.hidden = true;
});
elements.modelMenu.addEventListener('click', event => event.stopPropagation());
elements.toolsMenu.addEventListener('click', event => event.stopPropagation());

elements.themeToggle.addEventListener('click', () => {
  const theme = elements.app.dataset.theme === 'dark' ? 'light' : 'dark';
  elements.app.dataset.theme = theme;
  try { localStorage.setItem('datum-theme', theme); } catch {}
});

for (const eventName of ['dragenter', 'dragover']) {
  window.addEventListener(eventName, event => {
    event.preventDefault();
    if (eventName === 'dragenter') dragDepth += 1;
    if (event.dataTransfer?.types?.includes('Files')) elements.dragOverlay.hidden = false;
  });
}
window.addEventListener('dragleave', event => {
  event.preventDefault();
  dragDepth = Math.max(dragDepth - 1, 0);
  if (dragDepth === 0) elements.dragOverlay.hidden = true;
});
window.addEventListener('drop', event => {
  event.preventDefault();
  dragDepth = 0;
  elements.dragOverlay.hidden = true;
  importFiles(event.dataTransfer?.files || []);
});

try {
  const savedTheme = localStorage.getItem('datum-theme');
  if (savedTheme === 'light' || savedTheme === 'dark') elements.app.dataset.theme = savedTheme;
} catch {}

requestJson('/api/config')
  .then(configureRuntime)
  .catch(error => showError(`Configuration failed: ${error.message}`));
render();
