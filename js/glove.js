// トップ画面用のボクシンググローブのイラスト（固定のSVG文字列のみ。外部データは入れない）
const SVG = `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="ボクシンググローブ">
  <path d="M17 31C17 18 25 10 37 10c11 0 17 7 17 17 0 5-1 8-3 11l-1 9H24l-2-9c-3-2-5-5-5-7z" fill="#e03131"/>
  <path d="M17 33c-6-1-9 5-5 9 3 3 9 2 12-2z" fill="#c92a2a"/>
  <path d="M30 17c5-2 11-1 15 3" stroke="#fff" stroke-opacity=".55" stroke-width="3.2" fill="none" stroke-linecap="round"/>
  <path d="M38 27v7M46 28v7" stroke="#a51111" stroke-width="2.4" stroke-linecap="round"/>
  <rect x="22" y="47" width="30" height="11" rx="3.5" fill="#f8f9fa" stroke="#1c2530" stroke-width="2.4"/>
  <path d="M30 47v11M38 47v11M46 47v11" stroke="#1c2530" stroke-opacity=".25" stroke-width="2"/>
</svg>`;

export function gloveIcon() {
  const doc = new DOMParser().parseFromString(SVG, 'image/svg+xml');
  const el = document.importNode(doc.documentElement, true);
  el.setAttribute('class', 'glove');
  return el;
}
