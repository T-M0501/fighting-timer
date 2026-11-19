// 起動処理とルーター
import { app, initData, setupServiceWorker, tryApplyUpdate } from './core.js';
import { h, clear, mount } from './dom.js';
import { renderHome, renderMenus, renderHistory, renderExercises, renderImport } from './screens-main.js';
import { renderEditor } from './screens-edit.js';
import { renderTimer } from './screens-timer.js';
import { renderSettings, renderVoiceTest } from './screens-settings.js';
import { renderVoiceRec } from './screens-voice.js';
import { pageHeader } from './ui.js';

const root = document.getElementById('app');
let currentHash = '';
let suppress = false;

function routeOf(hash) {
  const p = (hash || '#/').replace(/^#/, '').split('/').filter(Boolean);
  return p;
}

function render(hash) {
  if (app.cleanup) { try { app.cleanup(); } catch (e) { console.warn(e); } app.cleanup = null; }
  app.guard = null;
  document.querySelectorAll('.modal-overlay').forEach((e) => e.remove());
  app.route = hash || '#/';
  clear(root);
  const [a, b, c] = routeOf(hash);
  const view = h('div', { class: 'view' });
  mount(root, view);
  try {
    if (!a) renderHome(view);
    else if (a === 'menus') renderMenus(view);
    else if (a === 'menu' && b && c === 'edit') renderEditor(view, b);
    else if (a === 'run' && b) renderTimer(view, b);
    else if (a === 'import') renderImport(view, b);
    else if (a === 'history') renderHistory(view);
    else if (a === 'settings') renderSettings(view);
    else if (a === 'voice') renderVoiceRec(view);
    else if (a === 'voicetest') renderVoiceTest(view);
    else if (a === 'exercises') renderExercises(view);
    else renderHome(view);
  } catch (e) {
    console.error(e);
    clear(view);
    view.append(pageHeader('エラー', '#/'), h('p', { class: 'pad' }, '画面の表示中に問題が起きました。ホームに戻ってやり直してください。'));
  }
  window.scrollTo(0, 0);
  tryApplyUpdate(); // トレーニング中・編集中でなければ、準備済みの更新を適用
}

function setRoute(hash) {
  if (location.hash !== hash) {
    suppress = true;
    location.hash = hash;
  }
  currentHash = hash;
  render(hash);
}

app.go = async (hash) => {
  if (app.guard && app.guard.dirty()) {
    if (!(await app.guard.confirm())) return;
    app.guard = null;
  }
  setRoute(hash);
};

window.addEventListener('hashchange', async () => {
  if (suppress) { suppress = false; return; }
  const target = location.hash || '#/';
  if (app.guard && app.guard.dirty()) {
    suppress = true;
    location.hash = currentHash; // 戻る操作をいったん取り消して確認する
    if (await app.guard.confirm()) {
      app.guard = null;
      setRoute(target);
    }
    return;
  }
  setRoute(target);
});

async function boot() {
  try {
    await initData();
  } catch (e) {
    console.error(e);
    mount(root, h('p', { class: 'pad' }, 'データの読み込みに失敗しました。ページを再読み込みしてください。'));
    return;
  }
  setupServiceWorker();
  setRoute(location.hash || '#/');
}

boot();
