// 画面共通の部品
import { h } from './dom.js';
import { app } from './core.js';
import { buildPlan } from './engine.js';
import { formatDuration } from './model.js';

export function pageHeader(title, backHash, right) {
  return h('header', { class: 'page-head' },
    h('div', { class: 'head-left' },
      backHash && backHash !== '#/' ? h('button', { class: 'btn btn-ghost back', 'aria-label': '戻る', onClick: () => app.go(backHash) }, '← 戻る') : null,
      h('button', { class: 'btn home-btn', 'aria-label': 'トップ画面に戻る', onClick: () => app.go('#/') }, '🏠 ホーム')),
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

/** 詳細表示用: 設定の要約と種目一覧 */
export function menuDetail(menu) {
  const d = formatDuration;
  const settings = [];
  if (menu.timeMode === 'common') settings.push(`運動 ${d(menu.commonWorkSec)}`);
  settings.push(`準備 ${menu.prepSec ? d(menu.prepSec) : 'なし'}`);
  if (menu.repeatMode === 'circuit') {
    settings.push(`${menu.laps}周`, `種目間休憩 ${d(menu.exerciseRestSec)}`, `周回間休憩 ${d(menu.circuitRestSec)}`);
  } else {
    settings.push(`セット間休憩 ${d(menu.setRestSec)}`, `種目間休憩 ${d(menu.exerciseRestSec)}`);
  }
  const items = menu.items.map((it, i) => {
    const parts = [];
    if (menu.timeMode === 'individual') parts.push(d(it.workSec));
    if (menu.repeatMode !== 'circuit') parts.push(`${it.sets}セット`);
    return `${i + 1}. ${it.name}${parts.length ? '　' + parts.join(' × ') : ''}`;
  });
  return { settings, items };
}

const WD =['日', '月', '火', '水', '木', '金', '土'];
export function fmtDateTime(iso) {
  const d = new Date(iso);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())}(${WD[d.getDay()]}) ${p(d.getHours())}:${p(d.getMinutes())}`;
}
