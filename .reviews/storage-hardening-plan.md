# Storage hardening + schema-7 release — agreed plan (Tier 1)

Planner: Codex (gpt-5.6-sol, high). Critique: Claude. Full plan in session log;
this records the decisions and the critique deltas.

## Part A — five fixes on claude/amend01-assisted, one commit each

A1 fix(storage): lock downgrades and refresh transition snapshots
   - backupKeyFor(from, to) -> `wr_backup_v${from}_to_v${to}`; overwrite on
     every upgrade (no "already exists" skip). This is what actually kills the
     6->5->7 poisoning: a stale key cannot mask a needed snapshot when the key
     names the transition.
   - Downgrade = storedVersion > SCHEMA_VERSION: normalize in memory, skip ALL
     persistence (notes, cards, marker), surface a DISTINCT writeError.
     Verified: storageLocked already gates App's save effects; export stays
     open, import locked. Never refuse boot.
   - Critique delta: the lock only binds code >= this fix; pre-fix rollbacks
     behave as today. The invariant is stated for new code only.
A2 fix(storage): validate persisted schema markers
   - Reader accepts only `^[1-9]\d*$` + safe integer; malformed -> 1
     (conservative: guarantees a snapshot attempt). NaN can no longer suppress.
A3 fix(backup): write import-compatible migration snapshots
   - Snapshot AFTER successful parse, as {version, savedAt, notes, cards} with
     arrays. Parse failure -> no snapshot (original stays, locked). Every
     written snapshot must pass importEnvelope. No restore UI (out of scope).
A4 fix(migration): preserve unknown card fields
   - `...card` spread first in migrateCard, explicit fields override. Brings
     cards up to the note/attempt preservation contract.
A5 fix(backup): reject unsupported versioned imports
   - Versionless (legacy v1) stays valid; numeric 1..SCHEMA_VERSION required
     otherwise; future/malformed rejected before any mapping, data unchanged.
   - Critique delta: initially suspected YAGNI; conceded because migrateCard
     (pre-A4 code in the wild) silently drops unknown card fields on import.

Regression tests ride in the same commit as their fix (A5 tests include the
A1/A2 matrix additions listed in the plan). Key-name assertion updates land in
commit 1; shape assertion updates land in commit 3.

## Part B — reconciliation release (needs Han's go before any push/merge)

1. Branch `release/schema-7-reconciliation` from fresh origin/main.
2. Merge `v1` (merge commit), then merge hardened `claude/amend01-assisted`.
   Only expected conflict: the SCHEMA_VERSION line/comment. Anything else ->
   abort and replan, do not improvise.
3. Bump commit: SCHEMA_VERSION = 7 `// v7: assistance + AI concept analysis`;
   v6 comments -> v7; listed test assertions 6->7; transition keys -> _to_v7.
   The 6->5->7 fixture KEEPS its historical 6s.
4. Gate: npm ci, npm test, npm run contrast, npm run themes + clean diff,
   npm run build. Then Claude reviews the release diff (Codex planned it).
5. Han's go/no-go. Push ONLY the release branch, one PR, one merge to main
   (= the only deploy; no intermediate 6 is ever a deployed build).
6. Han's device (stored 6): 6<7 -> writes wr_backup_v6_to_v7, migrates, done.
7. v2 and draft PR #12: frozen until 7 ships. v2 rebases after (drops v1
   ancestry). PR #12 reconciles as schema 8 under its own plan — it rewrites
   the same loadAll region Part A touches, so it must not land in between.

---

## Part A review + debate round 1 (closed)

Codex reviewed its own plan's implementation (Claude executed; Claude cannot
review its own execution). Verdict fix-then-merge, 3 high / 1 med / 1 low.
All five CONFIRMED with code evidence, none refuted. Fixed:

- [high] e54c0ac — snapshot overwrite could destroy the pristine copy. Root
  cause was MY over-correction in d590603: I fixed stale-key masking twice, via
  transition keys AND by dropping write-once. Transition keys alone suffice
  (v5_to_v6 != v5_to_v7), and dropping write-once meant a partial write —
  notes ok, cards fail, marker unwritten — made the next boot re-snapshot over
  the pristine copy with half-migrated data. Restored write-once; kept
  transition keys. Both properties hold.
- [high] fc56bb4 — a swallowed snapshot failure let the migration persist with
  nothing to roll back to. Load continues (data visible, export open);
  persistence is withheld so the next boot can retry.
- [high] 8aef83b — the downgrade-locked rescue export stamped the running
  version onto newer data. Now stamps the stored version.
- [med]/[low] e5953e9 — oversized numeric marker read as 1 (inverting future
  into ancient); USER_DATA_KEY imprint escaped the downgrade gate.

Debate: no disagreement survived, so no round 2. The one thing worth carrying
forward is that the [high] came from fixing a problem twice — belt-and-braces
on data paths is not free, it traded one failure mode for another.

Verification: 158 tests, contrast gate, build — all green.

## Part B status

NOT STARTED — needs Han's go. It merges and releases; nothing about it is
reversible once main deploys.
