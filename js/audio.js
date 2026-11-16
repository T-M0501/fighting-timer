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
        }
      }
      if (this.ctx && this.ctx.state !== 'running') this.ctx.resume().catch(() => {});
    } catch (e) {
      console.warn('AudioContext初期化失敗', e);
    }
    this.primeSpeech();
  }

  primeSpeech() {
    try {
      const s = globalThis.speechSynthesis;
      if (!s) return;
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
    if (this.ctx.state !== 'running') this.ctx.resume().catch(() => {});
    const nowMs = performance.now();
    if (kind === 'count' || kind === 'resume') {
      if (nowMs - this.lastBeepAt < 120) return; // 連続音の重複防止
    }
    this.lastBeepAt = nowMs;
    this.master.gain.cancelScheduledValues(this.ctx.currentTime);
    this.master.gain.setValueAtTime(this._volume(), this.ctx.currentTime);
    switch (kind) {
      case 'count': this._tone(1000, 0, 0.12); break;
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

  _pickVoice() {
    try {
      const list = globalThis.speechSynthesis.getVoices();
      return list.find((v) => v.lang === 'ja-JP') || list.find((v) => (v.lang || '').toLowerCase().startsWith('ja')) || null;
    } catch {
      return null;
    }
  }

  speak(text, { force = false } = {}) {
    const st = this.getSettings();
    if (!force && !st.voiceOn) return;
    const s = globalThis.speechSynthesis;
    if (!s || typeof SpeechSynthesisUtterance === 'undefined') return;
    try {
      s.cancel(); // 前の読み上げと重ならないようにする
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'ja-JP';
      u.volume = 1;
      u.rate = 1;
      u.pitch = 1;
      const v = this._pickVoice();
      if (v) u.voice = v;
      s.speak(u);
    } catch (e) {
      console.warn('音声読み上げ失敗', e);
    }
  }

  cancelSpeech() {
    try { globalThis.speechSynthesis?.cancel(); } catch { /* ignore */ }
  }
}
