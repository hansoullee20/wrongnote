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

## Recommendation

**Merge `v1` first, keeping 6. Rebase `claude/amend01-assisted` to 7.**

- Devices sitting at 6 from `v1` then satisfy `6 < 7` and get a proper
  `wr_backup_v6` snapshot before assistance fields are written.
- The reverse order is worse: landing amend01 first as 6 silently skips the
  backup for those devices, and landing it first as 7 would make `v1` at 6 a
  downgrade, forcing it to 8 anyway.

The ordering is not arbitrary — it is chosen so the snapshot gate fires for the
devices that already moved.

## Work required once the order is decided (~30 min)

On `claude/amend01-assisted`:
1. `SCHEMA_VERSION = 7`, comment `// v7: attempt-level assistance`.
2. `tests/migration.spec.js` — the v5→v6 describe becomes v5→v7; the backup-key
   assertion stays `wr_backup_v5` (the stored version is still 5 in that seed).
   Add a case seeding stored version **6** and asserting `wr_backup_v6` is
   written — this is the case the collision actually creates, and nothing tests
   it today.
3. `tests/backup.spec.js` — export envelope `6` → `7`.
4. `tests/review.spec.js` — the v4-seed migration assertion `"6"` → `"7"`.
5. Re-run the suite; no source change beyond the constant.

Not started: this encodes a merge-order decision, which is Han's.
