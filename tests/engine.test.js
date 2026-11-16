import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPlan, TimerEngine, nextInfo, crossedCountdown } from '../js/engine.js';
import { defaultMenu, sanitizeMenu } from '../js/model.js';

function menu(over = {}, items) {
  const m = { ...defaultMenu(), name: 't', ...over };
  m.items = items || [
    { id: 'a', name: 'A', workSec: 20, sets: 2 },
    { id: 'b', name: 'B', workSec: 40, sets: 2 },
  ];
  return m;
}
const kinds = (p) => p.segments.map((s) => s.kind[0] + s.dur + (s.restKind ? ':' + s.restKind[0] : '')).join(' ');

test('共通時間・種目完了型: 休憩の種類と順序', () => {
  const p = buildPlan(menu({ prepSec: 5, commonWorkSec: 30, setRestSec: 10, exerciseRestSec: 20 }));
  assert.equal(kinds(p), 'p5 w30 r10:s w30 r20:e w30 r10:s w30');
  assert.equal(p.totalSec, 5 + 30 * 4 + 10 + 20 + 10);
});

test('種目別時間モード', () => {
  const p = buildPlan(menu({ timeMode: 'individual', prepSec: 0, setRestSec: 0, exerciseRestSec: 0 }));
  assert.equal(kinds(p), 'w20 w20 w40 w40');
  assert.equal(p.totalSec, 120);
});

test('サーキット型: 種目間と周回間の休憩が重複しない', () => {
  const p = buildPlan(menu({ repeatMode: 'circuit', laps: 2, prepSec: 0, commonWorkSec: 10, exerciseRestSec: 5, circuitRestSec: 30, setRestSec: 99 }));
  assert.equal(kinds(p), 'w10 r5:e w10 r30:l w10 r5:e w10');
  assert.equal(p.segments.filter((s) => s.kind === 'rest').length, 3);
});

test('サーキットで種目が1つだけでも周回間休憩になる', () => {
  const p = buildPlan(menu({ repeatMode: 'circuit', laps: 3, prepSec: 0, commonWorkSec: 10, circuitRestSec: 7 }, [{ id: 'a', name: 'A', workSec: 1, sets: 1 }]));
  assert.equal(kinds(p), 'w10 r7:l w10 r7:l w10');
});

test('準備0秒・休憩0秒は区間を作らない', () => {
  const p = buildPlan(menu({ prepSec: 0, setRestSec: 0, exerciseRestSec: 0 }));
  assert.ok(p.segments.every((s) => s.kind === 'work'));
});

test('同一種目の重複登録は独立した種目として扱われる', () => {
  const p = buildPlan(menu({ prepSec: 0, setRestSec: 1, exerciseRestSec: 9, commonWorkSec: 5 }, [
    { id: 'a', name: 'X', workSec: 5, sets: 2 },
    { id: 'b', name: 'X', workSec: 5, sets: 2 },
  ]));
  assert.equal(kinds(p), 'w5 r1:s w5 r9:e w5 r1:s w5');
});

test('1セット・種目1つ', () => {
  const p = buildPlan(menu({ prepSec: 3 }, [{ id: 'a', name: 'A', workSec: 1, sets: 1 }]));
  assert.equal(kinds(p), 'p3 w30');
});

test('99セット・99周・最大30分でもフリーズせず合計が正しい', () => {
  const t0 = Date.now();
  const p1 = buildPlan(menu({ timeMode: 'individual', prepSec: 1800, setRestSec: 1800, exerciseRestSec: 1800 }, [{ id: 'a', name: 'A', workSec: 1800, sets: 99 }]));
  assert.equal(p1.totalSec, 1800 + 99 * 1800 + 98 * 1800);
  const many = Array.from({ length: 50 }, (_, i) => ({ id: 'i' + i, name: 'E' + i, workSec: 30, sets: 99 }));
  const p2 = buildPlan(menu({ repeatMode: 'circuit', laps: 99, prepSec: 0, commonWorkSec: 30, exerciseRestSec: 5, circuitRestSec: 20 }, many));
  assert.equal(p2.segments.filter((s) => s.kind === 'work').length, 99 * 50);
  assert.ok(Date.now() - t0 < 2000);
});

test('メニューが空なら計画も空', () => {
  const p = buildPlan(menu({}, []));
  assert.equal(p.segments.length, 0);
  assert.equal(p.totalSec, 0);
  assert.deepEqual(new TimerEngine(p).start(0), []);
});

test('nextInfo', () => {
  const p = buildPlan(menu({ prepSec: 0, setRestSec: 5 }));
  assert.deepEqual(nextInfo(p, 0).kind, 'rest');
  assert.equal(nextInfo(p, p.segments.length - 1).kind, 'end');
});

// ---- エンジン ----
function simple() {
  // prep3 work5 rest2 work5
  return buildPlan(menu({ prepSec: 3, commonWorkSec: 5, setRestSec: 2, exerciseRestSec: 2 }, [{ id: 'a', name: 'A', workSec: 5, sets: 2 }]));
}

test('エンジン: 時刻差分で進行し、終了イベントが出る', () => {
  const e = new TimerEngine(simple());
  assert.deepEqual(e.start(1000), [{ type: 'segment', index: 0 }]);
  assert.equal(e.view(1000).remainingSec, 3);
  assert.deepEqual(e.tick(3999), []);
  assert.deepEqual(e.tick(4000), [{ type: 'segment', index: 1 }]);
  assert.equal(e.view(4000).remainingSec, 5);
  assert.deepEqual(e.tick(9000), [{ type: 'segment', index: 2 }]);
  assert.deepEqual(e.tick(11000), [{ type: 'segment', index: 3 }]);
  assert.deepEqual(e.tick(16000), [{ type: 'finished' }]);
  assert.equal(e.status, 'finished');
  assert.equal(e.view(16000).totalElapsedMs, 15000);
});

test('エンジン: 大きな時間飛び(バックグラウンド)でも正しい位置に復帰', () => {
  const e = new TimerEngine(simple());
  e.start(0);
  const ev = e.tick(10_500); // prep3+work5 =8 → rest(2)内の 8..10, さらに work 開始(10) から0.5秒
  assert.equal(e.idx, 3);
  assert.deepEqual(ev.map((x) => x.index), [1, 2, 3]);
  assert.equal(e.view(10_500).remainingSec, 5);
  const ev2 = e.tick(100_000);
  assert.equal(ev2.at(-1).type, 'finished');
});

test('エンジン: 一時停止中は進まない', () => {
  const e = new TimerEngine(simple());
  e.start(0);
  e.pause(1500);
  assert.equal(e.status, 'paused');
  e.tick(60_000);
  assert.equal(e.view(60_000).remainingMs, 1500);
});

test('エンジン: 再開は3秒の準備カウント後、残り時間から再開(3秒は含めない)', () => {
  const e = new TimerEngine(simple());
  e.start(0);
  e.pause(1000); // prep 残り2000ms
  e.resume(10_000);
  assert.equal(e.status, 'resuming');
  assert.equal(e.view(10_000).resumeLeftSec, 3);
  assert.equal(e.view(11_000).resumeLeftSec, 2);
  e.tick(12_999);
  assert.equal(e.status, 'resuming');
  assert.equal(e.view(12_999).remainingMs, 2000);
  e.tick(13_000);
  assert.equal(e.status, 'running');
  assert.equal(e.view(13_000).remainingMs, 2000);
  assert.deepEqual(e.tick(14_999), []);
  assert.deepEqual(e.tick(15_000), [{ type: 'segment', index: 1 }]);
});

test('エンジン: 再開待機中の一時停止は残り時間を変えない', () => {
  const e = new TimerEngine(simple());
  e.start(0);
  e.pause(1000);
  e.resume(5000);
  e.pause(6000);
  assert.equal(e.status, 'paused');
  assert.equal(e.view(6000).remainingMs, 2000);
});

test('エンジン: リセットで初期状態に戻る', () => {
  const e = new TimerEngine(simple());
  e.start(0);
  e.tick(5000);
  e.reset();
  assert.equal(e.status, 'idle');
  assert.equal(e.idx, 0);
  assert.equal(e.view(9999).remainingSec, 3);
});

test('エンジン: 時計が逆行しても残り時間が増えない/負にならない', () => {
  const e = new TimerEngine(simple());
  e.start(10_000);
  e.tick(11_000);
  e.tick(5_000);
  assert.ok(e.view(5_000).remainingMs <= 2000);
});

test('エンジン: 99周サーキットを長時間分シミュレートして計画と一致', () => {
  const items = [{ id: 'a', name: 'A', workSec: 7, sets: 1 }, { id: 'b', name: 'B', workSec: 9, sets: 1 }];
  const plan = buildPlan(menu({ repeatMode: 'circuit', laps: 99, prepSec: 3, commonWorkSec: 7, exerciseRestSec: 2, circuitRestSec: 4 }, items));
  const e = new TimerEngine(plan);
  e.start(0);
  let finishedAt = null;
  for (let t = 0; t <= plan.totalSec * 1000 + 5000; t += 100) {
    if (e.tick(t).some((x) => x.type === 'finished')) { finishedAt = t; break; }
  }
  assert.equal(finishedAt, plan.totalSec * 1000);
});

test('カウントダウン判定', () => {
  assert.equal(crossedCountdown(4, 3, 3), 3);
  assert.equal(crossedCountdown(5, 4, 3), null);
  assert.equal(crossedCountdown(2, 1, 3), 1);
  assert.equal(crossedCountdown(3, 3, 3), null);
  assert.equal(crossedCountdown(1, 0, 3), null);
  assert.equal(crossedCountdown(4, 3, 0), null);
  assert.equal(crossedCountdown(30, 3, 3), null);
  assert.equal(crossedCountdown(null, 3, 3), null);
  assert.equal(crossedCountdown(11, 10, 10), 10);
});

test('サニタイズ後のメニューでも計画が作れ、範囲外値は丸められる', () => {
  const m = sanitizeMenu({ name: ' x ', prepSec: 99999, commonWorkSec: -5, laps: 1000, setRestSec: 'abc', items: [{ name: 'A', sets: 500, workSec: 0 }, { name: '' }] });
  assert.equal(m.prepSec, 1800);
  assert.equal(m.commonWorkSec, 1);
  assert.equal(m.laps, 99);
  assert.equal(m.setRestSec, 15);
  assert.equal(m.items.length, 1);
  assert.equal(m.items[0].sets, 99);
  assert.equal(m.items[0].workSec, 1);
  assert.ok(buildPlan(m).totalSec > 0);
});
