const SYSTEM_PROMPT = `You are a CityJSON specialist operating the CityJSON Toolbox through MCP tools.
Attachments are uploaded and imported by the chat host before you see the message. Their filenames, dataset IDs, and summaries are included in the user message. Use those dataset IDs directly; do not ask for file paths and do not call a text upload tool for an attachment.
Use MCP tools whenever the request depends on a dataset. Prefer compact inspection and query tools instead of downloading complete models into context. Explain tool errors plainly and never invent a successful transformation.`;

function apiUrl(baseUrl, pathname) {
  return `${baseUrl.replace(/\/$/, '')}${pathname}`;
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

function parseArguments(value) {
  try { return JSON.parse(value || '{}'); }
  catch (error) { throw new Error(`Model returned invalid tool arguments: ${error.message}`); }
}

async function invokeTools(calls, callTool) {
  const results = [];
  for (const call of calls) {
    const startedAt = Date.now();
    try {
      const result = await callTool(call.name, call.arguments);
      results.push({ ...call, ...result, durationMs: Date.now() - startedAt });
    } catch (error) {
      results.push({ ...call, isError: true, modelContent: JSON.stringify({ error: error.message }), durationMs: Date.now() - startedAt });
    }
  }
  return results;
}

class AnthropicModelClient {
  constructor(config, fetchImpl) {
    this.config = config;
    this.fetch = fetchImpl;
  }

  async runTurn(history, message, tools, callTool) {
    const messages = [...history, { role: 'user', content: message }];
    const trace = [];

    for (let round = 0; round < this.config.maxToolRounds; round += 1) {
      const response = await fetchJson(this.fetch, apiUrl(this.config.baseUrl, '/v1/messages'), {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': this.config.apiKey,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: this.config.model,
          max_tokens: this.config.maxOutputTokens,
          system: SYSTEM_PROMPT,
          messages,
          tools
        })
      });
      const content = Array.isArray(response.content) ? response.content : [];
      messages.push({ role: 'assistant', content });
      const calls = content.filter(item => item.type === 'tool_use').map(item => ({
        id: item.id,
        name: item.name,
        arguments: item.input || {}
      }));

      if (calls.length === 0) {
        const text = content.filter(item => item.type === 'text').map(item => item.text).join('\n').trim();
        return { text: text || 'The model returned no text response.', history: messages, trace };
      }

      const results = await invokeTools(calls, callTool);
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

  async runTurn(history, message, tools, callTool) {
    const messages = [...history, { role: 'user', content: message }];
    const trace = [];

    for (let round = 0; round < this.config.maxToolRounds; round += 1) {
      const response = await fetchJson(this.fetch, apiUrl(this.config.baseUrl, '/chat/completions'), {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.config.apiKey}`
        },
        body: JSON.stringify({
          model: this.config.model,
          messages: [{ role: 'system', content: SYSTEM_PROMPT }, ...messages],
          tools,
          tool_choice: 'auto',
          max_tokens: this.config.maxOutputTokens,
          stream: false
        })
      });
      const modelMessage = response.choices?.[0]?.message;
      if (!modelMessage) throw new Error('Model API response did not contain choices[0].message');
      const assistantMessage = {
        role: 'assistant',
        content: modelMessage.content ?? null
      };
      if (Array.isArray(modelMessage.tool_calls)) assistantMessage.tool_calls = modelMessage.tool_calls;
      if (typeof modelMessage.reasoning_content === 'string') assistantMessage.reasoning_content = modelMessage.reasoning_content;
      messages.push(assistantMessage);

      const calls = (modelMessage.tool_calls || []).map(item => ({
        id: item.id,
        name: item.function?.name,
        arguments: parseArguments(item.function?.arguments)
      }));
      if (calls.length === 0) {
        const text = typeof modelMessage.content === 'string' ? modelMessage.content.trim() : '';
        return { text: text || 'The model returned no text response.', history: messages, trace };
      }
      if (calls.some(call => !call.id || !call.name)) throw new Error('Model returned an incomplete tool call');

      const results = await invokeTools(calls, callTool);
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

export { SYSTEM_PROMPT };
