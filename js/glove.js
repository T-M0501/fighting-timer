// テーマ別のイラスト（固定のSVG文字列のみ。外部データは入れない）。ファイル名は旧名のまま。
const ICONS = {
  kickboxing: `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="グローブ">
  <path d="M17 31C17 18 25 10 37 10c11 0 17 7 17 17 0 5-1 8-3 11l-1 9H24l-2-9c-3-2-5-5-5-7z" fill="#e03131"/>
  <path d="M17 33c-6-1-9 5-5 9 3 3 9 2 12-2z" fill="#c92a2a"/>
  <path d="M30 17c5-2 11-1 15 3" stroke="#fff" stroke-opacity=".55" stroke-width="3.2" fill="none" stroke-linecap="round"/>
  <path d="M38 27v7M46 28v7" stroke="#a51111" stroke-width="2.4" stroke-linecap="round"/>
  <rect x="22" y="47" width="30" height="11" rx="3.5" fill="#f8f9fa" stroke="#1c2530" stroke-width="2.4"/>
  <path d="M30 47v11M38 47v11M46 47v11" stroke="#1c2530" stroke-opacity=".25" stroke-width="2"/>
</svg>`,
  boxing: `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="ゴング">
  <circle cx="32" cy="33" r="23" fill="#d4af37"/>
  <circle cx="32" cy="33" r="17" fill="none" stroke="#a8841a" stroke-width="2.4"/>
  <circle cx="32" cy="33" r="6" fill="#a8841a"/>
  <path d="M19 22c3-5 8-8 14-8" stroke="#fff" stroke-opacity=".5" stroke-width="3" fill="none" stroke-linecap="round"/>
  <path d="M32 6v5M20 10l2 3M44 10l-2 3" stroke="#d4af37" stroke-width="2.6" stroke-linecap="round"/>
</svg>`,
  judo: `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="柔道着">
  <path d="M20 8l12 10 12-10 14 12-6 12-6-3v26H18V29l-6 3-6-12z" fill="#f1f3f5" stroke="#1c2530" stroke-width="2.4" stroke-linejoin="round"/>
  <path d="M20 8l12 24 12-24" fill="none" stroke="#1c2530" stroke-width="2.4" stroke-linejoin="round"/>
  <rect x="18" y="40" width="28" height="6" fill="#16181b"/>
  <path d="M30 46l-3 11M34 46l3 11" stroke="#16181b" stroke-width="3" stroke-linecap="round"/>
</svg>`,
  karate: `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="空手">
  <circle cx="32" cy="32" r="27" fill="#d9342b"/>
  <text x="32" y="44" text-anchor="middle" font-size="34" font-weight="700" fill="#fff" font-family="'Hiragino Mincho ProN','Yu Mincho','Noto Serif JP',serif">空</text>
</svg>`,
};

/** テーマのイラスト要素を返す。通常テーマは null */
export function themeIcon(theme, cls = 'glove') {
  const s = ICONS[theme];
  if (!s) return null;
  const doc = new DOMParser().parseFromString(s, 'image/svg+xml');
  const el = document.importNode(doc.documentElement, true);
  el.setAttribute('class', cls);
  return el;
}

export const THEME_TAGLINE = {
  normal: 'トレーニングタイマー',
  kickboxing: 'キックボクシング',
  boxing: 'ボクシング',
  judo: '柔道',
  karate: '空手',
};
