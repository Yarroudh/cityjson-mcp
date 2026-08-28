import { marked } from '/vendor/marked.esm.js';
import DOMPurify from '/vendor/purify.es.mjs';
import { followUpSuggestions, inferSuggestionState, initialSuggestions } from '/suggestions.js?v=1';

marked.setOptions({ gfm: true, breaks: true });

const elements = {
  app: document.querySelector('#app'),
  fileInput: document.querySelector('#file-input'),
  importButton: document.querySelector('#import-button'),
  sidebarModelTrigger: document.querySelector('#sidebar-model-trigger'),
  sidebarModelLabel: document.querySelector('#sidebar-model-label'),
  sidebarModelMenu: document.querySelector('#sidebar-model-menu'),
  sidebarModelList: document.querySelector('#sidebar-model-list'),
  sidebarAddModel: document.querySelector('#sidebar-add-model'),
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
  modelMenu: document.querySelector('#model-menu'),
  modelList: document.querySelector('#model-list'),
  addModel: document.querySelector('#add-model'),
  toolsTrigger: document.querySelector('#tools-trigger'),
  toolsMenu: document.querySelector('#tools-menu'),
  toolCount: document.querySelector('#tool-count'),
  toolList: document.querySelector('#tool-list'),
  backendStatus: document.querySelector('#backend-status'),
  themeToggle: document.querySelector('#theme-toggle'),
  aboutButton: document.querySelector('#about-button'),
  promptSuggestions: document.querySelector('#prompt-suggestions'),
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
  modelDialogTitle: document.querySelector('#model-dialog-title'),
  modelDialogIntro: document.querySelector('#model-dialog-intro'),
  modelSubmitLabel: document.querySelector('#model-submit-label'),
  modelFormError: document.querySelector('#model-form-error'),
  modelProvider: document.querySelector('#model-provider'),
  modelName: document.querySelector('#model-name'),
  modelApiKey: document.querySelector('#model-api-key'),
  modelBaseUrl: document.querySelector('#model-base-url'),
  toolDialog: document.querySelector('#tool-dialog'),
  toolDialogClose: document.querySelector('#tool-dialog-close'),
  toolDialogName: document.querySelector('#tool-dialog-name'),
  toolDialogDescription: document.querySelector('#tool-dialog-description'),
  toolDialogParameters: document.querySelector('#tool-dialog-parameters'),
  aboutDialog: document.querySelector('#about-dialog'),
  aboutDialogClose: document.querySelector('#about-dialog-close'),
  viewerOpen: document.querySelector('#viewer-open'),
  viewerPanel: document.querySelector('#viewer-panel'),
  viewerClose: document.querySelector('#viewer-close'),
  viewerFit: document.querySelector('#viewer-fit'),
  viewerSemantics: document.querySelector('#viewer-semantics'),
  viewerStage: document.querySelector('#viewer-stage'),
  viewerLoading: document.querySelector('#viewer-loading'),
  viewerEmpty: document.querySelector('#viewer-empty'),
  viewerTitle: document.querySelector('#viewer-title'),
  viewerStats: document.querySelector('#viewer-stats'),
  viewerModeHint: document.querySelector('#viewer-mode-hint'),
  viewerInspector: document.querySelector('#viewer-inspector'),
  viewerInspectorClose: document.querySelector('#viewer-inspector-close'),
  viewerSelectionTitle: document.querySelector('#viewer-selection-title'),
  viewerInspectorBody: document.querySelector('#viewer-inspector-body')
};

const CACHE_KEY = 'datum-state-v1';
const CLIENT_KEY = 'datum-client-id';
const CACHE_TTL_MS = 8 * 60 * 60 * 1000;
let conversations = [];
let activeId = null;
let sendingId = null;
let importing = false;
let runtimeConfig = null;
let sequence = 1;
let dragDepth = 0;
let clientId;
let pendingSuggestion = null;
let editingModelId = null;
let viewer = null;
let viewerDatasetId = null;
let viewerRequest = 0;

const MESSAGE_ICONS = {
  copy: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M15 9V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h3"/></svg>',
  retry: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4v6h6"/><path d="M5.5 9a8 8 0 1 1-.6 5"/></svg>',
  copied: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 4 4L19 6"/></svg>'
};

try {
  clientId = localStorage.getItem(CLIENT_KEY);
  if (!clientId) {
    clientId = crypto.randomUUID();
    localStorage.setItem(CLIENT_KEY, clientId);
  }
} catch {
  clientId = crypto.randomUUID();
}

function restoreState() {
  try {
    const saved = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
    if (!saved || Date.now() - saved.savedAt > CACHE_TTL_MS || !Array.isArray(saved.conversations)) {
      localStorage.removeItem(CACHE_KEY);
      return;
    }
    conversations = saved.conversations.slice(0, 25).filter(conversation => conversation?.id && Array.isArray(conversation.messages));
    activeId = conversations.some(conversation => conversation.id === saved.activeId)
      ? saved.activeId
      : conversations[0]?.id || null;
    sequence = Number.isSafeInteger(saved.sequence) && saved.sequence > 0
      ? saved.sequence
      : Math.max(0, ...conversations.map(conversation => Number(conversation.number) || 0)) + 1;
  } catch {
    try { localStorage.removeItem(CACHE_KEY); } catch {}
  }
}

function saveState() {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({
      savedAt: Date.now(),
      conversations: conversations.slice(0, 25),
      activeId,
      sequence
    }));
  } catch {}
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

function markdownCell(value) {
  return String(value ?? 'Not specified').replaceAll('|', '\\|').replaceAll('\n', ' ');
}

function inlineCode(value) {
  const text = String(value);
  const delimiter = text.includes('`') ? '``' : '`';
  return `${delimiter}${text}${delimiter}`;
}

function welcomeMessage(file) {
  const summary = file.summary || {};
  const types = Object.entries(summary.typeCounts || {})
    .sort((a, b) => b[1] - a[1])
    .map(([name, count]) => `${name}: ${formatCount(count)}`)
    .join(', ') || 'None reported';
  const attributeNames = summary.attributeNames || summary.attributes;
  const attributes = Array.isArray(attributeNames)
    ? `${formatCount(attributeNames.length)} (${attributeNames.slice(0, 8).join(', ')}${attributeNames.length > 8 ? ', …' : ''})`
    : summary.attributeCount == null ? 'Not reported' : formatCount(summary.attributeCount);
  return `Imported ${inlineCode(file.originalFilename)} successfully.

| Metadata | Value |
| --- | --- |
| File size | ${markdownCell(formatBytes(file.sizeBytes || 0))} |
| CityJSON version | ${markdownCell(summary.version || 'Unknown')} |
| CityObjects | ${markdownCell(formatCount(summary.cityObjectCount))} |
| Vertices | ${markdownCell(formatCount(summary.vertexCount))} |
| Levels of detail | ${markdownCell(summary.lods?.length ? summary.lods.join(', ') : 'Not reported')} |
| Coordinate reference system | ${markdownCell(summaryCrs(summary))} |
| Object types | ${markdownCell(types)} |
| Attributes | ${markdownCell(attributes)} |

You can ask a question below or choose one of the examples.`;
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

async function showViewer() {
  const conversation = activeConversation();
  if (!conversation?.summary?.datasetId) return;
  elements.app.classList.add('viewer-visible');
  elements.viewerPanel.setAttribute('aria-hidden', 'false');
  elements.viewerOpen.setAttribute('aria-expanded', 'true');
  elements.viewerTitle.textContent = conversation.name;
  await loadViewerDataset(conversation);
}

function hideViewer() {
  elements.app.classList.remove('viewer-visible');
  elements.viewerPanel.setAttribute('aria-hidden', 'true');
  elements.viewerOpen.setAttribute('aria-expanded', 'false');
}

function inspectorSection(title, entries) {
  if (!entries.length) return null;
  const section = document.createElement('section');
  const heading = document.createElement('h4');
  heading.textContent = title;
  const list = document.createElement('dl');
  for (const [name, value] of entries) {
    const term = document.createElement('dt');
    term.textContent = name;
    const detail = document.createElement('dd');
    detail.textContent = value == null ? 'null' : typeof value === 'object' ? JSON.stringify(value) : String(value);
    list.append(term, detail);
  }
  section.append(heading, list);
  return section;
}

function showViewerSelection(selection) {
  if (!selection) {
    elements.viewerInspector.hidden = true;
    elements.viewerInspectorBody.replaceChildren();
    return;
  }
  elements.viewerSelectionTitle.textContent = selection.id;
  const objectEntries = [
    ['Type', selection.object.type],
    ['Geometry', selection.geometry?.type],
    ['LoD', selection.geometry?.lod],
    ['Geometry index', selection.geometryIndex]
  ].filter(([, value]) => value !== undefined);
  const semanticEntries = selection.semantic
    ? [['Type', selection.semantic.type], ['Surface index', selection.semanticIndex], ...Object.entries(selection.semantic).filter(([key]) => key !== 'type')]
    : [];
  const attributeEntries = Object.entries(selection.object.attributes || {});
  const relationshipEntries = [
    ['Parents', selection.object.parents],
    ['Children', selection.object.children]
  ].filter(([, value]) => Array.isArray(value) && value.length);
  elements.viewerInspectorBody.replaceChildren(...[
    inspectorSection('Object', objectEntries),
    inspectorSection('Semantic surface', semanticEntries),
    inspectorSection('Attributes', attributeEntries.length ? attributeEntries : [['Attributes', 'None']]),
    inspectorSection('Relationships', relationshipEntries)
  ].filter(Boolean));
  elements.viewerInspector.hidden = false;
}

async function loadViewerDataset(conversation, force = false) {
  const datasetId = conversation?.summary?.datasetId;
  if (!datasetId || (!force && viewerDatasetId === datasetId)) return;
  const requestId = ++viewerRequest;
  elements.viewerLoading.hidden = false;
  elements.viewerEmpty.hidden = true;
  try {
    const [model, viewerModule] = await Promise.all([
      requestJson('/api/datasets/view', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ datasetId })
      }),
      import('/viewer.js?v=9')
    ]);
    if (requestId !== viewerRequest) return;
    viewer ||= new viewerModule.CityJsonViewer(elements.viewerStage, {
      onStats: stats => {
        elements.viewerStats.textContent = `${formatCount(stats.renderedObjects)} objects · ${formatCount(stats.triangles)} triangles · ${formatCount(stats.vertices)} vertices`;
      },
      onSelect: showViewerSelection
    });
    viewer.setSelectionMode(elements.viewerSemantics.getAttribute('aria-checked') === 'true' ? 'surface' : 'object');
    viewer.load(model);
    viewerDatasetId = datasetId;
  } catch (error) {
    if (requestId !== viewerRequest) return;
    elements.viewerEmpty.textContent = `The current model could not be displayed: ${error.message}`;
    elements.viewerEmpty.hidden = false;
  } finally {
    if (requestId === viewerRequest) elements.viewerLoading.hidden = true;
  }
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

async function downloadDataset(conversation, event) {
  event.stopPropagation();
  hideError();
  try {
    const result = await requestJson('/api/datasets/download', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ datasetId: conversation.summary.datasetId })
    });
    const download = result.downloads?.[0];
    if (!download) throw new Error('The dataset did not produce a downloadable file');
    const link = document.createElement('a');
    link.href = download.url;
    link.download = download.filename || conversation.originalFilename;
    document.body.append(link);
    link.click();
    link.remove();
  } catch (error) {
    showError(`Download failed: ${error.message}`);
  }
}

async function deleteConversation(conversation, event) {
  event.stopPropagation();
  conversations = conversations.filter(item => item.id !== conversation.id);
  if (activeId === conversation.id) activeId = conversations[0]?.id || null;
  saveState();
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
      saveState();
      render();
    });
    card.addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        activeId = conversation.id;
        saveState();
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
      createActionButton('↓', 'Download imported CityJSON', event => downloadDataset(conversation, event)),
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

function messageActionButton(title, icon, handler) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'message-action';
  button.title = title;
  button.setAttribute('aria-label', title);
  button.innerHTML = icon;
  button.addEventListener('click', handler);
  return button;
}

async function copyMessage(message, button) {
  try {
    let copied = false;
    if (navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(String(message.content || ''));
        copied = true;
      } catch {}
    }
    if (!copied) {
      const field = document.createElement('textarea');
      field.value = String(message.content || '');
      field.style.position = 'fixed';
      field.style.opacity = '0';
      document.body.append(field);
      try {
        field.select();
        if (!document.execCommand('copy')) throw new Error('Clipboard access is unavailable');
      } finally {
        field.remove();
      }
    }
    button.innerHTML = MESSAGE_ICONS.copied;
    button.title = 'Copied';
    button.setAttribute('aria-label', 'Copied');
    setTimeout(() => {
      if (!button.isConnected) return;
      button.innerHTML = MESSAGE_ICONS.copy;
      button.title = 'Copy message';
      button.setAttribute('aria-label', 'Copy message');
    }, 1500);
  } catch (error) {
    showError(`Copy failed: ${error.message}`);
  }
}

async function retryMessage(conversation, message, messageIndex) {
  if (sendingId || importing || runtimeConfig?.modelConfigured === false) return;
  const laterMessages = conversation.messages.slice(messageIndex + 1);
  const hadResponse = laterMessages[0]?.role === 'assistant';
  const retryTurn = conversation.messages
    .slice(0, messageIndex)
    .filter(item => item.role === 'user').length;
  const previousSuggestionState = conversation.suggestionState;
  const previousSuggestionPage = conversation.suggestionPage;
  conversation.messages = conversation.messages.slice(0, messageIndex + 1);
  conversation.suggestionState = inferSuggestionState(message.content);
  conversation.suggestionPage = 0;
  pendingSuggestion = null;
  sendingId = conversation.id;
  hideError();
  saveState();
  render();

  try {
    const result = await requestJson('/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        sessionId: conversation.sessionId,
        clientId,
        message: message.content,
        batchId: message.file ? conversation.batchId : undefined,
        datasetId: conversation.summary.datasetId,
        datasetIsDerived: conversation.datasetIsDerived === true,
        storedFilename: conversation.storedFilename,
        originalFilename: conversation.originalFilename,
        retryTurn: hadResponse ? retryTurn : undefined
      })
    });
    if (message.file) conversation.batchPending = false;
    if (result.datasetId) conversation.summary.datasetId = result.datasetId;
    if (typeof result.datasetIsDerived === 'boolean') conversation.datasetIsDerived = result.datasetIsDerived;
    conversation.messages.push({ role: 'assistant', content: result.message, trace: result.trace, downloads: result.downloads });
  } catch (error) {
    conversation.messages.push(...laterMessages);
    conversation.suggestionState = previousSuggestionState;
    conversation.suggestionPage = previousSuggestionPage;
    showError(`Retry failed: ${error.message}`);
  } finally {
    sendingId = null;
    saveState();
    render();
    elements.message.focus();
  }
}

function renderMessage(message, messageIndex, conversation) {
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
  const actions = document.createElement('div');
  actions.className = 'message-actions';
  if (message.role === 'user') {
    const retry = messageActionButton('Retry question', MESSAGE_ICONS.retry, () => retryMessage(conversation, message, messageIndex));
    retry.disabled = Boolean(sendingId) || importing || runtimeConfig?.modelConfigured === false;
    actions.append(retry);
  }
  actions.append(messageActionButton('Copy message', MESSAGE_ICONS.copy, event => copyMessage(message, event.currentTarget)));
  row.append(bubble, actions);
  return row;
}

function renderSuggestions(conversation, disabled) {
  const allSuggestions = conversation.suggestionState
    ? followUpSuggestions(conversation.suggestionState)
    : initialSuggestions();
  const pageCount = Math.ceil(allSuggestions.length / 3);
  const page = Math.max(0, Number(conversation.suggestionPage) || 0) % pageCount;
  const suggestions = allSuggestions.slice(page * 3, page * 3 + 3);
  const heading = document.createElement('div');
  heading.className = 'suggestion-heading';
  const label = document.createElement('span');
  label.className = 'suggestion-label';
  label.textContent = conversation.suggestionState ? 'Suggested follow-ups' : 'Try asking';
  heading.append(label);
  if (pageCount > 1) {
    const more = document.createElement('button');
    more.type = 'button';
    more.className = 'suggestion-more';
    more.dataset.suggestionMore = 'true';
    more.textContent = 'More';
    more.disabled = disabled;
    heading.append(more);
  }
  const list = document.createElement('div');
  list.className = 'suggestion-list';
  for (const suggestion of suggestions) {
    const button = document.createElement('button');
    button.type = 'button';
    button.disabled = disabled;
    button.dataset.prompt = suggestion.prompt;
    button.dataset.topic = suggestion.topic;
    button.dataset.depth = String(suggestion.depth);
    button.title = suggestion.prompt;
    button.textContent = suggestion.label;
    list.append(button);
  }
  elements.promptSuggestions.replaceChildren(heading, list);
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
  elements.modelMetadata.textContent = `v${active.summary.version || 'unknown version'}`;
  elements.thread.replaceChildren(...active.messages.map((message, index) => renderMessage(message, index, active)));

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
  elements.promptSuggestions.hidden = Boolean(sendingId) || importing;
  if (!elements.promptSuggestions.hidden) renderSuggestions(active, modelUnavailable);
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
  if (!activeConversation()) hideViewer();
  else if (elements.app.classList.contains('viewer-visible')) {
    elements.viewerTitle.textContent = activeConversation().name;
    loadViewerDataset(activeConversation());
  }
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

function openModelDialog(model = null) {
  editingModelId = model?.id || null;
  elements.modelDialogTitle.textContent = model ? 'Edit model' : 'Add a model';
  elements.modelDialogIntro.textContent = model
    ? 'Update this model configuration. Leave the API key blank to keep the existing key. Saving runs a brief tool-call test.'
    : 'Add an Anthropic Messages or OpenAI-compatible model. A brief tool-call test must pass before it is saved. Credentials stay in the running application and are never displayed after saving.';
  elements.modelSubmitLabel.textContent = model ? 'Save changes' : 'Use this model';
  elements.modelFormError.hidden = true;
  elements.modelFormError.textContent = '';
  elements.modelProvider.value = model?.provider || 'openai';
  elements.modelName.value = model?.model || '';
  elements.modelApiKey.value = '';
  elements.modelApiKey.required = !model;
  elements.modelApiKey.placeholder = model ? 'Leave blank to keep the current key' : 'Enter the API key';
  elements.modelBaseUrl.value = model?.baseUrl || (elements.modelProvider.value === 'anthropic'
    ? 'https://api.anthropic.com'
    : 'https://api.openai.com/v1');
  elements.modelDialog.showModal();
}

function closeMenus() {
  for (const [trigger, menu] of [
    [elements.modelTrigger, elements.modelMenu],
    [elements.sidebarModelTrigger, elements.sidebarModelMenu],
    [elements.toolsTrigger, elements.toolsMenu]
  ]) {
    menu.hidden = true;
    trigger?.setAttribute('aria-expanded', 'false');
  }
}

function createModelOption(model) {
  const row = document.createElement('div');
  row.className = 'model-option-row';
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `model-option${model.id === runtimeConfig.activeModelId ? ' active' : ''}`;
  button.setAttribute('role', 'menuitemradio');
  button.setAttribute('aria-checked', String(model.id === runtimeConfig.activeModelId));
  const copy = document.createElement('span');
  copy.className = 'model-option-copy';
  const name = document.createElement('span');
  name.className = 'model-option-name';
  name.textContent = model.model;
  const meta = document.createElement('span');
  meta.className = 'model-option-meta';
  meta.textContent = `${model.provider} API${model.isDefault ? ' · default' : ''} · ${model.baseUrl}`;
  copy.append(name, meta);
  if (model.id === runtimeConfig.activeModelId) {
    const check = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    check.classList.add('model-option-check');
    check.setAttribute('viewBox', '0 0 24 24');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', 'm5 12 4 4L19 6');
    check.append(path);
    button.append(copy, check);
  } else {
    button.append(copy);
  }
  button.addEventListener('click', () => selectModel(model.id));
  row.append(button);
  if (!model.isDefault) {
    const actions = document.createElement('span');
    actions.className = 'model-option-actions';
    const edit = document.createElement('button');
    edit.type = 'button';
    edit.className = 'model-option-action';
    edit.title = `Edit ${model.model}`;
    edit.setAttribute('aria-label', edit.title);
    edit.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m4 20 4.5-1 10-10-3.5-3.5-10 10L4 20ZM13.5 7l3.5 3.5"/></svg>';
    edit.addEventListener('click', () => {
      closeMenus();
      openModelDialog(model);
    });
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'model-option-action danger';
    remove.title = `Delete ${model.model}`;
    remove.setAttribute('aria-label', remove.title);
    remove.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5"/></svg>';
    remove.addEventListener('click', () => deleteModel(model));
    actions.append(edit, remove);
    row.append(actions);
  }
  return row;
}

function renderModelMenus() {
  const models = runtimeConfig?.models || [];
  for (const list of [elements.modelList, elements.sidebarModelList]) {
    list.replaceChildren(...models.map(createModelOption));
    if (!models.length) {
      const empty = document.createElement('span');
      empty.className = 'picker-menu-header';
      empty.textContent = 'No model is configured yet';
      list.append(empty);
    }
  }
}

async function selectModel(modelId) {
  closeMenus();
  if (modelId === runtimeConfig?.activeModelId) return;
  hideError();
  try {
    const selected = await requestJson('/api/models/select', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ clientId, modelId })
    });
    configureRuntime({ ...runtimeConfig, ...selected });
  } catch (error) {
    showError(`Model selection failed: ${error.message}`);
  }
}

async function deleteModel(model) {
  closeMenus();
  if (!window.confirm(`Delete the model configuration for ${model.model}?`)) return;
  hideError();
  try {
    const selected = await requestJson(`/api/models/${encodeURIComponent(model.id)}`, {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ clientId })
    });
    configureRuntime({ ...runtimeConfig, ...selected });
  } catch (error) {
    showError(`Model deletion failed: ${error.message}`);
  }
}

function configureRuntime(config) {
  runtimeConfig = config;
  const modelName = config.modelConfigured ? config.model : 'Add a model';
  elements.modelLabel.textContent = modelName;
  elements.sidebarModelLabel.textContent = modelName;
  renderModelMenus();
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
    datasetIsDerived: false,
    messages: [{ role: 'assistant', content: welcomeMessage(imported), synthetic: true }]
  };
  conversations = [conversation, ...conversations];
  activeId = id;
  saveState();
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
  const selectedSuggestion = pendingSuggestion?.conversationId === active.id && pendingSuggestion.prompt === text
    ? { topic: pendingSuggestion.topic, depth: pendingSuggestion.depth }
    : inferSuggestionState(text, active.suggestionState);
  if (selectedSuggestion) active.suggestionState = selectedSuggestion;
  active.suggestionPage = 0;
  pendingSuggestion = null;
  active.messages.push({
    role: 'user',
    content: text,
    file: usedInitialBatch ? { name: active.originalFilename, sizeBytes: active.sizeBytes } : undefined
  });
  saveState();
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
        batchId: usedInitialBatch ? active.batchId : undefined,
        datasetId: active.summary.datasetId,
        datasetIsDerived: active.datasetIsDerived === true,
        storedFilename: active.storedFilename,
        originalFilename: active.originalFilename
      })
    });
    active.batchPending = false;
    if (result.datasetId) active.summary.datasetId = result.datasetId;
    if (typeof result.datasetIsDerived === 'boolean') active.datasetIsDerived = result.datasetIsDerived;
    active.messages.push({ role: 'assistant', content: result.message, trace: result.trace, downloads: result.downloads });
    saveState();
  } catch (error) {
    showError(`Reply failed: ${error.message}`);
  } finally {
    sendingId = null;
    saveState();
    render();
    elements.message.focus();
  }
}

function toggleMenu(menu) {
  const willOpen = menu.hidden;
  closeMenus();
  menu.hidden = !willOpen;
  const trigger = menu === elements.modelMenu
    ? elements.modelTrigger
    : menu === elements.sidebarModelMenu ? elements.sidebarModelTrigger : elements.toolsTrigger;
  trigger?.setAttribute('aria-expanded', String(willOpen));
}

elements.importButton.addEventListener('click', () => elements.fileInput.click());
elements.dropzone.addEventListener('click', () => elements.fileInput.click());
elements.fileInput.addEventListener('change', () => importFiles(elements.fileInput.files));
elements.dismissError.addEventListener('click', hideError);
elements.viewerOpen.addEventListener('click', showViewer);
elements.viewerClose.addEventListener('click', hideViewer);
elements.viewerFit.addEventListener('click', () => viewer?.fit());
elements.viewerSemantics.addEventListener('click', () => {
  const enabled = elements.viewerSemantics.getAttribute('aria-checked') !== 'true';
  elements.viewerSemantics.setAttribute('aria-checked', String(enabled));
  elements.viewerModeHint.textContent = enabled
    ? 'Surface mode · click to select a semantic surface'
    : 'Object mode · click to select an object';
  viewer?.setSelectionMode(enabled ? 'surface' : 'object');
});
elements.viewerInspectorClose.addEventListener('click', () => viewer?.clearSelection());

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
  toggleMenu(elements.modelMenu);
});
elements.sidebarModelTrigger.addEventListener('click', event => {
  event.stopPropagation();
  toggleMenu(elements.sidebarModelMenu);
});
for (const addButton of [elements.addModel, elements.sidebarAddModel]) {
  addButton.addEventListener('click', event => {
    event.stopPropagation();
    closeMenus();
    openModelDialog();
  });
}
elements.toolsTrigger.addEventListener('click', event => {
  event.stopPropagation();
  toggleMenu(elements.toolsMenu);
});
document.addEventListener('click', closeMenus);
for (const menu of [elements.modelMenu, elements.sidebarModelMenu, elements.toolsMenu]) {
  menu.addEventListener('click', event => event.stopPropagation());
}

elements.modelDialogClose.addEventListener('click', () => elements.modelDialog.close());
elements.modelCancel.addEventListener('click', () => elements.modelDialog.close());
elements.modelDialog.addEventListener('close', () => {
  editingModelId = null;
  elements.modelApiKey.value = '';
});
elements.toolDialogClose.addEventListener('click', () => elements.toolDialog.close());
elements.aboutButton.addEventListener('click', () => elements.aboutDialog.showModal());
elements.aboutDialogClose.addEventListener('click', () => elements.aboutDialog.close());
for (const dialog of [elements.modelDialog, elements.toolDialog, elements.aboutDialog]) {
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
  const wasEditing = Boolean(editingModelId);
  submit.disabled = true;
  elements.modelSubmitLabel.textContent = wasEditing ? 'Testing changes…' : 'Testing model…';
  elements.modelFormError.hidden = true;
  hideError();
  try {
    const endpoint = editingModelId ? `/api/models/${encodeURIComponent(editingModelId)}` : '/api/models';
    const selected = await requestJson(endpoint, {
      method: editingModelId ? 'PUT' : 'POST',
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
    editingModelId = null;
    elements.modelDialog.close();
    render();
  } catch (error) {
    elements.modelFormError.textContent = `Model configuration rejected: ${error.message}`;
    elements.modelFormError.hidden = false;
  } finally {
    submit.disabled = false;
    elements.modelSubmitLabel.textContent = wasEditing ? 'Save changes' : 'Use this model';
  }
});

elements.promptSuggestions.addEventListener('click', event => {
  const more = event.target.closest('[data-suggestion-more]');
  if (more) {
    const active = activeConversation();
    if (!active) return;
    active.suggestionPage = (Number(active.suggestionPage) || 0) + 1;
    saveState();
    renderActiveConversation();
    return;
  }
  const button = event.target.closest('[data-prompt]');
  if (!button) return;
  pendingSuggestion = {
    conversationId: activeId,
    prompt: button.dataset.prompt,
    topic: button.dataset.topic,
    depth: Number(button.dataset.depth)
  };
  elements.message.value = button.dataset.prompt;
  elements.message.dispatchEvent(new Event('input'));
  elements.message.focus();
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

restoreState();
requestJson(`/api/config?clientId=${encodeURIComponent(clientId)}`)
  .then(config => {
    configureRuntime(config);
    if (!config.modelConfigured) openModelDialog();
  })
  .catch(error => showError(`Configuration failed: ${error.message}`));
render();
