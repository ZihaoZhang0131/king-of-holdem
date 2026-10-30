/**
 * OpenAI Chat Completions 兼容客户端（适用于 Token Station 等统一网关）。
 * 只用 Node 自带 fetch，无第三方依赖。
 */

export class LLMError extends Error {
  constructor(message, { timeout = false, status = 0 } = {}) {
    super(message);
    this.timeout = timeout;
    this.status = status;
  }
}

export async function chatComplete({ baseURL, apiKey, model, messages, temperature = 0.7, maxTokens = 600, jsonMode = false, extraBody = {}, timeoutMs = 45000 }) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const body = {
    model, messages, temperature, max_tokens: maxTokens,
    ...(jsonMode ? { response_format: { type: 'json_object' } } : {}),
    ...extraBody,
  };
  let res;
  try {
    res = await fetch(`${baseURL.replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
  } catch (e) {
    clearTimeout(timer);
    if (e.name === 'AbortError') throw new LLMError(`请求超时（${timeoutMs}ms）`, { timeout: true });
    throw new LLMError(`网络错误：${e.message}`);
  }
  try {
    if (!res.ok) throw new LLMError(`HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`, { status: res.status });
    const data = await res.json();
    const content = data.choices?.[0]?.message?.content;
    const text = Array.isArray(content) ? content.map((c) => c.text ?? '').join('') : String(content ?? '');
    return { text, usage: data.usage ?? null };
  } catch (e) {
    if (e instanceof LLMError) throw e;
    if (e.name === 'AbortError') throw new LLMError(`请求超时（${timeoutMs}ms）`, { timeout: true });
    throw new LLMError(`响应解析失败：${e.message}`);
  } finally {
    clearTimeout(timer);
  }
}

/** GET {baseURL}/models：顺带验证 Key 是否有效（不花 token） */
export async function listModels({ baseURL, apiKey, timeoutMs = 15000 }) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${baseURL.replace(/\/+$/, '')}/models`, { headers: { authorization: `Bearer ${apiKey}` }, signal: ctrl.signal });
    if (!res.ok) throw new LLMError(`HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`, { status: res.status });
    const data = await res.json();
    return (Array.isArray(data.data) ? data.data : Array.isArray(data) ? data : []).map((m) => m.id ?? m.name).filter(Boolean).slice(0, 300);
  } catch (e) {
    if (e instanceof LLMError) throw e;
    if (e.name === 'AbortError') throw new LLMError(`请求超时（${timeoutMs}ms）`, { timeout: true });
    throw new LLMError(`网络错误：${e.message}`);
  } finally {
    clearTimeout(timer);
  }
}
