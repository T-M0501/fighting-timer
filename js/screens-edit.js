// メニュー作成・編集画面。「保存」を押したときだけ内容を確定する。
import { h, clear, mount, confirmDialog, openModal, toast, timeField, numberField, segmented, makeSortable, moveItem } from './dom.js';
import { app, saveMenu, addExercise } from './core.js';
import { buildPlan } from './engine.js';
import { defaultMenu, newItem, LIMITS, formatDuration } from './model.js';
import { pageHeader } from './ui.js';

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

  const updateTotal = () => {
    const plan = buildPlan({ ...draft, laps: draft.laps });
    clear(totalEl);
    totalEl.append(
      h('span', { class: 'total-label' }, '合計予定時間'),
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
        h('div', { class: 'fld-label' }, '運動時間の決め方'),
        segmented({
          label: '運動時間の決め方', value: draft.timeMode,
          options: [{ value: 'common', label: '全種目共通' }, { value: 'individual', label: '種目ごとに設定' }],
          onChange: (v) => { draft.timeMode = v; build(); },
        }),
        individual ? h('p', { class: 'meta' }, '運動時間は下の各種目で設定します。') : timeField({
          label: '運動時間（共通）', value: draft.commonWorkSec, min: 1, max: T,
          onChange: (v) => { draft.commonWorkSec = v; updateTotal(); },
        })),
      h('section', { class: 'card' },
        h('div', { class: 'fld-label' }, '進め方'),
        segmented({
          label: '進め方', value: draft.repeatMode,
          options: [{ value: 'exercise', label: '種目ごとに全セット' }, { value: 'circuit', label: 'サーキット' }],
          onChange: (v) => { draft.repeatMode = v; build(); },
        }),
        h('p', { class: 'meta' }, circuit ? '登録した種目を順番に1周し、それを周回数だけ繰り返します。' : '1つの種目のセットを全部終えてから、次の種目へ進みます。'),
        circuit ? numberField({
          label: '周回数', value: draft.laps, min: 1, max: LIMITS.MAX_LAPS, steps: [-1, 1], format: (v) => `${v}周`,
          onChange: (v) => { draft.laps = v; updateTotal(); },
        }) : null),
      h('section', { class: 'card' },
        h('div', { class: 'fld-label' }, '準備・休憩'),
        timeField({ label: '準備時間（0秒で即開始）', value: draft.prepSec, min: 0, max: T, onChange: (v) => { draft.prepSec = v; updateTotal(); } }),
        circuit ? null : timeField({ label: 'セット間の休憩', value: draft.setRestSec, min: 0, max: T, onChange: (v) => { draft.setRestSec = v; updateTotal(); } }),
        timeField({ label: '種目間の休憩', value: draft.exerciseRestSec, min: 0, max: T, onChange: (v) => { draft.exerciseRestSec = v; updateTotal(); } }),
        timeField({
          label: circuit ? '周回間の休憩' : 'サイクル間の休憩（同じ種目を繰り返すとき）', value: draft.circuitRestSec, min: 0, max: T,
          onChange: (v) => { draft.circuitRestSec = v; updateTotal(); },
        }),
        circuit ? null : h('p', { class: 'meta' }, '各種目の「休憩の個別設定」で、種目ごとに別の休憩にもできます。')),
      h('section', null,
        h('h2', { class: 'sec' }, `種目（${draft.items.length}）`),
        itemsList(),
        h('button', { class: 'btn btn-primary btn-lg btn-block', onClick: openPicker }, '＋ 種目を追加')),
    );
    updateTotal();
  }

  function itemsList() {
    const circuit = draft.repeatMode === 'circuit';
    const individual = draft.timeMode === 'individual';
    const ul = h('ul', { class: 'list sortable' });
    if (!draft.items.length) ul.append(h('li', { class: 'meta pad' }, 'まだ種目がありません。下のボタンから追加してください。'));
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
          label: 'セット数', value: it.sets, min: 1, max: LIMITS.MAX_SETS, steps: [-1, 1], format: (v) => `${v}セット`,
          onChange: (v) => { it.sets = v; updateTotal(); },
        }),
        circuit ? null : numberField({
          label: 'サイクル数（セットをまとめて繰り返す回数）', value: it.cycles, min: 1, max: LIMITS.MAX_SETS, steps: [-1, 1], format: (v) => `${v}サイクル`,
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
      ['setRestSec', 'この種目のセット間休憩', () => draft.setRestSec],
      ['cycleRestSec', 'この種目のサイクル間休憩', () => draft.circuitRestSec],
      ['restAfterSec', 'この種目が終わったあとの休憩（次の種目へ）', () => draft.exerciseRestSec],
    ];
    const used = rows.some(([k]) => it[k] !== null && it[k] !== undefined);
    const det = h('details', { class: 'ovr-box', open: used }, h('summary', null, '休憩の個別設定'));
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
            h('span', null, on ? label : `${label}：共通（${formatDuration(menuVal())}）`)),
          on ? timeField({ label: '秒数', value: it[key], min: 0, max: T, onChange: (v) => { it[key] = v; updateTotal(); } }) : null);
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
