// タイマー画面。進行は TimerEngine、ここは表示・音・操作だけを担当する。
import { h, mount, confirmDialog, openModal, toast } from './dom.js';
import { app, addHistory } from './core.js';
import { buildPlan, nextInfo, TimerEngine, crossedCountdown } from './engine.js';
import { formatClock, formatDuration } from './model.js';
import { pageHeader } from './ui.js';

const PHASE_LABEL = { prep: '準備中', work: '運動中', rest: '休憩中' };

function nextText(plan, index) {
  const n = nextInfo(plan, index);
  if (n.kind === 'end') return '次：トレーニング終了';
  if (n.kind === 'rest') return `次：休憩 ${formatDuration(n.dur)}`;
  if (n.kind === 'work') return `次：${n.name}（運動 ${formatDuration(n.dur)}）`;
  return `次：${n.name}`;
}

function setText(seg, menu) {
  if (!seg) return '';
  if (menu.repeatMode === 'circuit') {
    return `周回 ${seg.lap}/${seg.laps}　種目 ${seg.item + 1}/${menu.items.length}`;
  }
  const cyc = seg.cycles > 1 ? `サイクル ${seg.cycle}/${seg.cycles}　` : '';
  return `${cyc}セット ${seg.set}/${seg.sets}　種目 ${seg.item + 1}/${menu.items.length}`;
}

export function renderTimer(root, id) {
  const menu = app.state.menus.find((m) => m.id === id);
  if (!menu || !menu.items.length) {
    mount(root, pageHeader('タイマー', '#/menus'), h('p', { class: 'pad' }, menu ? '種目が登録されていません。メニューを編集して種目を追加してください。' : 'メニューが見つかりません。'));
    return;
  }
  const plan = buildPlan(menu);
  const eng = new TimerEngine(plan);
  let startedAt = 0;
  let intervalId = null;
  let lastSegIdx = -1;
  let lastRemSec = null;
  let lastResumeSec = 0;
  let finishPending = false; // 終了後、履歴の保存/破棄が未選択
  let lastTickAt = 0;

  // ---- 画面要素 ----
  const elPhase = h('div', { class: 't-phase' });
  const elName = h('div', { class: 't-name' });
  const elTime = h('div', { class: 't-time', 'aria-live': 'off' });
  const elBarFill = h('div', { class: 't-bar-fill' });
  const elBar = h('div', { class: 't-bar', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100' }, elBarFill);
  const elSet = h('div', { class: 't-set' });
  const elNext = h('div', { class: 't-next' });
  const elTotal = h('div', { class: 't-total' });
  const elResume = h('div', { class: 't-resume', hidden: true });
  const elButtons = h('div', { class: 't-buttons' });
  const screen = h('div', { class: 'timer-screen phase-idle' },
    h('div', { class: 't-head' },
      h('button', { class: 'btn btn-ghost back', onClick: () => app.go('#/menus') }, '← 戻る'),
      h('div', { class: 't-menu' }, menu.name)),
    h('div', { class: 't-body' },
      h('div', { class: 't-main' }, elPhase, elName, elTime, elBar),
      h('div', { class: 't-side' }, elSet, elNext, elTotal, elButtons)),
    elResume);

  const btn = (label, cls, fn, extra = {}) => h('button', { class: 'btn t-btn ' + cls, onClick: fn, ...extra }, label);

  function renderButtons(status) {
    elButtons.replaceChildren();
    if (status === 'idle') elButtons.append(btn('開始', 'btn-primary', onStart));
    else if (status === 'running' || status === 'resuming') elButtons.append(btn('一時停止', 'btn-warn', onPause), btn('リセット', '', onReset));
    else if (status === 'paused') elButtons.append(btn('再開', 'btn-primary', onResume), btn('リセット', '', onReset));
  }
  let shownStatus = null;

  // ---- 音・通知 ----
  function announce(index) {
    const seg = plan.segments[index];
    const a = app.audio;
    if (seg.kind === 'work') {
      a.beep('work');
      a.speak(index === 0 ? `${seg.name}、運動開始` : '運動開始');
    } else if (seg.kind === 'rest') {
      a.beep('rest');
      a.speak(`休憩開始。次は${seg.name}`);
    } else {
      a.beep('prep');
      a.speak(`次は${seg.name}`);
    }
    notifyIfHidden(seg.kind === 'work' ? `運動開始：${seg.name}` : seg.kind === 'rest' ? '休憩開始' : `準備：${seg.name}`);
  }

  function notifyIfHidden(text) {
    // 画面が見えていない間の通知は端末の制限(特にiPhone)で動かないことがある。可能な範囲での試行。
    try {
      if (document.visibilityState !== 'hidden' || !app.state.settings.notify) return;
      if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
      navigator.serviceWorker?.ready.then((r) => r.showNotification('Fighting Timer', { body: text, tag: 'ft-phase', renotify: true }));
    } catch { /* ignore */ }
  }

  function handleEvents(events) {
    if (!events.length) return;
    if (events.some((e) => e.type === 'finished')) {
      onFinished();
      return;
    }
    const segs = events.filter((e) => e.type === 'segment');
    if (segs.length) announce(segs[segs.length - 1].index); // まとめて進んだ場合(復帰時)は最後の区間だけ案内
  }

  function onFinished() {
    finishPending = true;
    app.audio.beep('finish');
    setTimeout(() => app.audio.speak('トレーニング終了です'), 1500);
    notifyIfHidden('トレーニング終了です');
    clearInterval(intervalId);
    intervalId = null;
    update();
    const m = openModal(h('div', null,
      h('h2', { class: 'modal-title' }, 'トレーニング終了！'),
      h('p', { class: 'modal-msg' }, `${menu.name}（${formatDuration(plan.totalSec)}）お疲れさまでした。この記録を履歴に保存しますか？`),
      h('div', { class: 'modal-actions col' },
        h('button', {
          class: 'btn btn-primary btn-lg',
          onClick: async () => {
            await addHistory({ at: startedAt, menuName: menu.name, durationSec: plan.totalSec });
            finishPending = false;
            m.close();
            toast('履歴を保存しました');
            app.go('#/');
          },
        }, '履歴を保存'),
        h('button', { class: 'btn btn-lg', onClick: () => { finishPending = false; m.close(); app.go('#/'); } }, '保存せず終了'))));
  }

  // ---- 操作 ----
  function onStart() {
    app.audio.unlock();
    startedAt = Date.now();
    handleEvents(eng.start(Date.now()));
    lastSegIdx = -1;
    ensureLoop();
    update();
  }
  function onPause() {
    handleEvents(eng.pause(Date.now()));
    app.audio.cancelSpeech();
    update();
  }
  function onResume() {
    app.audio.unlock();
    eng.resume(Date.now());
    lastResumeSec = 0;
    update();
  }
  async function onReset() {
    const ok = await confirmDialog({
      title: 'リセットしますか？', message: 'タイマーを最初の状態に戻します。この記録は履歴に保存されません。',
      okText: 'リセットする', cancelText: 'キャンセル', danger: true,
    });
    if (!ok) return; // キャンセル時は現在の状態をそのまま維持
    eng.tick(Date.now());
    eng.reset();
    app.audio.cancelSpeech();
    lastSegIdx = -1;
    lastRemSec = null;
    update();
  }

  // ---- 進行ループ ----
  function ensureLoop() {
    if (!intervalId) intervalId = setInterval(loop, 100);
  }
  function loop() {
    const now = Date.now();
    lastTickAt = now;
    const events = eng.tick(now);
    handleEvents(events);
    update();
  }
  // ---- 画面スリープ防止（設定でオン・トレーニング中のみ） ----
  let wakeLock = null;
  let wakeBusy = false;
  async function syncWake() {
    if (wakeBusy || !('wakeLock' in navigator)) return;
    const active = eng.status === 'running' || eng.status === 'paused' || eng.status === 'resuming';
    const want = app.state.settings.keepAwake && active && document.visibilityState === 'visible';
    wakeBusy = true;
    try {
      if (want && !wakeLock) {
        wakeLock = await navigator.wakeLock.request('screen');
        wakeLock.addEventListener('release', () => { wakeLock = null; });
      } else if (!want && wakeLock) {
        await wakeLock.release();
        wakeLock = null;
      }
    } catch { wakeLock = null; /* 非対応・省電力モード等では何もしない */ }
    wakeBusy = false;
  }
  const onVisible = () => {
    if (document.visibilityState === 'visible' && eng.status !== 'idle' && eng.status !== 'finished') loop(); // 実際の経過時間で復帰
    syncWake();
  };
  document.addEventListener('visibilitychange', onVisible);

  // ---- 表示更新 ----
  function update() {
    const now = Date.now();
    const v = eng.view(now);
    const seg = v.seg;
    let phase = 'idle';
    if (v.status === 'finished') phase = 'done';
    else if (v.status !== 'idle' && seg) phase = seg.kind;
    screen.className = `timer-screen phase-${phase}` + (v.status === 'paused' ? ' is-paused' : '');

    if (v.status === 'idle') {
      elPhase.textContent = '合計予定時間';
      elName.textContent = menu.name;
      elTime.textContent = formatClock(plan.totalSec);
      elBarFill.style.width = '0%';
      elSet.textContent = `${menu.items.length}種目 ・ ${menu.repeatMode === 'circuit' ? `サーキット ${menu.laps}周` : '1種目ずつ'}`;
      elNext.textContent = plan.segments[0] ? (plan.segments[0].kind === 'prep' ? `最初：準備 ${formatDuration(plan.segments[0].dur)}` : `最初：${plan.segments[0].name}`) : '';
      elTotal.textContent = '「開始」を押すとスタートします';
    } else if (v.status === 'finished') {
      elPhase.textContent = '終了';
      elName.textContent = 'お疲れさまでした！';
      elTime.textContent = '00:00';
      elBarFill.style.width = '100%';
      elSet.textContent = '';
      elNext.textContent = '';
      elTotal.textContent = '';
    } else {
      elPhase.textContent = v.status === 'paused' ? `一時停止中（${PHASE_LABEL[seg.kind]}）` : PHASE_LABEL[seg.kind];
      elName.textContent = seg.name;
      elTime.textContent = formatClock(v.remainingSec);
      elBarFill.style.width = `${Math.min(100, v.progress * 100).toFixed(1)}%`;
      elBar.setAttribute('aria-valuenow', String(Math.round(v.progress * 100)));
      elSet.textContent = setText(seg, menu) + (seg.kind === 'rest' ? '（次の運動）' : '');
      elNext.textContent = nextText(plan, v.index);
      elTotal.textContent = `全体の残り ${formatClock(Math.ceil(v.totalRemainingMs / 1000))}`;
    }

    // 再開前の3秒カウント
    if (v.status === 'resuming') {
      elResume.hidden = false;
      elResume.replaceChildren(h('div', { class: 't-resume-lbl' }, '再開まで'), h('div', { class: 't-resume-num' }, String(v.resumeLeftSec)));
      if (v.resumeLeftSec !== lastResumeSec) {
        app.audio.beep('resume');
        lastResumeSec = v.resumeLeftSec;
      }
    } else {
      elResume.hidden = true;
      lastResumeSec = 0;
    }

    // カウントダウン電子音(区間の終わりN秒前)
    if (v.status === 'running' && seg) {
      if (v.index !== lastSegIdx) {
        lastSegIdx = v.index;
        lastRemSec = v.remainingSec;
      } else {
        const c = crossedCountdown(lastRemSec, v.remainingSec, app.state.settings.countdown);
        if (c != null) app.audio.beep('count');
        lastRemSec = v.remainingSec;
      }
    } else if (v.status === 'resuming' || v.status === 'paused') {
      lastRemSec = v.remainingSec; // 再開後に同じ秒で鳴らないよう基準だけ更新
    }

    if (shownStatus !== v.status) {
      shownStatus = v.status;
      renderButtons(v.status);
      syncWake();
    }
  }

  // ---- 画面を離れるときの確認 ----
  app.guard = {
    dirty: () => eng.status === 'running' || eng.status === 'paused' || eng.status === 'resuming' || finishPending,
    confirm: () => confirmDialog({
      title: 'トレーニングを終了しますか？',
      message: finishPending ? '履歴は保存されません。' : '途中で終了すると、この記録は履歴に保存されません。',
      okText: '終了する', cancelText: '続ける', danger: true,
    }),
  };
  app.cleanup = () => {
    clearInterval(intervalId);
    document.removeEventListener('visibilitychange', onVisible);
    app.audio.cancelSpeech();
    try { wakeLock?.release(); } catch { /* ignore */ }
    wakeLock = null;
  };

  update();
  mount(root, screen);
}
