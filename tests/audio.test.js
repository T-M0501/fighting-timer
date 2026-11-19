import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cueText, cueClips, CLIP_KEYS, CLIP_DEFS, processVoice } from '../js/audio.js';

test('場面ごとの読み上げ文', () => {
  assert.equal(cueText('work', 'スクワット', true), 'スクワット、運動開始');
  assert.equal(cueText('work', 'スクワット', false), '運動開始');
  assert.equal(cueText('rest', 'プランク'), '休憩開始。次はプランク');
  assert.equal(cueText('prep', 'プランク'), '次はプランク');
  assert.equal(cueText('half'), '残り半分');
  assert.equal(cueText('ten'), '残り10秒');
});

test('録音の声の組み合わせ（最初から入っている種目名だけ読む）', () => {
  assert.deepEqual(cueClips('work', 'スクワット', true), ['n01', 'start']);
  assert.deepEqual(cueClips('work', '自分で付けた名前', true), ['start']);
  assert.deepEqual(cueClips('rest', '縄跳び'), ['rest', 'next', 'n15']);
  assert.deepEqual(cueClips('rest', '自分で付けた名前'), ['rest']);
  assert.deepEqual(cueClips('prep', '自分で付けた名前'), []);
  assert.deepEqual(cueClips('ten'), ['ten']);
  assert.ok(cueClips('prep', '腕立て伏せ').every((k) => CLIP_KEYS.includes(k)));
});

test('録音の言葉の一覧とキーが合っている', () => {
  assert.deepEqual(CLIP_DEFS.map((d) => d.key), CLIP_KEYS);
  assert.equal(CLIP_DEFS.filter((d) => d.group === 'name').length, 15);
});

test('録音を整える: 前後の無音を削り、音量をそろえる', () => {
  const rate = 8000;
  const s = new Float32Array(rate); // 1秒
  for (let i = 3000; i < 3800; i++) s[i] = 0.2 * Math.sin(i / 5); // 0.1秒ぶんの声
  const out = processVoice(s, rate);
  assert.ok(out);
  assert.ok(out.sec < 0.4 && out.sec > 0.15, 'trimmed: ' + out.sec);
  const peak = Math.max(...out.pcm.map(Math.abs));
  assert.ok(peak > 0.9 * 32767 && peak <= 32767);
});

test('録音を整える: 無音や短すぎる録音は受け付けない', () => {
  assert.equal(processVoice(new Float32Array(8000), 8000), null);
  const quiet = new Float32Array(8000).fill(0.005);
  assert.equal(processVoice(quiet, 8000), null);
  const blip = new Float32Array(8000);
  blip[4000] = 0.5;
  assert.equal(processVoice(blip, 8000), null);
});
