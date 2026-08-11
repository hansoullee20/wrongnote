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
