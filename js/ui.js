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

/**
 * 編集画面用: このメニューがどう進むかの説明。行は { type, name?, text, time? }
 * type: prep(準備) / item(種目) / rest(休憩) / loop(周回の説明) / total(合計) / note
 */
export function flowLines(menu) {
  const d = formatDuration;
  const items = menu.items || [];
  if (!items.length) return [{ type: 'note', text: '種目を追加すると、ここに流れが表示されます。' }];
  const pick = (v, def) => (v === null || v === undefined ? def : v);
  const work = (it) => (menu.timeMode === 'individual' ? it.workSec : menu.commonWorkSec);
  const rows = [];
  if (menu.prepSec > 0) rows.push({ type: 'prep', text: '準備', time: d(menu.prepSec) });
  if (menu.repeatMode === 'circuit') {
    let lapSec = 0;
    items.forEach((it, i) => {
      rows.push({ type: 'item', name: `${i + 1}. ${it.name}`, text: `運動 ${d(work(it))}`, time: d(work(it)) });
      lapSec += work(it);
      if (i < items.length - 1) {
        lapSec += menu.exerciseRestSec;
        if (menu.exerciseRestSec > 0) rows.push({ type: 'rest', text: `↓ 種目間 休憩 ${d(menu.exerciseRestSec)}` });
      }
    });
    rows.push({
      type: 'loop',
      text: `↑ ここまでを ${menu.laps}周（周回間${menu.circuitRestSec > 0 ? '休憩 ' + d(menu.circuitRestSec) : '休憩なし'}）`,
      time: `1周 ${d(lapSec)}`,
    });
  } else {
    items.forEach((it, i) => {
      const w = work(it);
      const sets = it.sets;
      const cycles = it.cycles || 1;
      const setRest = pick(it.setRestSec, menu.setRestSec);
      const cycleRest = pick(it.cycleRestSec, menu.circuitRestSec);
      let text = `運動 ${d(w)} × ${sets}セット`;
      if (sets > 1) text += `（セット間 ${setRest > 0 ? '休憩 ' + d(setRest) : '休憩なし'}）`;
      if (cycles > 1) text += ` × ${cycles}サイクル（サイクル間 ${cycleRest > 0 ? '休憩 ' + d(cycleRest) : '休憩なし'}）`;
      const oneCycle = sets * w + (sets - 1) * setRest;
      const sec = cycles * oneCycle + (cycles - 1) * cycleRest;
      rows.push({ type: 'item', name: `${i + 1}. ${it.name}`, text, time: d(sec) });
      if (i < items.length - 1) {
        const r = pick(it.restAfterSec, menu.exerciseRestSec);
        if (r > 0) rows.push({ type: 'rest', text: `↓ 種目間 休憩 ${d(r)}${it.restAfterSec != null ? '（この種目だけ変更）' : ''}` });
      }
    });
  }
  rows.push({ type: 'total', text: '合計', time: d(buildPlan(menu).totalSec) });
  return rows;
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
      if (it.restAfterSec != null) extra.push(`この種目のあとの休憩${d(it.restAfterSec)}`);
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
