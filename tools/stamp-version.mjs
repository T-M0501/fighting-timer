// 公開前に実行: アプリのファイル内容から版番号を作り、sw.js と js/version.js に書き込む。
// 内容が変われば版番号が変わり、利用者の端末が「新しいバージョンがある」と判断して自動更新される。
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const targets = ['index.html', 'styles.css', 'manifest.webmanifest'];
for (const f of await readdir(join(root, 'js'))) if (f !== 'version.js') targets.push('js/' + f);
for (const f of await readdir(join(root, 'icons'))) targets.push('icons/' + f);
targets.sort();

const hash = createHash('sha256');
for (const t of targets) {
  hash.update(t);
  hash.update(await readFile(join(root, t)));
}
const d = new Date();
const p = (n) => String(n).padStart(2, '0');
const version = `${d.getFullYear()}.${p(d.getMonth() + 1)}${p(d.getDate())}-${hash.digest('hex').slice(0, 8)}`;

const swPath = join(root, 'sw.js');
const sw = (await readFile(swPath, 'utf8')).replace(/const VERSION = '[^']*';/, `const VERSION = '${version}';`);
await writeFile(swPath, sw);
await writeFile(join(root, 'js', 'version.js'),
  `// このファイルは tools/stamp-version.mjs が自動で書き換えます（手で編集しないでください）\nexport const APP_VERSION = '${version}';\n`);
console.log('版番号:', version);
