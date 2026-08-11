===== v1 review — Codex (gpt-5.6-sol, high), diff-only, main...v1 =====

[high] src/aiBridge.js:27 — Unvalidated `topicMain` lets arbitrary JSON reach `MATH_TOPICS[draft.topicMain]`, where an unknown value crashes `ChipRow` — validate main/sub topics against `MATH_TOPICS` and reject invalid imports.
[high] src/views/RecordView.jsx:332 — Removed solution blobs are deleted before the note update is durably saved, so a quota failure restores references to permanently deleted images — defer deletion to serialized GC after successful persistence.
[high] src/migrate.js:5 — Version-6 boot/import paths accept newer schema versions, then rewrite them as v6 while `migrateCard` drops unknown fields — reject and lock `storedVersion` or backup versions greater than `SCHEMA_VERSION`.
[med] src/aiBridge.js:11 — Every subject receives the math taxonomy, causing non-math AI imports to acquire hidden math classifications — include the taxonomy only when `subject === "수학"`.
[med] src/aiBridge.js:32 — The requested `analysis.failurePoint` is silently discarded during import — persist it in a reviewable field or remove it from the requested schema.
[med] src/aiBridge.js:29 — Concepts are neither trimmed nor deduplicated, so one imported note can inflate or split concept statistics — normalize with trimmed unique strings before returning and migrating.
[med] src/views/RecordView.jsx:219 — Arbitrarily large AI JSON files are read and parsed synchronously without bounds, allowing a file to freeze or exhaust the tab — enforce a reasonable file-size and field-count/length limit before parsing.
[med] src/views/RecordView.jsx:467 — The new solution input and paste paths can start concurrent compression while `photo.busy`, and navigation/save can omit a still-pending image — serialize attachment processing and disable or guard every attachment, navigation, and save path until it finishes.
[low] src/views/SettingsView.jsx:204 — The language toggle exposes selected state only through CSS, unlike the adjacent accessible mode switch — add `aria-pressed` to both language buttons.
verdict: fix-then-merge
