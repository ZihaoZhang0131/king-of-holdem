/**
 * 左侧筹码排行榜：按"剩余筹码 + 本轮已下注"排序，行位置用 CSS 过渡平滑换位。
 * 每次 render(state) 后调用 update(state) 即可；点击某行回调 onSelect(座位号)。
 */

const fmt = (n) => Number(n || 0).toLocaleString('en-US');

export function createLeaderboard({ root, handEl, brands, onSelect }) {
  const rows = brands.map((b, i) => {
    const el = document.createElement('div');
    el.className = 'lb-row';
    el.style.setProperty('--c', '#' + b.color.toString(16).padStart(6, '0'));
    el.style.setProperty('--i', i);
    el.innerHTML = `
      <span class="lb-rank">${i + 1}</span>
      <div class="lb-main">
        <div class="lb-l1"><b>${b.name}</b><span class="lb-tag"></span><span class="lb-chips"></span></div>
        <div class="lb-l2"><span class="lb-track"><i></i></span><span class="lb-delta"></span><span class="lb-mode"></span><span class="lb-wins"></span></div>
      </div>`;
    el.addEventListener('click', () => onSelect?.(i));
    root.appendChild(el);
    const q = (sel) => el.querySelector(sel);
    return { el, rank: q('.lb-rank'), tag: q('.lb-tag'), chips: q('.lb-chips'), bar: q('.lb-track i'), delta: q('.lb-delta'), mode: q('.lb-mode'), wins: q('.lb-wins') };
  });

  let start = null;
  const wins = brands.map(() => 0);
  const counted = new Set();

  function update(st) {
    const totals = st.players.map((p) => p.stack + (p.bet || 0));
    if (st.handId === 0) { start = null; wins.fill(0); counted.clear(); } // 新比赛
    if (!start) start = totals.slice();
    st.players.forEach((p, i) => {
      const k = `${st.handId}:${i}`;
      if (p.winner && !counted.has(k)) { counted.add(k); wins[i]++; }
    });
    // 在局者按筹码排；出局者按名次排在后面
    const key = (i) => (st.players[i].sittingOut ? -2e9 : st.players[i].eliminated ? -1e9 - (st.players[i].place || 0) : totals[i]);
    const order = totals.map((_, i) => i).sort((a, b) => key(b) - key(a) || a - b);
    const max = Math.max(1, ...totals);
    if (handEl) handEl.textContent = `第 ${st.handId} 手`;
    // 不参赛的座位不占行：排在最后并隐藏
    root.style.setProperty('--n', st.players.filter((p) => !p.sittingOut).length);
    order.forEach((i, r) => {
      const row = rows[i];
      const p = st.players[i];
      const active = st.toAct === i;
      row.el.style.setProperty('--i', r);
      row.el.hidden = !!p.sittingOut;
      row.el.dataset.rank = r + 1;
      row.rank.textContent = r + 1;
      row.chips.textContent = fmt(totals[i]);
      row.bar.style.width = `${(totals[i] / max) * 100}%`;
      const d = totals[i] - start[i];
      row.delta.textContent = p.sittingOut ? '' : d === 0 ? '±0' : (d > 0 ? '+' : '') + fmt(d);
      row.delta.dataset.sign = Math.sign(d);
      row.wins.textContent = wins[i] ? `胜 ${wins[i]}` : '';
      const live = !p.eliminated && !p.sittingOut;
      row.mode.textContent = [st.modes?.squid && live && p.squids ? `🦑${p.squids}` : '', st.modes?.royale && live && p.bounty ? `🎯${fmt(p.bounty)}` : '', p.kills ? `⚔${p.kills}` : ''].filter(Boolean).join(' ');
      const champ = st.tournament?.finished && p.place === 1;
      const type = champ ? 'win' : p.eliminated ? 'out' : p.winner ? 'win' : active ? 'active' : p.folded ? 'fold' : p.allIn ? 'allin' : '';
      row.tag.textContent = champ ? '冠军' : p.sittingOut ? '未参赛' : p.eliminated ? `第${p.place}名` : ({ win: '赢', active: '行动中', fold: '弃牌', allin: '全下' }[type] || '');
      row.tag.dataset.type = type;
      row.el.classList.toggle('active', active);
      row.el.classList.toggle('winner', !!p.winner);
      row.el.classList.toggle('folded', !!p.folded || !!p.eliminated || (!p.cards && st.handId > 0));
    });
  }

  const setFocused = (i) => rows.forEach((r, k) => r.el.classList.toggle('focused', k === i));
  /** 缩小时标题栏里显示的一句话：当前领先者 */
  const leader = (st) => {
    const live = st.players.map((p, i) => ({ i, p, n: p.stack + (p.bet || 0) })).filter((x) => !x.p.eliminated);
    if (!live.length) return '';
    const top = live.sort((a, b) => b.n - a.n)[0];
    return `${brands[top.i].name} ${fmt(top.n)}`;
  };
  return { update, setFocused, leader };
}
