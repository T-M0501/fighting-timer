// 音声: Web Audio による電子音と、SpeechSynthesis による日本語音声ガイド。
//
// 聞こえやすさの設計（iPhone本体の最大音量を超えることはできません）:
//  - 矩形波(square)を使用。同じピーク振幅でも正弦波よりエネルギー(実効値)が大きく、小さなスピーカーでも通りやすい。
//  - 周波数は 700〜2000Hz 付近（スマホのスピーカーが得意な帯域）。
//  - 各音の振幅は 0.8 と十分に大きくし、DynamicsCompressorNode をリミッター的に設定して
//    重なっても音割れ(クリップ)しないようにする。音量スライダーは最終段のGainで調整。
//  - 立ち上がり6ms・立ち下がり30msのエンベロープでクリックノイズを防止。
//  - 音声ガイドは音量1.0固定で、電子音量スライダーとは独立（電子音を下げても声は聞こえる）。

import { DEFAULT_EXERCISE_NAMES } from './model.js';

const PEAK = 0.8;

// ---- 録音の声（「音楽アプリと一緒に使う」がオンのとき用） ----
// iPhoneは、読み上げ機能(SpeechSynthesis)が話し始めると音楽を止めてしまう。
// そこで、決まった言葉と、最初から入っている種目名だけは、録音した声を電子音と同じ仕組みで鳴らす。
// 声は2種類。どちらも電子音と同じ仕組み(Web Audio)で鳴らす:
//  - 標準の声: アプリに入れてある voice/*.wav（VOICEVOX:ずんだもん）。作り方は tools/make-voice.mjs。
//  - 自分の声: 利用者がアプリ内（screens-voice.js）で録音したもの。端末のIndexedDBに保存され、標準の声より優先される。
const CLIP_DIR = './voice/';
const clipNameKey = (name) => {
  const i = DEFAULT_EXERCISE_NAMES.indexOf(name);
  return i < 0 ? null : 'n' + String(i + 1).padStart(2, '0');
};
/** 録音する言葉の一覧。group: phrase=決まった言葉 / name=最初から入っている種目名 */
export const CLIP_DEFS = [
  { key: 'start', label: '運動開始', group: 'phrase' },
  { key: 'rest', label: '休憩開始', group: 'phrase' },
  { key: 'half', label: '残り半分', group: 'phrase' },
  { key: 'ten', label: '残り10秒', group: 'phrase' },
  { key: 'finish', label: 'トレーニング終了です', group: 'phrase' },
  { key: 'next', label: '次は', group: 'phrase', hint: '「次は、スクワット」の「次は」だけを言います' },
  ...DEFAULT_EXERCISE_NAMES.map((name, i) => ({ key: 'n' + String(i + 1).padStart(2, '0'), label: name, group: 'name' })),
];

/**
 * 録音した声を整える: 前後の無音を削り、音量をそろえる。声が小さすぎる・短すぎるときは null。
 * samples: Float32Array(-1〜1) / rate: サンプルレート
 */
export function processVoice(samples, rate) {
  let peak = 0;
  for (let i = 0; i < samples.length; i++) {
    const a = Math.abs(samples[i]);
    if (a > peak) peak = a;
  }
  if (peak < 0.02) return null;
  const th = peak * 0.06;
  let a = 0;
  let b = samples.length - 1;
  while (a < b && Math.abs(samples[a]) < th) a++;
  while (b > a && Math.abs(samples[b]) < th) b--;
  a = Math.max(0, a - Math.round(rate * 0.06));
  b = Math.min(samples.length - 1, b + Math.round(rate * 0.08));
  const n = b - a + 1;
  if (n < rate * 0.15) return null;
  const gain = 0.95 / peak;
  const fade = Math.max(1, Math.round(rate * 0.01));
  const pcm = new Int16Array(n);
  for (let i = 0; i < n; i++) {
    const f = Math.min(1, i / fade, (n - 1 - i) / fade);
    const v = Math.max(-1, Math.min(1, samples[a + i] * gain * f));
    pcm[i] = Math.round(v * 32767);
  }
  return { pcm, rate, sec: n / rate };
}

export const CLIP_KEYS = ['start', 'rest', 'half', 'ten', 'finish', 'next', ...DEFAULT_EXERCISE_NAMES.map((_, i) => 'n' + String(i + 1).padStart(2, '0'))];

/** 場面ごとに読み上げる文章（端末の読み上げ用） */
export function cueText(kind, name = '', first = false) {
  switch (kind) {
    case 'work': return first && name ? `${name}、運動開始` : '運動開始';
    case 'rest': return name ? `休憩開始。次は${name}` : '休憩開始';
    case 'prep': return name ? `次は${name}` : '';
    case 'half': return '残り半分';
    case 'ten': return '残り10秒';
    case 'finish': return 'トレーニング終了です';
    default: return '';
  }
}

/** 場面ごとに鳴らす録音の順番。種目名の録音がない(自分で付けた名前)ときは、その部分を省く */
export function cueClips(kind, name = '', first = false) {
  const n = clipNameKey(name);
  switch (kind) {
    case 'work': return first && n ? [n, 'start'] : ['start'];
    case 'rest': return n ? ['rest', 'next', n] : ['rest'];
    case 'prep': return n ? ['next', n] : [];
    case 'half': return ['half'];
    case 'ten': return ['ten'];
    case 'finish': return ['finish'];
    default: return [];
  }
}

export class AudioEngine {
  constructor(getSettings, loadVoices = async () => []) {
    this.getSettings = getSettings;
    this.loadVoices = loadVoices;
    this.ctx = null;
    this.master = null;
    this.lastBeepAt = 0;
    this.voice = null;
    this.speakTimer = null;
    this.clips = new Map(); // 録音の声（デコード済み）
    this.clipsState = 'idle'; // idle | loading | ready | failed
    this.clipsPromise = null;
    this.clipSrc = []; // 再生中の録音
    this.utter = null; // 読み上げ中の発話を保持（途中で破棄されて止まるのを防ぐ）
  }

  /** ユーザーの操作(タップ)の中で必ず呼ぶ。iOSでは操作内でないと音が出ない */
  unlock() {
    try {
      // iOS: 'playback' は消音モードでも鳴るが、音楽アプリは止まる。'ambient' は音楽アプリと一緒に鳴らせるが、消音モードでは鳴らない。
      if (navigator.audioSession) navigator.audioSession.type = this.getSettings().mixMusic ? 'ambient' : 'playback';
    } catch { /* 非対応 */ }
    try {
      if (!this.ctx) {
        const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
        if (AC) {
          this.ctx = new AC();
          const comp = this.ctx.createDynamicsCompressor();
          comp.threshold.value = -3;
          comp.knee.value = 0;
          comp.ratio.value = 20;
          comp.attack.value = 0.001;
          comp.release.value = 0.08;
          // 最終安全装置: どんな重なり方をしても 0.95 を超えないソフトクリッパー（音割れ防止）
          const shaper = this.ctx.createWaveShaper();
          const N = 2049;
          const curve = new Float32Array(N);
          for (let i = 0; i < N; i++) {
            const x = (i / (N - 1)) * 2 - 1;
            const a = Math.abs(x);
            curve[i] = Math.sign(x) * (a <= 0.7 ? a : 0.7 + 0.25 * Math.tanh((a - 0.7) / 0.25));
          }
          shaper.curve = curve;
          this.master = this.ctx.createGain();
          comp.connect(shaper);
          shaper.connect(this.master);
          this.master.connect(this.ctx.destination);
          this.input = comp;
          this.voiceGain = this.ctx.createGain(); // 録音の声は電子音量の影響を受けず、そのままの大きさで出す
          this.voiceGain.connect(this.ctx.destination);
          // iPhoneでは読み上げや着信などで音が止められる(interrupted)ことがある。止められたら自分で再開する。
          // ただし読み上げの最中は再開しない（声を途中で止めてしまうおそれがあるため。読み上げが終われば再開する）
          this.ctx.addEventListener('statechange', () => { if (!this.utter) this._wake(); });
          document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') this._wake(); });
        }
      }
      if (this.ctx && this.ctx.state !== 'running') this.ctx.resume().catch(() => {});
    } catch (e) {
      console.warn('AudioContext初期化失敗', e);
    }
    if (this.ctx && this.getSettings().mixMusic) this.loadClips();
    // 声の一覧を先に読み込んでおく。ここでは無音の読み上げをしない:
    // 直後の本物の読み上げがそれを取り消す形になり、iPhoneで声が出なくなることがあるため。
    try { globalThis.speechSynthesis?.getVoices(); } catch { /* ignore */ }
  }

  _bufferFrom(rec) {
    const pcm = new Int16Array(rec.pcm);
    const b = this.ctx.createBuffer(1, pcm.length, rec.rate);
    const f = b.getChannelData(0);
    for (let i = 0; i < pcm.length; i++) f[i] = pcm[i] / 32768;
    return b;
  }

  /** 録音の声を読み込む（一度だけ）。1つもなければ 'failed' にして、端末の読み上げに切り替える */
  loadClips() {
    if (this.clipsPromise) return this.clipsPromise;
    this.clipsState = 'loading';
    const token = (this.clipsToken = (this.clipsToken || 0) + 1);
    this.clipsPromise = (async () => {
      const clips = new Map();
      // 標準の声（アプリに入っているファイル。なくてもアプリは動く）
      await Promise.all(CLIP_KEYS.map(async (k) => {
        try {
          const r = await fetch(CLIP_DIR + k + '.wav');
          if (!r.ok) throw new Error(String(r.status));
          clips.set(k, await this.ctx.decodeAudioData(await r.arrayBuffer()));
        } catch { /* ignore */ }
      }));
      // 自分の声（あれば標準の声より優先）
      let rows = [];
      try { rows = (await this.loadVoices()) || []; } catch { /* ignore */ }
      for (const r of rows) {
        if (!CLIP_KEYS.includes(r.key)) continue;
        try { clips.set(r.key, this._bufferFrom(r)); } catch { /* ignore */ }
      }
      if (token !== this.clipsToken) return; // 読み込み中に録音が変わったら、新しい読み込みに任せる
      this.clips = clips;
      this.clipsState = clips.size > 0 ? 'ready' : 'failed';
    })();
    return this.clipsPromise;
  }

  /** 録音を録り直した・消したあとに、読み込み直す */
  reloadClips() {
    this.clipsToken = (this.clipsToken || 0) + 1; // 読み込み中のものがあれば、その結果は捨てる
    this.clips = new Map();
    this.clipsPromise = null;
    this.clipsState = 'idle';
    if (this.ctx && this.getSettings().mixMusic) this.loadClips();
  }

  /** 録音した声を1つ再生して確かめる（録音画面用） */
  previewRecording(rec) {
    this.unlock();
    if (!this.ctx) return;
    try {
      this._stopClips();
      const src = this.ctx.createBufferSource();
      src.buffer = this._bufferFrom(rec);
      src.connect(this.voiceGain);
      src.onended = () => { this.clipSrc = this.clipSrc.filter((x) => x !== src); try { src.disconnect(); } catch { /* ignore */ } };
      this.clipSrc.push(src);
      src.start();
    } catch (e) { console.warn('録音の再生に失敗', e); }
  }

  /** 電子音の出口が止められていたら再開する */
  _wake() {
    try {
      if (this.ctx && this.ctx.state !== 'running' && this.ctx.state !== 'closed') this.ctx.resume().catch(() => {});
    } catch { /* ignore */ }
  }

  /**
   * 読み上げの間だけ、耳に聞こえないごく小さな低い音を流し続ける。
   * iPhoneでは、電子音が鳴っている間しか読み上げの声が出ない(電子音が止むと声も途切れる)現象があるための対策。
   */
  _keepAlive(on) {
    clearTimeout(this.kaTimer);
    try {
      if (on && this.keepAliveOn !== false) {
        if (this.ka || !this.ctx || this.ctx.state !== 'running') return;
        const osc = this.ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.value = 40;
        const g = this.ctx.createGain();
        g.gain.value = 0.001;
        osc.connect(g);
        g.connect(this.ctx.destination);
        osc.start();
        this.ka = { osc, g };
        this.kaTimer = setTimeout(() => this._keepAlive(false), 12000); // 終了の合図が来ない端末のための保険
      } else if (this.ka) {
        const { osc, g } = this.ka;
        this.ka = null;
        osc.stop();
        osc.disconnect();
        g.disconnect();
      }
    } catch { this.ka = null; }
  }

  /** タップの中で無音の読み上げをして、あとから(時間差で)声を出せるようにする。すぐ後に speak() を呼ぶ場合は不要 */
  primeSpeech() {
    try {
      const s = globalThis.speechSynthesis;
      if (!s || s.speaking || s.pending) return;
      s.getVoices();
      const u = new SpeechSynthesisUtterance(' ');
      u.volume = 0;
      s.speak(u);
    } catch { /* ignore */ }
  }

  _volume() {
    const v = Math.min(100, Math.max(0, this.getSettings().volume)) / 100;
    return v;
  }

  _tone(freq, when, dur, peak = PEAK, type = 'square') {
    const ctx = this.ctx;
    const t0 = ctx.currentTime + when;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = freq;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 6000;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(peak, t0 + 0.006);
    g.gain.setValueAtTime(peak, t0 + Math.max(0.006, dur - 0.03));
    g.gain.linearRampToValueAtTime(0, t0 + dur);
    osc.connect(lp);
    lp.connect(g);
    g.connect(this.input);
    osc.start(t0);
    osc.stop(t0 + dur + 0.03);
    osc.onended = () => { try { osc.disconnect(); lp.disconnect(); g.disconnect(); } catch { /* ignore */ } };
  }

  /** kind: count | work | rest | prep | resume | finish。force=true で設定のオン・オフを無視(試聴用) */
  beep(kind, { force = false } = {}) {
    const st = this.getSettings();
    if (!force && !st.beepOn) return;
    if (!this.ctx) this.unlock();
    if (!this.ctx) return;
    const nowMs = performance.now();
    if (kind === 'count' || kind === 'resume') {
      if (nowMs - this.lastBeepAt < 120) return; // 連続音の重複防止
    }
    this.lastBeepAt = nowMs;
    if (this.ctx.state === 'running') {
      this._play(kind);
      return;
    }
    // 音声再生などで一時停止(suspended/interrupted)になっていたら、再開できてから鳴らす。
    // カウント音は0.5秒、切り替え音などは2秒以上遅れたら、ずれて鳴らないよう捨てる。
    const limit = kind === 'count' || kind === 'resume' ? 500 : 2000;
    this.ctx.resume().then(() => {
      if (performance.now() - nowMs < limit && this.ctx.state === 'running') this._play(kind);
    }).catch(() => {});
  }

  _play(kind) {
    this.master.gain.cancelScheduledValues(this.ctx.currentTime);
    this.master.gain.setValueAtTime(this._volume(), this.ctx.currentTime);
    switch (kind) {
      case 'count': this._tone(1000, 0, 0.18); break;
      case 'resume': this._tone(800, 0, 0.09); break;
      case 'prep': this._tone(988, 0, 0.28); break;
      case 'work': this._tone(1320, 0, 0.16); this._tone(1760, 0.19, 0.34); break; // 上昇音=開始
      case 'rest': this._tone(1175, 0, 0.16); this._tone(880, 0.19, 0.34); break; // 下降音=休憩
      case 'finish': {
        // 専用の終了メロディー: ド・ミ・ソ・高いド → 和音で締める
        const notes = [[523.25, 0, 0.2], [659.25, 0.22, 0.2], [783.99, 0.44, 0.2], [1046.5, 0.66, 0.3]];
        for (const [f, w, d] of notes) this._tone(f, w, d);
        this._tone(1046.5, 1.0, 0.8, 0.4);
        this._tone(783.99, 1.0, 0.8, 0.3);
        this._tone(659.25, 1.0, 0.8, 0.3);
        break;
      }
      default: break;
    }
  }

  /**
   * 端末に入っている日本語音声から、女性/男性の声を選ぶ（名前で判定）。
   * 男性の声が端末になければ、女性の声のピッチを下げた代用にする(substituted=true)。
   */
  pickVoice(gender) {
    const MALE = /otoya|ichiro|hattori|takeru|kenji|taro|yuuto|naoki|keita|daichi|男性|\bmale\b/i;
    const FEMALE = /female|女性/i;
    let list = [];
    try {
      list = globalThis.speechSynthesis.getVoices().filter((v) => /^ja/i.test(String(v.lang).replace('_', '-')));
    } catch { /* 非対応 */ }
    const isMale = (v) => MALE.test(v.name) && !FEMALE.test(v.name);
    const males = list.filter(isMale);
    const females = list.filter((v) => !isMale(v));
    const best = (arr) => arr.find((v) => /premium|enhanced|natural|高品質|拡張/i.test(v.name)) || arr.find((v) => v.localService) || arr[0] || null;
    if (gender === 'male') {
      if (males.length) return { voice: best(males), substituted: false };
      return { voice: best(females), substituted: true };
    }
    return { voice: best(females.length ? females : males), substituted: false };
  }

  describeVoice(gender) {
    const { voice, substituted } = this.pickVoice(gender);
    return { name: voice ? voice.name : null, substituted };
  }

  /**
   * delayMs: 読み上げを始めるまでの待ち時間。
   * iPhoneは読み上げ中にほかの音を小さくするため、切り替えの電子音が鳴り終わってから話し始める。
   */
  speak(text, { force = false, delayMs = 0 } = {}) {
    const st = this.getSettings();
    if (!force && !st.voiceOn) return;
    const s = globalThis.speechSynthesis;
    if (!s || typeof SpeechSynthesisUtterance === 'undefined') return;
    clearTimeout(this.speakTimer);
    let busy = false;
    try {
      busy = s.speaking || s.pending;
      if (busy) s.cancel(); // 前の読み上げと重ならないようにする
    } catch { /* ignore */ }
    // 取り消しの直後に話し始めると、iPhoneでは声が出ないことがあるので少し待つ
    const wait = Math.max(delayMs, busy ? 80 : 0);
    this._keepAlive(true); // 話し始める前から音の出口を開けておく（声の出だしが小さくなったり欠けたりしないように）
    if (wait > 0) this.speakTimer = setTimeout(() => this._speakNow(text, st), wait);
    else this._speakNow(text, st);
  }

  _speakNow(text, st) {
    const s = globalThis.speechSynthesis;
    try {
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'ja-JP';
      u.volume = 1;
      const { voice, substituted } = this.pickVoice(st.voiceGender);
      u.rate = substituted ? 0.95 : 1;
      u.pitch = substituted ? 0.55 : 1; // 男性の声がない端末では、声を低くして代用
      if (voice) u.voice = voice;
      // 読み上げのあとに電子音が止められたままにならないよう、終わったら再開を試みる
      const log = { text, voice: voice ? voice.name : '端末の標準', started: false, ended: false, error: '' };
      this.lastSpeech = log; // 設定画面のテストで表示する診断用
      u.onstart = () => { log.started = true; };
      const done = () => { if (this.utter === u) { this.utter = null; this._keepAlive(false); } this._wake(); };
      u.onend = () => { log.ended = true; done(); };
      u.onerror = (e) => { log.error = String((e && e.error) || '不明'); done(); };
      this.utter = u;
      this._keepAlive(true);
      s.speak(u);
    } catch (e) {
      console.warn('音声読み上げ失敗', e);
    }
  }

  /**
   * 場面に合わせて声を出す。
   * 「音楽アプリと一緒に使う」オンのときは録音の声（音楽を止めない）、そうでなければ端末の読み上げ。
   * kind: work | rest | prep | half | ten | finish
   */
  cue(kind, { name = '', first = false, force = false, delayMs = 0 } = {}) {
    const st = this.getSettings();
    if (!force && !st.voiceOn) return;
    const text = cueText(kind, name, first);
    if (st.mixMusic && this.clipsState !== 'failed') {
      this._playClips(cueClips(kind, name, first), text, delayMs, force);
      return;
    }
    if (text) this.speak(text, { force, delayMs });
  }

  async _playClips(keys, text, delayMs, force) {
    if (!keys.length) return;
    if (!this.ctx) this.unlock();
    if (!this.ctx) { if (text) this.speak(text, { force, delayMs }); return; }
    const asked = performance.now();
    try { await this.loadClips(); } catch { /* ignore */ }
    if (this.clipsState !== 'ready') { if (text) this.speak(text, { force, delayMs }); return; }
    try { if (this.ctx.state !== 'running') await this.ctx.resume(); } catch { /* ignore */ }
    if (this.ctx.state !== 'running' || performance.now() - asked > 2500) return; // ずれて鳴るくらいなら鳴らさない
    this._stopClips();
    let t = this.ctx.currentTime + Math.max(0, delayMs - (performance.now() - asked)) / 1000 + 0.02;
    for (const k of keys) {
      const b = this.clips.get(k);
      if (!b) continue;
      const src = this.ctx.createBufferSource();
      src.buffer = b;
      src.connect(this.voiceGain);
      src.start(t);
      src.onended = () => { this.clipSrc = this.clipSrc.filter((x) => x !== src); try { src.disconnect(); } catch { /* ignore */ } };
      this.clipSrc.push(src);
      t += b.duration + 0.06;
    }
  }

  _stopClips() {
    for (const s of this.clipSrc) { try { s.stop(); } catch { /* ignore */ } }
    this.clipSrc = [];
  }

  cancelSpeech() {
    this._stopClips();
    clearTimeout(this.speakTimer);
    this.utter = null;
    this._keepAlive(false);
    try { globalThis.speechSynthesis?.cancel(); } catch { /* ignore */ }
  }
}
