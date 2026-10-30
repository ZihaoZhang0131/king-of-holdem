import Anthropic from '@anthropic-ai/sdk';
import { LLMError } from './llm.js';

/**
 * Anthropic（Claude）适配器：官方 SDK，原生 Messages API。
 * 对外和 llm.js 的 chatComplete 同形：complete(...) → { text, usage }，失败抛 LLMError（超时带 timeout 标记）。
 * - agent 给的是 OpenAI 风格的 [system, user, assistant, user…]，这里拆成 system + messages
 * - 不发 temperature（采样参数已被 API 拒绝）、不发 thinking（当前模型默认自适应思考），用 effort 控制思考深度
 * - JSON 模式 → 结构化输出：模型只能按决策 schema 输出
 * - 先看 stop_reason 是否 refusal 再读内容；支持的模型默认开启服务端兜底（被拒时由 API 换模型重跑）
 */

// 决策 JSON：结构化输出要求每个字段都在 required 里；不需要的 amount 填 0、notes 填空串，validate() 会忽略
export const DECISION_SCHEMA = {
  type: 'object',
  properties: {
    action: { type: 'string', enum: ['fold', 'check', 'call', 'bet', 'raise', 'all_in'] },
    amount: { type: 'integer' },
    thought: { type: 'string' },
    notes: { type: 'string' },
  },
  required: ['action', 'amount', 'thought', 'notes'],
  additionalProperties: false,
};

// 服务端兜底（fallbacks: "default"）只在这些模型上可用
const FALLBACK_MODELS = new Set(['claude-fable-5-1', 'claude-opus-5-5', 'claude-opus-5', 'claude-sonnet-5-5']);
const MIN_MAX_TOKENS = 16000; // 思考也计入 max_tokens，太小会在输出 JSON 前被截断

/** OpenAI 风格消息 → { system, messages } */
export function toAnthropicMessages(messages) {
  const system = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');
  return { system, messages: messages.filter((m) => m.role !== 'system').map(({ role, content }) => ({ role, content })) };
}

/** 构造请求体（纯函数，便于自检） */
export function buildRequest({ model, messages, maxTokens = MIN_MAX_TOKENS, effort, jsonMode = false }) {
  const { system, messages: msgs } = toAnthropicMessages(messages);
  const output = { ...(effort ? { effort } : {}), ...(jsonMode ? { format: { type: 'json_schema', schema: DECISION_SCHEMA } } : {}) };
  return {
    model,
    max_tokens: Math.max(MIN_MAX_TOKENS, maxTokens),
    ...(system ? { system } : {}),
    messages: msgs,
    ...(Object.keys(output).length ? { output_config: output } : {}),
    ...(FALLBACK_MODELS.has(model) ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' } : {}),
  };
}

// 重试由 agent.js 统一负责，SDK 自身不重试
const client = ({ apiKey, baseURL, timeoutMs }) => new Anthropic({ apiKey, ...(baseURL ? { baseURL } : {}), timeout: timeoutMs, maxRetries: 0 });

function toLLMError(e, timeoutMs) {
  if (e instanceof LLMError) return e;
  if (e instanceof Anthropic.APIConnectionTimeoutError || e instanceof Anthropic.APIUserAbortError) return new LLMError(`请求超时（${timeoutMs}ms）`, { timeout: true });
  if (e instanceof Anthropic.AuthenticationError) return new LLMError('API Key 无效（401）', { status: 401 });
  if (e instanceof Anthropic.PermissionDeniedError) return new LLMError(`没有权限（403）：${e.message}`, { status: 403 });
  if (e instanceof Anthropic.NotFoundError) return new LLMError(`模型不存在或无权访问（404）：${e.message}`, { status: 404 });
  if (e instanceof Anthropic.RateLimitError) return new LLMError('请求过于频繁或额度不足（429）', { status: 429 });
  if (e instanceof Anthropic.APIConnectionError) return new LLMError(`网络错误：${e.message}`);
  if (e instanceof Anthropic.APIError) return new LLMError(`HTTP ${e.status ?? '?'}: ${String(e.message).slice(0, 300)}`, { status: e.status ?? 0 });
  return new LLMError(`请求失败：${e.message}`);
}

export async function complete({ apiKey, baseURL, model, messages, maxTokens, effort, jsonMode, timeoutMs = 45000 }) {
  try {
    const res = await client({ apiKey, baseURL, timeoutMs }).beta.messages.create(buildRequest({ model, messages, maxTokens, effort, jsonMode }));
    if (res.stop_reason === 'refusal') throw new LLMError(`模型拒绝回答（${res.stop_details?.category ?? '未说明原因'}）`);
    const text = res.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
    return { text, usage: res.usage ?? null };
  } catch (e) {
    throw toLLMError(e, timeoutMs);
  }
}

/** 模型列表（不花 token）：顺带验证 Key 是否有效 */
export async function listModels({ apiKey, baseURL, timeoutMs = 15000 }) {
  try {
    const ids = [];
    for await (const m of client({ apiKey, baseURL, timeoutMs }).models.list({ limit: 100 })) {
      ids.push(m.id);
      if (ids.length >= 200) break;
    }
    return ids;
  } catch (e) {
    throw toLLMError(e, timeoutMs);
  }
}

/** 模型可用性：先查模型是否存在（免费），再发一次极小的请求 */
export async function testModel({ apiKey, baseURL, model, timeoutMs = 30000 }) {
  const c = client({ apiKey, baseURL, timeoutMs });
  try {
    await c.models.retrieve(model);
    const res = await c.messages.create({ model, max_tokens: 1024, output_config: { effort: 'low' }, messages: [{ role: 'user', content: '只回复 OK' }] });
    if (res.stop_reason === 'refusal') throw new LLMError('模型拒绝回答');
    return res.content.filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
  } catch (e) {
    throw toLLMError(e, timeoutMs);
  }
}
