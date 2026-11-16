// IndexedDB 保存層。バージョン管理付き。使えない環境ではメモリ保存に切り替える。

const DB_NAME = 'fighting-timer';
const DB_VERSION = 1;
export const STORES = ['menus', 'exercises', 'history', 'meta'];

function reqP(req) {
  return new Promise((res, rej) => {
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
}
function txDone(tx) {
  return new Promise((res, rej) => {
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
    tx.onabort = () => rej(tx.error || new Error('transaction aborted'));
  });
}

class IdbStore {
  constructor(db) {
    this.db = db;
    this.persistent = true;
  }
  async loadAll() {
    const tx = this.db.transaction(STORES, 'readonly');
    const out = {};
    for (const s of STORES) out[s] = await reqP(tx.objectStore(s).getAll());
    return out;
  }
  async put(store, value) {
    const tx = this.db.transaction(store, 'readwrite');
    tx.objectStore(store).put(value);
    await txDone(tx);
  }
  async putMany(store, values) {
    const tx = this.db.transaction(store, 'readwrite');
    for (const v of values) tx.objectStore(store).put(v);
    await txDone(tx);
  }
  async del(store, key) {
    const tx = this.db.transaction(store, 'readwrite');
    tx.objectStore(store).delete(key);
    await txDone(tx);
  }
  async clear(store) {
    const tx = this.db.transaction(store, 'readwrite');
    tx.objectStore(store).clear();
    await txDone(tx);
  }
  /** すべてを1つのトランザクションで置き換える。途中で失敗したら元のデータは変わらない */
  async replaceAll(data) {
    const tx = this.db.transaction(STORES, 'readwrite');
    const done = txDone(tx);
    try {
      for (const s of STORES) tx.objectStore(s).clear();
      for (const m of data.menus) tx.objectStore('menus').put(m);
      for (const e of data.exercises) tx.objectStore('exercises').put(e);
      for (const h of data.history) tx.objectStore('history').put(h);
      tx.objectStore('meta').put({ key: 'settings', value: data.settings });
      tx.objectStore('meta').put({ key: 'seeded', value: true });
    } catch (err) {
      try { tx.abort(); } catch { /* ignore */ }
      done.catch(() => {});
      throw err;
    }
    await done;
  }
}

class MemoryStore {
  constructor() {
    this.persistent = false;
    this.data = { menus: new Map(), exercises: new Map(), history: new Map(), meta: new Map() };
  }
  keyOf(store, v) {
    return store === 'meta' ? v.key : v.id;
  }
  async loadAll() {
    const out = {};
    for (const s of STORES) out[s] = [...this.data[s].values()].map((v) => structuredClone(v));
    return out;
  }
  async put(store, v) { this.data[store].set(this.keyOf(store, v), structuredClone(v)); }
  async putMany(store, vs) { for (const v of vs) await this.put(store, v); }
  async del(store, key) { this.data[store].delete(key); }
  async clear(store) { this.data[store].clear(); }
  async replaceAll(data) {
    for (const s of STORES) this.data[s].clear();
    for (const m of data.menus) await this.put('menus', m);
    for (const e of data.exercises) await this.put('exercises', e);
    for (const h of data.history) await this.put('history', h);
    await this.put('meta', { key: 'settings', value: data.settings });
    await this.put('meta', { key: 'seeded', value: true });
  }
}

export async function openStore() {
  if (!('indexedDB' in globalThis)) return new MemoryStore();
  try {
    const db = await new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (ev) => {
        const d = req.result;
        // 将来のバージョンアップ時は oldVersion に応じてここへ段階的に追記する（既存ストアは消さない）
        if (ev.oldVersion < 1) {
          d.createObjectStore('menus', { keyPath: 'id' });
          d.createObjectStore('exercises', { keyPath: 'id' });
          d.createObjectStore('history', { keyPath: 'id' });
          d.createObjectStore('meta', { keyPath: 'key' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error('blocked'));
    });
    db.onversionchange = () => db.close();
    return new IdbStore(db);
  } catch (err) {
    console.warn('IndexedDB を開けませんでした。メモリ保存に切り替えます', err);
    return new MemoryStore();
  }
}
