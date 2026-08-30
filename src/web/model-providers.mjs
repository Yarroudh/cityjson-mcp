export const MODEL_PROVIDERS = Object.freeze({
  ollama: Object.freeze({
    apiStyle: 'openai',
    defaultBaseUrl: 'http://127.0.0.1:11434/v1',
    requiresApiKey: false
  }),
  openrouter: Object.freeze({
    apiStyle: 'openai',
    defaultBaseUrl: 'https://openrouter.ai/api/v1',
    apiKeyEnvironmentVariables: ['OPENROUTER_API_KEY'],
    supportsDiscovery: true
  }),
  openai: Object.freeze({
    apiStyle: 'openai',
    defaultBaseUrl: 'https://api.openai.com/v1',
    apiKeyEnvironmentVariables: ['OPENAI_API_KEY']
  }),
  anthropic: Object.freeze({
    apiStyle: 'anthropic',
    defaultBaseUrl: 'https://api.anthropic.com',
    apiKeyEnvironmentVariables: ['ANTHROPIC_API_KEY']
  })
});

export const MODEL_PROVIDER_NAMES = Object.freeze(Object.keys(MODEL_PROVIDERS));

export function modelProvider(name) {
  return MODEL_PROVIDERS[String(name || '').trim().toLowerCase()] || null;
}

export function providerApiKey(env, service) {
  const definition = modelProvider(service);
  for (const name of definition?.apiKeyEnvironmentVariables || []) {
    if (env[name]) return env[name];
  }
  return definition?.requiresApiKey === false ? service : null;
}
