// OpenRouter API adapter supporting 6 model providers
// ChatGPT, Claude, Gemini, DeepSeek, Qwen, Kimi

const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1/chat/completions';

// Model mapping for the 6 supported providers
export const MODEL_PROVIDERS = {
  chatgpt: {
    name: 'ChatGPT',
    models: [
      { id: 'openai/gpt-4o', label: 'GPT-4o' },
      { id: 'openai/gpt-4o-mini', label: 'GPT-4o Mini' },
    ],
  },
  claude: {
    name: 'Claude',
    models: [
      { id: 'anthropic/claude-sonnet-4', label: 'Claude Sonnet 4' },
      { id: 'anthropic/claude-haiku-4', label: 'Claude Haiku 4' },
    ],
  },
  gemini: {
    name: 'Gemini',
    models: [
      { id: 'google/gemini-2.5-flash-preview', label: 'Gemini 2.5 Flash' },
      { id: 'google/gemini-2.5-pro-preview', label: 'Gemini 2.5 Pro' },
    ],
  },
  deepseek: {
    name: 'DeepSeek',
    models: [
      { id: 'deepseek/deepseek-chat-v3-0324', label: 'DeepSeek V3' },
      { id: 'deepseek/deepseek-r1', label: 'DeepSeek R1' },
    ],
  },
  qwen: {
    name: 'Qwen',
    models: [
      { id: 'qwen/qwen-2.5-72b-instruct', label: 'Qwen 2.5 72B' },
      { id: 'qwen/qwen-turbo', label: 'Qwen Turbo' },
    ],
  },
  kimi: {
    name: 'Kimi',
    models: [
      { id: 'moonshotai/moonshot-v1-8k', label: 'Moonshot V1 8K' },
      { id: 'moonshotai/moonshot-v1-32k', label: 'Moonshot V1 32K' },
    ],
  },
};

export function getAllModels() {
  const models = [];
  for (const [provider, info] of Object.entries(MODEL_PROVIDERS)) {
    for (const model of info.models) {
      models.push({ provider, providerName: info.name, ...model });
    }
  }
  return models;
}

// Build whitelist set of valid model IDs
const VALID_MODEL_IDS = new Set(getAllModels().map(m => m.id));

export function isValidModel(modelId) {
  return VALID_MODEL_IDS.has(modelId);
}

export function validateApiKey() {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey || apiKey === 'your_openrouter_api_key_here') {
    return 'OPENROUTER_API_KEY is not configured. Please set it in .env file.';
  }
  // OpenRouter keys start with "sk-or-" and are at least 20 chars
  if (!apiKey.startsWith('sk-or-') || apiKey.length < 20) {
    return 'OPENROUTER_API_KEY format is invalid. Keys should start with "sk-or-".';
  }
  return null;
}

export async function callOpenRouter(modelId, messages, options = {}) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error('OPENROUTER_API_KEY not configured');

  const response = await fetch(OPENROUTER_BASE_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
      'HTTP-Referer': 'https://undercover-game.local',
      'X-Title': 'Undercover Game',
    },
    body: JSON.stringify({
      model: modelId,
      messages,
      max_tokens: options.maxTokens || 256,
      temperature: options.temperature || 0.7,
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`OpenRouter API error (${response.status}): ${err}`);
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content || '';
}
