Second pass on branch claude/theme-system. You already reviewed this diff once and admitted
it was thin coverage, naming three areas you had not examined. One of those three has since
been cleared. Review the remaining two. Do NOT run builds, tests, servers, or npm — read only.

ALREADY CLEARED, do not re-report:
- Token migration completeness. `--primary-soft` was removed from the generator and has zero
  consumers. All 62 `var(--x)` references across src/ resolve to one of the 66 defined tokens
  — no dangling variables.
- Generator drift: regenerating src/themes.css leaves git status clean.
- Text contrast: tools/verify-contrast.mjs passes 272 pairs across all 8 palettes at 4.5:1+.
- A pre-paint test now exists (tests/theme.spec.js, "첫 페인트 — React 없이"). It blocks
  /src/main.jsx so React never mounts, stubs Storage.prototype.getItem via addInitScript, and
  covers: palette read throwing, theme read throwing, both throwing, a corrupt "banana" theme
  value, "system", and an unknown palette id. It was mutation-tested — collapsing commit B's
  separate guard back into the outer try makes exactly two of these fail.

AREA 1 — the inline pre-paint script in index.html (the <script> in <head>).
Read index.html and src/App.jsx. Line by line, consider:
- corrupt or attacker-controlled localStorage values flowing into setAttribute
- unknown or removed palette ids
- localStorage throwing (private mode, blocked cookies, SecurityError) on each of the two
  separate reads
- the interaction between the theme read and the palette read now that commit B guards them
  separately
- whether the script can leave <html> half-set in a way the React app then disagrees with.
  The comment claims its fallback rules must match initialTheme/initialPalette in src/App.jsx
  — verify they actually do, do not take the comment's word for it.
- whether a thrown error inside it can block the rest of the document
- whether window.matchMedia can be absent or throw
- anything the new test above still fails to cover

AREA 3 — the 2 newly added palettes in src/palettes.js.
Read src/palettes.js, tools/gen-themes.mjs, tools/verify-contrast.mjs.
- Identify which 2 are new (6 existing + 2 = 8).
- Compare their key sets, for BOTH .day and .night, against all 6 pre-existing palettes.
  Report by name any key present in the old palettes but missing in the new ones.
- Text contrast is already covered — do NOT re-check it. Check what verify-contrast.mjs does
  NOT enumerate: non-text contrast (borders, dividers, focus rings), surface-against-surface
  separation, and whether pass/fail semantic colors stay distinguishable from each other and
  from --action in both day and night. Include red-green color blindness for the pass/fail pair.
- State which pairs the verifier already enumerates, so you do not double-report.

OUTPUT FORMAT — nothing else, no preamble:
[severity] file:line — problem — one-line fix
severity = blocker / high / med / low, ordered by severity.
If an area is genuinely clean, one line: 'AREA N: clean — <what you verified>'.
Do not manufacture findings.
End with exactly one line: verdict: merge | fix-then-merge | block
