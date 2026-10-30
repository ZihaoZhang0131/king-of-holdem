import { bestHand, handName, newDeck, cmp } from '../poker.js';
import { resolveModes } from './modes.js';

/**
 * 2–7 人无限注德州扑克淘汰赛（Freezeout）引擎（6 个 AI 座位 + 1 个玩家座位，不参赛的座位 enabled:false）。
 * - 只负责规则与流程：盲注升级、按钮轮转、单挑规则、最小加注、短码全下不重开加注、边池、摊牌、淘汰与名次
 * - 特殊玩法（鱿鱼游戏、大逃杀，规则见 modes.js）也在这里结算；筹码总量始终守恒：
 *   所有人的筹码 + 桌上下注与底池 + 空投箱 + 人头赏金 = 参赛人数 × 起始筹码
 * - 不关心决策从哪来：每次轮到某座位时调用 decide(seat, request)，request 即发给模型的局面（协议 ai-holdem/1）
 * - 每一步通过 emit(state) 推送观众视角的完整状态（格式见 table.js 顶部注释）；
 *   特殊玩法的事件（拿到鱿鱼、鱿鱼结算、缩圈、空投、淘汰赏金）放在 state.events 里，seq 递增，客户端据此播放动画
 */

const POSITIONS = {
  3: ['BTN', 'SB', 'BB'],
  4: ['BTN', 'SB', 'BB', 'CO'],
  5: ['BTN', 'SB', 'BB', 'UTG', 'CO'],
  6: ['BTN', 'SB', 'BB', 'UTG', 'HJ', 'CO'],
  7: ['BTN', 'SB', 'BB', 'UTG', 'MP', 'HJ', 'CO'],
};
const STREET_CN = { preflop: '翻牌前', flop: '翻牌', turn: '转牌', river: '河牌' };
const ACTION_CN = { small_blind: '小盲', big_blind: '大盲', fold: '弃牌', check: '过牌', call: '跟注到', bet: '下注', raise: '加注到', all_in: '全下到' };

export class Aborted extends Error {}

/** 开赛前的选手初始状态（大厅显示也用它）：enabled:false 的座位开局即视为出局、没有名次 */
export function initialPlayers(seats, config) {
  const m = resolveModes(config.modes);
  const bounty = m.royale.enabled ? Math.round(config.startingStack * m.royale.bountyPct) : 0;
  return seats.map((s, i) => {
    const out = s.enabled === false;
    return {
      seat: i, name: s.name, stack: out ? 0 : config.startingStack - bounty, eliminated: out, sittingOut: out, place: null, thought: '',
      squids: [], bounty: out ? 0 : bounty, kills: 0,
    };
  });
}

/** 大厅/开赛前给观众看的玩法信息 */
export function modesView(config, { handNo = 0, alive = 0, crate = 0, squidRound = 1 } = {}) {
  const m = resolveModes(config.modes);
  const per = m.royale.enabled ? m.royale.zoneEvery : config.handsPerLevel;
  const lv = Math.min(Math.floor(Math.max(0, handNo - 1) / per), config.blinds.length - 1);
  const BB = config.blinds[lv][1];
  return {
    squid: m.squid.enabled ? { round: squidRound, unit: m.squid.unitBB * BB, lastDouble: m.squid.lastDouble, active: alive >= 3 } : null,
    royale: m.royale.enabled ? { phase: lv + 1, zoneEvery: per, crate, finalCircle: alive > 1 && alive <= m.royale.finalCircle, finalAt: m.royale.finalCircle } : null,
  };
}

/**
 * 某个座位能看到的状态（玩家模式下发给浏览器的就是它）：
 * 别人没亮的底牌换成牌背 '?'；AI 的内心独白常常泄露牌力，本手结束（出现赢家）前不给看
 */
export function viewFor(st, seat) {
  const over = st.players.some((p) => p.winner) || !!st.tournament?.finished;
  return {
    ...st,
    players: st.players.map((p, i) => (i === seat ? p : {
      ...p,
      cards: p.cards && !p.revealed ? p.cards.map(() => '?') : p.cards,
      thought: over ? p.thought : '',
    })),
  };
}

export function createTournament({ seats, config, decide, emit, wait }) {
  const N = seats.length;
  const modes = resolveModes(config.modes);
  const SQ = modes.squid.enabled ? modes.squid : null;
  const BR = modes.royale.enabled ? modes.royale : null;
  const P = initialPlayers(seats, config);
  const entrants = P.filter((p) => !p.sittingOut).length;
  const history = [];
  let dealer = Math.floor(Math.random() * N);
  let handNo = 0;
  let finished = false;
  let lastState = null;
  let crate = 0; // 大逃杀：空投箱
  let squidRound = 1, finalAnnounced = false;
  let seq = 0;
  let pending = []; // 下一次 emit 时带出去的事件
  const event = (e) => pending.push({ ...e, seq: ++seq });
  const squidSum = (p) => p.squids.reduce((s, v) => s + v, 0);

  const alive = () => P.filter((p) => !p.eliminated);
  const nextFrom = (i, pred) => {
    for (let k = 1; k <= N; k++) { const j = (i + k) % N; if (pred(j)) return j; }
    return -1;
  };

  async function run() {
    while (alive().length > 1 && handNo < config.maxHands) await playHand();
    finished = true;
    // 收尾：存活者的人头赏金回到自己筹码，空投箱剩余归筹码最多者；正常只剩一人，若达到手数上限则按筹码排名
    alive().forEach((p) => { p.stack += p.bounty; p.bounty = 0; });
    const ranked = alive().sort((a, b) => b.stack - a.stack);
    ranked[0].stack += crate;
    crate = 0;
    ranked.forEach((p, k) => { p.place = k + 1; });
    const champ = ranked[0];
    lastState = { ...lastState, toAct: -1, message: `冠军：${champ.name}！`, tournament: { ...lastState.tournament, finished: true, champion: champ.seat },
      modes: lastState.modes && { ...lastState.modes, royale: lastState.modes.royale && { ...lastState.modes.royale, crate: 0 } },
      events: [],
      players: lastState.players.map((p, i) => ({ ...p, stack: P[i].stack, bounty: P[i].bounty, place: P[i].place, winner: i === champ.seat })) };
    emit(lastState);
    return P.map((p) => ({ name: p.name, place: p.place, stack: p.stack }));
  }

  async function playHand() {
    handNo++;
    // 大逃杀：毒圈收缩代替普通涨盲
    const per = BR ? BR.zoneEvery : config.handsPerLevel;
    const lv = Math.min(Math.floor((handNo - 1) / per), config.blinds.length - 1);
    const [SB, BB] = config.blinds[lv];
    const levelUp = handNo > 1 && (handNo - 1) % per === 0;
    dealer = nextFrom(dealer, (j) => !P[j].eliminated);

    // 本手参与者，按顺时针从庄位开始
    const order = [];
    for (let k = 0; k < N; k++) { const j = (dealer + k) % N; if (!P[j].eliminated) order.push(j); }
    const n = order.length;
    const sbSeat = n === 2 ? dealer : order[1];
    const bbSeat = n === 2 ? order[1] : order[2];
    const posOf = {};
    order.forEach((j, k) => { posOf[j] = n === 2 ? (j === dealer ? 'BTN/SB' : 'BB') : POSITIONS[n][k]; });

    const deck = newDeck();
    const H = P.map((p) => (p.eliminated ? null : {
      cards: [deck.pop(), deck.pop()], bet: 0, contrib: 0, folded: false, allIn: false,
      revealed: false, winner: false, handName: '', lastAction: null,
    }));
    const board = [];
    const boardAt = {};
    const actions = [];
    let stage = 'preflop', toAct = -1, paid = false;
    let message = levelUp ? (BR ? `毒圈收缩 · 第 ${lv + 1} 阶段 · 盲注 ${SB}/${BB}` : `盲注升级：${SB}/${BB}`) : '';
    let currentBet = 0, lastRaise = BB;
    P.forEach((p) => { p.thought = ''; });

    // ---- 大逃杀：缩圈、空投、毒伤、决赛圈 ----
    let dead = 0; // 本手底池里的死钱（空投）
    const finalCircle = !!BR && order.length <= BR.finalCircle;
    let ante = 0;
    if (BR) {
      if (levelUp) event({ type: 'zone', phase: lv + 1 });
      if (levelUp && crate > 0) {
        dead = crate;
        crate = 0;
        event({ type: 'airdrop', amount: dead });
        message += ` · 空投 ${dead.toLocaleString('en-US')} 落入底池`;
      }
      if (finalCircle && !finalAnnounced) {
        finalAnnounced = true;
        event({ type: 'final', players: order.length });
        message = (message ? message + ' · ' : '') + '进入决赛圈，毒伤翻倍';
      }
      ante = Math.round(BB * Math.min(1, (lv) * BR.anteStep) * (finalCircle ? 2 : 1));
      if (ante > 0) order.forEach((i) => { const a = Math.min(ante, P[i].stack - 1); P[i].stack -= a; crate += a; });
    }
    // 鱿鱼游戏只在 3 人及以上时进行；人数不够时本轮作废
    const squidLive = !!SQ && order.length >= 3;
    if (SQ && !squidLive && P.some((p) => p.squids.length)) { P.forEach((p) => { p.squids = []; }); squidRound++; event({ type: 'squidVoid' }); }
    const startStacks = P.map((p) => p.stack);

    const put = (i, amt) => {
      const h = H[i], p = P[i];
      amt = Math.min(amt, p.stack);
      p.stack -= amt; h.bet += amt; h.contrib += amt;
      if (p.stack === 0) h.allIn = true;
      return amt;
    };
    const potTotal = () => order.reduce((s, i) => s + H[i].contrib, 0) + dead;
    const potCollected = () => (paid ? 0 : order.reduce((s, i) => s + H[i].contrib - H[i].bet, 0) + dead);
    const noSquid = () => order.filter((i) => !P[i].eliminated && !P[i].squids.length);
    const liveSeats = () => order.filter((i) => !H[i].folded);
    const canAct = (i) => H[i] && !H[i].folded && !H[i].allIn;

    const state = () => ({
      mode: 'live', handId: handNo, stage, board: [...board], pot: potCollected(), dealer, toAct, blinds: [SB, BB], message,
      tournament: {
        level: lv + 1, handsPerLevel: per, handsToNextLevel: per - ((handNo - 1) % per),
        playersLeft: alive().length, startingStack: config.startingStack, finished,
      },
      modes: {
        squid: SQ ? { round: squidRound, unit: SQ.unitBB * BB, lastDouble: SQ.lastDouble, active: squidLive, double: squidLive && SQ.lastDouble && noSquid().length <= 2 } : null,
        royale: BR ? { phase: lv + 1, zoneEvery: per, handsToShrink: per - ((handNo - 1) % per), ante, crate, dead, finalCircle, finalAt: BR.finalCircle } : null,
      },
      events: pending,
      players: P.map((p, i) => {
        const h = H[i];
        return {
          name: p.name, stack: p.stack, bet: h ? h.bet : 0, cards: h ? h.cards : null,
          folded: h ? h.folded : false, allIn: h ? h.allIn : false, revealed: h ? h.revealed : false,
          winner: h ? h.winner : false, handName: h ? h.handName : '', lastAction: h ? h.lastAction : null,
          thought: p.thought, eliminated: p.eliminated, sittingOut: p.sittingOut, place: p.place, position: posOf[i] || '',
          squids: squidSum(p), bounty: p.bounty, kills: p.kills,
        };
      }),
    });
    const show = () => { lastState = state(); pending = []; emit(lastState); };
    const log = (street, seat, action, to) => actions.push({ street, seat, player: P[seat].name, position: posOf[seat], action, ...(to !== undefined ? { to } : {}) });

    put(sbSeat, SB);
    H[sbSeat].lastAction = { type: 'sb', amount: H[sbSeat].bet };
    log('preflop', sbSeat, 'small_blind', H[sbSeat].bet);
    put(bbSeat, BB);
    H[bbSeat].lastAction = { type: 'bb', amount: H[bbSeat].bet };
    log('preflop', bbSeat, 'big_blind', H[bbSeat].bet);
    show();
    await wait(config.pace.deal);

    function legalFor(i, acted) {
      const h = H[i], p = P[i];
      const toCall = Math.max(0, currentBet - h.bet);
      const callAmt = Math.min(toCall, p.stack);
      const list = [];
      if (toCall > 0) {
        list.push({ type: 'fold' });
        list.push({ type: 'call', amount: callAmt, ...(callAmt === p.stack ? { all_in: true } : {}) });
      } else list.push({ type: 'check' });
      const maxTo = h.bet + p.stack;
      const others = order.filter((j) => j !== i && canAct(j)).length;
      if (others > 0 && !acted.has(i) && maxTo > currentBet) {
        const minTo = Math.min(currentBet === 0 ? BB : currentBet + lastRaise, maxTo);
        list.push({ type: currentBet === 0 ? 'bet' : 'raise', min_to: minTo, max_to: maxTo });
      }
      return { toCall: callAmt, list };
    }

    // 引擎兜底校验（agent 已校验过，这里防御任何来源的非法决策）
    function enforce(d, legal) {
      const has = (t) => legal.list.find((a) => a.type === t);
      const R = has('bet') || has('raise');
      const t = d?.type;
      if (t === 'fold') return has('fold') ? { type: 'fold' } : { type: 'check' };
      if (t === 'check') return has('check') ? { type: 'check' } : { type: 'fold' };
      if (t === 'call') return has('call') ? { type: 'call' } : { type: 'check' };
      if ((t === 'bet' || t === 'raise') && R) {
        const amt = Math.round(Number(d.amount));
        return { type: R.type, amount: Math.min(R.max_to, Math.max(R.min_to, Number.isFinite(amt) ? amt : R.min_to)) };
      }
      return has('check') ? { type: 'check' } : { type: 'fold' };
    }

    function buildRequest(i, street, legal) {
      const h = H[i], p = P[i];
      const pot = potTotal();
      return {
        protocol: 'ai-holdem/1',
        tournament: {
          format: `${entrants}-max No-Limit Hold'em freezeout`, hand_no: handNo, level: lv + 1, blinds: { sb: SB, bb: BB },
          hands_until_blinds_up: per - ((handNo - 1) % per),
          next_blinds: config.blinds[Math.min(lv + 1, config.blinds.length - 1)],
          players_left: alive().length, starting_stack: config.startingStack,
        },
        you: { seat: i, name: p.name, position: posOf[i], hole_cards: h.cards, stack: p.stack, bet_this_street: h.bet, invested_this_hand: h.contrib },
        table: order.map((j) => ({
          seat: j, name: P[j].name, position: posOf[j], stack: P[j].stack, bet_this_street: H[j].bet, invested_this_hand: H[j].contrib,
          status: H[j].folded ? 'folded' : H[j].allIn ? 'all_in' : 'active', ...(j === i ? { is_you: true } : {}),
        })),
        eliminated: P.filter((q) => q.eliminated && !q.sittingOut).map((q) => ({ name: q.name, place: q.place })),
        hand: {
          street, board: [...board], pot_total: pot, current_bet: currentBet, to_call: legal.toCall,
          pot_odds: legal.toCall ? Math.round((legal.toCall / (pot + legal.toCall)) * 1000) / 1000 : 0,
          actions: actions.map(({ seat, ...a }) => a),
        },
        legal_actions: legal.list,
        recent_hands: history.slice(-config.recentHands),
        ...(SQ || BR ? { modes: modeRequest(i) } : {}),
      };
    }

    // 特殊玩法里模型需要知道的公开信息
    function modeRequest(i) {
      const out = {};
      if (SQ) {
        out.squid_game = squidLive ? {
          round: squidRound, value_per_squid: SQ.unitBB * BB, your_squids: squidSum(P[i]),
          squids: order.map((j) => ({ name: P[j].name, squids: squidSum(P[j]) })),
          players_without_squid: noSquid().map((j) => P[j].name),
          next_squid_double: SQ.lastDouble && noSquid().length <= 2,
          note: noSquid().length === 1 ? `${P[noSquid()[0]].name} 是最后一个没有鱿鱼的人：只要再有一人净赢一手，他就要买单` : undefined,
        } : { paused: '在局不足 3 人，鱿鱼游戏暂停' };
      }
      if (BR) {
        out.battle_royale = {
          zone_phase: lv + 1, hands_until_zone_shrinks: per - ((handNo - 1) % per), poison_ante_per_hand: ante, final_circle: finalCircle,
          airdrop_crate: crate, airdrop_in_this_pot: dead, your_bounty: P[i].bounty,
          bounties: order.map((j) => ({ name: P[j].name, bounty: P[j].bounty, kills: P[j].kills })),
        };
      }
      return out;
    }

    async function betting(street, first) {
      currentBet = Math.max(...order.map((i) => H[i].bet));
      lastRaise = BB;
      let need = new Set(order.filter(canAct));
      const acted = new Set(); // 自上次"完整加注"后已行动的人：遇到短码全下时不能再加注
      for (let guard = 0, i = first; guard < 1000 && need.size; guard++, i = (i + 1) % N) {
        if (!need.has(i)) continue;
        if (liveSeats().length <= 1) break;
        const h = H[i];
        const toCall = currentBet - h.bet;
        const others = order.filter((j) => j !== i && canAct(j)).length;
        if (others === 0 && toCall <= 0) { need.delete(i); continue; }

        const legal = legalFor(i, acted);
        toAct = i;
        show();
        const raw = await decide(i, buildRequest(i, street, legal));
        const d = enforce(raw, legal);
        toAct = -1;
        P[i].thought = typeof raw?.thought === 'string' ? raw.thought : '';

        if (d.type === 'fold') {
          h.folded = true;
          h.lastAction = { type: 'fold' };
          log(street, i, 'fold');
        } else if (d.type === 'check') {
          h.lastAction = { type: 'check' };
          acted.add(i);
          log(street, i, 'check');
        } else if (d.type === 'call') {
          put(i, toCall);
          h.lastAction = { type: h.allIn ? 'allin' : 'call', amount: h.bet };
          acted.add(i);
          log(street, i, h.allIn ? 'all_in' : 'call', h.bet);
        } else {
          put(i, d.amount - h.bet);
          const size = h.bet - currentBet;
          if (size >= lastRaise) { lastRaise = size; acted.clear(); }
          acted.add(i);
          currentBet = Math.max(currentBet, h.bet);
          need = new Set(order.filter((j) => j !== i && canAct(j)));
          h.lastAction = { type: h.allIn ? 'allin' : d.type, amount: h.bet };
          log(street, i, h.allIn ? 'all_in' : d.type, h.bet);
        }
        need.delete(i);
        show();
        await wait(config.pace.action);
      }
      toAct = -1;
      return liveSeats().length > 1;
    }

    const collect = () => order.forEach((i) => { H[i].bet = 0; });
    const revealIfNoBetting = () => {
      if (liveSeats().length > 1 && order.filter(canAct).length <= 1) liveSeats().forEach((i) => { H[i].revealed = true; });
    };

    let contested = await betting('preflop', nextFrom(bbSeat, (j) => !!H[j]));
    for (const [name, k] of [['flop', 3], ['turn', 1], ['river', 1]]) {
      if (!contested) break;
      collect();
      order.forEach((i) => { if (!H[i].folded) H[i].lastAction = H[i].allIn ? { type: 'allin' } : null; });
      stage = name;
      revealIfNoBetting();
      show();
      await wait(config.pace.street);
      deck.pop();
      for (let c = 0; c < k; c++) board.push(deck.pop());
      boardAt[name] = [...board];
      show();
      await wait(config.pace.board);
      contested = await betting(name, nextFrom(dealer, (j) => canAct(j)));
    }
    collect();

    const pot = potTotal();
    const won = P.map(() => 0);
    const layerWinners = {}; // 每层边池的赢家：用来判定是谁淘汰了谁
    let showdown = null;
    if (!contested) {
      const w = liveSeats()[0];
      show();
      await wait(config.pace.collect);
      won[w] = pot;
      H[w].winner = true;
      message = `${P[w].name} 赢得 ${pot.toLocaleString('en-US')}（其余玩家弃牌）`;
    } else {
      stage = 'showdown';
      const scores = P.map((_, i) => (H[i] && !H[i].folded ? bestHand([...H[i].cards, ...board]) : null));
      liveSeats().forEach((i) => { H[i].revealed = true; H[i].handName = handName(scores[i]); });
      show();
      await wait(config.pace.showdown);
      // 边池：按投入额分层，每层只在投入达到该层的未弃牌玩家中比牌
      const levels = [...new Set(order.map((i) => H[i].contrib).filter((c) => c > 0))].sort((a, b) => a - b);
      let prev = 0;
      for (const L of levels) {
        // 空投的死钱并入主池
        const amt = order.reduce((s, i) => s + Math.min(H[i].contrib, L) - Math.min(H[i].contrib, prev), 0) + (prev === 0 ? dead : 0);
        prev = L;
        let elig = liveSeats().filter((i) => H[i].contrib >= L);
        if (!elig.length) {
          const maxLive = Math.max(...liveSeats().map((i) => H[i].contrib));
          elig = liveSeats().filter((i) => H[i].contrib === maxLive);
        }
        let best = [];
        elig.forEach((i) => {
          const c = best.length ? cmp(scores[i], scores[best[0]]) : 1;
          if (c > 0) best = [i]; else if (c === 0) best.push(i);
        });
        // 零头给庄位左手第一位赢家
        best.sort((a, b) => ((a - dealer + N) % N || N) - ((b - dealer + N) % N || N));
        best.forEach((i, k) => { won[i] += Math.floor(amt / best.length) + (k === 0 ? amt % best.length : 0); });
        layerWinners[L] = best;
      }
      const winners = order.filter((i) => won[i] > 0);
      winners.forEach((i) => { H[i].winner = true; });
      message = winners.map((i) => `${P[i].name} 以${H[i].handName}赢得 ${won[i].toLocaleString('en-US')}`).join('，');
      showdown = liveSeats().map((i) => ({ player: P[i].name, cards: H[i].cards, hand: H[i].handName }));
    }
    order.forEach((i) => { P[i].stack += won[i]; });
    paid = true;
    // 谁淘汰了谁：输掉自己最上层边池时，那一层的赢家
    const killersOf = (i) => layerWinners[H[i].contrib] || (contested ? [] : order.filter((j) => H[j].winner));

    // ---- 鱿鱼游戏：发鱿鱼，检查是否结算 ----
    let squidKiller = null;
    if (squidLive) {
      const doubleNow = SQ.lastDouble && noSquid().length <= 2;
      order.filter((i) => won[i] - H[i].contrib > 0).forEach((i) => {
        const v = doubleNow ? 2 : 1;
        P[i].squids.push(v);
        event({ type: 'squid', seat: i, value: v, total: squidSum(P[i]) });
      });
      const survivors = order.filter((i) => P[i].stack > 0);
      const without = survivors.filter((i) => !P[i].squids.length);
      if (without.length <= 1) {
        if (without.length === 1) {
          const loser = without[0];
          const unit = SQ.unitBB * BB;
          const dues = survivors.filter((j) => j !== loser).map((j) => ({ seat: j, due: unit * squidSum(P[j]) })).filter((d) => d.due > 0);
          const total = dues.reduce((s, d) => s + d.due, 0);
          const scale = total > P[loser].stack ? P[loser].stack / total : 1;
          const pays = dues.map((d) => ({ seat: d.seat, amount: Math.floor(d.due * scale) }));
          pays.forEach((d) => { P[loser].stack -= d.amount; P[d.seat].stack += d.amount; });
          const paidTotal = pays.reduce((s, d) => s + d.amount, 0);
          if (P[loser].stack === 0) squidKiller = { loser, killers: [pays.slice().sort((a, b) => b.amount - a.amount)[0].seat] };
          event({ type: 'squidSettle', loser, pays, total: paidTotal, round: squidRound });
          message += `；鱿鱼游戏第 ${squidRound} 轮结束：${P[loser].name} 没有鱿鱼，支付 ${paidTotal.toLocaleString('en-US')}`;
        } else {
          event({ type: 'squidVoid', round: squidRound });
        }
        P.forEach((p) => { p.squids = []; });
        squidRound++;
      }
    }

    // 淘汰与名次：同一手出局的，开局筹码多者名次靠前
    const busted = order.filter((i) => P[i].stack === 0).sort((a, b) => startStacks[b] - startStacks[a]);
    busted.forEach((i) => { P[i].eliminated = true; P[i].squids = []; });
    const left = alive().length;
    busted.forEach((i, k) => { P[i].place = left + 1 + k; });
    // ---- 大逃杀：人头赏金（递进式：一半进筹码，一半加到自己人头上）----
    if (BR) busted.forEach((i) => {
      const killers = (squidKiller?.loser === i ? squidKiller.killers : killersOf(i)).filter((j) => j !== i && !P[j].eliminated);
      const b = P[i].bounty;
      P[i].bounty = 0;
      if (!killers.length) { crate += b; return; }
      killers.forEach((j, k) => {
        const share = Math.floor(b / killers.length) + (k === 0 ? b % killers.length : 0);
        const cash = Math.ceil(share / 2);
        P[j].stack += cash;
        P[j].bounty += share - cash;
        P[j].kills++;
        event({ type: 'kill', seat: j, victim: i, loot: cash, bountyUp: share - cash });
      });
    });
    if (busted.length) message += `；${busted.map((i) => `${P[i].name} 出局（第 ${P[i].place} 名）`).join('，')}`;
    show();

    history.push(summarize({ handNo, SB, BB, dealer, actions, boardAt, showdown, won, pot }));
    if (history.length > 20) history.shift();
    await wait(config.pace.end);
  }

  // 公开信息的单手摘要（写进之后每个模型的 recent_hands）
  function summarize({ handNo: no, SB, BB, dealer: d, actions, boardAt, showdown, won, pot }) {
    const parts = [`#${no} 盲注${SB}/${BB} 庄位${P[d].name}`];
    for (const st of ['preflop', 'flop', 'turn', 'river']) {
      const acts = actions.filter((a) => a.street === st);
      if (!acts.length && !boardAt[st]) continue;
      const head = STREET_CN[st] + (boardAt[st] ? `[${boardAt[st].join(' ')}]` : '');
      parts.push(`${head}: ${acts.map((a) => `${a.player}${ACTION_CN[a.action]}${a.to !== undefined && a.action !== 'fold' && a.action !== 'check' ? a.to : ''}`).join('，') || '无行动'}`);
    }
    if (showdown) parts.push(`摊牌: ${showdown.map((s) => `${s.player}[${s.cards.join(' ')}]${s.hand}`).join('；')}`);
    parts.push(`结果: ${P.filter((_, i) => won[i] > 0).map((p) => `${p.name}赢${won[p.seat]}`).join('，')}（底池${pot}）`);
    return parts.join(' | ');
  }

  return { run, get state() { return lastState; } };
}
