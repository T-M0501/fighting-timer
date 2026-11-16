// 画面共通の部品
import { h } from './dom.js';
import { app } from './core.js';
import { buildPlan } from './engine.js';
import { formatDuration } from './model.js';

export function pageHeader(title, backHash, right) {
  return h('header', { class: 'page-head' },
    backHash ? h('button', { class: 'btn btn-ghost back', 'aria-label': '戻る', onClick: () => app.go(backHash) }, '← 戻る') : h('span'),
    h('h1', null, title),
    right || h('span'));
}

export function menuTotalSec(menu) {
  return buildPlan(menu).totalSec;
}

export function menuSummary(menu) {
  const total = menuTotalSec(menu);
  const mode = menu.repeatMode === 'circuit' ? `サーキット ${menu.laps}周` : '種目ごと';
  return `${mode} ・ ${menu.items.length}種目 ・ 合計 ${total ? formatDuration(total) : '—'}`;
}

const WD = ['日', '月', '火', '水', '木', '金', '土'];
export function fmtDateTime(iso) {
  const d = new Date(iso);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())}(${WD[d.getDay()]}) ${p(d.getHours())}:${p(d.getMinutes())}`;
}
