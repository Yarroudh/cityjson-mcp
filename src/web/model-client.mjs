const SYSTEM_PROMPT = `You are a CityJSON specialist operating the CityJSON Toolbox through MCP tools.
Attachments are uploaded and imported by the chat host before you see the message. Their filenames, dataset IDs, and summaries are included in the user message. Use those dataset IDs directly; do not ask for file paths and do not call a text upload tool for an attachment.
When an active conversation dataset is provided, it is the exact model the user is discussing. Use that dataset ID for all dataset operations. Never list the input inbox, ask which file they mean, or import another file unless the user explicitly asks to switch datasets.
Validation results include a compact reportSummary. When the user refers to invalid geometries or asks for a subset of them, use the complete geometry.reportSummary.invalidObjectIds list. Never infer the set from prose, a partial list, or a tool result marked as truncated; rerun validation if the complete summary is not present in context.
Use MCP tools whenever the request depends on a dataset. Prefer compact inspection and query tools instead of downloading complete models into context. Explain tool errors plainly and never invent a successful transformation.
After tools finish, always provide a textual answer that directly explains their results. Never end a turn with only tool calls or an empty response.
When the user asks to download, receive, or save a dataset locally, finish the requested transformation and then call cityjson_download on the resulting dataset in the same turn. Never stop at merely reporting a dataset_id when a downloadable file was requested.
For subset requests, call cityjson_subset with the complete requested ID list before calling cityjson_download. Never claim that a subset was created if cityjson_subset was not successfully executed.
Use concise, professional language. Never use emojis or emoticons.`;

const CONNECTION_TEST_TOOL_NAME = 'datum_connection_test';
const MAX_TEXT_CONTINUATIONS = 8;
const MAX_EMPTY_RESPONSE_RETRIES = 2;
const CONTINUATION_PROMPT = 'Continue the answer exactly from where it was cut off. Do not repeat any heading, sentence, or text already written. Return only the continuation and do not call tools.';
const FINAL_RESPONSE_PROMPT = 'Provide the final answer now. Explain the important findings clearly and do not call any more tools.';
const CONNECTION_TEST_PARAMETERS = {
  type: 'object',
  properties: { status: { type: 'string', enum: ['ok'] } },
  required: ['status'],
  additionalProperties: false
};

function apiUrl(baseUrl, pathname) {
  return `${baseUrl.replace(/\/$/, '')}${pathname}`;
}

function ollamaApiUrl(baseUrl, pathname) {
  return `${baseUrl.replace(/\/$/, '').replace(/\/v1$/, '')}${pathname}`;
}

async function fetchJson(fetchImpl, url, options) {
  const response = await fetchImpl(url, options);
  const text = await response.text();
  let body;
  try { body = text ? JSON.parse(text) : {}; }
  catch { body = { raw: text }; }
  if (!response.ok) {
    const message = body?.error?.message || body?.message || text || response.statusText;
    throw new Error(`Model API returned ${response.status}: ${message}`);
  }
  return body;
}

async function fetchEventStream(fetchImpl, url, options, onData) {
  const response = await fetchImpl(url, options);
  if (!response.ok) {
    const text = await response.text();
    let body;
    try { body = text ? JSON.parse(text) : {}; }
    catch { body = { raw: text }; }
    const message = body?.error?.message || body?.message || text || response.statusText;
    throw new Error(`Model API returned ${response.status}: ${message}`);
  }
  if (!response.body) throw new Error('Model API returned a streaming response without a body');

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const consume = block => {
    const data = block.split(/\r?\n/)
      .filter(line => line.startsWith('data:'))
      .map(line => line.slice(5).trimStart())
      .join('\n');
    if (!data || data === '[DONE]') return data === '[DONE]';
    const event = JSON.parse(data);
    if (event?.error) throw new Error(`Model API stream failed: ${event.error.message || event.error.type || 'Unknown error'}`);
    onData(event);
    return false;
  };

  try {
    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
      const blocks = buffer.split(/\r?\n\r?\n/);
      buffer = blocks.pop() || '';
      for (const block of blocks) if (consume(block)) return;
      if (done) {
        if (buffer.trim()) consume(buffer);
        return;
      }
    }
  } finally {
    reader.releaseLock();
  }
}

async function fetchOpenAIStream(fetchImpl, url, options, onEvent) {
  const message = { role: 'assistant', content: '' };
  const toolCalls = new Map();
  let finishReason = null;
  await fetchEventStream(fetchImpl, url, options, event => {
    const choice = event.choices?.[0];
    if (!choice) return;
    finishReason = choice.finish_reason ?? finishReason;
    const delta = choice.delta || {};
    if (typeof delta.content === 'string') {
      message.content += delta.content;
      onEvent({ type: 'text_delta', text: delta.content });
    }
    if (typeof delta.reasoning_content === 'string') {
      message.reasoning_content = `${message.reasoning_content || ''}${delta.reasoning_content}`;
    }
    for (const fragment of delta.tool_calls || []) {
      const index = Number.isSafeInteger(fragment.index) ? fragment.index : toolCalls.size;
      const call = toolCalls.get(index) || { id: '', type: 'function', function: { name: '', arguments: '' } };
      if (fragment.id) call.id += fragment.id;
      if (fragment.type) call.type = fragment.type;
      if (fragment.function?.name) call.function.name += fragment.function.name;
      if (fragment.function?.arguments) call.function.arguments += fragment.function.arguments;
      toolCalls.set(index, call);
    }
  });
  if (toolCalls.size) message.tool_calls = [...toolCalls.entries()].sort(([a], [b]) => a - b).map(([, call]) => call);
  if (!message.content) message.content = null;
  return { choices: [{ message, finish_reason: finishReason }] };
}

async function fetchAnthropicStream(fetchImpl, url, options, onEvent) {
  const content = [];
  let stopReason = null;
  await fetchEventStream(fetchImpl, url, options, event => {
    if (event.type === 'content_block_start') {
      const block = event.content_block || {};
      content[event.index] = block.type === 'tool_use'
        ? { type: 'tool_use', id: block.id, name: block.name, input: block.input || {}, _input: '' }
        : { type: 'text', text: block.text || '' };
      if (block.type === 'text' && block.text) onEvent({ type: 'text_delta', text: block.text });
      return;
    }
    if (event.type === 'content_block_delta') {
      const block = content[event.index];
      if (!block) return;
      if (event.delta?.type === 'text_delta') {
        block.text += event.delta.text || '';
        if (event.delta.text) onEvent({ type: 'text_delta', text: event.delta.text });
      } else if (event.delta?.type === 'input_json_delta') {
        block._input += event.delta.partial_json || '';
      }
      return;
    }
    if (event.type === 'message_delta') stopReason = event.delta?.stop_reason ?? stopReason;
  });
  for (const block of content) {
    if (block?.type !== 'tool_use') continue;
    if (block._input) block.input = parseArguments(block._input);
    delete block._input;
  }
  return { content: content.filter(Boolean), stop_reason: stopReason };
}

function parseArguments(value) {
  try { return JSON.parse(value || '{}'); }
  catch (error) { throw new Error(`Model returned invalid tool arguments: ${error.message}`); }
}

function cleanModelText(value) {
  return String(value || '')
    .replace(/[\p{Extended_Pictographic}\p{Regional_Indicator}\uFE0F\u200D]/gu, '')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

async function invokeTools(calls, callTool, { signal, onEvent } = {}) {
  const results = [];
  for (const call of calls) {
    signal?.throwIfAborted();
    const startedAt = Date.now();
    onEvent?.({ type: 'tool_start', id: call.id, name: call.name });
    try {
      const result = await callTool(call.name, call.arguments, {
        signal,
        onProgress: progress => onEvent?.({ type: 'tool_progress', id: call.id, name: call.name, ...progress })
      });
      const completed = { ...call, ...result, durationMs: Date.now() - startedAt };
      results.push(completed);
      onEvent?.({ type: 'tool_end', id: call.id, name: call.name, durationMs: completed.durationMs, isError: completed.isError === true });
    } catch (error) {
      if (signal?.aborted || error?.name === 'AbortError') throw error;
      const completed = { ...call, isError: true, modelContent: JSON.stringify({ error: error.message }), durationMs: Date.now() - startedAt };
      results.push(completed);
      onEvent?.({ type: 'tool_end', id: call.id, name: call.name, durationMs: completed.durationMs, isError: true });
    }
  }
  return results;
}

class AnthropicModelClient {
  constructor(config, fetchImpl) {
    this.config = config;
    this.fetch = fetchImpl;
  }

  async testConnection() {
    const response = await fetchJson(this.fetch, apiUrl(this.config.baseUrl, '/v1/messages'), {
      method: 'POST',
      signal: AbortSignal.timeout(30_000),
      headers: {
        'content-type': 'application/json',
        'x-api-key': this.config.apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: this.config.model,
        max_tokens: Math.min(this.config.maxOutputTokens, 64),
        temperature: this.config.temperature ?? 0.1,
        messages: [{ role: 'user', content: `Call ${CONNECTION_TEST_TOOL_NAME} with status set to ok.` }],
        tools: [{
          name: CONNECTION_TEST_TOOL_NAME,
          description: 'Confirm that this model configuration supports tool calls.',
          input_schema: CONNECTION_TEST_PARAMETERS
        }],
        tool_choice: { type: 'tool', name: CONNECTION_TEST_TOOL_NAME }
      })
    });
    const accepted = response.content?.some(item => item.type === 'tool_use' && item.name === CONNECTION_TEST_TOOL_NAME);
    if (!accepted) throw new Error('The model responded, but it did not complete the required tool-call test');
  }

  async runTurn(history, message, tools, callTool, { signal, onEvent } = {}) {
    const messages = [...history, { role: 'user', content: message }];
    const trace = [];
    const textParts = [];
    let textContinuations = 0;
    let requireTextResponse = false;
    let toolRounds = 0;

    for (let round = 0; round < this.config.maxToolRounds + MAX_TEXT_CONTINUATIONS; round += 1) {
      signal?.throwIfAborted();
      const request = {
        method: 'POST',
        signal,
        headers: {
          'content-type': 'application/json',
          'x-api-key': this.config.apiKey,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: this.config.model,
          max_tokens: this.config.maxOutputTokens,
          temperature: this.config.temperature ?? 0.1,
          system: SYSTEM_PROMPT,
          messages,
          ...(requireTextResponse ? {} : { tools }),
          ...(onEvent ? { stream: true } : {})
        })
      };
      const response = onEvent
        ? await fetchAnthropicStream(this.fetch, apiUrl(this.config.baseUrl, '/v1/messages'), request, onEvent)
        : await fetchJson(this.fetch, apiUrl(this.config.baseUrl, '/v1/messages'), request);
      const content = Array.isArray(response.content) ? response.content : [];
      messages.push({ role: 'assistant', content });
      const calls = content.filter(item => item.type === 'tool_use').map(item => ({
        id: item.id,
        name: item.name,
        arguments: item.input || {}
      }));

      if (calls.length === 0) {
        const rawText = content.filter(item => item.type === 'text').map(item => item.text).join('\n');
        if (rawText) textParts.push(rawText);
        if (response.stop_reason === 'max_tokens') {
          if (textContinuations >= MAX_TEXT_CONTINUATIONS) throw new Error('Model answer remained truncated after repeated continuation attempts');
          messages.push({ role: 'user', content: CONTINUATION_PROMPT });
          textContinuations += 1;
          requireTextResponse = true;
          continue;
        }
        const text = cleanModelText(textParts.join(''));
        return { text: text || 'The model returned no text response.', history: messages, trace };
      }
      if (toolRounds >= this.config.maxToolRounds) throw new Error(`Model exceeded the ${this.config.maxToolRounds}-round tool-call limit`);
      toolRounds += 1;

      const results = await invokeTools(calls, callTool, { signal, onEvent });
      trace.push(...results.map(result => ({ name: result.name, durationMs: result.durationMs, isError: result.isError === true })));
      messages.push({
        role: 'user',
        content: results.map(result => ({
          type: 'tool_result',
          tool_use_id: result.id,
          content: result.modelContent,
          is_error: result.isError === true
        }))
      });
    }
    throw new Error(`Model exceeded the ${this.config.maxToolRounds}-round tool-call limit`);
  }
}

class OpenAIModelClient {
  constructor(config, fetchImpl) {
    this.config = config;
    this.fetch = fetchImpl;
  }

  async testConnection() {
    if (this.config.service === 'ollama') {
      const response = await fetchJson(this.fetch, ollamaApiUrl(this.config.baseUrl, '/api/show'), {
        method: 'POST',
        signal: AbortSignal.timeout(30_000),
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: this.config.model })
      });
      if (!response.capabilities?.includes('tools')) {
        throw new Error('The selected Ollama model does not advertise tool-calling support');
      }
      return;
    }
    const response = await fetchJson(this.fetch, apiUrl(this.config.baseUrl, '/chat/completions'), {
      method: 'POST',
      signal: AbortSignal.timeout(30_000),
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${this.config.apiKey}`
      },
      body: JSON.stringify({
        model: this.config.model,
        messages: [{ role: 'user', content: `Call ${CONNECTION_TEST_TOOL_NAME} with status set to ok.` }],
        tools: [{
          type: 'function',
          function: {
            name: CONNECTION_TEST_TOOL_NAME,
            description: 'Confirm that this model configuration supports tool calls.',
            parameters: CONNECTION_TEST_PARAMETERS
          }
        }],
        tool_choice: 'auto',
        max_tokens: Math.min(this.config.maxOutputTokens, 64),
        temperature: this.config.temperature ?? 0.1,
        stream: false
      })
    });
    const calls = response.choices?.[0]?.message?.tool_calls;
    const accepted = calls?.some(item => item.type === 'function' && item.function?.name === CONNECTION_TEST_TOOL_NAME);
    if (!accepted) throw new Error('The model responded, but it did not complete the required tool-call test');
  }

  async runTurn(history, message, tools, callTool, { signal, onEvent } = {}) {
    const messages = [...history, { role: 'user', content: message }];
    const trace = [];
    const textParts = [];
    let textContinuations = 0;
    let emptyResponseRetries = 0;
    let requireTextResponse = false;
    let toolRounds = 0;

    for (let round = 0; round < this.config.maxToolRounds + MAX_TEXT_CONTINUATIONS + MAX_EMPTY_RESPONSE_RETRIES; round += 1) {
      signal?.throwIfAborted();
      const request = {
        method: 'POST',
        signal,
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.config.apiKey}`
        },
        body: JSON.stringify({
          model: this.config.model,
          messages: [{ role: 'system', content: SYSTEM_PROMPT }, ...messages],
          tools,
          tool_choice: requireTextResponse ? 'none' : 'auto',
          max_tokens: this.config.maxOutputTokens,
          temperature: this.config.temperature ?? 0.1,
          stream: Boolean(onEvent)
        })
      };
      const response = onEvent
        ? await fetchOpenAIStream(this.fetch, apiUrl(this.config.baseUrl, '/chat/completions'), request, onEvent)
        : await fetchJson(this.fetch, apiUrl(this.config.baseUrl, '/chat/completions'), request);
      const choice = response.choices?.[0];
      const modelMessage = choice?.message;
      if (!modelMessage) throw new Error('Model API response did not contain choices[0].message');
      const assistantMessage = {
        role: 'assistant',
        content: modelMessage.content ?? null
      };
      if (Array.isArray(modelMessage.tool_calls)) assistantMessage.tool_calls = modelMessage.tool_calls;
      if (typeof modelMessage.reasoning_content === 'string') assistantMessage.reasoning_content = modelMessage.reasoning_content;

      const calls = (modelMessage.tool_calls || []).map(item => ({
        id: item.id,
        name: item.function?.name,
        arguments: parseArguments(item.function?.arguments)
      }));
      if (calls.length === 0) {
        const rawText = typeof modelMessage.content === 'string' ? modelMessage.content : '';
        if (rawText) {
          messages.push(assistantMessage);
          textParts.push(rawText);
        }
        if (rawText && ['length', 'max_tokens'].includes(choice.finish_reason)) {
          if (textContinuations >= MAX_TEXT_CONTINUATIONS) throw new Error('Model answer remained truncated after repeated continuation attempts');
          messages.push({ role: 'user', content: CONTINUATION_PROMPT });
          textContinuations += 1;
          requireTextResponse = true;
          continue;
        }
        const text = cleanModelText(textParts.join(''));
        if (text) return { text, history: messages, trace };
        if (emptyResponseRetries < MAX_EMPTY_RESPONSE_RETRIES) {
          messages.push({
            role: 'user',
            content: trace.length > 0
              ? `Using the tool results above, ${FINAL_RESPONSE_PROMPT}`
              : FINAL_RESPONSE_PROMPT
          });
          emptyResponseRetries += 1;
          requireTextResponse = true;
          continue;
        }
        return { text: 'The model returned no text response.', history: messages, trace };
      }
      if (calls.some(call => !call.id || !call.name)) throw new Error('Model returned an incomplete tool call');
      messages.push(assistantMessage);
      if (toolRounds >= this.config.maxToolRounds) throw new Error(`Model exceeded the ${this.config.maxToolRounds}-round tool-call limit`);
      toolRounds += 1;

      const results = await invokeTools(calls, callTool, { signal, onEvent });
      trace.push(...results.map(result => ({ name: result.name, durationMs: result.durationMs, isError: result.isError === true })));
      messages.push(...results.map(result => ({
        role: 'tool',
        tool_call_id: result.id,
        content: result.modelContent
      })));
    }
    throw new Error(`Model exceeded the ${this.config.maxToolRounds}-round tool-call limit`);
  }
}

export function createModelClient(config, fetchImpl = fetch) {
  return config.provider === 'anthropic'
    ? new AnthropicModelClient(config, fetchImpl)
    : new OpenAIModelClient(config, fetchImpl);
}

export { SYSTEM_PROMPT, cleanModelText };
