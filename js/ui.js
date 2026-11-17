// 画面共通の部品
import { h, toast } from './dom.js';

/** 文字列をクリップボードにコピーして結果を知らせる */
export async function copyText(text, okMsg = 'コピーしました') {
  const ng = 'コピーできませんでした。文字を長押ししてコピーしてください';
  try {
    await navigator.clipboard.writeText(text);
    toast(okMsg);
    return;
  } catch { /* 下の方法に切り替える */ }
  try {
    const ta = h('textarea', { style: { position: 'fixed', opacity: '0' } });
    ta.value = text;
    document.body.append(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    toast(ok ? okMsg : ng);
  } catch {
    toast(ng);
  }
}
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
 * 編集画面用: メニューの流れを時系列で返す（タイマーと同じ buildPlan の結果から作る）。
 * rows: 準備・休憩は { type:'prep'|'rest', at, text, dur }、
 *       種目(サーキットでは周回)は { type:'group', key, at, name, text, dur, children:[{ type:'work'|'rest', at, text, dur }] }
 * at は開始からの経過秒。
 */
export function flowTimeline(menu) {
  const plan = buildPlan(menu);
  const circuit = menu.repeatMode === 'circuit';
  const d = formatDuration;
  const REST = { set: 'セット間', cycle: 'サイクル間', exercise: '種目間', lap: '周回間' };
  const keyOf = (s) => (circuit ? s.lap : s.item);
  const rows = [];
  let at = 0;
  let group = null;
  for (const s of plan.segments) {
    if (s.kind === 'prep') {
      rows.push({ type: 'prep', at, text: '準備', dur: s.dur });
    } else if (s.kind === 'rest') {
      const row = { type: 'rest', at, text: `休憩（${REST[s.restKind]}）`, dur: s.dur };
      if (group && group.key === keyOf(s)) group.children.push(row);
      else rows.push(row);
    } else {
      if (!group || group.key !== keyOf(s)) {
        group = circuit
          ? { type: 'group', key: s.lap, at, name: `${s.lap}周目`, text: `${menu.items.length}種目を1回ずつ`, dur: 0, children: [] }
          : { type: 'group', key: s.item, at, name: `${s.item + 1}. ${s.name}`, text: `${d(s.dur)} × ${s.sets}セット${s.cycles > 1 ? ` × ${s.cycles}サイクル` : ''}`, dur: 0, children: [] };
        rows.push(group);
      }
      const text = circuit
        ? `${s.item + 1}. ${s.name}`
        : `運動（${s.cycles > 1 ? `${s.cycle}サイクル目・` : ''}${s.set}セット目）`;
      group.children.push({ type: 'work', at, text, dur: s.dur });
      group.dur = at + s.dur - group.at; // グループは必ず運動で終わる
    }
    at += s.dur;
  }
  return { rows, totalSec: plan.totalSec };
}

/** 種目1つ分の内容を1行で表す（例: 30秒 ・ 3セット（セット間の休憩15秒））。編集画面とメニュー詳細で共通 */
export function itemSummary(menu, it) {
  const d = formatDuration;
  const pick = (v, def) => (v === null || v === undefined ? def : v);
  const rest = (sec) => (sec ? d(sec) : 'なし');
  const work = d(menu.timeMode === 'individual' ? it.workSec : menu.commonWorkSec);
  if (menu.repeatMode === 'circuit') return work;
  const parts = [work, it.sets > 1 ? `${it.sets}セット（セット間の休憩${rest(pick(it.setRestSec, menu.setRestSec))}）` : '1セット'];
  if (it.cycles > 1) parts.push(`${it.cycles}サイクル（サイクル間の休憩${rest(pick(it.cycleRestSec, menu.circuitRestSec))}）`);
  return parts.join(' ・ ');
}

/** 詳細表示用: 設定の要約と種目一覧 */
export function menuDetail(menu) {
  const d = formatDuration;
  const circuit = menu.repeatMode === 'circuit';
  const settings = [`準備 ${menu.prepSec ? d(menu.prepSec) : 'なし'}`];
  if (circuit) settings.push(`${menu.laps}周`, `種目間休憩 ${d(menu.exerciseRestSec)}`, `周回間休憩 ${d(menu.circuitRestSec)}`);
  const items = menu.items.map((it, i) => {
    const after = it.restAfterSec === null || it.restAfterSec === undefined ? menu.exerciseRestSec : it.restAfterSec;
    const gap = circuit || i === menu.items.length - 1 ? '' : ` → インターバル${after ? d(after) : 'なし'}`;
    return `${i + 1}. ${it.name}　${itemSummary(menu, it)}${gap}`;
  });
  return { settings, items };
}

const WD =['日', '月', '火', '水', '木', '金', '土'];
export function fmtDateTime(iso) {
  const d = new Date(iso);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())}(${WD[d.getDay()]}) ${p(d.getHours())}:${p(d.getMinutes())}`;
}
