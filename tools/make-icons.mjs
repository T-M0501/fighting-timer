// 仮アイコン(PNG)を生成する。外部ライブラリ不要。後で差し替える場合は icons/ のPNGを置き換えるだけでよい。
import { writeFile, mkdir } from 'node:fs/promises';
import { deflateSync, crc32 } from 'node:zlib';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));

function png(size, pixel) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  const SS = 3; // 3x3 スーパーサンプリング
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) {
        const c = pixel((x + (sx + 0.5) / SS) / size, (y + (sy + 0.5) / SS) / size);
        r += c[0] * c[3]; g += c[1] * c[3]; b += c[2] * c[3]; a += c[3];
      }
      const o = y * (size * 4 + 1) + 1 + x * 4;
      const n = SS * SS;
      raw[o] = a ? Math.round(r / a) : 0;
      raw[o + 1] = a ? Math.round(g / a) : 0;
      raw[o + 2] = a ? Math.round(b / a) : 0;
      raw[o + 3] = Math.round((a / n) * 255);
    }
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td) >>> 0);
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

const ORANGE = [232, 89, 12, 1];
const WHITE = [255, 255, 255, 1];
const NONE = [0, 0, 0, 0];

// ストップウォッチ風のデザイン。scale: 図柄の大きさ(maskable用は小さめ)。rounded: 角丸の有無
function design({ scale, rounded, fullBleed }) {
  return (u, v) => {
    const inRound = (() => {
      if (!rounded) return true;
      const rad = 0.22, x = Math.min(u, 1 - u), y = Math.min(v, 1 - v);
      if (x >= rad || y >= rad) return true;
      return (rad - x) ** 2 + (rad - y) ** 2 <= rad * rad;
    })();
    if (!inRound) return NONE;
    const cx = (u - 0.5) / scale, cy = (v - 0.54) / scale;
    const d = Math.hypot(cx, cy);
    // 外周リング
    if (d <= 0.34 && d >= 0.26) return WHITE;
    // 上のボタン
    if (Math.abs(cx) <= 0.06 && cy >= -0.46 && cy <= -0.36) return WHITE;
    if (Math.abs(cx) <= 0.13 && cy >= -0.5 && cy <= -0.45) return WHITE;
    // 針（12時と1時半方向）
    if (Math.abs(cx) <= 0.028 && cy >= -0.2 && cy <= 0.02) return WHITE;
    const dx = cx - 0, dy = cy - 0.0;
    const t = (dx * 0.7071 + dy * -0.7071) * -1; // 斜め針
    if (d <= 0.2 && Math.abs(dx * 0.7071 + dy * 0.7071) <= 0.03 && dx * 0.7071 - dy * 0.7071 >= -0.01) return WHITE;
    void t;
    return fullBleed || rounded ? ORANGE : ORANGE;
  };
}

await mkdir(join(root, 'icons'), { recursive: true });
const out = (name, size, opts) => writeFile(join(root, 'icons', name), png(size, design(opts)));
await out('icon-192.png', 192, { scale: 1, rounded: true });
await out('icon-512.png', 512, { scale: 1, rounded: true });
await out('apple-touch-icon.png', 180, { scale: 1, rounded: false, fullBleed: true });
await out('maskable-512.png', 512, { scale: 0.78, rounded: false, fullBleed: true });

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" rx="22" fill="#e8590c"/><circle cx="50" cy="54" r="30" fill="none" stroke="#fff" stroke-width="8"/><rect x="44" y="8" width="12" height="10" fill="#fff"/><rect x="37" y="4" width="26" height="5" fill="#fff"/><path d="M50 54V38M50 54l12-12" stroke="#fff" stroke-width="5" stroke-linecap="round"/></svg>\n`;
await writeFile(join(root, 'icons', 'icon.svg'), svg);
console.log('icons generated');
