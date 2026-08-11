# Amendment 01 — Codex review (reviewer: gpt-5.6-sol, high effort)

Branch `claude/amend01-assisted`, 5 commits off origin/main. Diff-only input.

[med] src/components.jsx:194 — `role="img"` flattens descendants, so per-attempt
`aria-label`s are hidden and assistive technology hears only "재풀이 궤적" —
include the ordered attempt labels in the parent's accessible name or remove the
parent image role and expose labeled child roles.

[low] tests/migration.spec.js:278 — backup checks only two substrings, so a
truncated or normalized snapshot still passes despite the plan's exact raw-data
guarantee — retain the seeded JSON strings and assert `backup.notes` and
`backup.cards` equal them byte-for-byte.

[low] tests/solve.spec.js:588 — the assisted-failure case starts with empty
history, omitting the agreed assertion that prior attempts remain
byte-equivalent — seed a sentinel attempt and deep-compare it after appending
the assisted failure.

verdict: fix-then-merge
