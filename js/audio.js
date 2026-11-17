// 音声: Web Audio による電子音と、SpeechSynthesis による日本語音声ガイド。
//
// 聞こえやすさの設計（iPhone本体の最大音量を超えることはできません）:
//  - 矩形波(square)を使用。同じピーク振幅でも正弦波よりエネルギー(実効値)が大きく、小さなスピーカーでも通りやすい。
//  - 周波数は 700〜2000Hz 付近（スマホのスピーカーが得意な帯域）。
//  - 各音の振幅は 0.8 と十分に大きくし、DynamicsCompressorNode をリミッター的に設定して
//    重なっても音割れ(クリップ)しないようにする。音量スライダーは最終段のGainで調整。
//  - 立ち上がり6ms・立ち下がり30msのエンベロープでクリックノイズを防止。
//  - 音声ガイドは音量1.0固定で、電子音量スライダーとは独立（電子音を下げても声は聞こえる）。

const PEAK = 0.8;

export class AudioEngine {
  constructor(getSettings) {
    this.getSettings = getSettings;
    this.ctx = null;
    this.master = null;
    this.lastBeepAt = 0;
    this.voice = null;
    this.speakTimer = null;
    this.utter = null; // 読み上げ中の発話を保持（途中で破棄されて止まるのを防ぐ）
  }

  /** ユーザーの操作(タップ)の中で必ず呼ぶ。iOSでは操作内でないと音が出ない */
  unlock() {
    try {
      if (navigator.audioSession) navigator.audioSession.type = 'playback'; // iOS: サイレントスイッチの影響を受けにくくする
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
    // 声の一覧を先に読み込んでおく。ここでは無音の読み上げをしない:
    // 直後の本物の読み上げがそれを取り消す形になり、iPhoneで声が出なくなることがあるため。
    try { globalThis.speechSynthesis?.getVoices(); } catch { /* ignore */ }
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

  cancelSpeech() {
    clearTimeout(this.speakTimer);
    this.utter = null;
    this._keepAlive(false);
    try { globalThis.speechSynthesis?.cancel(); } catch { /* ignore */ }
  }
}
