// メニュー作成・編集画面。「保存」を押したときだけ内容を確定する。
import { h, clear, mount, confirmDialog, openModal, toast, timeField, numberField, segmented, makeSortable, moveItem } from './dom.js';
import { app, saveMenu, addExercise } from './core.js';
import { buildPlan } from './engine.js';
import { defaultMenu, newItem, LIMITS, formatDuration, formatClock } from './model.js';
import { pageHeader, flowTimeline } from './ui.js';

export function renderEditor(root, id) {
  const isNew = id === 'new';
  const found = isNew ? defaultMenu() : app.state.menus.find((m) => m.id === id);
  if (!found) {
    mount(root, pageHeader('メニュー', '#/menus'), h('p', { class: 'pad' }, 'メニューが見つかりません。'));
    return;
  }
  const draft = structuredClone(found);
  let snapshot = JSON.stringify(draft);
  const isDirty = () => JSON.stringify(draft) !== snapshot;

  app.guard = {
    dirty: isDirty,
    confirm: () => confirmDialog({ title: '変更を破棄しますか？', message: '保存していない変更は失われます。', okText: '破棄する', cancelText: '編集を続ける', danger: true }),
  };
  const onBeforeUnload = (e) => { if (isDirty()) { e.preventDefault(); e.returnValue = ''; } };
  window.addEventListener('beforeunload', onBeforeUnload);
  app.cleanup = () => window.removeEventListener('beforeunload', onBeforeUnload);

  const T = LIMITS.MAX_TIME_SEC;
  const form = h('div', { class: 'form' });
  const totalEl = h('div', { class: 'total-box' });

  const flowBox = h('details', { class: 'card flow-box' }, h('summary', null, 'このメニューの流れを確認する'));
  const flowBody = h('div');
  flowBox.append(flowBody);
  const FLOW_LIMIT = 8; // これより行が多いときは折りたたむ
  let flowMode = 'simple'; // simple=種目ごと / detail=1セットごと
  let flowAll = false; // 折りたたんだ続きを表示しているか
  let openKeys = null; // 詳細表示で開いている種目(周回)

  function drawFlow() {
    clear(flowBody);
    const { rows, totalSec } = flowTimeline(draft);
    const groups = rows.filter((r) => r.type === 'group');
    if (!groups.length) {
      flowBody.append(h('p', { class: 'meta' }, '種目を追加すると、ここに流れが表示されます。'));
      return;
    }
    if (!openKeys) openKeys = new Set([groups[0].key]);
    const detail = flowMode === 'detail';
    const allOpen = groups.every((g) => openKeys.has(g.key));
    const line = (r) => [
      h('span', { class: 'tl-at' }, formatClock(r.at)),
      h('span', { class: 'tl-text' }, r.name ? h('b', null, r.name) : null, r.name ? ' ' : null, r.text),
      r.dur != null ? h('span', { class: 'tl-dur' }, formatDuration(r.dur)) : null];
    const list = h('ol', { class: 'tl' });
    const shown = flowAll ? rows : rows.slice(0, FLOW_LIMIT);
    for (const r of shown) {
      if (detail && r.type === 'group') {
        list.append(h('li', { class: 'tl-group' }, h('details', {
          open: openKeys.has(r.key),
          onToggle: (e) => { if (e.target.open) openKeys.add(r.key); else openKeys.delete(r.key); },
        },
        h('summary', { class: 'tl-row' }, line(r)),
        h('ol', { class: 'tl tl-sub' }, r.children.map((c) => h('li', { class: 'tl-row tl-' + c.type }, line(c)))))));
      } else {
        list.append(h('li', { class: 'tl-row tl-' + r.type }, line(r)));
      }
    }
    const hidden = rows.length - shown.length;
    if (!hidden) list.append(h('li', { class: 'tl-row tl-end' }, line({ at: totalSec, text: '終了' })));
    mount(flowBody,
      segmented({
        label: '流れの表示', value: flowMode,
        options: draft.repeatMode === 'circuit'
          ? [{ value: 'simple', label: '簡易（周回ごと）' }, { value: 'detail', label: '詳細（種目ごと）' }]
          : [{ value: 'simple', label: '簡易（種目ごと）' }, { value: 'detail', label: '詳細（1セットごと）' }],
        onChange: (v) => { flowMode = v; drawFlow(); },
      }),
      detail ? h('button', {
        class: 'btn btn-ghost tl-btn',
        onClick: () => { openKeys = new Set(allOpen ? [] : groups.map((g) => g.key)); drawFlow(); },
      }, allOpen ? 'すべて閉じる' : 'すべて開く') : null,
      list,
      rows.length > FLOW_LIMIT ? h('button', {
        class: 'btn btn-block tl-btn',
        onClick: () => { flowAll = !flowAll; drawFlow(); },
      }, flowAll ? '折りたたむ' : `続きを表示（あと${hidden}行）`) : null);
  }

  const updateTotal = () => {
    drawFlow();
    const plan = buildPlan({ ...draft, laps: draft.laps });
    clear(totalEl);
    totalEl.append(
      h('span', { class: 'total-label' }, '合計時間'),
      h('span', { class: 'total-val' }, draft.items.length ? formatDuration(plan.totalSec) : '—'));
  };

  const nameInput = h('input', {
    type: 'text', class: 'text', maxlength: LIMITS.NAME_MAX, placeholder: '例：朝の筋トレ', value: draft.name, 'aria-label': 'メニュー名',
    onInput: (e) => { draft.name = e.target.value; },
  });

  function build() {
    clear(form);
    const circuit = draft.repeatMode === 'circuit';
    const individual = draft.timeMode === 'individual';

    form.append(
      h('section', { class: 'card' }, h('label', { class: 'fld-label' }, 'メニュー名'), nameInput),
      h('section', { class: 'card' },
        h('div', { class: 'fld-label' }, '① 運動時間'),
        segmented({
          label: '運動時間の決め方', value: draft.timeMode,
          options: [{ value: 'common', label: '全種目で同じ' }, { value: 'individual', label: '種目ごとに決める' }],
          onChange: (v) => { draft.timeMode = v; build(); },
        }),
        individual ? h('p', { class: 'meta' }, '運動時間は、下の「④ 種目」で1つずつ決めます。') : timeField({
          label: '1セットの運動時間', value: draft.commonWorkSec, min: 1, max: T,
          onChange: (v) => { draft.commonWorkSec = v; updateTotal(); },
        })),
      h('section', { class: 'card' },
        h('div', { class: 'fld-label' }, '② 進め方'),
        segmented({
          label: '進め方', value: draft.repeatMode,
          options: [{ value: 'exercise', label: '1種目ずつ' }, { value: 'circuit', label: 'サーキット' }],
          onChange: (v) => { draft.repeatMode = v; openKeys = null; flowAll = false; build(); },
        }),
        h('p', { class: 'meta' }, circuit
          ? 'サーキット：種目を順番に1回ずつ行い、最後の種目まで終わったら最初に戻ります。これを「周回数」の分だけ繰り返します。'
          : '1種目ずつ：1つの種目を決めたセット数だけ行ってから、次の種目へ進みます。「サイクル」を2以上にすると、同じ内容をもう一度繰り返せます（例：4セット×2サイクル＝4セット → 休憩 → 4セット）。'),
        circuit ? numberField({
          label: '周回数（全種目を何周するか）', value: draft.laps, min: 1, max: LIMITS.MAX_LAPS, steps: [-1, 1], format: (v) => `${v}周`,
          onChange: (v) => { draft.laps = v; updateTotal(); },
        }) : null),
      h('section', { class: 'card' },
        h('div', { class: 'fld-label' }, '③ 準備と休憩の時間'),
        timeField({ label: '準備時間（スタートから最初の運動まで）', value: draft.prepSec, min: 0, max: T, onChange: (v) => { draft.prepSec = v; updateTotal(); } }),
        circuit ? null : timeField({ label: 'セット間の休憩（1セット終わるごとの休憩）', value: draft.setRestSec, min: 0, max: T, onChange: (v) => { draft.setRestSec = v; updateTotal(); } }),
        circuit ? null : timeField({
          label: 'サイクル間の休憩（1サイクル終わるごとの休憩）', value: draft.circuitRestSec, min: 0, max: T,
          onChange: (v) => { draft.circuitRestSec = v; updateTotal(); },
        }),
        timeField({ label: '種目間の休憩（次の種目に移るときの休憩）', value: draft.exerciseRestSec, min: 0, max: T, onChange: (v) => { draft.exerciseRestSec = v; updateTotal(); } }),
        circuit ? timeField({
          label: '周回間の休憩（1周終わるごとの休憩）', value: draft.circuitRestSec, min: 0, max: T,
          onChange: (v) => { draft.circuitRestSec = v; updateTotal(); },
        }) : h('p', { class: 'meta' }, 'ここで決めた休憩は、すべての種目に使われます。種目によって変えたいときは、下の各種目にある「この種目だけ休憩を変える」を開いてください。')),
      h('section', null,
        h('h2', { class: 'sec' }, `④ 種目（${draft.items.length}）`),
        itemsList(),
        h('button', { class: 'btn btn-primary btn-lg btn-block', onClick: openPicker }, '＋ 種目を追加')),
      flowBox,
    );
    updateTotal();
  }

  function itemsList() {
    const circuit = draft.repeatMode === 'circuit';
    const individual = draft.timeMode === 'individual';
    const ul = h('ul', { class: 'list sortable' });
    if (!draft.items.length) ul.append(h('li', { class: 'meta pad' }, 'まだ種目がありません。下の「＋ 種目を追加」から選んでください。'));
    draft.items.forEach((it, i) => {
      ul.append(h('li', { class: 'card item', 'data-sortable': '' },
        h('div', { class: 'row-top' },
          h('span', { class: 'drag-handle', role: 'img', 'aria-label': 'ドラッグして並び替え' }, '⠿'),
          h('span', { class: 'item-no' }, String(i + 1)),
          h('div', { class: 'menu-main' }, h('div', { class: 'menu-name' }, it.name)),
          h('button', { class: 'btn btn-icon', 'aria-label': '上へ', disabled: i === 0, onClick: () => reorder(i, i - 1) }, '↑'),
          h('button', { class: 'btn btn-icon', 'aria-label': '下へ', disabled: i === draft.items.length - 1, onClick: () => reorder(i, i + 1) }, '↓'),
          h('button', { class: 'btn btn-danger-ghost btn-icon', 'aria-label': `${it.name}を外す`, onClick: () => { draft.items.splice(i, 1); build(); } }, '✕')),
        individual ? timeField({ label: '運動時間', value: it.workSec, min: 1, max: T, onChange: (v) => { it.workSec = v; updateTotal(); } }) : null,
        circuit ? null : numberField({
          label: 'セット数（この種目を何回行うか）', value: it.sets, min: 1, max: LIMITS.MAX_SETS, steps: [-1, 1], format: (v) => `${v}セット`,
          onChange: (v) => { it.sets = v; updateTotal(); },
        }),
        circuit ? null : numberField({
          label: 'サイクル数（上のセットをまとめて何回繰り返すか）', value: it.cycles, min: 1, max: LIMITS.MAX_SETS, steps: [-1, 1], format: (v) => `${v}サイクル`,
          onChange: (v) => { it.cycles = v; updateTotal(); },
        }),
        circuit ? null : restOverrides(it)));
    });
    makeSortable(ul, { onReorder: reorder });
    return ul;
  }

  /** 種目ごとの休憩の個別設定（チェックを外すとメニュー共通の値を使う） */
  function restOverrides(it) {
    const rows = [
      ['setRestSec', 'セット間の休憩', () => draft.setRestSec],
      ['cycleRestSec', 'サイクル間の休憩', () => draft.circuitRestSec],
      ['restAfterSec', 'この種目のあとの休憩', () => draft.exerciseRestSec],
    ];
    const used = rows.some(([k]) => it[k] !== null && it[k] !== undefined);
    const det = h('details', { class: 'ovr-box', open: used }, h('summary', null, 'この種目だけ休憩を変える（任意）'));
    for (const [key, label, menuVal] of rows) {
      const wrap = h('div', { class: 'ovr' });
      const draw = () => {
        clear(wrap);
        const on = it[key] !== null && it[key] !== undefined;
        mount(wrap,
          h('label', { class: 'ovr-chk' },
            h('input', {
              type: 'checkbox', checked: on,
              onChange: (e) => { it[key] = e.target.checked ? menuVal() : null; draw(); updateTotal(); },
            }),
            h('span', null, on ? `${label}を変える` : `${label}：③の設定のまま（${formatDuration(menuVal())}）`)),
          on ? timeField({ label: '休憩時間', value: it[key], min: 0, max: T, onChange: (v) => { it[key] = v; updateTotal(); } }) : null);
      };
      draw();
      det.append(wrap);
    }
    return det;
  }

  function reorder(from, to) {
    draft.items = moveItem(draft.items, from, to);
    build();
  }

  function addItem(name) {
    draft.items.push(newItem(name, draft.commonWorkSec));
    build();
  }

  function openPicker() {
    const list = h('ul', { class: 'list pick-list' });
    const input = h('input', { type: 'text', class: 'text', maxlength: 40, placeholder: '新しい種目名を入力', 'aria-label': '新しい種目名' });
    const drawList = () => {
      clear(list);
      for (const e of app.state.exercises) {
        list.append(h('li', null, h('button', { class: 'btn btn-block pick-btn', onClick: () => { addItem(e.name); toast(`「${e.name}」を追加しました`); } }, '＋ ', e.name)));
      }
    };
    const addNew = async () => {
      const ex = await addExercise(input.value);
      if (!ex) { toast('種目名を入力してください'); return; }
      input.value = '';
      addItem(ex.name);
      drawList();
      toast(`「${ex.name}」を登録して追加しました`);
    };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') addNew(); });
    drawList();
    const m = openModal(h('div', { class: 'picker' },
      h('h2', { class: 'modal-title' }, '種目を追加'),
      h('p', { class: 'meta' }, '同じ種目を何回でも追加できます。'),
      h('div', { class: 'add-row' }, input, h('button', { class: 'btn btn-primary', onClick: addNew }, '登録して追加')),
      list,
      h('div', { class: 'modal-actions' }, h('button', { class: 'btn btn-primary', onClick: () => m.close() }, '閉じる'))));
  }

  async function save() {
    draft.name = draft.name.trim();
    if (!draft.name) {
      toast('メニュー名を入力してください');
      nameInput.focus();
      return;
    }
    await saveMenu(draft);
    snapshot = JSON.stringify(draft); // 未保存扱いを解除
    toast('保存しました');
    app.go('#/menus');
  }

  build();
  mount(root, 
    pageHeader(isNew ? 'メニュー作成' : 'メニュー編集', '#/menus'),
    form,
    h('div', { class: 'bottom-bar' }, totalEl, h('button', { class: 'btn btn-primary btn-lg', onClick: save }, '保存')));
}
