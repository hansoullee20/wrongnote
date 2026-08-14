import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createQueueStore } from "../src/queueStore.js";
import { inspectQueueLock, lockPathForQueue, unlockDeadQueueLock } from "../src/lockFile.js";

async function tempFile(name) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), `wrongnote-v2-${name}-`));
  return path.join(dir, "ai-queue-v2.json");
}

const payload = (n = 1) => ({ version: 1, analysis: { topicMain: "수II·미분", n } });

async function acquired(store, id = "tab-a") {
  const a = await store.acquireSession(id);
  assert.equal(a.status, "acquired");
  return a;
}

test("one process owns a queue file", async () => {
  const file = await tempFile("process-lock");
  const a = await createQueueStore({ file });
  await assert.rejects(() => createQueueStore({ file }), (err) => err.code === "queue_locked");
  await a.close();
  const b = await createQueueStore({ file });
  await b.close();
});

test("one browser session owns the whole queue", async () => {
  const file = await tempFile("session");
  const store = await createQueueStore({ file });
  await store.submit("event-1", payload(1));
  await store.submit("event-2", payload(2));
  const a = await acquired(store, "tab-a");
  assert.equal((await store.acquireSession("tab-b")).status, "busy");
  const first = await store.claim("tab-a", a.fence);
  assert.equal(first.status, "delivered");
  assert.equal((await store.acquireSession("tab-b")).status, "busy");
  await store.close();
});

test("expired session takeover fences the old browser", async () => {
  let t = 1000;
  const store = await createQueueStore({ file: await tempFile("fence"), leaseMs: 100, now: () => t });
  await store.submit("event-1", payload());
  const a = await acquired(store, "tab-a");
  const d = await store.claim("tab-a", a.fence);
  t = 1200;
  const b = await store.acquireSession("tab-b");
  assert.equal(b.status, "acquired");
  assert.ok(b.fence > a.fence);
  const stale = await store.settle("tab-a", a.fence, d.receipt, "accepted");
  assert.equal(stale.status, "stale_fence");
  const d2 = await store.claim("tab-b", b.fence);
  assert.equal(d2.eventId, "event-1");
  assert.notEqual(d2.receipt, d.receipt);
  await store.close();
});

test("late settlement succeeds after expiry when no takeover occurred", async () => {
  let t = 1000;
  const store = await createQueueStore({ file: await tempFile("late"), leaseMs: 100, now: () => t });
  await store.submit("event-1", payload());
  const a = await acquired(store);
  const d = await store.claim("tab-a", a.fence);
  t = 1200;
  const settled = await store.settle("tab-a", a.fence, d.receipt, "accepted");
  assert.equal(settled.status, "accepted");
  assert.equal((await store.list()).length, 0);
  await store.close();
});

test("submit snapshots caller payload before queued async work", async () => {
  const store = await createQueueStore({ file: await tempFile("snapshot") });
  const input = payload(1);
  const p = store.submit("event-1", input);
  input.analysis.n = 999;
  await p;
  const s = await acquired(store);
  const d = await store.claim("tab-a", s.fence);
  assert.equal(d.payload.analysis.n, 1);
  await store.close();
});

test("producer id is identity; equal content may be distinct events", async () => {
  const store = await createQueueStore({ file: await tempFile("identity") });
  assert.equal((await store.submit("event-a", payload())).status, "waiting");
  assert.equal((await store.submit("event-b", payload())).status, "waiting");
  assert.equal((await store.list()).length, 2);
  const dup = await store.submit("event-a", payload());
  assert.equal(dup.status, "duplicate");
  const conflict = await store.submit("event-a", payload(2));
  assert.equal(conflict.status, "idempotency_conflict");
  await store.close();
});

test("strict JSON payloads reject null, Date, non-finite values and prototype-sensitive keys", async () => {
  const store = await createQueueStore({ file: await tempFile("payload") });
  await assert.rejects(() => store.submit("null", null), (e) => e.code === "invalid_payload");
  await assert.rejects(() => store.submit("date", { d: new Date() }), (e) => e.code === "invalid_payload");
  await assert.rejects(() => store.submit("nan", { n: NaN }), (e) => e.code === "invalid_payload");
  const unsafe = JSON.parse('{"__proto__":{"x":1}}');
  await assert.rejects(() => store.submit("proto", unsafe), (e) => e.code === "invalid_payload");
  await store.close();
});

test("accepted event identity survives restart", async () => {
  const file = await tempFile("accepted");
  let store = await createQueueStore({ file });
  await store.submit("event-1", payload());
  const s = await acquired(store);
  const d = await store.claim("tab-a", s.fence);
  assert.equal((await store.settle("tab-a", s.fence, d.receipt, "accepted")).status, "accepted");
  await store.close();
  store = await createQueueStore({ file });
  const dup = await store.submit("event-1", payload());
  assert.equal(dup.status, "duplicate");
  assert.equal(dup.state, "accepted");
  await store.close();
});

test("requeue preserves rejection evidence and compacts its historical payload", async () => {
  const store = await createQueueStore({ file: await tempFile("requeue") });
  await store.submit("event-1", payload());
  const s = await acquired(store);
  const d = await store.claim("tab-a", s.fence);
  const rejected = await store.settle("tab-a", s.fence, d.receipt, "rejected", { error: "bad taxonomy" });
  const before = await store.listRejected();
  assert.equal(before[0].error, "bad taxonomy");
  assert.deepEqual(before[0].payload, payload());
  const rq = await store.requeue(rejected.rejectionId);
  assert.equal(rq.status, "requeued");
  const after = await store.listRejected();
  assert.equal(after.length, 1);
  assert.equal(after[0].error, "bad taxonomy");
  assert.equal(after[0].payload, null);
  assert.equal(after[0].requeuedItemId, rq.itemId);
  assert.equal((await store.requeue(rejected.rejectionId)).status, "already_requeued");
  await store.close();
});

test("released delivery returns to the queue without losing the item", async () => {
  const store = await createQueueStore({ file: await tempFile("release") });
  await store.submit("event-1", payload());
  const s = await acquired(store);
  const d = await store.claim("tab-a", s.fence);
  assert.equal((await store.settle("tab-a", s.fence, d.receipt, "released")).status, "released");
  const d2 = await store.claim("tab-a", s.fence);
  assert.equal(d2.eventId, "event-1");
  assert.notEqual(d2.receipt, d.receipt);
  await store.close();
});

test("settlement distinguishes stale receipt and already-settled receipt", async () => {
  const store = await createQueueStore({ file: await tempFile("outcomes") });
  await store.submit("event-1", payload());
  const s = await acquired(store);
  const d = await store.claim("tab-a", s.fence);
  assert.equal((await store.settle("tab-a", s.fence, "wrong", "accepted")).status, "receipt_mismatch");
  assert.equal((await store.settle("tab-a", s.fence, d.receipt, "accepted")).status, "accepted");
  const again = await store.settle("tab-a", s.fence, d.receipt, "accepted");
  assert.equal(again.status, "already_settled");
  assert.equal(again.outcome, "accepted");
  await store.close();
});

test("undefined settlement credentials fail loudly", async () => {
  const store = await createQueueStore({ file: await tempFile("credentials") });
  await assert.rejects(() => store.settle(undefined, undefined, undefined, "accepted"));
  await store.close();
});

test("pre-rename write failure leaves live and durable state unchanged", async () => {
  const file = await tempFile("precommit");
  const failing = {
    ...fs,
    async rename(from, to) {
      if (to === file) {
        const e = new Error("injected rename failure");
        e.code = "EIO";
        throw e;
      }
      return fs.rename(from, to);
    },
  };
  const store = await createQueueStore({ file, fsImpl: failing });
  await assert.rejects(() => store.submit("event-1", payload()), /rename failure/);
  assert.equal((await store.list()).length, 0);
  await store.close();
  const reopened = await createQueueStore({ file });
  assert.equal((await reopened.list()).length, 0);
  await reopened.close();
});

function fsWithDirSyncFailure(targetDir, code) {
  return {
    ...fs,
    async open(p, flags, mode) {
      const h = await fs.open(p, flags, mode);
      if (String(p) !== String(targetDir) || flags !== "r") return h;
      return new Proxy(h, {
        get(target, key) {
          if (key === "sync") {
            return async () => {
              const e = new Error(`injected ${code}`);
              e.code = code;
              throw e;
            };
          }
          const v = target[key];
          return typeof v === "function" ? v.bind(target) : v;
        },
      });
    },
  };
}

test("post-rename EIO propagates committed uncertainty but keeps candidate live and on disk", async () => {
  const file = await tempFile("postcommit");
  const dir = path.dirname(file);
  const store = await createQueueStore({ file, fsImpl: fsWithDirSyncFailure(dir, "EIO") });
  await assert.rejects(() => store.submit("event-1", payload()), (e) => e.code === "committed_durability_uncertain" && e.committed === true);
  assert.equal((await store.list()).length, 1);
  await store.close();
  const reopened = await createQueueStore({ file });
  assert.equal((await reopened.list()).length, 1);
  await reopened.close();
});

test("unsupported directory fsync is explicit degraded mode", async () => {
  const file = await tempFile("degraded");
  const dir = path.dirname(file);
  const unsupportedCode = process.platform === "win32" ? "EPERM" : "EINVAL";
  const store = await createQueueStore({
    file,
    fsImpl: fsWithDirSyncFailure(dir, unsupportedCode),
    platform: process.platform,
  });
  const result = await store.submit("event-1", payload());
  assert.equal(result.durability, "degraded");
  assert.equal((await store.health()).durability, "degraded");
  await store.close();
});

test("EACCES is a real error, never degraded capability", async () => {
  const file = await tempFile("eacces");
  const dir = path.dirname(file);
  const store = await createQueueStore({ file, fsImpl: fsWithDirSyncFailure(dir, "EACCES"), platform: "win32" });
  await assert.rejects(() => store.submit("event-1", payload()), (e) => e.code === "committed_durability_uncertain");
  await store.close();
});

test("record-level corruption fails startup and leaves canonical bytes untouched", async () => {
  const file = await tempFile("corrupt-record");
  let store = await createQueueStore({ file });
  await store.submit("event-1", payload());
  await store.close();
  const state = JSON.parse(await fs.readFile(file, "utf8"));
  delete state.items[0].payload;
  const raw = JSON.stringify(state);
  await fs.writeFile(file, raw, "utf8");
  await assert.rejects(() => createQueueStore({ file }), (e) => e.code === "corrupt_queue");
  assert.equal(await fs.readFile(file, "utf8"), raw);
  assert.equal((await inspectQueueLock(lockPathForQueue(file))).exists, false);
});

test("orphan temp files are quarantined after canonical validation", async () => {
  const file = await tempFile("quarantine");
  const orphan = path.join(path.dirname(file), `.${path.basename(file)}.tmp-999-deadbeef`);
  await fs.writeFile(orphan, '{"partial":', "utf8");
  const store = await createQueueStore({ file });
  const h = await store.health();
  assert.equal(h.quarantinedTemps, 1);
  await assert.rejects(() => fs.stat(orphan), (e) => e.code === "ENOENT");
  const qdir = `${file}.quarantine`;
  assert.equal((await fs.readdir(qdir)).length, 1);
  await store.close();
});

test("clock regression does not move a live lease backwards", async () => {
  let t = 10_000;
  const store = await createQueueStore({ file: await tempFile("clock"), leaseMs: 1000, now: () => t });
  const s = await acquired(store);
  const firstExpiry = s.expiresAt;
  t = 5_000;
  const renewed = await store.renewSession("tab-a", s.fence);
  assert.equal(renewed.status, "renewed");
  assert.ok(renewed.expiresAt >= firstExpiry);
  await store.close();
});

test("manual unlock refuses a live local holder", async () => {
  const file = await tempFile("unlock");
  const store = await createQueueStore({ file });
  const lockPath = lockPathForQueue(file);
  await assert.rejects(() => unlockDeadQueueLock(lockPath), (e) => e.code === "unlock_refused");
  await store.close();
});

test("accessor payload properties are rejected instead of being read twice inconsistently", async () => {
  const store = await createQueueStore({ file: await tempFile("accessor") });
  let n = 0;
  const p = {};
  Object.defineProperty(p, "value", { enumerable: true, get: () => ++n });
  await assert.rejects(() => store.submit("event-accessor", p), (e) => e.code === "invalid_payload");
  assert.equal((await store.list()).length, 0);
  await store.close();
});

test("a compacted rejection must point to its concrete retry record", async () => {
  const file = await tempFile("retry-link");
  let store = await createQueueStore({ file });
  await store.submit("event-1", payload());
  const s = await acquired(store);
  const d = await store.claim("tab-a", s.fence);
  const rej = await store.settle("tab-a", s.fence, d.receipt, "rejected", { error: "bad" });
  await store.requeue(rej.rejectionId);
  await store.close();
  const state = JSON.parse(await fs.readFile(file, "utf8"));
  state.rejected[0].requeuedItemId = "missing-retry";
  const raw = JSON.stringify(state);
  await fs.writeFile(file, raw, "utf8");
  await assert.rejects(() => createQueueStore({ file }), (e) => e.code === "corrupt_queue");
  assert.equal(await fs.readFile(file, "utf8"), raw);
});
