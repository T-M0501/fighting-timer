// アプリに標準で入れる声(voice/*.wav)を、VOICEVOX ENGINE で作る。
// 使い方:
//   1) VOICEVOX ENGINE(公式 https://github.com/VOICEVOX/voicevox_engine )を起動しておく（既定: http://127.0.0.1:50021）
//   2) node tools/make-voice.mjs [エンジンのURL] [話者名=ずんだもん] [スタイル名=ノーマル]
// 声の利用条件: クレジット表記が必要（アプリ内に「VOICEVOX:ずんだもん」と表示している）。
//   https://zunko.jp/con_ongen_kiyaku.html
// 作った音声は、アプリ内の録音と同じ方法(processVoice)で、前後の無音を削り、音量をそろえる。
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CLIP_DEFS, processVoice } from '../js/audio.js';

const base = process.argv[2] || 'http://127.0.0.1:50021';
const speakerName = process.argv[3] || 'ずんだもん';
const styleName = process.argv[4] || 'ノーマル';
const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'voice');
mkdirSync(out, { recursive: true });

// 読み上げる文字。漢字の読みを誤りやすいものは、ひらがなにする（読みは audio_query の kana で確認できる）
const SAY = {
  '運動開始': '運動開始', '休憩開始': '休憩開始', '残り半分': '残り半分', '残り10秒': '残り十秒',
  'トレーニング終了です': 'トレーニング終了です', '次は': '次は',
  '背筋': 'はいきん', // 漢字のままだと「せすじ」と読まれる
};
const say = (label) => SAY[label] ?? label;

const speakers = await (await fetch(base + '/speakers')).json();
const sp = speakers.find((s) => s.name === speakerName);
const style = sp && sp.styles.find((s) => s.name === styleName);
if (!style) { console.error('話者が見つかりません:', speakerName, styleName); process.exit(1); }
console.log(`声: ${speakerName}（${styleName}） スタイルID=${style.id}`);

function readWav(buf) {
  let p = 12;
  let rate = 24000;
  while (p + 8 <= buf.length) {
    const id = buf.toString('ascii', p, p + 4);
    const size = buf.readUInt32LE(p + 4);
    if (id === 'fmt ') rate = buf.readUInt32LE(p + 12);
    if (id === 'data') {
      const n = Math.min(size, buf.length - p - 8) >> 1;
      const f = new Float32Array(n);
      for (let i = 0; i < n; i++) f[i] = buf.readInt16LE(p + 8 + i * 2) / 32768;
      return { rate, samples: f };
    }
    p += 8 + size + (size & 1);
  }
  throw new Error('data chunk not found');
}

function writeWav(rate, pcm) {
  const head = Buffer.alloc(44);
  head.write('RIFF', 0); head.writeUInt32LE(36 + pcm.length * 2, 4); head.write('WAVEfmt ', 8);
  head.writeUInt32LE(16, 16); head.writeUInt16LE(1, 20); head.writeUInt16LE(1, 22);
  head.writeUInt32LE(rate, 24); head.writeUInt32LE(rate * 2, 28); head.writeUInt16LE(2, 32); head.writeUInt16LE(16, 34);
  head.write('data', 36); head.writeUInt32LE(pcm.length * 2, 40);
  return Buffer.concat([head, Buffer.from(pcm.buffer, pcm.byteOffset, pcm.length * 2)]);
}

let total = 0;
for (const def of CLIP_DEFS) {
  const text = say(def.label);
  const q = await fetch(`${base}/audio_query?text=${encodeURIComponent(text)}&speaker=${style.id}`, { method: 'POST' });
  const query = await q.json();
  query.speedScale = 1.05; // 少しだけ早口にして、きびきびした感じにする
  query.outputSamplingRate = 24000;
  query.outputStereo = false;
  const s = await fetch(`${base}/synthesis?speaker=${style.id}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(query) });
  const { rate, samples } = readWav(Buffer.from(await s.arrayBuffer()));
  const r = processVoice(samples, rate);
  if (!r) { console.error('作れませんでした:', def.label); process.exit(1); }
  const file = writeWav(r.rate, r.pcm);
  writeFileSync(join(out, def.key + '.wav'), file);
  total += file.length;
  console.log(`${def.key}.wav  ${r.sec.toFixed(2)}秒  ${def.label}  読み: ${query.kana}`);
}
writeFileSync(join(out, 'CREDIT.txt'), `音声: VOICEVOX:${speakerName}\nhttps://voicevox.hiroshiba.jp/\n利用規約: https://zunko.jp/con_ongen_kiyaku.html\n`);
console.log(`合計 ${(total / 1024).toFixed(0)} KB`);
