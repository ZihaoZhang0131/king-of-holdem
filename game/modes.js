/**
 * 特殊玩法：鱿鱼游戏、大逃杀。两种可以同时开启。
 * 这里只放默认值、参数范围和给模型看的规则说明；结算逻辑在 engine.js。
 *
 * 鱿鱼游戏（扑克桌上流行的"鱿鱼"边局）
 * - 3 人及以上在局时进行。每手净赢筹码（赢得的比投入的多）的玩家拿到 1 只鱿鱼，可累积
 * - 只剩 2 人还没拿到鱿鱼时，下一只鱿鱼价值翻倍（"最后的鱿鱼"）
 * - 当只剩 1 位存活玩家没有鱿鱼：他向其余每位玩家支付「鱿鱼价值 × 对方持有的鱿鱼数」，然后清空鱿鱼、开始新一轮
 * - 鱿鱼价值以大盲为单位，随盲注上涨；付不起时按比例付光全部筹码（可能因此出局）
 *
 * 大逃杀
 * - 毒圈：每 zoneEvery 手毒圈收缩一次，盲注随之升一级（代替普通的涨盲节奏）
 * - 毒伤：从第 2 阶段起每手每人缴纳毒伤（大盲的 (阶段-1)×anteStep，最多 1 个大盲），进入空投箱；决赛圈毒伤翻倍。毒伤不会让人出局（至少留 1 枚筹码）
 * - 空投：毒圈收缩的那一手，空投箱里的筹码全部空投进底池，谁赢下这手谁拿走
 * - 赏金（递进式）：每人起始筹码中 bountyPct 作为人头赏金；淘汰别人时，对方赏金一半进你的筹码、一半加到你自己的人头上
 * - 决赛圈：存活人数 ≤ finalCircle 时进入决赛圈
 */

export const MODE_DEFAULTS = {
  squid: { enabled: false, unitBB: 2, lastDouble: true },
  royale: { enabled: false, zoneEvery: 6, anteStep: 0.25, bountyPct: 0.2, finalCircle: 3 },
};

/** 参数范围：[最小, 最大, 步长]，服务端校验与设置面板共用 */
export const MODE_LIMITS = {
  squid: { unitBB: [1, 20, 1] },
  royale: { zoneEvery: [2, 30, 1], anteStep: [0, 1, 0.05], bountyPct: [0, 0.5, 0.05], finalCircle: [2, 5, 1] },
};

export function resolveModes(modes = {}) {
  return {
    squid: { ...MODE_DEFAULTS.squid, ...(modes.squid || {}) },
    royale: { ...MODE_DEFAULTS.royale, ...(modes.royale || {}) },
  };
}

/** 开启的玩法名，如「鱿鱼游戏 + 大逃杀」 */
export function modeTitle(modes) {
  const m = resolveModes(modes);
  return [m.squid.enabled && '鱿鱼游戏', m.royale.enabled && '大逃杀'].filter(Boolean).join(' + ');
}

/** 校验设置面板提交的玩法参数：按 MODE_LIMITS 夹取并对齐步长 */
export function sanitizeModes(input, current) {
  const cur = resolveModes(current);
  const out = {};
  for (const k of Object.keys(MODE_DEFAULTS)) {
    const q = (input && input[k]) || {};
    out[k] = { ...cur[k] };
    for (const [f, d] of Object.entries(MODE_DEFAULTS[k])) {
      if (typeof d === 'boolean') { if (typeof q[f] === 'boolean') out[k][f] = q[f]; continue; }
      const [lo, hi, step] = MODE_LIMITS[k][f];
      const v = Number(q[f]);
      if (q[f] === undefined || !Number.isFinite(v)) continue;
      out[k][f] = Math.round(Math.min(hi, Math.max(lo, Math.round(v / step) * step)) * 100) / 100;
    }
  }
  return out;
}

/** 追加到系统提示词里的规则说明（只写开启的玩法） */
export function modeRules(modes) {
  const m = resolveModes(modes);
  const parts = [];
  if (m.squid.enabled) {
    parts.push(`【鱿鱼游戏】本场附加鱿鱼边局（3 人及以上在局时进行）：
- 每手净赢筹码的玩家获得 1 只鱿鱼，可累积；只剩 2 人没有鱿鱼时，下一只鱿鱼价值翻倍${m.squid.lastDouble ? '' : '（本场关闭）'}
- 当只剩 1 位玩家没有鱿鱼，他要向其余每位玩家支付「鱿鱼价值 × 对方持有的鱿鱼数」，然后开始新一轮
- 鱿鱼价值 = ${m.squid.unitBB} 个大盲。还没拿到鱿鱼时，赢下任意一个底池（哪怕很小）都很重要；局面见 modes.squid_game`);
  }
  if (m.royale.enabled) {
    parts.push(`【大逃杀】本场为大逃杀模式：
- 毒圈每 ${m.royale.zoneEvery} 手收缩一次，盲注随之升级；从第 2 阶段起每手每人缴纳毒伤，进入空投箱，决赛圈（剩 ${m.royale.finalCircle} 人及以下）毒伤翻倍
- 毒圈收缩的那一手，空投箱里的筹码会作为死钱空投进底池，谁赢下这手谁拿走
- 人头赏金：淘汰一名玩家时，他的赏金一半直接进你的筹码，一半加到你自己的人头上（你也会更值钱）
- 局面见 modes.battle_royale（含各人赏金、空投箱、距离下次缩圈手数）`);
  }
  return parts.join('\n\n');
}
