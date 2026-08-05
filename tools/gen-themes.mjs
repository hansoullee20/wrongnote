// src/palettes.js → src/themes.css 생성.
// 팔레트 × (주간|야간) 조합마다 색 토큰 블록을 찍어낸다.
// 손으로 12개 블록을 쓰면 반드시 어긋나므로 생성으로 관리한다.
//   실행: npm run themes
import { writeFileSync } from "fs";
import { PALETTES, DEFAULT_PALETTE } from "../src/palettes.js";

/** 팔레트 한 벌 → 색 토큰 선언문 */
function tokens(c, scheme) {
  return `  color-scheme: ${scheme};

  --bg: ${c.bg};
  --paper: ${c.paper};
  --surface: ${c.paper};
  --surface-2: ${c.s2};
  --sunken: ${c.sunken};
  --border: ${c.bd};
  --border-strong: ${c.bds};
  --rule: ${c.bd};

  --text: ${c.ink};
  --text-secondary: ${c.sec};
  --text-muted: ${c.mut};
  --text-on-accent: ${c.paper};

  --red-pen: ${c.fail};
  --red-pen-soft: ${c.failBg};
  --blue-pen: ${c.info};
  --blue-pen-soft: ${c.infoBg};
  --pencil: ${c.mut};
  --highlight: ${c.hi};
  --highlight-strong: ${c.hiStrong};

  --action: ${c.act};
  --action-hover: ${c.actHover};
  --on-action: ${c.on};

  --primary: var(--red-pen);
  --primary-hover: ${c.fail};
  --primary-soft: var(--red-pen-soft);
  --success: ${c.pass};
  --success-soft: ${c.passBg};
  --error: var(--red-pen);
  --error-soft: var(--red-pen-soft);
  --warning: ${c.warn};
  --warning-soft: var(--highlight);
  --info: var(--blue-pen);
  --info-soft: var(--blue-pen-soft);`;
}

const shadows = (dark) =>
  dark
    ? `
  --sh-sm: 0 1px 2px rgba(0, 0, 0, 0.4);
  --sh-md: 0 1px 2px rgba(0, 0, 0, 0.4), 0 4px 14px rgba(0, 0, 0, 0.35);
  --sh-lg: 0 2px 4px rgba(0, 0, 0, 0.45), 0 12px 32px rgba(0, 0, 0, 0.5);`
    : `
  --sh-sm: 0 1px 2px rgba(40, 32, 26, 0.06);
  --sh-md: 0 1px 2px rgba(40, 32, 26, 0.06), 0 4px 14px rgba(40, 32, 26, 0.07);
  --sh-lg: 0 2px 4px rgba(40, 32, 26, 0.07), 0 12px 32px rgba(40, 32, 26, 0.12);`;

const def = PALETTES.find((p) => p.id === DEFAULT_PALETTE);

const blocks = [];

// JS가 data-palette를 붙이기 전 한 프레임 동안 쓰일 기본값
blocks.push(`/* 기본값 — App이 data-palette를 붙이기 전에도 화면이 깨지지 않게 */
:root {
${tokens(def.day, "light")}
${shadows(false)}
}`);

for (const p of PALETTES) {
  blocks.push(`/* ${p.name} — ${p.desc} · 주간 */
:root[data-palette="${p.id}"] {
${tokens(p.day, "light")}
${shadows(false)}
}`);
  blocks.push(`/* ${p.name} — ${p.desc} · 야간 */
:root[data-palette="${p.id}"][data-theme="dark"] {
${tokens(p.night, "dark")}
${shadows(true)}
}`);
}

const out = `/* ⚠️ 자동 생성 파일 — 직접 고치지 말 것.
   색은 src/palettes.js에서 고치고 \`npm run themes\`를 실행한다.
   생성: tools/gen-themes.mjs · 검증: tools/verify-contrast.mjs */

${blocks.join("\n\n")}
`;

writeFileSync(new URL("../src/themes.css", import.meta.url), out);
console.log(`✓ src/themes.css 생성 — 팔레트 ${PALETTES.length}종 × 주간/야간`);
