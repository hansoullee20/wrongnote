# E-2 atomic state — Claude-side Tier 2 plan (2026-08-07)

Counterpart to the Codex plan required by CLAUDE.md Tier 2. **Not approved. No code
written.** Read with `.reviews/idb-invariant-duel.md` §"E-2 — Tier 2 확정".

## 0. Where the work actually stands

PR #10 (`claude/e2-atomic-state`) merged **only the control step**:

| Commit | What landed |
|---|---|
| `4303c94` | `tests/helpers.js` dual-reads `wr_state`, falls back to legacy |
| `76e4588` | `wr_state` is authoritative once present — no legacy fallback |

Production storage is unchanged. `src/storage.js:5-6` still writes `wr_notes` /
`wr_cards` through `saveNotes` / `saveCards`, and `src/App.jsx:132-151` still has
**two save effects**. The 80-test suite passing against those helpers is the
baseline this change is measured against — that was the point of landing them first.

So the orphan-card defect (`CODEX_HANDOFF_CLEANUP.md` §11) is **still open**, exactly
as described: `addNote` mutates `notes` and `cards` in one render, both effects run in
the same flush capturing the same stale `storageLocked=false`, large `notes` fails and
small `cards` succeeds.

## 1. Invariant

*Notes and cards are written by one `setItem`. There is no interleaving in which one
advances and the other does not.*

## 2. Design

Single key `wr_state` holding `{version, notes, cards}`. One `saveState`. One effect.

**Read order (`loadAll`)**

1. `wr_state` present → authoritative. Unparseable, or parses without both arrays →
   **parse error, lock**. Never fall back to legacy.
2. `wr_state` absent → read `wr_notes` / `wr_cards` / `gap_cards` as today, migrate,
   then write the envelope.

Step 1's "never fall back" is not a detail. Falling back would mask a half-written
envelope behind stale legacy data — the precise divergence E-2 exists to remove.
`tests/helpers.js:20-35` already encodes this rule; production must match it or the
helpers and the app disagree about what the store says.

**Legacy keys are never deleted.** Per the duel decision: a delete that fails is a new
failure mode on a path whose whole purpose is surviving failure. They stay frozen at
their pre-transition value and serve as the recovery copy for §3.1.

## 3. The three questions the DEBATE left open

### 3.1 First transition write fails on quota

State = absent, legacy = present, and it persists across boots. Every boot retries.

**Recommendation: the legacy→state move is not a version promotion.**
`SCHEMA_VERSION` does not change and no new `wr_backup_v{n}` snapshot is taken.

Reasons: (a) note and card *shapes* are identical on both sides — the backup key
protects against shape migration, and there is none here; (b) the snapshot would
double stored bytes at exactly the moment quota is already the failing constraint;
(c) the untouched legacy keys already *are* the pre-transition copy, so a snapshot
would be a third redundant copy.

Consequence, stated plainly: a user who cannot fit `wr_state` keeps running on the
legacy path indefinitely, without atomicity. That is not a regression — it is today's
behaviour — but it is silent. `storageLocked` covers it only once a write is
*attempted and observed* to fail, which the transition write is. So the banner does
fire. Needs a test (§5, T4).

### 3.2 Orphan cards that already exist

**Recommendation: out of scope. Detect nothing, delete nothing, in this change.**

E-2 stops new orphans. Auto-deleting existing ones is a data-loss risk on a path being
restructured in the same commit, and a diagnostic UI is a Settings feature with its own
review surface. Bundling either makes "is the storage change correct?" undecidable in
review — the §10.2 mistake again.

Han's call; if he wants detection, it belongs in a follow-up commit that touches no
storage code.

### 3.3 Test trap must become per-key

`tests/storage-failure.spec.js:122` hardcodes `BLOCKED = ["wr_notes", "wr_cards",
"wr_schema_version"]` with a single on/off flag.

⚠️ **This is the highest-risk item in the change.** If `wr_state` is not added to that
list, every quota test keeps passing while testing nothing — the app writes a key the
trap does not block, the write succeeds, and assertions like "disk is unchanged"
either fail confusingly or pass vacuously. The trap must be updated *before* the
storage change, not with it.

Parameterize: `installQuotaTrap(page, keys)` defaulting to the full set including
`wr_state`. Per-key blocking is what makes "notes fail / cards succeed" expressible —
and after E-2 that combination must be **unreachable by construction**, which is the
property T2 asserts.

## 4. File-by-file

### `src/storage.js`

- Add `const STATE_KEY = "wr_state"`.
- `loadAll`: read `wr_state` first. Present → parse envelope; `Array.isArray` on both
  arrays or `error` + empty arrays (same message shape as today's parse failure).
  Absent → existing legacy read path unchanged.
- Backup-snapshot block (`:56-71`): unchanged, still keyed off `storedVersion <
  SCHEMA_VERSION`. Per §3.1 the transition does not trigger it.
- Post-migration persist (`:107-113`): replace the three chained `safeSet` calls with
  `saveState(notes, cards)` **and** the version write. Order: state, then version —
  version promotion last, so a partial failure re-runs the idempotent migration next
  boot. That ordering rationale in the existing comment stays true and stays accurate.
- Add `export const saveState = (notes, cards) => safeSet(STATE_KEY,
  JSON.stringify({version: SCHEMA_VERSION, notes, cards}))`.
- `saveNotes` / `saveCards`: keep in commit B (unused), delete in commit C.
- `exportEnvelope` / `importEnvelope`: **unchanged.** The backup file format is a
  separate contract from the storage layout and must not drift in this commit.

### `src/App.jsx`

- Collapse `:132-147` and `:148-151` into one effect, deps `[notes, cards,
  storageLocked]`.
- `requestPersistentStorage` stays inside it, still behind
  `pendingPersistRequest.current`, still only after a successful write. Its
  "first real note landed on disk" meaning is preserved — one write now covers both
  arrays, so the condition is if anything sharper.
- No change to `deleteNote` / `replaceAll` / the `storageLocked` guards on
  `deleteImages` / `gcImages`. Those are D-gc's territory (§11.1) and mixing them in
  re-opens a Tier 2 that was deliberately scoped out.

### `src/storageHealth.js`

No change. Its three `wr_meta_*` keys plus `USER_DATA_KEY` are top-level metadata that
the envelope neither reads nor moves — the file's header comment (`:9-11`) already
commits to this and stays true.

### `tests/helpers.js`

No change. Already landed and already correct.

### `tests/storage-failure.spec.js`

Trap parameterization per §3.3, plus the new cases in §5.

### Specs that seed legacy keys directly

`tests/stats.spec.js:56`, `solve.spec.js:20`, `solution-images.spec.js:73`,
`migration.spec.js:78,116,168`, `helpers.js:seedLegacyStore`. **All unchanged** — they
seed `wr_notes`/`wr_cards`, which is now the legacy-transition path, and they read
through the dual-read helpers. They keep passing, and in doing so they become the
regression test for the transition itself. That is the payoff of landing the helpers
first; do not "modernize" them to seed `wr_state`.

## 5. Tests

Each must fail with the fix reverted (`git stash push src/` → run → `stash pop`).

| # | Case | Asserts |
|---|---|---|
| T1 | Legacy store boots, no `wr_state` | after load, `wr_state` present with both arrays; `wr_notes` still present and byte-identical |
| T2 | `wr_state` blocked, add a note | banner visible; after reload **neither** the note nor its card is present — the atomicity claim |
| T3 | `wr_state` = `{"notes":[]}` (no cards array) | parse-error lock, export disabled, legacy keys untouched, **no silent fallback to legacy** |
| T4 | `wr_state` blocked on a legacy-only store | app renders, banner fires, legacy keys byte-identical, still readable next boot |
| T5 | control — `wr_state` present *and* stale legacy present | app shows `wr_state` contents, ignores legacy |

T5 is the control that locks §2 step 1. Without it, a later "helpful" fallback can be
added and nothing catches it.

## 6. Commits

| | Content | Gate |
|---|---|---|
| **A** | Test infra only: per-key trap, `wr_state` added to `BLOCKED` | suite green **unchanged** — pure control |
| **B** | `storage.js` + `App.jsx` atomic state, with T1–T5 | each new test fails when reverted |
| **C** | Delete `saveNotes` / `saveCards` | pure deletion, no behaviour change |

A before B is not cosmetic — §3.3 is why. C separate is the standing rule: a deletion
mixed with a behaviour change cannot be judged safe in review.

## 7. Verification

`npm test` in a plain shell. Local-green is a weak signal here
(`.reviews/lessons-2026-08-06.md` §2) — CI on the PR is the real gate.

## 8. Open for Han

1. §3.1 — accept "transition is not a version promotion" (no new backup key)?
2. §3.2 — leave existing orphan cards alone, or add non-destructive detection later?
3. Review side: CLAUDE.md requires the non-planner reviews. Codex is not installed in
   this remote environment (`which codex` → nothing), so Tier 2's two-plan comparison
   and opposing-model review cannot run here as written.
