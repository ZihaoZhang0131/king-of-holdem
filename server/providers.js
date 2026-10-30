import { PROVIDERS, providerOf, DEFAULT_PROVIDER } from './provider-list.js';
import { chatComplete, listModels as listOpenAI, LLMError } from './llm.js';
import * as claude from './anthropic.js';
import { setEnvVar } from './envfile.js';

/**
 * 厂商运行时：取 Key / Base URL、按厂商分发模型调用、模型列表（缓存 10 分钟）、健康测试、改 Key。
 * Key 每次调用时才从进程环境里取，所以在页面上换了 Key 立即生效。
 * @param {object} o
 * @param {object} o.env          进程环境（process.env），Key 的唯一来源
 * @param {string} o.envFile      .env 路径：改 Key 时写回
 * @param {() => object} o.config 当前 config.json（读 providers.<id>.baseURL 覆盖）
 */
export function createProviders({ env, envFile, config }) {
  const cache = new Map(); // id → { at, models, key }
  const tests = new Map(); // id → 最近一次连接测试结果
  const TTL = 10 * 60 * 1000;

  const keyOf = (id) => String(env[providerOf(id)?.env] || '').trim();
  const baseURLOf = (id) => {
    const p = providerOf(id);
    if (!p) return '';
    return config()?.providers?.[id]?.baseURL || (p.baseEnv && env[p.baseEnv]) || p.baseURL;
  };
  // Anthropic 的 Base URL 可以留空（用 SDK 默认）；OpenAI 兼容的必须有
  const configured = (id) => !!providerOf(id) && !!keyOf(id) && (providerOf(id).kind === 'anthropic' || !!baseURLOf(id));
  const mask = (k) => (!k ? '' : k.length >= 12 ? `${k.slice(0, 3)}…${k.slice(-4)}` : '••••');

  /** 给浏览器看的状态：永远不含完整 Key */
  const view = () => PROVIDERS.map((p) => ({
    id: p.id, name: p.name, sub: p.sub, kind: p.kind, env: p.env, presets: p.presets,
    configured: configured(p.id), masked: mask(keyOf(p.id)), baseURL: baseURLOf(p.id), defaultBaseURL: p.baseURL,
    test: tests.get(p.id) || null,
  }));

  function need(id) {
    const p = providerOf(id);
    if (!p) throw new LLMError(`未知厂商：${id}`);
    if (!keyOf(id)) throw new LLMError(`${p.name} 未配置 API Key`);
    if (p.kind === 'openai' && !baseURLOf(id)) throw new LLMError(`${p.name} 未配置 Base URL`);
    return { p, apiKey: keyOf(id), baseURL: baseURLOf(id) };
  }

  /** 一次决策调用：参数与 chatComplete 相同，按厂商分发 */
  async function complete(id, { model, messages, temperature, maxTokens, jsonMode, extraBody = {}, timeoutMs }) {
    const { p, apiKey, baseURL } = need(id || DEFAULT_PROVIDER);
    if (p.kind === 'anthropic') {
      return claude.complete({ apiKey, baseURL, model, messages, maxTokens, jsonMode, timeoutMs, effort: extraBody.reasoning_effort });
    }
    return chatComplete({ baseURL, apiKey, model, messages, temperature, maxTokens, jsonMode, extraBody, timeoutMs });
  }

  async function listModels(id, { refresh = false } = {}) {
    const { p, apiKey, baseURL } = need(id);
    const hit = cache.get(id);
    if (!refresh && hit && hit.key === apiKey + baseURL && Date.now() - hit.at < TTL) return hit.models;
    const models = p.kind === 'anthropic' ? await claude.listModels({ apiKey, baseURL }) : await listOpenAI({ apiKey, baseURL });
    models.sort();
    cache.set(id, { at: Date.now(), models, key: apiKey + baseURL });
    return models;
  }

  /** 连接测试：拉一次模型列表（不花 token），验证 Key 与 Base URL */
  async function testProvider(id) {
    const t0 = Date.now();
    let r;
    try {
      const models = await listModels(id, { refresh: true });
      r = { ok: true, ms: Date.now() - t0, models: models.length, at: Date.now() };
    } catch (e) {
      r = { ok: false, ms: Date.now() - t0, error: e.message, at: Date.now() };
    }
    tests.set(id, r);
    return r;
  }

  /** 模型测试：一次极小的真实调用（会花极少量 token） */
  async function testModel(id, model) {
    const t0 = Date.now();
    try {
      if (!model) throw new LLMError('没有填写模型');
      const { p, apiKey, baseURL } = need(id);
      const reply = p.kind === 'anthropic'
        ? await claude.testModel({ apiKey, baseURL, model })
        : (await chatComplete({ baseURL, apiKey, model, maxTokens: 16, temperature: 0, timeoutMs: 30000, messages: [{ role: 'user', content: '只回复 OK' }] })).text.trim();
      return { ok: true, ms: Date.now() - t0, reply: reply.slice(0, 40) };
    } catch (e) {
      return { ok: false, ms: Date.now() - t0, error: e.message };
    }
  }

  /** 填写 / 更换 / 清除 Key：写回 .env，同时更新进程环境，立即生效 */
  function setKey(id, key) {
    const p = providerOf(id);
    if (!p) return { ok: false, error: '未知厂商' };
    const k = typeof key === 'string' ? key.trim() : '';
    if (k && (!/^\S+$/.test(k) || k.length < 8 || k.length > 400)) return { ok: false, error: 'API Key 格式不对（不能含空格，长度 8–400）' };
    setEnvVar(envFile, p.env, k || null);
    if (k) env[p.env] = k; else delete env[p.env];
    cache.delete(id);
    tests.delete(id);
    return { ok: true };
  }

  return { view, configured, complete, listModels, testProvider, testModel, setKey, baseURLOf };
}
