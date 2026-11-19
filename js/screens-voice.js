// 自分の声を録音する画面。「音楽アプリと一緒に使う」がオンのとき、ここで録音した声が音声ガイドになる。
// 録音はこの端末の中（IndexedDB）にだけ保存する。サーバーには送らない。
import { h, mount, toast } from './dom.js';
import { app } from './core.js';
import { pageHeader } from './ui.js';
import { CLIP_DEFS, processVoice } from './audio.js';

const MAX_SEC = 5; // 録音は最長5秒で自動的に止める

export function renderVoiceRec(root) {
  let alive = true;
  let rec = null; // 録音中: { key, mr, stream, timer }
  let busy = false; // 録音を整えて保存している間
  const records = new Map();
  const box = h('div');

  function setSession(type) {
    try { if (navigator.audioSession) navigator.audioSession.type = type; } catch { /* 非対応 */ }
  }

  async function startRec(def) {
    if (rec || busy) return;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || typeof MediaRecorder === 'undefined') {
      toast('この端末（ブラウザ）では録音できません');
      return;
    }
    app.audio.unlock(); // 録音のあと、声を整えるために音の出口が必要
    setSession('play-and-record');
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { noiseSuppression: true, autoGainControl: true, echoCancellation: false } });
    } catch {
      app.audio.unlock();
      toast('マイクを使えません。マイクの許可をご確認ください');
      return;
    }
    if (!alive) { stream.getTracks().forEach((t) => t.stop()); return; }
    const chunks = [];
    let mr;
    try {
      mr = new MediaRecorder(stream);
    } catch {
      stream.getTracks().forEach((t) => t.stop());
      app.audio.unlock();
      toast('この端末では録音を始められませんでした');
      return;
    }
    mr.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
    mr.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      if (rec) clearTimeout(rec.timer);
      rec = null;
      app.audio.unlock(); // 音の設定を元に戻す（録音用になったままだと、音が小さくなることがある）
      if (!alive) return;
      finish(def, new Blob(chunks, { type: mr.mimeType || 'audio/mp4' }));
    };
    mr.start();
    rec = { key: def.key, mr, stream, timer: setTimeout(() => stopRec(), MAX_SEC * 1000) };
    draw();
  }

  function stopRec() {
    if (rec && rec.mr.state === 'recording') {
      try { rec.mr.stop(); } catch { /* ignore */ }
    }
    draw();
  }

  async function finish(def, blob) {
    busy = true;
    draw();
    try {
      const ctx = app.audio.ctx;
      if (!ctx) throw new Error('no audio');
      const buf = await ctx.decodeAudioData(await blob.arrayBuffer());
      const out = processVoice(buf.getChannelData(0), buf.sampleRate);
      if (!out) {
        toast('声が小さいか、短すぎます。マイクに近づいて、はっきり話してください');
        return;
      }
      const row = { key: def.key, rate: out.rate, pcm: out.pcm.buffer, at: new Date().toISOString() };
      await app.store.voicePut(row);
      records.set(def.key, row);
      app.audio.reloadClips();
      app.audio.previewRecording(row); // 録れた声をすぐ聞かせる
    } catch (e) {
      console.warn('録音の保存に失敗', e);
      toast('録音を保存できませんでした。もう一度試してください');
    } finally {
      busy = false;
      draw();
    }
  }

  async function remove(def) {
    try {
      await app.store.voiceDel(def.key);
      records.delete(def.key);
      app.audio.reloadClips();
      toast(`「${def.label}」の録音を消しました`);
    } catch {
      toast('消せませんでした');
    }
    draw();
  }

  function rowFor(def) {
    const r = records.get(def.key);
    const recording = !!rec && rec.key === def.key;
    const sec = r ? (r.pcm.byteLength / 2 / r.rate).toFixed(1) : '';
    const note = recording ? '録音中… 話したら ■ を押します'
      : r ? `録音済み（${sec}秒）`
        : '未録音（標準の声）' + (def.hint ? `　${def.hint}` : '');
    return h('li', { class: 'card vrow' },
      h('div', { class: 'menu-main' }, h('div', { class: 'menu-name' }, def.label), h('div', { class: 'meta' }, note)),
      h('div', { class: 'vbtns' },
        recording
          ? h('button', { class: 'btn btn-warn', onClick: stopRec }, '■ 停止')
          : h('button', { class: 'btn' + (r ? '' : ' btn-primary'), disabled: !!rec || busy, onClick: () => startRec(def) }, r ? '録り直す' : '● 録音'),
        r && !recording ? h('button', { class: 'btn', disabled: !!rec || busy, 'aria-label': `${def.label}を再生`, onClick: () => app.audio.previewRecording(r) }, '▶') : null,
        r && !recording ? h('button', { class: 'btn btn-danger-ghost', disabled: !!rec || busy, onClick: () => remove(def) }, '消す') : null));
  }

  function draw() {
    if (!alive) return;
    const phrases = CLIP_DEFS.filter((d) => d.group === 'phrase');
    const names = CLIP_DEFS.filter((d) => d.group === 'name');
    const mix = app.state.settings.mixMusic;
    box.replaceChildren();
    mount(box,
      h('section', { class: 'card' },
        h('p', null, 'あなたの声を録音して、音声ガイドにできます。録音していない言葉は、標準の声（VOICEVOX:ずんだもん）が鳴ります。'),
        h('ul', { class: 'meta vhelp' },
          h('li', null, '静かな場所で、マイクに近づいて、はっきり話してください。'),
          h('li', null, '「● 録音」を押して話し、終わったら「■ 停止」を押します（5秒で自動的に止まります）。'),
          h('li', null, '録音した声は、この端末の中だけに保存されます。バックアップには含まれません。'),
          h('li', null, '初めて録音するときは、マイクの使用を許可してください。')),
        h('p', { class: 'meta' }, mix
          ? '「音楽アプリと一緒に使う」：オン（録音した声が使われます）'
          : '「音楽アプリと一緒に使う」：オフ。設定でオンにすると、録音した声が使われます。'),
        h('div', { class: 'vsum' }, `録音済み ${records.size} / ${CLIP_DEFS.length}`)),
      h('h2', { class: 'sec' }, '決まった言葉'),
      h('ul', { class: 'list' }, phrases.map(rowFor)),
      h('h2', { class: 'sec' }, '種目名（最初から入っている種目）'),
      h('ul', { class: 'list' }, names.map(rowFor)),
      h('p', { class: 'meta pad' }, '録音していない言葉は、標準の声（VOICEVOX:ずんだもん）が鳴ります。自分で付けた種目名は、ここでは録音できないため、読み上げません。「音楽アプリと一緒に使う」がオフのときは、これまでどおり端末の読み上げです。'));
  }

  app.cleanup = () => {
    alive = false;
    if (rec) {
      clearTimeout(rec.timer);
      try { rec.mr.stop(); } catch { /* ignore */ }
      try { rec.stream.getTracks().forEach((t) => t.stop()); } catch { /* ignore */ }
    }
    app.audio.cancelSpeech();
  };

  mount(root, pageHeader('自分の声を録音', '#/settings'), box);
  draw();
  app.store.voiceAll().then((rows) => {
    for (const r of rows) records.set(r.key, r);
    draw();
  }).catch(() => draw());
}
