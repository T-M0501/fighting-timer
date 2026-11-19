// 設定画面（音・試聴・バックアップ・復元・更新確認）
import { h, mount, confirmDialog, alertDialog, openModal, toast, segmented } from './dom.js';
import { app, saveSettings, applyRestore, hasPendingUpdate, tryApplyUpdate } from './core.js';
import { buildBackup, validateBackup, extractShareCode, COUNTDOWN_CHOICES, THEMES } from './model.js';
import { themeIcon } from './glove.js';
import { pageHeader, copyText } from './ui.js';
import { APP_VERSION } from './version.js';

function toggleRow(label, desc, checked, onChange) {
  const input = h('input', { type: 'checkbox', checked, role: 'switch', 'aria-label': label, onChange: (e) => onChange(e.target.checked) });
  return h('label', { class: 'toggle-row' },
    h('div', null, h('div', { class: 'menu-name' }, label), desc ? h('div', { class: 'meta' }, desc) : null),
    h('span', { class: 'switch' }, input, h('span', { class: 'slider' })));
}

/** アプリの公開URL（index.html や #以降を除いた形） */
function shareUrl() {
  return new URL('./', location.href).href;
}

const copyUrl = () => copyText(shareUrl(), 'URLをコピーしました');

/** 共有されたメニューのURLを貼り付けて追加する（ホーム画面に追加したアプリではURLを直接開けないため） */
function openImportDialog() {
  const ta = h('textarea', { class: 'text', rows: 4, placeholder: 'ここに共有されたURLを貼り付け', 'aria-label': '共有されたURL' });
  const m = openModal(h('div', null,
    h('h2', { class: 'modal-title' }, '共有されたメニューを追加'),
    h('p', { class: 'meta' }, '受け取ったURLをコピーして、下に貼り付けてください。'),
    ta,
    h('div', { class: 'modal-actions' },
      h('button', { class: 'btn', onClick: () => m.close() }, '閉じる'),
      h('button', {
        class: 'btn btn-primary',
        onClick: () => {
          const code = extractShareCode(ta.value);
          if (!code) { toast('共有用のURLが見つかりません'); return; }
          m.close();
          app.go('#/import/' + code);
        },
      }, '読み込む'))));
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

/** 音声ガイドが出ない端末で、原因を切り分けるための診断画面 */
export function renderVoiceTest(root) {
  const TEXT = '運動開始。次はスクワット';
  const a = app.audio;
  const out = h('ol', { class: 'meta' });
  const add = (label) => { const li = h('li', null, label + '：実行中…'); out.append(li); return li; };
  // アプリの読み上げ処理を通さず、端末の読み上げ機能をそのまま呼ぶ
  const bare = (label) => {
    const li = add(label);
    const r = { started: false, ended: false, error: '' };
    try {
      const u = new SpeechSynthesisUtterance(TEXT);
      u.lang = 'ja-JP';
      u.onstart = () => { r.started = true; };
      u.onend = () => { r.ended = true; };
      u.onerror = (e) => { r.error = String((e && e.error) || '不明'); };
      window.__ftUtter = u;
      speechSynthesis.speak(u);
    } catch (e) { r.error = String(e); }
    setTimeout(() => { li.textContent = `${label}：開始${r.started ? '○' : '×'}／終了${r.ended ? '○' : '×'}／エラー${r.error || 'なし'}／音${a.ctx ? a.ctx.state : '未使用'}`; }, 6000);
  };
  const viaApp = (label, keep) => {
    const li = add(label);
    a.keepAliveOn = keep;
    a.unlock();
    a.speak(TEXT, { force: true });
    setTimeout(() => {
      const r = a.lastSpeech || {};
      a.keepAliveOn = true;
      li.textContent = `${label}：開始${r.started ? '○' : '×'}／終了${r.ended ? '○' : '×'}／エラー${r.error || 'なし'}／音${a.ctx ? a.ctx.state : '未使用'}／声${r.voice || '?'}`;
    }, 6000);
  };
  let n = -1;
  try { n = speechSynthesis.getVoices().filter((v) => /^ja/i.test(v.lang)).length; } catch { /* 非対応 */ }
  mount(root,
    pageHeader('音声ガイドの診断', '#/settings'),
    h('section', { class: 'card' },
      h('p', null, '音声ガイドが聞こえないときの原因を調べる画面です。'),
      h('p', { class: 'meta' }, '① アプリ（またはブラウザのタブ）を一度完全に閉じて開き直し、ほかのボタンを押さずにこの画面を開いてください。② 下のA・B・Cを上から順に、1つ押したら6秒ほど待ってから次を押してください。どれも「運動開始。次はスクワット」と話します。③ 最後まで聞こえたものはどれか（A・B・C）と、下に出る結果の文字を開発者に伝えてください。'),
      h('div', { class: 'row-actions wrap' },
        h('button', { class: 'btn', onClick: () => bare('A') }, 'A：声だけ'),
        h('button', { class: 'btn', onClick: () => viaApp('B', false) }, 'B：電子音の準備あり'),
        h('button', { class: 'btn', onClick: () => viaApp('C', true) }, 'C：新しい方式')),
      out,
      h('p', { class: 'meta' }, `日本語の声：${n}個 ／ 版：${APP_VERSION}`)));
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
  // 実際のタイマーと同じように、ボタン操作のあと時間をおいて音を出すテスト（設定のオン・オフに関係なく鳴らす）
  const flowTestMsg = h('p', { class: 'meta', 'aria-live': 'polite' }, '実際のタイマーと同じ順番で音を出します。トレーニング中に音が出ないときの確認に使えます。');
  let flowTestBusy = false;
  function flowTest() {
    if (flowTestBusy) return;
    flowTestBusy = true;
    const a = app.audio;
    a.unlock();
    a.primeSpeech();
    flowTestMsg.textContent = 'テスト中… ①開始の音 →②「運動開始」の声 →③カウントダウン3回 →④休憩の音 →⑤「休憩開始」の声 の順に鳴ります。';
    const F = { force: true };
    setTimeout(() => { a.beep('work', F); a.cue('work', { force: true, delayMs: 650 }); }, 1500);
    for (const t of [5000, 6000, 7000]) setTimeout(() => a.beep('count', F), t);
    setTimeout(() => { a.beep('rest', F); a.cue('rest', { force: true, delayMs: 650 }); }, 8000);
    setTimeout(() => {
      flowTestBusy = false;
      const state = a.ctx ? a.ctx.state : 'なし';
      const sp = a.lastSpeech;
      let n = -1;
      try { n = speechSynthesis.getVoices().filter((v) => /^ja/i.test(v.lang)).length; } catch { /* 非対応 */ }
      const mix = app.state.settings.mixMusic ? `録音の声：${a.clipsState}（${a.clips.size}個）` : '';
      const spoken = sp ? `${sp.voice}／開始${sp.started ? '○' : '×'}／終了${sp.ended ? '○' : '×'}／エラー${sp.error || 'なし'}` : (mix ? '' : '読み上げ非対応');
      const voice = [mix, spoken].filter(Boolean).join('／');
      flowTestMsg.textContent = `テスト終了。①〜⑤のうち聞こえなかった番号があれば、その番号と、次のかっこの中の文字を開発者に伝えてください。（音の状態：${state}／声：${voice}／日本語の声${n}個）`;
    }, 11000);
  }

  // 音声ガイドの声（女性/男性）。切り替えるとすぐ試聴できる
  const voiceSeg = h('div');
  const voiceHint = h('p', { class: 'meta' });
  function drawVoice() {
    const g = app.state.settings.voiceGender;
    voiceSeg.replaceChildren(segmented({
      label: '音声ガイドの声', value: g,
      options: [{ value: 'female', label: '女性' }, { value: 'male', label: '男性' }],
      onChange: async (v) => {
        await saveSettings({ voiceGender: v });
        drawVoice();
        app.audio.unlock();
        app.audio.speak('運動開始。次はスクワット', { force: true });
      },
    }));
    const d = app.audio.describeVoice(g);
    voiceHint.textContent = !d.name
      ? 'この端末では日本語の音声を取得できていません。音声が出ない場合は、端末の設定で日本語の音声データを追加してください。'
      : d.substituted
        ? `この端末には男性の日本語音声が入っていないため、「${d.name}」を低い声にして代用します。`
        : `使用する声：${d.name}（端末に入っている音声を使います）`;
  }
  drawVoice();
  try {
    speechSynthesis.addEventListener('voiceschanged', drawVoice);
    app.cleanup = () => speechSynthesis.removeEventListener('voiceschanged', drawVoice);
  } catch { /* 非対応 */ }
  const cdHint = h('p', { class: 'meta' });
  function updateCdHint() {
    const s = app.state.settings;
    cdHint.textContent = !s.beepOn
      ? '※「電子音」がオフのため、カウントダウン音は鳴りません。鳴らすには上の「電子音」をオンにしてください。'
      : s.countdown === 0
        ? 'カウントダウン音は鳴りません（「なし」）。'
        : `準備・運動・休憩が終わる${s.countdown}秒前から、1秒ごとに「ピッ」と鳴ります。`;
    cdHint.classList.toggle('warn-text', !s.beepOn);
  }
  cdSelect.addEventListener('change', updateCdHint);
  updateCdHint();
  const fileInput = h('input', { type: 'file', accept: '.json,application/json', hidden: true, onChange: (e) => { importBackup(e.target.files[0]); e.target.value = ''; } });

  mount(root, 
    pageHeader('設定', '#/'),
    !app.persistent ? h('div', { class: 'card warn' }, 'この環境ではデータを保存できません（ブラウザの保存機能が使えません）。バックアップをこまめに保存してください。') : null,
    h('section', { class: 'card' },
      h('h2', { class: 'sec in' }, 'デザイン（テーマ）'),
      h('div', { class: 'theme-grid', role: 'group', 'aria-label': 'テーマ' }, THEMES.map((t) => h('button', {
        class: 'btn theme-btn' + (t.id === st.theme ? ' on' : ''),
        'aria-pressed': t.id === st.theme ? 'true' : 'false',
        onClick: async () => { await saveSettings({ theme: t.id }); app.go('#/settings'); },
      }, themeIcon(t.id, 'theme-ico') || h('span', { class: 'theme-ico swatch', style: { background: t.color } }), h('span', null, t.label)))),
      h('p', { class: 'meta' }, '色と、トップ画面のイラストが変わります。タイマー画面の色(準備=黄・運動=緑・休憩=青)は変わりません。')),
    h('section', { class: 'card' },
      h('h2', { class: 'sec in' }, '音'),
      toggleRow('電子音', '運動・休憩の切り替え音、カウントダウン音、終了メロディー', st.beepOn, async (v) => { await saveSettings({ beepOn: v }); updateCdHint(); }),
      toggleRow('音声ガイド（日本語）', '運動開始・休憩開始・次の種目名・終了', st.voiceOn, (v) => saveSettings({ voiceOn: v })),
      toggleRow('残り時間の読み上げ', '運動が1分以上のとき「残り半分」、30秒以上のとき「残り10秒」と読み上げます（音声ガイドがオンのとき）', st.voiceProgress, (v) => saveSettings({ voiceProgress: v })),
      toggleRow('音楽アプリと一緒に使う', 'オンにすると、音楽アプリの曲を止めずに、このアプリの音も鳴らします。音声ガイドは、あなたが録音した声になります（下の「自分の声を録音する」で録音します）。録音していない言葉は読み上げません。消音モード（マナーモード）のときは、このアプリの音も鳴りません（iPhone）', st.mixMusic, (v) => { saveSettings({ mixMusic: v }); app.audio.unlock(); }),
      h('button', { class: 'btn btn-block', onClick: () => app.go('#/voice') }, '自分の声を録音する'),
      h('div', { class: 'fld-label' }, '音声ガイドの声'),
      voiceSeg,
      voiceHint,
      h('div', { class: 'fld-label' }, '電子音の音量 ', volVal),
      slider,
      h('div', { class: 'fld-label' }, 'カウントダウン音（終わる何秒前から鳴らすか）'),
      cdSelect,
      cdHint,
      h('div', { class: 'fld-label' }, '試聴'),
      h('div', { class: 'row-actions wrap' },
        h('button', { class: 'btn', onClick: () => { app.audio.unlock(); app.audio.beep('work', { force: true }); } }, '電子音（開始）'),
        h('button', { class: 'btn', onClick: () => { app.audio.unlock(); app.audio.beep('count', { force: true }); } }, 'カウントダウン'),
        h('button', { class: 'btn', onClick: () => { app.audio.unlock(); app.audio.cue('work', { name: 'スクワット', first: true, force: true }); } }, '音声ガイド'),
        h('button', { class: 'btn', onClick: () => { app.audio.unlock(); app.audio.beep('finish', { force: true }); } }, '終了メロディー')),
      h('button', { class: 'btn btn-block', onClick: flowTest }, 'タイマーと同じ流れで試す（約10秒）'),
      flowTestMsg,
      h('button', { class: 'btn btn-ghost btn-block', onClick: () => app.go('#/voicetest') }, '音声ガイドが出ないとき（診断）'),
      h('p', { class: 'meta' }, '音が小さいときは、端末本体の音量を上げ、マナーモード（消音）になっていないか確認してください。このアプリは、端末の最大音量より大きな音は出せません。'),
      h('p', { class: 'meta' }, '音声ガイドの声だけが小さいとき：声の大きさは端末の音量で決まり、アプリからはこれ以上大きくできません。端末の音量を上げてから、上の「電子音の音量」を下げると、声と電子音のバランスが取れます。')),
    h('section', { class: 'card' },
      h('h2', { class: 'sec in' }, '画面'),
      toggleRow('トレーニング中は画面をスリープさせない', 'タイマーが動いている間（一時停止中も含む）だけ、画面をつけたままにします。電池の減りは早くなります', st.keepAwake, (v) => saveSettings({ keepAwake: v })),
      'wakeLock' in navigator ? null : h('p', { class: 'meta' }, 'この端末（またはブラウザ）は対応していないため、この設定は使えません。'),
      toggleRow('履歴に集計を表示', '履歴画面の上に、今週・先週・今月・累計の回数と合計時間を表示します', st.historyStats, (v) => saveSettings({ historyStats: v }))),
    h('section', { class: 'card' },
      h('h2', { class: 'sec in' }, '通知（お試し機能）'),
      toggleRow('運動・休憩の切り替わりを通知', '画面を閉じている間は、端末の制限で通知が届かないことがあります', st.notify, async (v) => {
        if (v && typeof Notification !== 'undefined' && Notification.permission !== 'granted') {
          const p = await Notification.requestPermission().catch(() => 'denied');
          if (p !== 'granted') { toast('通知が許可されませんでした'); await saveSettings({ notify: false }); app.go('#/settings'); return; }
        }
        saveSettings({ notify: v });
      })),
    h('section', { class: 'card' },
      h('h2', { class: 'sec in' }, 'データ'),
      h('button', { class: 'btn btn-block', onClick: () => app.go('#/exercises') }, '登録種目の管理'),
      h('button', { class: 'btn btn-block', onClick: openImportDialog }, '共有されたメニューを追加'),
      h('button', { class: 'btn btn-block btn-primary', onClick: exportBackup }, 'バックアップを保存'),
      h('button', { class: 'btn btn-block', onClick: () => fileInput.click() }, 'バックアップから復元'),
      fileInput,
      h('p', { class: 'meta' }, 'メニュー・登録種目・履歴・設定を1つのファイルにまとめて保存します。保存先は、表示された画面で選べます（iPhoneの「ファイルに保存」、Googleドライブなど）。')),
    h('section', { class: 'card' },
      h('h2', { class: 'sec in' }, 'アプリのURL（共有用）'),
      h('input', { type: 'text', class: 'text url-box', readonly: true, value: shareUrl(), 'aria-label': '共有用URL', onFocus: (e) => e.target.select() }),
      h('div', { class: 'row-actions wrap' },
        h('button', { class: 'btn btn-primary', onClick: copyUrl }, 'URLをコピー'),
        navigator.share ? h('button', { class: 'btn', onClick: () => navigator.share({ title: 'Fighting Timer', url: shareUrl() }).catch(() => {}) }, '共有する') : null),
      h('p', { class: 'meta' }, '家族や友人にこのURLを送ると、同じアプリを使ってもらえます（保存したデータは共有されません）。')),
    h('section', { class: 'card' },
      h('h2', { class: 'sec in' }, 'アプリ情報'),
      h('p', { class: 'meta' }, `バージョン：${APP_VERSION}`),
      h('button', {
        class: 'btn btn-block',
        onClick: async () => {
          try { await app.swReg?.update(); } catch { /* オフライン等 */ }
          if (hasPendingUpdate()) { toast('新しいバージョンを準備しました'); tryApplyUpdate(); } else toast('新しいバージョンは見つかりませんでした');
        },
      }, '更新を確認')),
  );
}
