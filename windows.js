/**
 * 浮窗：标题栏拖动、缩小成胶囊、点击置顶；位置与缩小状态记在 localStorage。
 * 位置按就近的左/右边缘锚定，窗口缩小或浏览器改变宽度时，贴右侧的窗口仍然贴右。
 *
 * 结构：<section class="win" id="..."> <header class="win-head">…<button class="win-min"></button></header> <div class="win-body">…</div> </section>
 */

const KEY = 'dpzw:win:';
const M = 12; // 与视口边缘的最小间距
let zTop = 20;
const all = [];

const load = (id) => { try { return JSON.parse(localStorage.getItem(KEY + id)); } catch { return null; } };
const save = (id, v) => { try { localStorage.setItem(KEY + id, JSON.stringify(v)); } catch { /* 隐私模式等 */ } };

/**
 * @param {HTMLElement} el
 * @param {{side:'l'|'r', x:number, y:number, min?:boolean}} def 默认位置：距左/右边缘 x、距顶部 y
 */
export function createWindow(el, def) {
  const head = el.querySelector('.win-head');
  const body = el.querySelector('.win-body');
  const minBtn = el.querySelector('.win-min');
  let pos = { ...def, ...(load(el.id) || {}) };

  function apply() {
    el.classList.toggle('min', !!pos.min);
    minBtn.title = pos.min ? '展开' : '缩小';
    minBtn.setAttribute('aria-expanded', String(!pos.min));
    const w = el.offsetWidth, h = head.offsetHeight;
    const x = Math.max(M, Math.min(pos.x, innerWidth - w - M));
    const y = Math.max(M, Math.min(pos.y, innerHeight - h - M));
    el.style.left = pos.side === 'l' ? `${x}px` : 'auto';
    el.style.right = pos.side === 'r' ? `${x}px` : 'auto';
    el.style.top = `${y}px`;
    body.style.maxHeight = `${Math.max(120, innerHeight - y - h - M)}px`;
  }
  const persist = () => save(el.id, pos);
  const front = () => { el.style.zIndex = ++zTop; };

  function setMinimized(v) {
    pos.min = v;
    apply();
    persist();
  }

  // 拖动：按下标题栏（按钮除外）开始；松手时按窗口中心落在哪半边重新选锚定边
  head.addEventListener('pointerdown', (e) => {
    front();
    if (e.button !== 0 || e.target.closest('button, input, select, a')) return;
    const r = el.getBoundingClientRect();
    const dx = e.clientX - r.left, dy = e.clientY - r.top;
    let moved = false;
    head.setPointerCapture(e.pointerId);
    const move = (ev) => {
      if (!moved && Math.hypot(ev.clientX - e.clientX, ev.clientY - e.clientY) < 4) return;
      moved = true;
      el.classList.add('dragging');
      const left = Math.max(M, Math.min(ev.clientX - dx, innerWidth - r.width - M));
      const top = Math.max(M, Math.min(ev.clientY - dy, innerHeight - head.offsetHeight - M));
      el.style.left = `${left}px`;
      el.style.right = 'auto';
      el.style.top = `${top}px`;
    };
    const up = () => {
      head.removeEventListener('pointermove', move);
      head.removeEventListener('pointerup', up);
      head.removeEventListener('pointercancel', up);
      el.classList.remove('dragging');
      if (!moved) return;
      const b = el.getBoundingClientRect();
      const side = b.left + b.width / 2 > innerWidth / 2 ? 'r' : 'l';
      pos = { ...pos, side, x: side === 'l' ? b.left : innerWidth - b.right, y: b.top };
      apply();
      persist();
    };
    head.addEventListener('pointermove', move);
    head.addEventListener('pointerup', up);
    head.addEventListener('pointercancel', up);
  });
  head.addEventListener('dblclick', (e) => { if (!e.target.closest('button, input, select')) setMinimized(!pos.min); });
  minBtn.addEventListener('click', () => setMinimized(!pos.min));
  el.addEventListener('pointerdown', front);

  const win = {
    el, apply, setMinimized,
    get minimized() { return !!pos.min; },
    reset() { pos = { ...def }; apply(); persist(); },
  };
  all.push(win);
  apply();
  return win;
}

addEventListener('resize', () => all.forEach((w) => w.apply()));

/** 恢复所有浮窗的默认位置与展开状态 */
export const resetWindows = () => all.forEach((w) => w.reset());
