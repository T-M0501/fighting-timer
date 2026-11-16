// ホーム・メニュー一覧・履歴・種目管理
import { h, clear, mount, confirmDialog, toast, makeSortable, moveItem, segmented } from './dom.js';
import { app, saveSettings, toggleFavorite, deleteMenu, reorderMenus, deleteHistory, clearHistory, historyNewestFirst, addExercise, removeExercise } from './core.js';
import { themeIcon } from './glove.js';
import { pageHeader, menuSummary, menuDetail, fmtDateTime } from './ui.js';

function detailBlock(m) {
  const d = menuDetail(m);
  return h('div', { class: 'detail' },
    h('div', { class: 'detail-settings' }, d.settings.join(' ／ ')),
    d.items.length ? h('ol', { class: 'detail-items' }, d.items.map((t) => h('li', null, t.replace(/^\d+\.\s/, '')))) : h('div', { class: 'meta' }, '種目がありません'));
}
import { formatDuration } from './model.js';

function historyRow(rec, { deletable, onDelete } = {}) {
  return h('li', { class: 'card hist' },
    h('div', { class: 'hist-main' },
      h('div', { class: 'hist-name' }, rec.menuName),
      h('div', { class: 'meta' }, fmtDateTime(rec.at), ' ・ ', formatDuration(rec.durationSec))),
    deletable ? h('button', { class: 'btn btn-danger-ghost', 'aria-label': `${rec.menuName}の履歴を削除`, onClick: onDelete }, '削除') : null);
}

export function renderHome(root) {
  const { menus } = app.state;
  const favs = menus.filter((m) => m.favorite);
  const recent = historyNewestFirst().slice(0, 3);
  mount(root, 
    h('header', { class: 'home-head' + (app.state.settings.theme === 'normal' ? '' : ' themed') },
      themeIcon(app.state.settings.theme),
      h('div', null, h('h1', null, 'Fighting Timer'))),
    menus.length === 0
      ? h('section', { class: 'card hero' },
        h('h2', null, 'はじめましょう'),
        h('p', null, 'まだトレーニングメニューがありません。最初のメニューを作りましょう。'),
        h('button', { class: 'btn btn-primary btn-lg', onClick: () => app.go('#/menu/new/edit') }, 'メニューを新規作成'))
      : null,
    h('section', null,
      h('h2', { class: 'sec' }, '★ お気に入りメニュー'),
      favs.length
        ? h('ul', { class: 'list' }, favs.map((m) => h('li', { class: 'card' },
          h('div', { class: 'menu-main' }, h('div', { class: 'menu-name' }, m.name), h('div', { class: 'meta' }, menuSummary(m))),
          h('button', { class: 'btn btn-primary', onClick: () => app.go(`#/run/${m.id}`) }, '開始'))))
        : (menus.length ? h('p', { class: 'meta pad' }, 'お気に入りはまだありません。メニュー一覧で ☆ を押すとここに表示されます。') : null)),
    h('section', null,
      h('h2', { class: 'sec' }, '最近のトレーニング'),
      recent.length ? h('ul', { class: 'list' }, recent.map((r) => historyRow(r))) : h('p', { class: 'meta pad' }, 'まだ履歴がありません。')),
    h('nav', { class: 'nav-grid', 'aria-label': 'メインメニュー' },
      h('button', { class: 'btn nav-btn', onClick: () => app.go('#/menus') }, h('span', { class: 'nav-ico' }, '📋'), 'メニュー一覧'),
      h('button', { class: 'btn nav-btn', onClick: () => app.go('#/history') }, h('span', { class: 'nav-ico' }, '🕘'), '履歴'),
      h('button', { class: 'btn nav-btn', onClick: () => app.go('#/settings') }, h('span', { class: 'nav-ico' }, '⚙️'), '設定')),
  );
}

export function renderMenus(root) {
  const listEl = h('ul', { class: 'list sortable' });
  const draw = () => {
    clear(listEl);
    const menus = app.state.menus;
    if (!menus.length) {
      listEl.append(h('li', { class: 'meta pad' }, 'メニューがありません。「＋ 新規作成」から作りましょう。'));
      return;
    }
    menus.forEach((m, i) => {
      listEl.append(h('li', { class: 'card menu-card', 'data-sortable': '', dataset: { id: m.id } },
        h('div', { class: 'row-top' },
          h('span', { class: 'drag-handle', 'aria-label': 'ドラッグして並び替え', role: 'img' }, '⠿'),
          h('button', {
            class: 'btn btn-star' + (m.favorite ? ' on' : ''),
            'aria-label': m.favorite ? 'お気に入り解除' : 'お気に入りに登録',
            'aria-pressed': m.favorite ? 'true' : 'false',
            onClick: async () => { await toggleFavorite(m.id); draw(); },
          }, m.favorite ? '★' : '☆'),
          h('div', { class: 'menu-main' }, h('div', { class: 'menu-name' }, m.name), h('div', { class: 'meta' }, menuSummary(m)))),
        app.state.settings.menuView === 'detail' ? detailBlock(m) : null,
        h('div', { class: 'row-actions' },
          h('button', { class: 'btn btn-primary', disabled: m.items.length === 0, onClick: () => app.go(`#/run/${m.id}`) }, '開始'),
          h('button', { class: 'btn', onClick: () => app.go(`#/menu/${m.id}/edit`) }, '編集'),
          h('button', { class: 'btn btn-icon', 'aria-label': '上へ', disabled: i === 0, onClick: () => move(i, i - 1) }, '↑'),
          h('button', { class: 'btn btn-icon', 'aria-label': '下へ', disabled: i === menus.length - 1, onClick: () => move(i, i + 1) }, '↓'),
          h('button', {
            class: 'btn btn-danger-ghost',
            onClick: async () => {
              const ok = await confirmDialog({ title: 'メニューを削除しますか？', message: `「${m.name}」を削除します。過去の履歴は残ります。`, okText: '削除する', danger: true });
              if (ok) { await deleteMenu(m.id); toast('削除しました'); draw(); }
            },
          }, '削除'))));
    });
  };
  const move = async (from, to) => {
    const ids = moveItem(app.state.menus.map((m) => m.id), from, to);
    await reorderMenus(ids);
    draw();
  };
  makeSortable(listEl, { onReorder: move });
  draw();
  const viewToggle = h('div', { class: 'view-toggle' });
  const drawToggle = () => {
    clear(viewToggle);
    viewToggle.append(segmented({
      label: '表示切替', value: app.state.settings.menuView,
      options: [{ value: 'simple', label: '通常表示' }, { value: 'detail', label: '詳細表示' }],
      onChange: async (v) => { await saveSettings({ menuView: v }); drawToggle(); draw(); },
    }));
  };
  drawToggle();
  mount(root,
    pageHeader('メニュー一覧', '#/', h('button', { class: 'btn btn-primary', onClick: () => app.go('#/menu/new/edit') }, '＋新規')),
    viewToggle,
    listEl);
}

export function renderHistory(root) {
  const listEl = h('ul', { class: 'list' });
  const clearBtn = h('button', {
    class: 'btn btn-danger-ghost',
    onClick: async () => {
      const ok = await confirmDialog({ title: '履歴をすべて削除しますか？', message: `${app.state.history.length}件の履歴を削除します。元に戻せません。`, okText: 'すべて削除', danger: true });
      if (ok) { await clearHistory(); draw(); toast('すべて削除しました'); }
    },
  }, '全件削除');
  const draw = () => {
    clear(listEl);
    const list = historyNewestFirst();
    clearBtn.disabled = list.length === 0;
    if (!list.length) { listEl.append(h('li', { class: 'meta pad' }, '履歴はまだありません。トレーニング終了時に「履歴を保存」を選ぶとここに残ります。')); return; }
    for (const r of list) {
      listEl.append(historyRow(r, {
        deletable: true,
        onDelete: async () => {
          const ok = await confirmDialog({ title: 'この履歴を削除しますか？', message: `${r.menuName}（${fmtDateTime(r.at)}）`, okText: '削除する', danger: true });
          if (ok) { await deleteHistory(r.id); draw(); }
        },
      }));
    }
  };
  draw();
  mount(root, pageHeader('履歴', '#/', clearBtn), listEl);
}

export function renderExercises(root) {
  const listEl = h('ul', { class: 'list' });
  const input = h('input', { type: 'text', maxlength: 40, placeholder: '新しい種目名', 'aria-label': '新しい種目名', class: 'text' });
  const draw = () => {
    clear(listEl);
    for (const e of app.state.exercises) {
      listEl.append(h('li', { class: 'card ex-row' },
        h('span', { class: 'menu-name' }, e.name),
        h('button', {
          class: 'btn btn-danger-ghost',
          onClick: async () => {
            const ok = await confirmDialog({ title: '種目を削除しますか？', message: `「${e.name}」を登録種目から削除します。作成済みのメニュー内の種目は変わりません。`, okText: '削除する', danger: true });
            if (ok) { await removeExercise(e.id); draw(); }
          },
        }, '削除')));
    }
  };
  const add = async () => {
    const ex = await addExercise(input.value);
    if (!ex) { toast('種目名を入力してください'); return; }
    input.value = '';
    draw();
    toast('登録しました');
  };
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') add(); });
  draw();
  mount(root, 
    pageHeader('登録種目の管理', '#/settings'),
    h('div', { class: 'card add-row' }, input, h('button', { class: 'btn btn-primary', onClick: add }, '登録')),
    listEl);
}
