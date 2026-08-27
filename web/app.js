import { marked } from '/vendor/marked.esm.js';
import DOMPurify from '/vendor/purify.es.mjs';

marked.setOptions({ gfm: true, breaks: true });

const elements = {
  app: document.querySelector('#app'),
  fileInput: document.querySelector('#file-input'),
  importButton: document.querySelector('#import-button'),
  modelSettingsButton: document.querySelector('#model-settings-button'),
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
  modelLabel: document.querySelector('#model-label'),
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
  dismissError: document.querySelector('#dismiss-error'),
  modelDialog: document.querySelector('#model-dialog'),
  modelForm: document.querySelector('#model-form'),
  modelDialogClose: document.querySelector('#model-dialog-close'),
  modelCancel: document.querySelector('#model-cancel'),
  modelProvider: document.querySelector('#model-provider'),
  modelName: document.querySelector('#model-name'),
  modelApiKey: document.querySelector('#model-api-key'),
  modelBaseUrl: document.querySelector('#model-base-url'),
  toolDialog: document.querySelector('#tool-dialog'),
  toolDialogClose: document.querySelector('#tool-dialog-close'),
  toolDialogName: document.querySelector('#tool-dialog-name'),
  toolDialogDescription: document.querySelector('#tool-dialog-description'),
  toolDialogParameters: document.querySelector('#tool-dialog-parameters')
};

let conversations = [];
let activeId = null;
let sendingId = null;
let importing = false;
let runtimeConfig = null;
let sequence = 1;
let dragDepth = 0;
let clientId;

try {
  clientId = sessionStorage.getItem('datum-client-id');
  if (!clientId) {
    clientId = crypto.randomUUID();
    sessionStorage.setItem('datum-client-id', clientId);
  }
} catch {
  clientId = crypto.randomUUID();
}

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

function renderMarkdown(source) {
  const container = document.createElement('div');
  container.className = 'message-content markdown';
  const rendered = marked.parse(String(source || ''));
  container.innerHTML = DOMPurify.sanitize(rendered, { USE_PROFILES: { html: true } });
  for (const link of container.querySelectorAll('a')) {
    if (!['http:', 'https:'].includes(new URL(link.href, location.href).protocol)) {
      link.removeAttribute('href');
      continue;
    }
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
  }
  return container;
}

function renderMessage(message) {
  const row = document.createElement('div');
  row.className = `row ${message.role}`;
  const bubble = document.createElement('div');
  bubble.className = `bubble ${message.role}`;
  const label = document.createElement('span');
  label.className = 'bubble-label';
  label.textContent = message.role === 'user' ? 'you' : 'assistant';
  const content = message.role === 'assistant' ? renderMarkdown(message.content) : document.createElement('div');
  if (message.role !== 'assistant') {
    content.className = 'message-content';
    content.textContent = message.content;
  }
  bubble.append(label, content);

  if (message.file) {
    const files = document.createElement('div');
    files.className = 'message-files';
    const chip = document.createElement('span');
    chip.textContent = `${message.file.name} · ${formatBytes(message.file.sizeBytes)}`;
    files.append(chip);
    bubble.insertBefore(files, content);
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

  if (message.downloads?.length) {
    const downloads = document.createElement('div');
    downloads.className = 'download-list';
    for (const download of message.downloads) {
      const link = document.createElement('a');
      link.className = 'download-button';
      link.href = download.url;
      link.download = download.filename;
      link.textContent = `↓ ${download.filename} · ${formatBytes(download.sizeBytes)}`;
      downloads.append(link);
    }
    bubble.append(downloads);
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

  const modelUnavailable = runtimeConfig?.modelConfigured === false;
  const unavailable = Boolean(sendingId) || importing || modelUnavailable;
  elements.message.disabled = unavailable;
  elements.message.placeholder = modelUnavailable
    ? 'Configure a model to start chatting…'
    : unavailable ? 'Waiting on a reply…' : 'Ask about the model, or request a tool action…';
  elements.sendButton.disabled = unavailable || !elements.message.value.trim();
  requestAnimationFrame(() => { elements.thread.scrollTop = elements.thread.scrollHeight; });
}

function render() {
  renderConversationList();
  renderActiveConversation();
  elements.importButton.disabled = importing;
}

function shortDescription(description) {
  const text = String(description || 'No description available.').trim();
  const sentence = /^(.+?[.!?])(?:\s|$)/.exec(text);
  return sentence ? sentence[1] : text;
}

function schemaType(schema) {
  if (Array.isArray(schema?.type)) return schema.type.join(' | ');
  if (schema?.type === 'array') return `array<${schemaType(schema.items) || 'value'}>`;
  if (schema?.type) return schema.type;
  if (Array.isArray(schema?.enum)) return schema.enum.map(value => JSON.stringify(value)).join(' | ');
  if (Array.isArray(schema?.anyOf)) return schema.anyOf.map(schemaType).filter(Boolean).join(' | ');
  return 'value';
}

function showToolDocumentation(tool) {
  elements.toolDialogName.textContent = tool.name;
  elements.toolDialogDescription.textContent = tool.description || 'No additional documentation is available for this action.';
  elements.toolDialogParameters.replaceChildren();
  const properties = tool.inputSchema?.properties || {};
  const required = new Set(tool.inputSchema?.required || []);
  if (Object.keys(properties).length === 0) {
    const empty = document.createElement('div');
    empty.className = 'parameter';
    empty.textContent = 'This action has no parameters.';
    elements.toolDialogParameters.append(empty);
  }
  for (const [name, schema] of Object.entries(properties)) {
    const row = document.createElement('div');
    row.className = 'parameter';
    const heading = document.createElement('div');
    heading.className = 'parameter-name';
    const code = document.createElement('code');
    code.textContent = name;
    heading.append(code);
    if (required.has(name)) {
      const marker = document.createElement('span');
      marker.className = 'parameter-required';
      marker.textContent = 'required';
      heading.append(marker);
    }
    const detail = document.createElement('div');
    detail.className = 'parameter-detail';
    const type = document.createElement('span');
    type.className = 'parameter-type';
    type.textContent = schemaType(schema);
    const description = document.createElement('span');
    const defaultText = schema.default === undefined ? '' : ` Default: ${JSON.stringify(schema.default)}.`;
    description.textContent = `${schema.description || 'No description.'}${defaultText}`;
    detail.append(type, description);
    row.append(heading, detail);
    elements.toolDialogParameters.append(row);
  }
  elements.toolDialog.showModal();
}

function openModelDialog() {
  elements.modelProvider.value = runtimeConfig?.provider || 'openai';
  elements.modelName.value = runtimeConfig?.model || '';
  elements.modelApiKey.value = '';
  elements.modelBaseUrl.value = runtimeConfig?.baseUrl || '';
  elements.modelDialog.showModal();
}

function configureRuntime(config) {
  runtimeConfig = config;
  const modelName = config.modelConfigured ? config.model : 'Configure model';
  elements.modelLabel.textContent = modelName;
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
    const action = document.createElement('button');
    action.type = 'button';
    action.className = 'connector-action';
    const name = document.createElement('code');
    name.className = 'tool-name';
    name.textContent = tool.name;
    const description = document.createElement('span');
    description.className = 'tool-summary';
    description.textContent = shortDescription(tool.description);
    action.append(name, description);
    action.addEventListener('click', () => {
      elements.toolsMenu.hidden = true;
      showToolDocumentation(tool);
    });
    elements.toolList.append(action);
  }
  render();
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
        clientId,
        message: text,
        batchId: usedInitialBatch ? active.batchId : undefined
      })
    });
    active.batchPending = false;
    active.messages.push({ role: 'assistant', content: result.message, trace: result.trace, downloads: result.downloads });
  } catch (error) {
    showError(`Reply failed: ${error.message}`);
  } finally {
    sendingId = null;
    render();
    elements.message.focus();
  }
}

function toggleMenu(menu) {
  const willOpen = menu.hidden;
  menu.hidden = !willOpen;
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

elements.modelSettingsButton.addEventListener('click', openModelDialog);
elements.modelTrigger.addEventListener('click', openModelDialog);
elements.toolsTrigger.addEventListener('click', event => {
  event.stopPropagation();
  toggleMenu(elements.toolsMenu);
});
document.addEventListener('click', () => {
  elements.toolsMenu.hidden = true;
});
elements.toolsMenu.addEventListener('click', event => event.stopPropagation());

elements.modelDialogClose.addEventListener('click', () => elements.modelDialog.close());
elements.modelCancel.addEventListener('click', () => elements.modelDialog.close());
elements.toolDialogClose.addEventListener('click', () => elements.toolDialog.close());
for (const dialog of [elements.modelDialog, elements.toolDialog]) {
  dialog.addEventListener('click', event => {
    if (event.target === dialog) dialog.close();
  });
}
elements.modelProvider.addEventListener('change', () => {
  const defaults = {
    openai: 'https://api.openai.com/v1',
    anthropic: 'https://api.anthropic.com'
  };
  elements.modelBaseUrl.value = defaults[elements.modelProvider.value];
});
elements.modelForm.addEventListener('submit', async event => {
  event.preventDefault();
  const submit = elements.modelForm.querySelector('[type="submit"]');
  submit.disabled = true;
  hideError();
  try {
    const selected = await requestJson('/api/model/configure', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        clientId,
        provider: elements.modelProvider.value,
        model: elements.modelName.value,
        apiKey: elements.modelApiKey.value,
        baseUrl: elements.modelBaseUrl.value
      })
    });
    configureRuntime({ ...runtimeConfig, ...selected });
    for (const conversation of conversations) conversation.messages.push({
      role: 'assistant',
      content: `Model changed to **${selected.model}**. The next message starts a fresh model session for this conversation.`,
      synthetic: true
    });
    elements.modelDialog.close();
    render();
  } catch (error) {
    showError(`Model configuration failed: ${error.message}`);
  } finally {
    submit.disabled = false;
    elements.modelApiKey.value = '';
  }
});

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

requestJson(`/api/config?clientId=${encodeURIComponent(clientId)}`)
  .then(config => {
    configureRuntime(config);
    if (!config.modelConfigured) openModelDialog();
  })
  .catch(error => showError(`Configuration failed: ${error.message}`));
render();
