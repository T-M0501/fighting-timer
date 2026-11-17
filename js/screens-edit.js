// メニュー作成・編集画面。「保存」を押したときだけ内容を確定する。
// 種目を上から並べるだけのシンプルな一覧で、行を押すとその場で開いて編集できる。
import { h, clear, mount, confirmDialog, openModal, toast, timeField, numberField, segmented, makeSortable, moveItem } from './dom.js';
import { app, saveMenu, addExercise } from './core.js';
import { buildPlan } from './engine.js';
import { defaultMenu, newItem, LIMITS, formatDuration, formatClock } from './model.js';
import { pageHeader, flowTimeline, itemSummary } from './ui.js';

export function renderEditor(root, id) {
  const isNew = id === 'new';
  const found = isNew ? defaultMenu() : app.state.menus.find((m) => m.id === id);
  if (!found) {
    mount(root, pageHeader('メニュー', '#/menus'), h('p', { class: 'pad' }, 'メニューが見つかりません。'));
    return;
  }
  const draft = structuredClone(found);

  // 時間と休憩はすべて種目ごとに持たせる。
  // 以前の「全種目で同じ運動時間」「メニュー共通の休憩」は各種目の値に展開する（タイマーの進み方は変わらない）。
  if (draft.timeMode !== 'individual') {
    for (const it of draft.items) it.workSec = draft.commonWorkSec;
    draft.timeMode = 'individual';
  }
  for (const it of draft.items) {
    if (it.setRestSec == null) it.setRestSec = draft.setRestSec;
    if (it.restAfterSec == null) it.restAfterSec = draft.exerciseRestSec;
    if (it.cycleRestSec == null) it.cycleRestSec = draft.circuitRestSec;
  }
  let snapshot = JSON.stringify(draft); // 展開しただけでは「変更あり」にしない
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

  // ---- メニューの流れ（時系列） ----
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
    const plan = buildPlan(draft);
    clear(totalEl);
    totalEl.append(
      h('span', { class: 'total-label' }, '合計時間'),
      h('span', { class: 'total-val' }, draft.items.length ? formatDuration(plan.totalSec) : '—'));
  };

  const nameInput = h('input', {
    type: 'text', class: 'text', maxlength: LIMITS.NAME_MAX, placeholder: '例：朝の筋トレ', value: draft.name, 'aria-label': 'メニュー名',
    onInput: (e) => { draft.name = e.target.value; },
  });

  // ---- 一覧の状態 ----
  let openKey = null; // 開いている行（'prep' または種目のid）
  let modeOpen = false; // 「進め方」を開いているか
  const cycOpen = new Set(); // 「サイクル」を開いている種目
  let sumEls = [];
  const refreshSummaries = () => {
    for (const [el, it] of sumEls) el.textContent = itemSummary(draft, it);
  };
  const changed = () => { refreshSummaries(); updateTotal(); };
  const toggle = (key) => { openKey = openKey === key ? null : key; build(); };

  function build() {
    clear(form);
    const circuit = draft.repeatMode === 'circuit';
    form.append(
      h('section', { class: 'card' }, h('label', { class: 'fld-label' }, 'メニュー名'), nameInput),
      h('section', null,
        h('h2', { class: 'sec' }, `種目（${draft.items.length}）`),
        h('p', { class: 'meta it-help' }, circuit ? '行を押すと、運動時間を変えられます。' : '行を押すと、運動時間・セット数を変えられます。種目の間の「インターバル」を押すと、次の種目までの休憩を変えられます。'),
        itemsList(),
        h('button', { class: 'btn btn-primary btn-lg btn-block', onClick: openPicker }, '＋ 種目を追加')),
      h('details', { class: 'card flow-box', open: circuit || modeOpen, onToggle: (e) => { modeOpen = e.target.open; } },
        h('summary', null, `進め方：${circuit ? `サーキット（${draft.laps}周）` : '1種目ずつ'}`),
        segmented({
          label: '進め方', value: draft.repeatMode,
          options: [{ value: 'exercise', label: '1種目ずつ' }, { value: 'circuit', label: 'サーキット' }],
          onChange: (v) => { draft.repeatMode = v; openKeys = null; flowAll = false; modeOpen = true; build(); },
        }),
        h('p', { class: 'meta' }, circuit
          ? 'サーキット：種目を順番に1回ずつ行い、最後の種目まで終わったら最初に戻ります。これを「周回数」の分だけ繰り返します。'
          : '1種目ずつ：上の種目を順番に、決めたセット数だけ行ってから次の種目へ進みます。'),
        circuit ? numberField({
          label: '周回数（全種目を何周するか）', value: draft.laps, min: 1, max: LIMITS.MAX_LAPS, steps: [-1, 1], format: (v) => `${v}周`,
          onChange: (v) => { draft.laps = v; updateTotal(); },
        }) : null,
        circuit ? timeField({ label: '種目間の休憩（次の種目に移るときの休憩）', value: draft.exerciseRestSec, min: 0, max: T, onChange: (v) => { draft.exerciseRestSec = v; updateTotal(); } }) : null,
        circuit ? timeField({ label: '周回間の休憩（1周終わるごとの休憩）', value: draft.circuitRestSec, min: 0, max: T, onChange: (v) => { draft.circuitRestSec = v; updateTotal(); } }) : null),
      flowBox,
    );
    updateTotal();
  }

  /** 一覧の1行（押すと開く） */
  function rowHead(key, { no, name, sumEl, handle }) {
    const open = openKey === key;
    return h('div', {
      class: 'it-row', role: 'button', tabindex: '0', 'aria-expanded': open ? 'true' : 'false',
      onClick: (e) => { if (!e.target.closest('.drag-handle')) toggle(key); },
      onKeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(key); } },
    },
    handle ? h('span', { class: 'drag-handle', role: 'img', 'aria-label': 'ドラッグして並び替え' }, '⠿') : null,
    no != null ? h('span', { class: 'item-no' }, String(no)) : null,
    h('div', { class: 'menu-main' }, h('div', { class: 'menu-name' }, name), sumEl),
    h('span', { class: 'it-chev', 'aria-hidden': 'true' }, open ? '▴' : '▾'));
  }

  function itemsList() {
    const circuit = draft.repeatMode === 'circuit';
    const ul = h('ul', { class: 'list sortable' });
    sumEls = [];
    // 準備（スタートから最初の運動まで）
    const prepText = (v) => (v ? formatDuration(v) : 'なし');
    const prepSum = h('div', { class: 'meta' }, prepText(draft.prepSec));
    ul.append(h('li', { class: 'card item it-prep' + (openKey === 'prep' ? ' open' : '') },
      rowHead('prep', { name: '準備（スタートから最初の運動まで）', sumEl: prepSum }),
      openKey === 'prep' ? h('div', { class: 'it-body' },
        timeField({ label: '準備時間', value: draft.prepSec, min: 0, max: T, onChange: (v) => { draft.prepSec = v; prepSum.textContent = prepText(v); updateTotal(); } }),
        h('div', { class: 'row-actions' }, h('button', { class: 'btn btn-primary', onClick: () => toggle('prep') }, 'OK'))) : null));
    if (!draft.items.length) ul.append(h('li', { class: 'meta pad' }, 'まだ種目がありません。下の「＋ 種目を追加」から選んでください。'));
    const lastIdx = draft.items.length - 1;
    draft.items.forEach((it, i) => {
      const last = i === lastIdx;
      const sumEl = h('div', { class: 'meta' }, itemSummary(draft, it));
      sumEls.push([sumEl, it]);
      const open = openKey === it.id;
      ul.append(h('li', { class: 'card item' + (open ? ' open' : ''), 'data-sortable': '' },
        rowHead(it.id, { no: i + 1, name: it.name, sumEl, handle: true }),
        open ? itemBody(it, i, last, circuit) : null));
      if (!circuit && !last) ul.append(gapRow(it));
    });
    makeSortable(ul, { onReorder: reorder });
    // ドラッグ中はインターバルの行を隠し、指を離したら並びを描き直す（インターバルは前の種目についていく）
    ul.addEventListener('pointerdown', (e) => { if (e.target.closest('.drag-handle')) ul.classList.add('sorting'); });
    const endDrag = () => { if (ul.classList.contains('sorting')) setTimeout(build, 0); };
    ul.addEventListener('pointerup', endDrag);
    ul.addEventListener('pointercancel', endDrag);
    return ul;
  }

  /** 開いた行の中身 */
  function itemBody(it, i, last, circuit) {
    const body = h('div', { class: 'it-body' });
    body.append(timeField({ label: '運動時間', value: it.workSec, min: 1, max: T, onChange: (v) => { it.workSec = v; changed(); } }));
    if (!circuit) {
      if (it.sets > 1) {
        body.append(timeField({ label: 'セット間の休憩（1セット終わるごと）', value: it.setRestSec, min: 0, max: T, onChange: (v) => { it.setRestSec = v; changed(); } }));
      }
      body.append(numberField({
        label: 'セット数', value: it.sets, min: 1, max: LIMITS.MAX_SETS, steps: [-1, 1], format: (v) => `${v}セット`,
        onChange: (v) => {
          const was = it.sets > 1;
          it.sets = v;
          if (was !== (v > 1)) build(); else changed(); // 2セット以上のときだけ「セット間の休憩」の欄を出す
        },
      }));
      body.append(h('details', {
        class: 'ovr-box', open: it.cycles > 1 || cycOpen.has(it.id),
        onToggle: (e) => { if (e.target.open) cycOpen.add(it.id); else cycOpen.delete(it.id); },
      },
      h('summary', null, 'サイクル（上のセットをまとめて繰り返す・任意）'),
      numberField({
        label: 'サイクル数', value: it.cycles, min: 1, max: LIMITS.MAX_SETS, steps: [-1, 1], format: (v) => `${v}サイクル`,
        onChange: (v) => {
          const was = it.cycles > 1;
          it.cycles = v;
          if (was !== (v > 1)) { cycOpen.add(it.id); build(); } else changed();
        },
      }),
      it.cycles > 1
        ? timeField({ label: 'サイクル間の休憩（1サイクル終わるごと）', value: it.cycleRestSec, min: 0, max: T, onChange: (v) => { it.cycleRestSec = v; changed(); } })
        : h('p', { class: 'meta' }, '例：4セット×2サイクル＝4セット → 休憩 → 4セット')));
    }
    body.append(h('div', { class: 'row-actions wrap' },
      h('button', { class: 'btn btn-primary', onClick: () => toggle(it.id) }, 'OK'),
      h('button', { class: 'btn', onClick: () => duplicate(i) }, '複製'),
      h('button', { class: 'btn btn-icon', 'aria-label': '上へ', disabled: i === 0, onClick: () => reorder(i, i - 1) }, '↑'),
      h('button', { class: 'btn btn-icon', 'aria-label': '下へ', disabled: last, onClick: () => reorder(i, i + 1) }, '↓'),
      h('button', { class: 'btn btn-danger-ghost', 'aria-label': `${it.name}を外す`, onClick: () => { draft.items.splice(i, 1); openKey = null; build(); } }, '外す')));
    return body;
  }

  /** 種目と種目の間のインターバル（次の種目までの休憩）。押すとその場で時間を変えられる */
  function gapRow(it) {
    const key = 'gap:' + it.id;
    const open = openKey === key;
    const text = (v) => (v ? formatDuration(v) : 'なし');
    const val = h('b', null, text(it.restAfterSec));
    return h('li', { class: 'it-gap' + (open ? ' open' : '') },
      h('div', {
        class: 'it-gap-row', role: 'button', tabindex: '0', 'aria-expanded': open ? 'true' : 'false',
        onClick: () => toggle(key),
        onKeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(key); } },
      }, h('span', { 'aria-hidden': 'true' }, '↓'), h('span', null, 'インターバル　', val), h('span', { class: 'it-chev', 'aria-hidden': 'true' }, open ? '▴' : '▾')),
      open ? h('div', { class: 'it-body' },
        timeField({ label: 'インターバル（次の種目までの休憩）', value: it.restAfterSec, min: 0, max: T, onChange: (v) => { it.restAfterSec = v; val.textContent = text(v); updateTotal(); } }),
        h('div', { class: 'row-actions' }, h('button', { class: 'btn btn-primary', onClick: () => toggle(key) }, 'OK'))) : null);
  }

  function reorder(from, to) {
    draft.items = moveItem(draft.items, from, to);
    build();
  }

  function duplicate(i) {
    const src = draft.items[i];
    const copy = { ...src, id: newItem(src.name).id };
    draft.items.splice(i + 1, 0, copy);
    openKey = copy.id;
    build();
    toast(`「${src.name}」を複製しました`);
  }

  /** 新しい種目は、直前の種目と同じ時間・休憩・セット数で追加する（同じ設定の種目を続けて入れやすいように） */
  function addItem(name) {
    const prev = draft.items[draft.items.length - 1];
    const it = newItem(name, prev ? prev.workSec : draft.commonWorkSec);
    it.sets = prev ? prev.sets : 1;
    it.cycles = prev ? prev.cycles : 1;
    it.setRestSec = prev ? prev.setRestSec : draft.setRestSec;
    it.restAfterSec = prev ? prev.restAfterSec : draft.setRestSec;
    it.cycleRestSec = prev ? prev.cycleRestSec : draft.circuitRestSec;
    draft.items.push(it);
    openKey = null;
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
      h('p', { class: 'meta' }, '同じ種目を何回でも追加できます。時間や休憩は、追加したあと一覧の行を押して変えられます。'),
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
