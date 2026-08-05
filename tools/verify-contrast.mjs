// styles.css의 실제 토큰 값을 읽어 명도 대비를 검증한다 (눈대중 금지)
import { readFileSync } from "fs";

const css = readFileSync("/home/user/wrongnote/src/styles.css", "utf8");

// 두 :root 블록을 순서대로 잘라낸다
const lightStart = css.indexOf(":root {");
const darkStart = css.indexOf(':root[data-theme="dark"] {');
const lightBlock = css.slice(lightStart, darkStart);
const darkBlock = css.slice(darkStart, darkStart + 3000);

const parse = (block) => {
  const o = {};
  for (const m of block.matchAll(/(--[a-z0-9-]+):\s*(#[0-9a-fA-F]{6})/g)) o[m[1]] = m[2];
  return o;
};
const light = parse(lightBlock);
const dark = { ...light, ...parse(darkBlock) }; // 다크는 라이트를 덮어쓴다

const lin = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const L = (h) => { const n = parseInt(h.slice(1), 16);
  return 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255); };
const R = (a, b) => { const [x, y] = [L(a), L(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

const PAIRS = [
  ["--text", "--paper"], ["--text-secondary", "--paper"], ["--text-muted", "--paper"],
  ["--text", "--surface-2"], ["--text-muted", "--surface-2"], ["--text", "--bg"],
  ["--on-action", "--action"], ["--red-pen", "--paper"], ["--red-pen", "--red-pen-soft"],
  ["--success", "--paper"], ["--success", "--success-soft"], ["--blue-pen", "--paper"],
  ["--warning", "--highlight"], ["--text-on-accent", "--red-pen"],
];

let fails = 0;
for (const [label, t] of [["주간", light], ["야간", dark]]) {
  console.log(`\n■ ${label}`);
  for (const [fg, bg] of PAIRS) {
    if (!t[fg] || !t[bg]) { console.log(`  ? ${fg}/${bg} 미정의`); continue; }
    const r = R(t[fg], t[bg]);
    const ok = r >= 4.5;
    if (!ok) fails++;
    console.log(`  ${`${fg} on ${bg}`.padEnd(36)} ${t[fg]}/${t[bg]}  ${r.toFixed(2)}:1 ${ok ? "OK" : "✗ 미달"}`);
  }
}
console.log(`\n미달 조합: ${fails}`);
process.exit(fails ? 1 : 0);
