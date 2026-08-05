// 모든 팔레트의 명도 대비를 계산으로 검증한다 (눈대중 금지).
// 하나라도 4.5:1 미만이면 실패 코드로 끝난다 — 색을 고칠 때마다 돌린다.
//   실행: npm run contrast
import { PALETTES } from "../src/palettes.js";

const lin = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const L = (h) => { const n = parseInt(h.slice(1), 16);
  return 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255); };
const ratio = (a, b) => { const [x, y] = [L(a), L(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

/* 실제로 화면에서 겹쳐 나오는 조합만 검사한다 */
const PAIRS = [
  ["ink", "paper"], ["sec", "paper"], ["mut", "paper"],
  ["ink", "s2"], ["mut", "s2"], ["ink", "bg"], ["mut", "sunken"],
  ["on", "act"], ["paper", "fail"],
  ["fail", "paper"], ["fail", "failBg"],
  ["pass", "paper"], ["pass", "passBg"],
  ["info", "paper"], ["info", "infoBg"],
  ["warn", "hi"], ["ink", "hi"],
];

const MIN = 4.5;
let checked = 0;
const fails = [];

for (const p of PALETTES) {
  for (const mode of ["day", "night"]) {
    for (const [fg, bg] of PAIRS) {
      const c = p[mode];
      if (!c[fg] || !c[bg]) {
        fails.push(`${p.name}/${mode}: ${fg} 또는 ${bg} 미정의`);
        continue;
      }
      const r = ratio(c[fg], c[bg]);
      checked += 1;
      if (r < MIN) {
        fails.push(
          `${p.name}/${mode}  ${fg} on ${bg}  ${c[fg]}/${c[bg]}  ${r.toFixed(2)}:1 (기준 ${MIN})`
        );
      }
    }
  }
}

if (fails.length) {
  console.error(`✗ 대비 미달 ${fails.length}건 / 검사 ${checked}건\n`);
  for (const f of fails) console.error("   " + f);
  console.error("\nsrc/palettes.js에서 해당 색을 조정한 뒤 다시 실행하세요.");
  process.exit(1);
}

console.log(`✓ 대비 전부 통과 — 팔레트 ${PALETTES.length}종, 조합 ${checked}건 (전부 ${MIN}:1 이상)`);
