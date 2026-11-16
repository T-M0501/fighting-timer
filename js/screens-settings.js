// 設定画面（音・試聴・バックアップ・復元・更新確認）
import { h, mount, confirmDialog, alertDialog, toast } from './dom.js';
import { app, saveSettings, applyRestore, hasPendingUpdate, tryApplyUpdate } from './core.js';
import { buildBackup, validateBackup, COUNTDOWN_CHOICES } from './model.js';
import { pageHeader } from './ui.js';
import { APP_VERSION } from './version.js';

function toggleRow(label, desc, checked, onChange) {
  const input = h('input', { type: 'checkbox', checked, role: 'switch', 'aria-label': label, onChange: (e) => onChange(e.target.checked) });
  return h('label', { class: 'toggle-row' },
    h('div', null, h('div', { class: 'menu-name' }, label), desc ? h('div', { class: 'meta' }, desc) : null),
    h('span', { class: 'switch' }, input, h('span', { class: 'slider' })));
}

function backupFileName() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `fighting-timer-backup-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}.json`;
}

async function exportBackup() {
  const text = JSON.stringify(buildBackup(app.state), null, 2);
  const name = backupFileName();
  const file = new File([text], name, { type: 'application/json' });
  try {
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: 'Fighting Timer バックアップ' });
      toast('バックアップを共有しました');
      return;
    }
  } catch (e) {
    if (e && e.name === 'AbortError') return; // 利用者が共有をキャンセル
    // それ以外の失敗はダウンロード方式に切り替える
  }
  const url = URL.createObjectURL(file);
  const a = h('a', { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  toast('バックアップファイルを保存しました');
}

async function importBackup(file) {
  if (!file) return;
  let text;
  try {
    text = await file.text();
  } catch {
    await alertDialog({ title: '復元できません', message: 'ファイルを読み込めませんでした。' });
    return;
  }
  const r = validateBackup(text);
  if (!r.ok) {
    await alertDialog({ title: '復元できません', message: r.error + '（現在のデータは変更されていません）' });
    return;
  }
  const s = r.summary;
  const ok = await confirmDialog({
    title: '現在のデータを上書きして復元しますか？',
    message: `バックアップの内容：メニュー${s.menus}件・登録種目${s.exercises}件・履歴${s.history}件・設定。` +
      (s.skipped ? `（読み取れない項目${s.skipped}件は除外されます）` : '') +
      ' 今のメニュー・履歴・設定はすべて置き換えられます。不安な場合は先に現在のバックアップを保存してください。',
    okText: '上書きして復元', danger: true,
  });
  if (!ok) return;
  try {
    await applyRestore(r.data);
  } catch (e) {
    console.error(e);
    await alertDialog({ title: '復元に失敗しました', message: '保存中にエラーが発生しました。現在のデータは変更されていません。' });
    return;
  }
  toast('復元しました');
  app.go('#/');
}

export function renderSettings(root) {
  const st = app.state.settings;
  const volVal = h('span', { class: 'vol-val' }, `${st.volume}%`);
  const slider = h('input', {
    type: 'range', min: 0, max: 100, step: 1, value: st.volume, 'aria-label': '電子音の音量',
    onInput: (e) => { volVal.textContent = `${e.target.value}%`; saveSettings({ volume: Number(e.target.value) }); },
  });
  const cdSelect = h('select', {
    class: 'select', 'aria-label': 'カウントダウン電子音',
    onChange: (e) => saveSettings({ countdown: Number(e.target.value) }),
  }, COUNTDOWN_CHOICES.map((n) => h('option', { value: n, selected: n === st.countdown }, n === 0 ? 'なし' : `${n}秒前`)));
  const fileInput = h('input', { type: 'file', accept: '.json,application/json', hidden: true, onChange: (e) => { importBackup(e.target.files[0]); e.target.value = ''; } });

  mount(root, 
    pageHeader('設定', '#/'),
    !app.persistent ? h('div', { class: 'card warn' }, 'この環境ではデータを保存できません（ブラウザの保存機能が使えません）。バックアップをこまめに保存してください。') : null,
    h('section', { class: 'card' },
      h('h2', { class: 'sec in' }, '音'),
      toggleRow('電子音', '切り替え・カウントダウンの音', st.beepOn, (v) => saveSettings({ beepOn: v })),
      toggleRow('音声ガイド（日本語）', '運動開始・休憩開始・次の種目名・終了', st.voiceOn, (v) => saveSettings({ voiceOn: v })),
      h('div', { class: 'fld-label' }, '電子音の音量 ', volVal),
      slider,
      h('div', { class: 'fld-label' }, 'カウントダウン電子音'),
      cdSelect,
      h('div', { class: 'fld-label' }, '試聴'),
      h('div', { class: 'row-actions wrap' },
        h('button', { class: 'btn', onClick: () => { app.audio.unlock(); app.audio.beep('work', { force: true }); } }, '電子音（開始）'),
        h('button', { class: 'btn', onClick: () => { app.audio.unlock(); app.audio.beep('count', { force: true }); } }, 'カウントダウン'),
        h('button', { class: 'btn', onClick: () => { app.audio.unlock(); app.audio.speak('運動開始。次はスクワット', { force: true }); } }, '音声ガイド'),
        h('button', { class: 'btn', onClick: () => { app.audio.unlock(); app.audio.beep('finish', { force: true }); } }, '終了メロディー')),
      h('p', { class: 'meta' }, '音が小さいときは、iPhone本体の音量を上げ、消音(サイレント)スイッチがオフになっているか確認してください。本アプリは端末の最大音量を超えて鳴らすことはできません。')),
    h('section', { class: 'card' },
      h('h2', { class: 'sec in' }, '画面'),
      toggleRow('トレーニング中は画面をスリープさせない', 'タイマー実行中（一時停止中も含む）だけ、画面を点灯したままにします。電池の消費が増えます', st.keepAwake, (v) => saveSettings({ keepAwake: v })),
      'wakeLock' in navigator ? null : h('p', { class: 'meta' }, 'この端末・ブラウザは画面の点灯維持に対応していないため、この設定は働きません。')),
    h('section', { class: 'card' },
      h('h2', { class: 'sec in' }, '通知（試験的）'),
      toggleRow('フェーズ切り替えを通知', '画面を閉じている間の通知は、端末の制限により届かないことがあります', st.notify, async (v) => {
        if (v && typeof Notification !== 'undefined' && Notification.permission !== 'granted') {
          const p = await Notification.requestPermission().catch(() => 'denied');
          if (p !== 'granted') { toast('通知が許可されませんでした'); await saveSettings({ notify: false }); app.go('#/settings'); return; }
        }
        saveSettings({ notify: v });
      })),
    h('section', { class: 'card' },
      h('h2', { class: 'sec in' }, 'データ'),
      h('button', { class: 'btn btn-block', onClick: () => app.go('#/exercises') }, '登録種目の管理'),
      h('button', { class: 'btn btn-block btn-primary', onClick: exportBackup }, 'バックアップを保存'),
      h('button', { class: 'btn btn-block', onClick: () => fileInput.click() }, 'バックアップから復元'),
      fileInput,
      h('p', { class: 'meta' }, 'メニュー・登録種目・履歴・設定を1つのファイルにまとめて保存します。iPhoneでは「ファイルに保存」やiCloud Driveを選べます。')),
    h('section', { class: 'card' },
      h('h2', { class: 'sec in' }, 'アプリ情報'),
      h('p', { class: 'meta' }, `バージョン：${APP_VERSION}`),
      h('button', {
        class: 'btn btn-block',
        onClick: async () => {
          try { await app.swReg?.update(); } catch { /* オフライン等 */ }
          if (hasPendingUpdate()) { toast('新しいバージョンを準備しました'); tryApplyUpdate(); } else toast('最新の状態です（または確認できませんでした）');
        },
      }, '更新を確認')),
  );
}
