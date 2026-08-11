# R5 — SCHEMA_VERSION 6 claimed by two branches

`claude/amend01-assisted` and `v1` both declare `SCHEMA_VERSION = 6` with
different meanings:

| branch | 6 means | touches |
|---|---|---|
| `claude/amend01-assisted` | attempt-level assistance | `migrateAttempt` |
| `v1` | personal AI-imported concept analysis | `migrateNote` |

## What is NOT at risk

The two branches edit **different functions**. The only textual conflict in
`src/migrate.js` is the `SCHEMA_VERSION` line itself. There is no migration
ordering hazard, because this codebase does not do stepwise migration:
`loadAll` calls `migrateNote`/`migrateCard` on **every** note on **every** load,
unconditionally, and each normalizer adds all of its fields regardless of the
stored version. Both sets of fields will land correctly no matter what the
number says.

So the merge is mechanically small: one constant, one comment, and the test
assertions that pin the number (`migration.spec.js`, `backup.spec.js`,
`review.spec.js`, and on `v1` also `photos.spec.js`).

## What IS at risk — the reason this is not just a number

`storedVersion` is used for exactly one thing (`storage.js:57-71`): deciding
whether to take a raw pre-upgrade backup snapshot, gated on
`storedVersion < SCHEMA_VERSION`.

A device that has already stored version **6** — i.e. anything that ran the `v1`
branch, **which includes Han's own device**, since `v1` was the checked-out
branch — will load a merged build that also declares 6, evaluate
`6 < 6 === false`, and **take no backup** before the new fields are written.

The data still migrates correctly. What is lost is the pre-upgrade safety net,
for precisely the users who ran the branch and are therefore most likely to have
real data in an intermediate state. That is the wrong population to skip a
backup for.

## Recommendation (corrected — see "Superseded" below)

**Merge `v1`, then amend01, and hold deployment until both are combined. Release
once, as schema 7. Never ship a build declaring 6.**

Then every existing device is at 5 (or lower), satisfies `5 < 7`, and takes a
normal snapshot. No device is ever left at an ambiguous 6, so the equal-version
suppression cannot fire at all. Han's own device, already at 6 from running the
`v1` branch, satisfies `6 < 7` and snapshots cleanly.

The controlling variable is **deployment, not merge order**. Merging does not
pin a number — the `SCHEMA_VERSION` conflict is resolved at merge time to
whatever we choose. What creates a stranded population is *shipping* a build
that declares 6.

### Superseded: my original recommendation, and why it was wrong

I first argued "merge `v1` first keeping 6, rebase amend01 to 7", on the grounds
that devices at 6 would then get a `wr_backup_v6` snapshot. Codex refuted it on
two counts, both correct:

1. **It conflated merging with deploying.** Landing amend01 as 7 does not
   inherently downgrade `v1` data; only *deploying* the untouched `v1` branch
   afterwards would. Merge order alone just selects *which* v6 population
   crosses a schema boundary without a snapshot — it does not remove the
   problem. Not creating a v6 population at all does.
2. **It optimised for a safety net that cannot be used.** `wr_backup_v*` keys
   are only ever written (`storage.js:57,64`) and are read by nothing in `src/`.
   Recovering one requires DevTools. Worse, the snapshot stores raw JSON
   *strings* while `importEnvelope` requires arrays, so it is not even
   import-compatible. I was choosing a merge order to preserve a backup no user
   can restore.

## Related defects found while attacking this (pre-existing, not from either branch)

- **[high]** `storage.js:111` — a 6→5 load (device on `v1`, then a build from
  `main`) preserves all fields via spreads but rewrites the marker to 5. Coming
  back to newer code then finds a stale `wr_backup_v5` already present and skips
  a fresh snapshot. Fix: reject/lock downgrades, and key snapshots by transition
  (`wr_backup_v5_to_v7`) rather than by source version alone.
- **[med]** `storage.js:51` — `Number(getItem(VERSION_KEY) || 1)` yields `NaN`
  for a malformed value; `NaN < SCHEMA_VERSION` is false, so the snapshot is
  silently suppressed. Validate that the stored version is a finite supported
  integer.
- **[med]** `storage.js:66` — snapshots are not import-compatible (raw strings
  vs the arrays `importEnvelope` expects) and have no in-app restore path.
- **[med]** `storage.js:138` — import ignores `parsed.version`. Cross-branch
  import is lossless *today* only because `migrateNote`/`migrateAttempt` spread
  unknown fields — but `migrateCard` **reconstructs** cards field-by-field
  (`migrate.js:12`) and would silently drop unknown card fields. The export
  envelope's version is decorative: asserted in tests, read by nothing.
- **[med]** `tests/migration.spec.js` — no coverage for equal-version
  cross-branch loading, 6→5→7, or a stale `wr_backup_v5`.

## Work required once the order is decided (~30 min)

On the combined branch (v1 merged in, then amend01):
1. `SCHEMA_VERSION = 7`, comment `// v7: assistance + AI concept analysis`.
2. `tests/migration.spec.js` — the v5→v6 describe becomes v5→v7; the backup-key
   assertion stays `wr_backup_v5` (the stored version is still 5 in that seed).
   Add a case seeding stored version **6** and asserting `wr_backup_v6` is
   written — this is the case the collision actually creates, and nothing tests
   it today.
3. `tests/backup.spec.js` — export envelope `6` → `7`.
4. `tests/review.spec.js` — the v4-seed migration assertion `"6"` → `"7"`.
5. Re-run the suite; no source change beyond the constant.

Not started: this encodes a release decision, which is Han's.

Deployment note: `main` deploys to GitHub Pages, so merging to `main` IS
shipping. The "hold deployment" instruction therefore means: do not merge
either branch to `main` alone — combine them on an integration branch and merge
that once.
