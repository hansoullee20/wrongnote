import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createQueueStore } from "../src/queueStore.js";

async function tempFile(name) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), `wrongnote-contract-${name}-`));
  return path.join(dir, "ai-queue-v2.json");
}
const PAYLOAD = { version: 1, analysis: { topicMain: "수II·미분" } };

test("rejected settlement requires a visible nonblank reason", async () => {
  const file = await tempFile("reason");
  const store = await createQueueStore({ file });
  await store.submit("event-1", PAYLOAD);
  const s = await store.acquireSession("tab");
  const d = await store.claim("tab", s.fence);
  await assert.rejects(
    () => store.settle("tab", s.fence, d.receipt, "rejected"),
    (e) => e.code === "invalid_rejection_error"
  );
  await assert.rejects(
    () => store.settle("tab", s.fence, d.receipt, "rejected", { error: "   " }),
    (e) => e.code === "invalid_rejection_error"
  );
  assert.equal((await store.list()).length, 1, "invalid rejection must not consume the item");
  await store.close();
});

test("future queue versions fail as unsupported before current-shape validation", async () => {
  const file = await tempFile("future-version");
  const future = JSON.stringify({ version: 3, newFormat: true, records: [] });
  await fs.writeFile(file, future, "utf8");
  await assert.rejects(
    () => createQueueStore({ file }),
    (e) => e.code === "unsupported_queue_version"
  );
  assert.equal(await fs.readFile(file, "utf8"), future);
});

test("clock regression across restart cannot shorten a persisted live lease", async () => {
  const file = await tempFile("clock-restart");
  let t = 10000;
  let store = await createQueueStore({ file, leaseMs: 1000, now: () => t });
  const s = await store.acquireSession("tab-clock");
  assert.equal(s.status, "acquired");
  const oldExpiry = s.expiresAt;
  await store.close();

  t = 5000;
  store = await createQueueStore({ file, leaseMs: 1000, now: () => t });
  const renewed = await store.renewSession("tab-clock", s.fence);
  assert.equal(renewed.status, "renewed");
  assert.ok(renewed.expiresAt >= oldExpiry, "restart after a backward clock jump must not shorten the lease");
  await store.close();
});

test("acquire retry for the same live session recovers its fence without renewing the lease", async () => {
  const store = await createQueueStore({ file: await tempFile("acquire-retry") });
  const first = await store.acquireSession("tab-acquire");
  assert.equal(first.status, "acquired");
  const retry = await store.acquireSession("tab-acquire");
  assert.equal(retry.status, "already_acquired");
  assert.equal(retry.fence, first.fence);
  assert.equal(retry.expiresAt, first.expiresAt);
  await store.close();
});

test("restart of an existing canonical queue fsyncs its containing directory before claiming resolved durability", async () => {
  const file = await tempFile("startup-repair");
  let store = await createQueueStore({ file });
  await store.submit("event-startup", { value: 1 });
  await store.close();

  const dir = path.dirname(file);
  let dirSyncs = 0;
  const spy = {
    ...fs,
    async open(p, flags, mode) {
      const h = await fs.open(p, flags, mode);
      if (String(p) !== String(dir) || flags !== "r") return h;
      return new Proxy(h, {
        get(target, key) {
          if (key === "sync") {
            return async () => {
              dirSyncs += 1;
              return target.sync();
            };
          }
          const value = target[key];
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
    },
  };
  store = await createQueueStore({ file, fsImpl: spy });
  assert.ok(dirSyncs >= 1, "startup must repair/confirm the canonical queue directory entry");
  const health = await store.health();
  assert.notEqual(health.durability, "uncertain");
  if (process.platform === "win32") {
    assert.ok(["durable", "degraded"].includes(health.durability));
  } else {
    assert.equal(health.durability, "durable");
  }
  await store.close();
});

test("a non-integer queue version is corruption, not an unsupported-format claim", async () => {
  const file = await tempFile("bad-version-type");
  const raw = JSON.stringify({ version: "2", nextFence: 1, session: null, items: [], accepted: [], rejected: [] });
  await fs.writeFile(file, raw, "utf8");
  await assert.rejects(() => createQueueStore({ file }), (e) => e.code === "corrupt_queue");
  assert.equal(await fs.readFile(file, "utf8"), raw);
});
