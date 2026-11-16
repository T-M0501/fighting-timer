// 画面部品の小さなヘルパー。innerHTMLは使わず、必ず textContent 経由で表示する(バックアップ由来の文字列でも安全)。
import { formatDuration } from './model.js';

const PROP_KEYS = new Set(['value', 'checked', 'disabled', 'selected']);

export function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (PROP_KEYS.has(k)) el[k] = v;
      else el.setAttribute(k, v === true ? '' : String(v));
    }
  }
  append(el, kids);
  return el;
}

export function append(el, kids) {
  for (const k of kids) {
    if (k == null || k === false) continue;
    if (Array.isArray(k)) append(el, k);
    else el.append(k instanceof Node ? k : document.createTextNode(String(k)));
  }
  return el;
}

/** el.append と同じだが null/false を無視する（そのまま渡すと「null」と表示されてしまうため） */
export function mount(el, ...kids) {
  return append(el, kids);
}

export function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
}

// ---- モーダル・確認ダイアログ ----
export function openModal(content, { dismissable = false } = {}) {
  const overlay = h('div', { class: 'modal-overlay' }, h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true' }, content));
  document.body.append(overlay);
  const close = () => overlay.remove();
  if (dismissable) overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  return { close, overlay };
}

export function confirmDialog({ title, message, okText = 'OK', cancelText = 'キャンセル', danger = false }) {
  return new Promise((resolve) => {
    const m = openModal(
      h('div', null,
        h('h2', { class: 'modal-title' }, title),
        message ? h('p', { class: 'modal-msg' }, message) : null,
        h('div', { class: 'modal-actions' },
          h('button', { class: 'btn', onClick: () => { m.close(); resolve(false); } }, cancelText),
          h('button', { class: 'btn ' + (danger ? 'btn-danger' : 'btn-primary'), onClick: () => { m.close(); resolve(true); } }, okText))),
    );
  });
}

export function alertDialog({ title, message, okText = '閉じる' }) {
  return new Promise((resolve) => {
    const m = openModal(
      h('div', null,
        h('h2', { class: 'modal-title' }, title),
        message ? h('p', { class: 'modal-msg' }, message) : null,
        h('div', { class: 'modal-actions' }, h('button', { class: 'btn btn-primary', onClick: () => { m.close(); resolve(); } }, okText))),
    );
  });
}

let toastTimer = null;
export function toast(message) {
  let el = document.getElementById('toast');
  if (!el) {
    el = h('div', { id: 'toast', role: 'status', 'aria-live': 'polite' });
    document.body.append(el);
  }
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
}

// ---- 数値入力（±ボタン付き） ----
export function numberField({ label, value, min, max, steps, format, onChange, hint }) {
  let v = value;
  const input = h('input', { type: 'number', inputmode: 'numeric', min, max, value: v, 'aria-label': label });
  const fmt = h('span', { class: 'nf-fmt' });
  const refresh = () => {
    input.value = String(v);
    fmt.textContent = format ? format(v) : '';
  };
  const commit = (n) => {
    v = Math.min(max, Math.max(min, Math.round(n)));
    refresh();
    onChange(v);
  };
  input.addEventListener('input', () => {
    const n = input.valueAsNumber;
    if (Number.isFinite(n) && n >= min && n <= max) {
      v = Math.round(n);
      fmt.textContent = format ? format(v) : '';
      onChange(v);
    }
  });
  input.addEventListener('change', () => {
    const n = input.valueAsNumber;
    commit(Number.isFinite(n) ? n : v); // 範囲外・空欄は範囲内に補正
  });
  const btn = (s) => h('button', {
    type: 'button',
    class: 'btn btn-step',
    'aria-label': `${label} ${s > 0 ? '+' : ''}${s}`,
    onClick: () => commit(v + s),
  }, (s > 0 ? '+' : '−') + Math.abs(s));
  const neg = steps.filter((s) => s < 0).sort((a, b) => a - b).map(btn);
  const pos = steps.filter((s) => s > 0).sort((a, b) => a - b).map(btn);
  refresh();
  const row = h('div', { class: 'nf-row' }, neg, input, pos);
  row.style.setProperty('--cols', String(steps.length + 1));
  return h('div', { class: 'nf' },
    h('div', { class: 'nf-label' }, h('span', null, label), fmt),
    row,
    hint ? h('div', { class: 'nf-hint' }, hint) : null,
  );
}

export const TIME_STEPS = [-10, -5, 5, 10];
export const timeField = (opts) => numberField({ steps: TIME_STEPS, format: formatDuration, ...opts });

export function segmented({ options, value, onChange, label }) {
  const wrap = h('div', { class: 'seg', role: 'group', 'aria-label': label || '' });
  for (const o of options) {
    wrap.append(h('button', {
      type: 'button',
      class: 'seg-btn' + (o.value === value ? ' on' : ''),
      'aria-pressed': o.value === value ? 'true' : 'false',
      onClick: () => onChange(o.value),
    }, o.label));
  }
  return wrap;
}

// ---- ドラッグ並び替え（ハンドルをつかんで上下に動かす） ----
export function makeSortable(container, { onReorder, handle = '.drag-handle', itemSel = '[data-sortable]' }) {
  container.addEventListener('pointerdown', (e) => {
    const hd = e.target.closest(handle);
    if (!hd || !container.contains(hd)) return;
    const item = hd.closest(itemSel);
    if (!item || item.parentElement !== container) return;
    e.preventDefault();
    const list = () => [...container.children].filter((c) => c.matches(itemSel));
    const from = list().indexOf(item);
    item.classList.add('dragging');
    try { hd.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    const move = (ev) => {
      const sibs = list().filter((x) => x !== item);
      let placed = false;
      for (const s of sibs) {
        const r = s.getBoundingClientRect();
        if (ev.clientY < r.top + r.height / 2) {
          if (item.nextElementSibling !== s) container.insertBefore(item, s);
          placed = true;
          break;
        }
      }
      if (!placed && container.lastElementChild !== item) container.append(item);
      if (ev.clientY < 70) window.scrollBy(0, -12);
      else if (ev.clientY > window.innerHeight - 70) window.scrollBy(0, 12);
    };
    const up = () => {
      hd.removeEventListener('pointermove', move);
      hd.removeEventListener('pointerup', up);
      hd.removeEventListener('pointercancel', up);
      item.classList.remove('dragging');
      const to = list().indexOf(item);
      if (to !== from) onReorder(from, to);
    };
    hd.addEventListener('pointermove', move);
    hd.addEventListener('pointerup', up);
    hd.addEventListener('pointercancel', up);
  });
}

export function moveItem(arr, from, to) {
  const a = arr.slice();
  const [x] = a.splice(from, 1);
  a.splice(to, 0, x);
  return a;
}
