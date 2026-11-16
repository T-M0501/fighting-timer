// データモデル・入力検証・バックアップ検証（画面に依存しない純粋なロジック）

export const LIMITS = Object.freeze({
  MAX_TIME_SEC: 30 * 60, // 運動・休憩・準備の上限 30分
  MAX_SETS: 99,
  MAX_LAPS: 99,
  NAME_MAX: 40,
});

export const BACKUP_FORMAT = 'FightingTimerBackup';
export const BACKUP_VERSION = 1;
export const COUNTDOWN_CHOICES = [0, 3, 5, 10];
export const THEMES = [
  { id: 'normal', label: '通常', color: '#e8590c' },
  { id: 'kickboxing', label: 'キックボクシング', color: '#c92a2a' },
  { id: 'boxing', label: 'ボクシング', color: '#1d4f91' },
  { id: 'judo', label: '柔道', color: '#34478f' },
  { id: 'karate', label: '空手', color: '#2b2d31' },
];

export const DEFAULT_EXERCISE_NAMES = [
  'スクワット', '腕立て伏せ', 'プランク', '腹筋', '背筋',
  'ランジ', 'バーピー', 'マウンテンクライマー', 'ジャンピングジャック', 'もも上げ',
  'サイドプランク', 'ブリッジ', 'レッグレイズ', 'バックエクステンション', '縄跳び',
];

export function newId() {
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

export function clampInt(value, min, max, fallback) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

export function cleanName(value, max = LIMITS.NAME_MAX) {
  return String(value ?? '').replace(/[\r\n\t]+/g, ' ').trim().slice(0, max);
}

export function defaultMenu(order = 0) {
  return {
    id: newId(),
    name: '',
    favorite: false,
    order,
    timeMode: 'common', // 'common' 共通時間 | 'individual' 種目別時間
    commonWorkSec: 30,
    repeatMode: 'exercise', // 'exercise' 種目ごとに全セット | 'circuit' サーキット
    prepSec: 10,
    setRestSec: 15,
    exerciseRestSec: 30,
    circuitRestSec: 30,
    laps: 3,
    items: [],
  };
}

/** 空(null/未設定)は「メニュー共通の値を使う」。値があれば 0〜30分に補正 */
function optionalSec(v) {
  if (v === null || v === undefined || v === '') return null;
  return clampInt(v, 0, LIMITS.MAX_TIME_SEC, null);
}

export function sanitizeItem(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const name = cleanName(raw.name);
  if (!name) return null;
  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : newId(),
    name,
    workSec: clampInt(raw.workSec, 1, LIMITS.MAX_TIME_SEC, 30),
    sets: clampInt(raw.sets, 1, LIMITS.MAX_SETS, 3),
    cycles: clampInt(raw.cycles, 1, LIMITS.MAX_SETS, 1), // 同じ種目を繰り返す回数(種目ごとに全セットの方式のみ)
    setRestSec: optionalSec(raw.setRestSec), // この種目のセット間休憩(空=メニュー共通)
    cycleRestSec: optionalSec(raw.cycleRestSec), // この種目のサイクル間休憩(空=メニュー共通)
    restAfterSec: optionalSec(raw.restAfterSec), // この種目の後の休憩(空=メニューの種目間休憩)
  };
}

export function newItem(name, workSec = 30) {
  return { id: newId(), name, workSec, sets: 3, cycles: 1, setRestSec: null, cycleRestSec: null, restAfterSec: null };
}

export function sanitizeMenu(raw, fallbackOrder = 0) {
  if (!raw || typeof raw !== 'object') return null;
  const items = Array.isArray(raw.items) ? raw.items.map(sanitizeItem).filter(Boolean) : [];
  const T = LIMITS.MAX_TIME_SEC;
  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : newId(),
    name: cleanName(raw.name) || '無題のメニュー',
    favorite: !!raw.favorite,
    order: Number.isFinite(raw.order) ? raw.order : fallbackOrder,
    timeMode: raw.timeMode === 'individual' ? 'individual' : 'common',
    commonWorkSec: clampInt(raw.commonWorkSec, 1, T, 30),
    repeatMode: raw.repeatMode === 'circuit' ? 'circuit' : 'exercise',
    prepSec: clampInt(raw.prepSec, 0, T, 10),
    setRestSec: clampInt(raw.setRestSec, 0, T, 15),
    exerciseRestSec: clampInt(raw.exerciseRestSec, 0, T, 30),
    circuitRestSec: clampInt(raw.circuitRestSec, 0, T, 30),
    laps: clampInt(raw.laps, 1, LIMITS.MAX_LAPS, 3),
    items,
  };
}

export function sanitizeExercise(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const name = cleanName(raw.name);
  if (!name) return null;
  return { id: typeof raw.id === 'string' && raw.id ? raw.id : newId(), name };
}

export function sanitizeHistory(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const t = Date.parse(raw.at);
  if (!Number.isFinite(t)) return null;
  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : newId(),
    at: new Date(t).toISOString(),
    menuName: cleanName(raw.menuName, 80) || '（名称なし）',
    durationSec: clampInt(raw.durationSec, 0, 10_000_000, 0),
  };
}

export function defaultSettings() {
  return { beepOn: true, voiceOn: true, volume: 80, countdown: 3, notify: false, keepAwake: true, menuView: 'simple', theme: 'kickboxing', voiceGender: 'female' };
}

export function sanitizeSettings(raw) {
  const d = defaultSettings();
  if (!raw || typeof raw !== 'object') return d;
  const cd = Number(raw.countdown);
  return {
    beepOn: typeof raw.beepOn === 'boolean' ? raw.beepOn : d.beepOn,
    voiceOn: typeof raw.voiceOn === 'boolean' ? raw.voiceOn : d.voiceOn,
    volume: clampInt(raw.volume, 0, 100, d.volume),
    countdown: COUNTDOWN_CHOICES.includes(cd) ? cd : d.countdown,
    notify: typeof raw.notify === 'boolean' ? raw.notify : d.notify,
    keepAwake: typeof raw.keepAwake === 'boolean' ? raw.keepAwake : d.keepAwake,
    menuView: raw.menuView === 'detail' ? 'detail' : 'simple',
    theme: THEMES.some((t) => t.id === raw.theme) ? raw.theme : d.theme,
    voiceGender: raw.voiceGender === 'male' ? 'male' : 'female',
  };
}

function dedupeById(list) {
  const seen = new Set();
  return list.filter((x) => (seen.has(x.id) ? false : (seen.add(x.id), true)));
}

// ---- バックアップ ----

export function buildBackup(state, now = new Date()) {
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: now.toISOString(),
    data: {
      menus: state.menus,
      exercises: state.exercises,
      history: state.history,
      settings: state.settings,
    },
  };
}

/** バックアップ(文字列またはオブジェクト)を検証し、安全な形に整える。失敗時は {ok:false,error} */
export function validateBackup(input) {
  let obj = input;
  if (typeof input === 'string') {
    try {
      obj = JSON.parse(input);
    } catch {
      return { ok: false, error: 'ファイルを読み取れませんでした。Fighting Timerのバックアップファイルではないか、壊れています。' };
    }
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    return { ok: false, error: 'バックアップファイルの形式が正しくありません。' };
  }
  if (obj.format !== BACKUP_FORMAT) {
    return { ok: false, error: 'Fighting Timerのバックアップファイルではありません。' };
  }
  if (!Number.isInteger(obj.version) || obj.version < 1) {
    return { ok: false, error: 'バックアップのバージョン情報が正しくありません。' };
  }
  if (obj.version > BACKUP_VERSION) {
    return { ok: false, error: 'このバックアップはより新しいバージョンのアプリで作成されました。アプリを更新してからやり直してください。' };
  }
  const d = obj.data;
  if (!d || typeof d !== 'object' || !Array.isArray(d.menus) || !Array.isArray(d.exercises) || !Array.isArray(d.history)) {
    return { ok: false, error: 'バックアップの内容が不足しているため復元できません。' };
  }
  let skipped = 0;
  const pick = (arr, fn) => arr.map((x, i) => {
    const r = fn(x, i);
    if (!r) skipped++;
    return r;
  }).filter(Boolean);
  const menus = dedupeById(pick(d.menus, (x, i) => sanitizeMenu(x, i)));
  const exercises = dedupeById(pick(d.exercises, sanitizeExercise));
  const history = dedupeById(pick(d.history, sanitizeHistory));
  const settings = sanitizeSettings(d.settings);
  return {
    ok: true,
    data: { menus, exercises, history, settings },
    summary: { menus: menus.length, exercises: exercises.length, history: history.length, skipped },
  };
}

// ---- 表示用の書式 ----

export function formatDuration(sec) {
  const t = Math.max(0, Math.round(sec));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = t % 60;
  if (h) return `${h}時間${m}分${s ? s + '秒' : ''}`;
  if (m) return `${m}分${s ? s + '秒' : ''}`;
  return `${s}秒`;
}

export function formatClock(sec) {
  const t = Math.max(0, Math.round(sec));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = t % 60;
  const p = (n) => String(n).padStart(2, '0');
  return h ? `${h}:${p(m)}:${p(s)}` : `${p(m)}:${p(s)}`;
}
