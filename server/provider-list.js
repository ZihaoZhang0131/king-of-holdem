/**
 * 模型厂商注册表（纯数据，设置校验和运行时共用）。
 * - kind: anthropic 走官方 SDK（原生 Messages API）；openai 走 OpenAI Chat Completions 兼容接口（llm.js）
 * - env: API Key 在 .env 里的变量名；Key 只存 .env，从不发给浏览器
 * - baseURL: 默认接口地址，可在页面「模型」页签里覆盖（存进 config.json 的 providers.<id>.baseURL）
 * - presets: 拉不到模型列表时的备选；平时以厂商接口实时返回为准
 */

export const PROVIDERS = [
  { id: 'anthropic', name: 'Anthropic', sub: 'Claude', kind: 'anthropic', env: 'ANTHROPIC_API_KEY', baseURL: '',
    presets: ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5', 'claude-fable-5-1'] },
  { id: 'openai', name: 'OpenAI', sub: 'GPT', kind: 'openai', env: 'OPENAI_API_KEY', baseURL: 'https://api.openai.com/v1', presets: [] },
  { id: 'gemini', name: 'Google Gemini', sub: 'OpenAI 兼容端点', kind: 'openai', env: 'GEMINI_API_KEY', baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai', presets: [] },
  { id: 'zhipu', name: '智谱', sub: 'GLM', kind: 'openai', env: 'ZHIPU_API_KEY', baseURL: 'https://open.bigmodel.cn/api/paas/v4', presets: [] },
  { id: 'moonshot', name: 'Kimi', sub: '月之暗面', kind: 'openai', env: 'MOONSHOT_API_KEY', baseURL: 'https://api.moonshot.cn/v1', presets: [] },
  { id: 'deepseek', name: 'DeepSeek', sub: '深度求索', kind: 'openai', env: 'DEEPSEEK_API_KEY', baseURL: 'https://api.deepseek.com/v1', presets: ['deepseek-chat', 'deepseek-reasoner'] },
  // 老配置的统一网关（Token Station 等）：Base URL 默认取 .env 的 LLM_BASE_URL
  { id: 'custom', name: '自定义网关', sub: 'OpenAI 兼容', kind: 'openai', env: 'LLM_API_KEY', baseEnv: 'LLM_BASE_URL', baseURL: '', presets: [] },
];

export const PROVIDER_IDS = PROVIDERS.map((p) => p.id);
export const DEFAULT_PROVIDER = 'custom'; // 没写 provider 的座位（老配置）走统一网关
export const providerOf = (id) => PROVIDERS.find((p) => p.id === id);
