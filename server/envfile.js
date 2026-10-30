import { readFileSync, writeFileSync, existsSync } from 'node:fs';

/**
 * 读写 .env：按变量名替换或删除一行，其余行（注释、其他变量）原样保留。
 * 页面上填写 / 更换 / 清除 API Key 时由服务端调用；Key 永远不经过浏览器读回。
 */

export function parseEnv(text) {
  const out = {};
  for (const line of text.split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return out;
}

/** value 为 null / 空串时删除该变量 */
export function setEnvVar(file, key, value) {
  const lines = existsSync(file) ? readFileSync(file, 'utf8').split('\n') : [];
  const re = new RegExp(`^\\s*${key}\\s*=`);
  const kept = lines.filter((l) => !re.test(l));
  if (value) {
    const at = lines.findIndex((l) => re.test(l));
    const line = `${key}=${value}`;
    if (at >= 0) kept.splice(lines.slice(0, at).filter((l) => !re.test(l)).length, 0, line); // 原位置替换
    else {
      while (kept.length && kept[kept.length - 1] === '') kept.pop();
      kept.push(line);
    }
  }
  while (kept.length && kept[kept.length - 1] === '') kept.pop();
  writeFileSync(file, kept.join('\n') + '\n', { mode: 0o600 });
}
