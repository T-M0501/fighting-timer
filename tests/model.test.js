import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateBackup, buildBackup, defaultMenu, sanitizeSettings, formatDuration, formatClock,
  DEFAULT_EXERCISE_NAMES, BACKUP_VERSION,
} from '../js/model.js';

const sampleState = () => ({
  menus: [{ ...defaultMenu(1), name: 'メニューA', items: [{ id: 'i1', name: 'スクワット', workSec: 30, sets: 3, cycles: 2, setRestSec: 10, cycleRestSec: null, restAfterSec: 120 }] }],
  exercises: [{ id: 'e1', name: 'スクワット' }],
  history: [{ id: 'h1', at: '2026-11-16T05:00:00.000Z', menuName: 'メニューA', durationSec: 300 }],
  settings: { beepOn: false, voiceOn: true, volume: 50, countdown: 5, notify: false, keepAwake: false, menuView: 'detail', theme: 'judo', voiceGender: 'male' },
});

test('バックアップ: 書き出し→検証で内容が一致する', () => {
  const st = sampleState();
  const text = JSON.stringify(buildBackup(st));
  const r = validateBackup(text);
  assert.equal(r.ok, true);
  assert.deepEqual(r.data.menus, st.menus);
  assert.deepEqual(r.data.history, st.history);
  assert.deepEqual(r.data.exercises, st.exercises);
  assert.deepEqual(r.data.settings, st.settings);
  assert.equal(r.summary.skipped, 0);
});

test('バックアップ: 壊れたファイル・別形式は拒否', () => {
  assert.equal(validateBackup('{{{').ok, false);
  assert.equal(validateBackup('[]').ok, false);
  assert.equal(validateBackup('null').ok, false);
  assert.equal(validateBackup({ format: 'Other', version: 1, data: {} }).ok, false);
  assert.equal(validateBackup({ format: 'FightingTimerBackup', version: 1 }).ok, false);
  assert.equal(validateBackup({ format: 'FightingTimerBackup', version: 1, data: { menus: {}, exercises: [], history: [] } }).ok, false);
});

test('バックアップ: 新しすぎるバージョンは拒否', () => {
  const b = buildBackup(sampleState());
  b.version = BACKUP_VERSION + 1;
  const r = validateBackup(b);
  assert.equal(r.ok, false);
  assert.match(r.error, /新しい/);
});

test('バックアップ: 不正な要素は除外し、範囲外は丸める', () => {
  const b = buildBackup(sampleState());
  b.data.menus.push({ name: 'B', prepSec: 100000, items: [{ name: 'X', sets: 1000 }] }, 5, null);
  b.data.history.push({ at: 'not-a-date' }, { at: '2026-01-01T00:00:00Z', menuName: 'M', durationSec: -5 });
  const r = validateBackup(b);
  assert.equal(r.ok, true);
  assert.equal(r.data.menus.length, 2);
  assert.equal(r.data.menus[1].prepSec, 1800);
  assert.equal(r.data.menus[1].items[0].sets, 99);
  assert.equal(r.data.history.length, 2);
  assert.equal(r.data.history[1].durationSec, 0);
  assert.equal(r.summary.skipped, 3);
});

test('バックアップ: ID重複は除去', () => {
  const b = buildBackup(sampleState());
  b.data.menus.push({ ...b.data.menus[0] });
  assert.equal(validateBackup(b).data.menus.length, 1);
});

test('設定の補正', () => {
  assert.deepEqual(sanitizeSettings(null), { beepOn: true, voiceOn: true, volume: 80, countdown: 3, notify: false, keepAwake: true, menuView: 'simple', theme: 'kickboxing', voiceGender: 'female' });
  assert.equal(sanitizeSettings({ voiceGender: 'male' }).voiceGender, 'male');
  assert.equal(sanitizeSettings({ voiceGender: 'x' }).voiceGender, 'female');
  assert.equal(sanitizeSettings({ theme: 'karate' }).theme, 'karate');
  assert.equal(sanitizeSettings({ theme: 'bogus' }).theme, 'kickboxing');
  const s = sanitizeSettings({ volume: 500, countdown: 7, beepOn: 'x' });
  assert.equal(s.volume, 100);
  assert.equal(s.countdown, 3);
  assert.equal(s.beepOn, true);
  assert.equal(sanitizeSettings({ volume: -3 }).volume, 0);
});

test('初期種目は10〜15種類でスクワット・腕立て・プランク・腹筋を含む', () => {
  assert.ok(DEFAULT_EXERCISE_NAMES.length >= 10 && DEFAULT_EXERCISE_NAMES.length <= 15);
  for (const n of ['スクワット', '腕立て伏せ', 'プランク', '腹筋']) assert.ok(DEFAULT_EXERCISE_NAMES.includes(n));
  assert.equal(new Set(DEFAULT_EXERCISE_NAMES).size, DEFAULT_EXERCISE_NAMES.length);
});

test('時間の書式', () => {
  assert.equal(formatDuration(0), '0秒');
  assert.equal(formatDuration(45), '45秒');
  assert.equal(formatDuration(750), '12分30秒');
  assert.equal(formatDuration(720), '12分');
  assert.equal(formatDuration(3725), '1時間2分5秒');
  assert.equal(formatClock(1800), '30:00');
  assert.equal(formatClock(5), '00:05');
  assert.equal(formatClock(3725), '1:02:05');
});
