// 進行計画の生成とタイマー進行エンジン（画面・音に依存しない）。
// 合計予定時間の計算も、実際のタイマー進行も、必ず buildPlan() の同じ結果を使う。

/** 2つの運動ユニット間に入る休憩を決める（休憩の遷移ルールはここだけで一元管理） */
export function restBetween(menu, a, b) {
  if (a.lap !== b.lap) return { restKind: 'lap', dur: menu.circuitRestSec };
  if (a.item !== b.item) return { restKind: 'exercise', dur: menu.exerciseRestSec };
  return { restKind: 'set', dur: menu.setRestSec };
}

/**
 * メニューから進行計画を作る。
 * segment: { kind:'prep'|'work'|'rest', dur(秒), name, item, set, sets, lap, laps, restKind? }
 *   - prep / rest の name・set・lap は「次に行う運動」の情報
 *   - dur が 0 の準備・休憩は計画に含めない（直ちに次へ進む）
 */
export function buildPlan(menu) {
  const items = menu.items || [];
  const units = [];
  if (menu.repeatMode === 'circuit') {
    const laps = menu.laps;
    for (let l = 1; l <= laps; l++) {
      for (let i = 0; i < items.length; i++) units.push({ item: i, set: 1, sets: 1, lap: l, laps });
    }
  } else {
    for (let i = 0; i < items.length; i++) {
      const sets = items[i].sets;
      for (let s = 1; s <= sets; s++) units.push({ item: i, set: s, sets, lap: 1, laps: 1 });
    }
  }

  const segments = [];
  let totalSec = 0;
  const push = (seg) => {
    segments.push(seg);
    totalSec += seg.dur;
  };

  if (units.length && menu.prepSec > 0) {
    push({ kind: 'prep', dur: menu.prepSec, name: items[units[0].item].name, ...units[0] });
  }
  for (let k = 0; k < units.length; k++) {
    const u = units[k];
    if (k > 0) {
      const r = restBetween(menu, units[k - 1], u);
      if (r.dur > 0) {
        push({ kind: 'rest', restKind: r.restKind, dur: r.dur, name: items[u.item].name, ...u });
      }
    }
    const it = items[u.item];
    const dur = menu.timeMode === 'individual' ? it.workSec : menu.commonWorkSec;
    push({ kind: 'work', dur, name: it.name, ...u });
  }
  return { segments, totalSec };
}

/** 現在の次に来る動作（表示用）。最後なら kind:'end' */
export function nextInfo(plan, index) {
  const s = plan.segments[index + 1];
  if (!s) return { kind: 'end' };
  return { kind: s.kind, restKind: s.restKind, name: s.name, dur: s.dur };
}

/** カウントダウン電子音を鳴らす秒を判定。鳴らすなら秒数、鳴らさないなら null */
export function crossedCountdown(prevSec, curSec, n) {
  if (!n || prevSec == null) return null;
  const diff = prevSec - curSec;
  if (diff < 1 || diff > 2) return null; // 復帰直後などの大きな飛びでは鳴らさない
  if (curSec >= 1 && curSec <= n) return curSec;
  return null;
}

/**
 * タイマー本体。時刻(now:ミリ秒)を外から渡す方式で、setIntervalの回数には依存しない。
 * status: idle | running | paused | resuming | finished
 */
export class TimerEngine {
  constructor(plan, { resumeMs = 3000 } = {}) {
    this.plan = plan;
    this.n = plan.segments.length;
    this.durMs = new Float64Array(this.n);
    this.startMs = new Float64Array(this.n + 1);
    for (let i = 0; i < this.n; i++) {
      this.durMs[i] = plan.segments[i].dur * 1000;
      this.startMs[i + 1] = this.startMs[i] + this.durMs[i];
    }
    this.totalMs = this.startMs[this.n];
    this.resumeMs = resumeMs;
    this.reset();
  }

  reset() {
    this.status = 'idle';
    this.idx = 0;
    this.base = 0; // 現セグメントで消化済みのミリ秒（anchor時点まで）
    this.anchor = 0;
    this.resumeEnd = 0;
  }

  start(now) {
    if (this.status !== 'idle' || this.n === 0) return [];
    this.status = 'running';
    this.idx = 0;
    this.base = 0;
    this.anchor = now;
    return [{ type: 'segment', index: 0 }];
  }

  /** 時刻を進めて、発生したイベントを返す */
  tick(now) {
    const events = [];
    if (this.status === 'resuming') {
      if (now < this.resumeEnd) return events;
      this.status = 'running';
      this.anchor = this.resumeEnd; // 再開前の3秒は運動・休憩時間に含めない
      events.push({ type: 'resumed' });
    }
    if (this.status !== 'running') return events;
    let elapsed = this.base + Math.max(0, now - this.anchor);
    while (this.idx < this.n && elapsed >= this.durMs[this.idx]) {
      elapsed -= this.durMs[this.idx];
      this.idx++;
      if (this.idx < this.n) {
        events.push({ type: 'segment', index: this.idx });
      } else {
        this.status = 'finished';
        this.base = 0;
        events.push({ type: 'finished' });
        return events;
      }
    }
    this.base = elapsed;
    this.anchor = now;
    return events;
  }

  pause(now) {
    const ev = this.tick(now);
    if (this.status === 'running' || this.status === 'resuming') this.status = 'paused';
    return ev;
  }

  resume(now) {
    if (this.status !== 'paused') return [];
    this.status = 'resuming';
    this.resumeEnd = now + this.resumeMs;
    return [];
  }

  /** 表示用の状態（副作用なし。先に tick(now) を呼ぶこと） */
  view(now) {
    const seg = this.idx < this.n ? this.plan.segments[this.idx] : null;
    let elapsed = this.base;
    if (this.status === 'running') elapsed += Math.max(0, now - this.anchor);
    const dur = seg ? this.durMs[this.idx] : 0;
    if (elapsed > dur) elapsed = dur;
    const remainingMs = seg ? dur - elapsed : 0;
    const totalElapsedMs = this.status === 'finished' ? this.totalMs : this.startMs[this.idx] + elapsed;
    return {
      status: this.status,
      index: this.idx,
      seg,
      elapsedMs: elapsed,
      remainingMs,
      remainingSec: Math.ceil(remainingMs / 1000),
      progress: dur ? elapsed / dur : 1,
      totalElapsedMs,
      totalRemainingMs: Math.max(0, this.totalMs - totalElapsedMs),
      resumeLeftSec: this.status === 'resuming' ? Math.max(1, Math.ceil((this.resumeEnd - now) / 1000)) : 0,
    };
  }
}
