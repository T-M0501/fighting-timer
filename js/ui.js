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
  const mode = menu.repeatMode === 'circuit' ? `サーキット ${menu.laps}周` : '1種目ずつ';
  return `${mode} ・ ${menu.items.length}種目 ・ 合計 ${total ? formatDuration(total) : '—'}`;
}

/** 編集画面用: このメニューがどう進むかを日本語で説明（'↓'で始まる行は休憩） */
export function flowLines(menu) {
  const d = formatDuration;
  const items = menu.items || [];
  if (!items.length) return ['種目を追加すると、ここに流れが表示されます。'];
  const pick = (v, def) => (v === null || v === undefined ? def : v);
  const rest = (sec) => (sec > 0 ? `↓ 休憩 ${d(sec)}` : null);
  const lines = [];
  if (menu.prepSec > 0) lines.push(`準備 ${d(menu.prepSec)}`);
  const work = (it) => (menu.timeMode === 'individual' ? it.workSec : menu.commonWorkSec);
  if (menu.repeatMode === 'circuit') {
    for (let i = 0; i < items.length; i++) {
      lines.push(`${items[i].name}（運動 ${d(work(items[i]))}）`);
      if (i < items.length - 1) { const r = rest(menu.exerciseRestSec); if (r) lines.push(r); }
    }
    lines.push(`↑ ここまでを ${menu.laps}周 くり返します` + (menu.circuitRestSec > 0 ? `（周回の間は休憩 ${d(menu.circuitRestSec)}）` : ''));
    return lines;
  }
  items.forEach((it, i) => {
    const setRest = pick(it.setRestSec, menu.setRestSec);
    const cycleRest = pick(it.cycleRestSec, menu.circuitRestSec);
    const cycles = it.cycles || 1;
    let s = `${it.name}：運動 ${d(work(it))} を ${it.sets}セット`;
    if (it.sets > 1) s += setRest > 0 ? `（セットの間は休憩 ${d(setRest)}）` : '（セットの間は休憩なし）';
    if (cycles > 1) s += ` → これを ${cycles}サイクル` + (cycleRest > 0 ? `（サイクルの間は休憩 ${d(cycleRest)}）` : '（サイクルの間は休憩なし）');
    lines.push(s);
    if (i < items.length - 1) { const r = rest(pick(it.restAfterSec, menu.exerciseRestSec)); if (r) lines.push(r); }
  });
  return lines;
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
    const extra = [];
    if (menu.timeMode === 'individual') parts.push(d(it.workSec));
    if (menu.repeatMode !== 'circuit') {
      parts.push(`${it.sets}セット`);
      if (it.cycles > 1) parts.push(`${it.cycles}サイクル`);
      if (it.setRestSec != null) extra.push(`セット間休憩${d(it.setRestSec)}`);
      if (it.cycleRestSec != null && it.cycles > 1) extra.push(`サイクル間休憩${d(it.cycleRestSec)}`);
      if (it.restAfterSec != null) extra.push(`終了後の休憩${d(it.restAfterSec)}`);
    }
    return `${i + 1}. ${it.name}${parts.length ? '　' + parts.join(' × ') : ''}${extra.length ? '（' + extra.join('、') + '）' : ''}`;
  });
  return { settings, items };
}

const WD =['日', '月', '火', '水', '木', '金', '土'];
export function fmtDateTime(iso) {
  const d = new Date(iso);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())}(${WD[d.getDay()]}) ${p(d.getHours())}:${p(d.getMinutes())}`;
}
