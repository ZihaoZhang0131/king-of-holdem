import { bestHand, handName } from './poker.js';
import { cardHTML } from './table.js';

/**
 * 玩家模式的操作栏：常驻屏幕底部，显示自己的底牌、位置、筹码和当前牌型；
 * 轮到你时展开行动按钮 —— 弃牌 / 过牌或跟注 / 下注·加注（滑杆、底池比例快捷键、数字输入）。
 *
 * turn（服务端 SSE "turn" 事件或本地演示给出，不轮到你时为 null）：
 *   { legal: legal_actions, toCall, pot, currentBet, stack, bet, bb, deadline, left, limit }
 *   limit 为思考时限（毫秒，0 = 不限）；deadline 为截止时间戳，暂停时为 0 并用 left 记剩余
 *   bet/raise 的金额是本街下注总额（raise-to），范围 [min_to, max_to]
 * 快捷键：F 弃牌、C 过牌/跟注、R 下注/加注（输入框里回车同样提交）、A 全下
 */

const fmt = (n) => Number(n || 0).toLocaleString('en-US');
const POT_PRESETS = [['½池', 0.5], ['⅔池', 2 / 3], ['1池', 1]];

export function createActionBar({ root, seat, onAct, sfx }) {
  root.innerHTML = `
    <div class="ab-me">
      <div class="ab-cards"></div>
      <div class="ab-info"><b></b><small></small></div>
    </div>
    <div class="ab-wait"></div>
    <div class="ab-acts" hidden>
      <div class="ab-raise">
        <div class="ab-presets">${POT_PRESETS.map(([n, k]) => `<button data-frac="${k}">${n}</button>`).join('')}<button data-allin>全下</button></div>
        <div class="ab-size"><input type="range" class="ab-slider"><input type="number" class="ab-amt"></div>
      </div>
      <div class="ab-btns">
        <button data-act="fold" class="ab-fold">弃牌<kbd>F</kbd></button>
        <button data-act="call" class="ab-call"></button>
        <button data-act="raise" class="ab-go"></button>
      </div>
      <div class="ab-err"></div>
    </div>
    <div class="ab-timer"><i></i></div>`;
  const $ = (s) => root.querySelector(s);
  const cardsEl = $('.ab-cards'), nameEl = $('.ab-info b'), subEl = $('.ab-info small'), waitEl = $('.ab-wait');
  const acts = $('.ab-acts'), slider = $('.ab-slider'), amtEl = $('.ab-amt'), errEl = $('.ab-err');
  const callBtn = $('.ab-call'), goBtn = $('.ab-go'), foldBtn = $('.ab-fold'), raiseBox = $('.ab-raise');
  const timer = $('.ab-timer'), timerBar = $('.ab-timer i');

  let turn = null, st = null, busy = false, amount = 0;
  const R = () => turn?.legal.find((a) => a.type === 'bet' || a.type === 'raise');
  const has = (t) => !!turn?.legal.find((a) => a.type === t);
  const clamp = (v) => { const r = R(); return Math.min(r.max_to, Math.max(r.min_to, Math.round(v))); };

  function setAmount(v) {
    if (!R()) return;
    amount = clamp(v);
    slider.value = amount;
    if (document.activeElement !== amtEl) amtEl.value = amount;
    const r = R();
    goBtn.innerHTML = `${amount >= r.max_to ? '全下' : r.type === 'bet' ? '下注' : '加注到'} ${fmt(amount)}<kbd>R</kbd>`;
    goBtn.classList.toggle('allin', amount >= r.max_to);
  }

  function paintTurn() {
    const mine = !!turn;
    root.classList.toggle('turn', mine);
    acts.hidden = !mine;
    waitEl.hidden = mine;
    errEl.textContent = '';
    if (!mine) { paintWait(); paintTimer(); return; }
    const call = turn.legal.find((a) => a.type === 'call');
    callBtn.innerHTML = call ? `${call.all_in ? '全下跟注' : '跟注'} ${fmt(call.amount)}<kbd>C</kbd>` : '过牌<kbd>C</kbd>';
    foldBtn.hidden = !has('fold');
    const r = R();
    raiseBox.hidden = goBtn.hidden = !r;
    if (r) {
      slider.min = amtEl.min = r.min_to;
      slider.max = amtEl.max = r.max_to;
      slider.step = Math.max(1, Math.round((turn.bb || 1) / 2));
      // 默认尺度：开池 ⅔ 池，面对下注时最小加注
      setAmount(r.type === 'bet' ? turn.currentBet + (turn.pot + turn.toCall) * (2 / 3) : r.min_to);
    }
    paintTimer();
  }

  function paintWait() {
    if (!st) { waitEl.textContent = ''; return; }
    const me = st.players[seat];
    const actor = st.toAct >= 0 ? st.players[st.toAct] : null;
    waitEl.textContent = st.tournament?.finished ? (me.place === 1 ? '🏆 你是冠军！' : `比赛结束 · 你获得第 ${me.place} 名`)
      : me.eliminated ? `你已出局（第 ${me.place} 名）· 继续观战`
      : st.handId === 0 ? '等待开赛'
      : me.folded ? '你已弃牌 · 等待本手结束'
      : st.toAct === seat ? '轮到你了'
      : actor ? `等待 ${actor.name} 行动…`
      : me.allIn ? '你已全下' : '';
  }

  // 倒计时：deadline 为服务端时间戳；暂停时 left > 0 且 deadline 为 0
  let tick = 0;
  function paintTimer() {
    cancelAnimationFrame(tick);
    const total = turn?.limit || 0;
    timer.hidden = !turn || (!turn.deadline && !turn.left);
    if (timer.hidden) return;
    if (!turn.deadline) { timerBar.style.width = `${(turn.left / total) * 100}%`; timer.dataset.paused = '1'; return; }
    timer.dataset.paused = '';
    const loop = () => {
      const left = Math.max(0, turn.deadline - Date.now());
      timerBar.style.width = `${(left / total) * 100}%`;
      timer.classList.toggle('hurry', left < 5000);
      if (left > 0 && turn) tick = requestAnimationFrame(loop);
    };
    loop();
  }

  async function act(type, amt) {
    if (!turn || busy) return;
    busy = true;
    root.classList.add('busy');
    try {
      const r = await onAct(amt === undefined ? { type } : { type, amount: amt });
      if (r && !r.ok) errEl.textContent = r.error || '操作失败';
    } catch { errEl.textContent = '提交失败：连不上对局服务'; }
    busy = false;
    root.classList.remove('busy');
  }
  const doFold = () => has('fold') && act('fold');
  const doCall = () => act(has('call') ? 'call' : 'check');
  const doRaise = () => R() && act(R().type, amount);
  const doAllIn = () => (R() ? act(R().type, R().max_to) : has('call') && act('call'));

  root.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b || !turn) return;
    if (b.dataset.act === 'fold') doFold();
    else if (b.dataset.act === 'call') doCall();
    else if (b.dataset.act === 'raise') doRaise();
    else if (b.dataset.frac) { setAmount(turn.currentBet + (turn.pot + turn.toCall) * Number(b.dataset.frac)); sfx?.ui('tick'); }
    else if ('allin' in b.dataset) { setAmount(R().max_to); sfx?.ui('tick'); }
  });
  slider.addEventListener('input', () => setAmount(Number(slider.value)));
  amtEl.addEventListener('input', () => { if (amtEl.value !== '') setAmount(Number(amtEl.value)); });
  amtEl.addEventListener('change', () => { amtEl.value = amount; });
  amtEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); amtEl.blur(); doRaise(); } });
  addEventListener('keydown', (e) => {
    if (!turn || e.metaKey || e.ctrlKey || e.altKey || e.target.closest?.('input, textarea, select, [contenteditable]')) return;
    const k = e.key.toLowerCase();
    if (k === 'f') doFold();
    else if (k === 'c') doCall();
    else if (k === 'r') doRaise();
    else if (k === 'a') doAllIn();
    else return;
    e.preventDefault();
  });

  function update(state) {
    st = state;
    const me = st.players[seat];
    if (!me) return;
    root.hidden = !!me.sittingOut;
    const board = st.board || [];
    cardsEl.innerHTML = me.cards ? me.cards.map((c) => cardHTML(c)).join('') : '<span class="pc empty"></span><span class="pc empty"></span>';
    root.classList.toggle('folded', !!me.folded || !!me.eliminated);
    let made = '';
    if (me.cards && me.cards.every((c) => c !== '?')) {
      if (board.length >= 3) made = handName(bestHand([...me.cards, ...board]));
      else if (me.cards[0][0] === me.cards[1][0]) made = '口袋对';
    }
    nameEl.textContent = [me.name, me.position].filter(Boolean).join(' · ');
    subEl.textContent = [`筹码 ${fmt(me.stack)}`, me.bet ? `本轮已下 ${fmt(me.bet)}` : '', made].filter(Boolean).join(' · ');
    if (!turn) paintWait();
  }

  return {
    update,
    setTurn(t) {
      turn = t && t.seat === seat ? t : null;
      if (turn) sfx?.ui('on');
      paintTurn();
    },
  };
}
