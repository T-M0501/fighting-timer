// アプリ全体の状態と保存操作。画面(screens)はここの app を通してデータを読み書きする。
import { openStore } from './db.js';
import { AudioEngine } from './audio.js';
import {
  DEFAULT_EXERCISE_NAMES, newId, sanitizeSettings, sanitizeMenu, sanitizeExercise, sanitizeHistory,
  cleanName, defaultSettings,
} from './model.js';

export const app = {
  store: null,
  state: { menus: [], exercises: [], history: [], settings: defaultSettings() },
  audio: null,
  guard: null, // { dirty(): boolean, confirm(): Promise<boolean> } 画面を離れる前の確認
  route: '',
  go: null, // router が設定する
  persistent: true,
};

app.audio = new AudioEngine(() => app.state.settings);

const byOrder = (a, b) => a.order - b.order;

export async function initData() {
  app.store = await openStore();
  app.persistent = app.store.persistent;
  const all = await app.store.loadAll();
  const metaMap = new Map(all.meta.map((m) => [m.key, m.value]));
  app.state.settings = sanitizeSettings(metaMap.get('settings'));
  app.state.menus = all.menus.map((m, i) => sanitizeMenu(m, i)).filter(Boolean).sort(byOrder);
  app.state.exercises = all.exercises.map(sanitizeExercise).filter(Boolean);
  app.state.history = all.history.map(sanitizeHistory).filter(Boolean);
  if (!metaMap.get('seeded')) {
    // 初回起動: 基本種目だけ登録（サンプルメニューは作らない）
    const seeds = DEFAULT_EXERCISE_NAMES.map((name) => ({ id: newId(), name }));
    await app.store.putMany('exercises', seeds);
    await app.store.put('meta', { key: 'seeded', value: true });
    await app.store.put('meta', { key: 'settings', value: app.state.settings });
    app.state.exercises = seeds;
  }
  try {
    if (navigator.storage?.persist) await navigator.storage.persist(); // データが自動削除されにくくなる
  } catch { /* ignore */ }
}

// ---- メニュー ----
export async function saveMenu(menu) {
  const clean = sanitizeMenu(menu, 0);
  const i = app.state.menus.findIndex((m) => m.id === clean.id);
  if (i >= 0) {
    clean.order = app.state.menus[i].order;
    app.state.menus[i] = clean;
  } else {
    clean.order = app.state.menus.reduce((mx, m) => Math.max(mx, m.order), -1) + 1;
    app.state.menus.push(clean);
  }
  app.state.menus.sort(byOrder);
  await app.store.put('menus', clean);
  return clean;
}

export async function deleteMenu(id) {
  app.state.menus = app.state.menus.filter((m) => m.id !== id);
  await app.store.del('menus', id); // 履歴は残す
}

export async function reorderMenus(orderedIds) {
  const map = new Map(app.state.menus.map((m) => [m.id, m]));
  const list = orderedIds.map((id) => map.get(id)).filter(Boolean);
  list.forEach((m, i) => { m.order = i; });
  app.state.menus = list;
  await app.store.putMany('menus', list);
}

export async function toggleFavorite(id) {
  const m = app.state.menus.find((x) => x.id === id);
  if (!m) return;
  m.favorite = !m.favorite;
  await app.store.put('menus', m);
}

// ---- 種目 ----
export async function addExercise(name) {
  const n = cleanName(name);
  if (!n) return null;
  const hit = app.state.exercises.find((e) => e.name.toLowerCase() === n.toLowerCase());
  if (hit) return hit;
  const ex = { id: newId(), name: n };
  app.state.exercises.push(ex);
  await app.store.put('exercises', ex);
  return ex;
}

export async function removeExercise(id) {
  app.state.exercises = app.state.exercises.filter((e) => e.id !== id);
  await app.store.del('exercises', id);
}

// ---- 履歴 ----
export async function addHistory({ at, menuName, durationSec }) {
  const rec = sanitizeHistory({ id: newId(), at: new Date(at).toISOString(), menuName, durationSec });
  app.state.history.push(rec);
  await app.store.put('history', rec);
  return rec;
}
export async function deleteHistory(id) {
  app.state.history = app.state.history.filter((x) => x.id !== id);
  await app.store.del('history', id);
}
export async function clearHistory() {
  app.state.history = [];
  await app.store.clear('history');
}
export const historyNewestFirst = () => [...app.state.history].sort((a, b) => Date.parse(b.at) - Date.parse(a.at));

// ---- 設定 ----
export async function saveSettings(patch) {
  app.state.settings = sanitizeSettings({ ...app.state.settings, ...patch });
  await app.store.put('meta', { key: 'settings', value: app.state.settings });
}

// ---- 復元（検証済みデータのみ受け付ける） ----
export async function applyRestore(data) {
  await app.store.replaceAll(data); // 失敗時は元のデータが残る
  app.state.menus = data.menus.slice().sort(byOrder);
  app.state.exercises = data.exercises.slice();
  app.state.history = data.history.slice();
  app.state.settings = data.settings;
}

// ---- Service Worker と安全なタイミングの自動更新 ----
let pendingWorker = null;
export function appIsBusy() {
  return !!(app.guard && app.guard.dirty()) || app.route.startsWith('#/run/');
}
export function tryApplyUpdate() {
  if (!pendingWorker || appIsBusy()) return;
  const w = pendingWorker;
  pendingWorker = null;
  w.postMessage({ type: 'SKIP_WAITING' });
}

export function setupServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  if (location.protocol !== 'https:' && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') return;
  const hadController = !!navigator.serviceWorker.controller;
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloading) return; // 初回インストール時は再読み込みしない
    reloading = true;
    location.reload();
  });
  navigator.serviceWorker.register('./sw.js').then((reg) => {
    app.swReg = reg;
    if (reg.waiting && navigator.serviceWorker.controller) {
      pendingWorker = reg.waiting;
      tryApplyUpdate();
    }
    reg.addEventListener('updatefound', () => {
      const nw = reg.installing;
      if (!nw) return;
      nw.addEventListener('statechange', () => {
        if (nw.state === 'installed' && navigator.serviceWorker.controller) {
          pendingWorker = nw; // 準備完了。トレーニング中・編集中でなければ適用
          tryApplyUpdate();
        }
      });
    });
    const check = () => reg.update().catch(() => {});
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') check(); });
    setInterval(check, 60 * 60 * 1000);
  }).catch((e) => console.warn('Service Worker登録失敗', e));
}
export const hasPendingUpdate = () => !!pendingWorker;
