import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createQueueStore } from "../src/queueStore.js";

async function tempFile(name) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), `wrongnote-durability-${name}-`));
  return path.join(dir, "ai-queue-v2.json");
}

const ANALYSIS = { version: 1, analysis: { topicMain: "수II·미분" } };

function failTargetDirSyncOnce(targetDir) {
  let failures = 1;
  let targetSyncs = 0;
  return {
    fsImpl: {
      ...fs,
      async open(p, flags, mode) {
        const h = await fs.open(p, flags, mode);
        if (String(p) !== String(targetDir) || flags !== "r") return h;
        return new Proxy(h, {
          get(target, key) {
            if (key === "sync") {
              return async () => {
                targetSyncs += 1;
                if (failures-- > 0) {
                  const e = new Error("injected EIO");
                  e.code = "EIO";
                  throw e;
                }
                return target.sync();
              };
            }
            const v = target[key];
            return typeof v === "function" ? v.bind(target) : v;
          },
        });
      },
    },
    syncCount: () => targetSyncs,
  };
}

function assertUncertaintyRepaired(value) {
  assert.notEqual(value, "uncertain");
  if (process.platform === "win32") {
    assert.ok(["durable", "degraded"].includes(value));
  } else {
    assert.equal(value, "durable");
  }
}

test("retry after committed uncertainty re-persists before reporting duplicate", async () => {
  const file = await tempFile("repair");
  const probe = failTargetDirSyncOnce(path.dirname(file));
  const store = await createQueueStore({ file, fsImpl: probe.fsImpl });

  await assert.rejects(
    () => store.submit("event-1", ANALYSIS),
    (e) => e.code === "committed_durability_uncertain"
  );
  assert.equal((await store.health()).durability, "uncertain");
  const before = probe.syncCount();

  const retry = await store.submit("event-1", ANALYSIS);
  assert.equal(retry.status, "duplicate");
  assertUncertaintyRepaired(retry.durability);
  assert.ok(probe.syncCount() > before, "duplicate retry must perform a durability repair write");
  assertUncertaintyRepaired((await store.health()).durability);
  await store.close();
});

test("ambiguous session acquisition is recoverable by the same session id without extending the lease", async () => {
  const file = await tempFile("acquire-ambiguous");
  const probe = failTargetDirSyncOnce(path.dirname(file));
  const store = await createQueueStore({ file, fsImpl: probe.fsImpl });
  let firstError;
  try {
    await store.acquireSession("tab-ambiguous");
    assert.fail("expected committed uncertainty");
  } catch (err) {
    firstError = err;
  }
  assert.equal(firstError.code, "committed_durability_uncertain");
  assert.equal(firstError.result.status, "acquired");
  const originalExpiry = firstError.result.expiresAt;

  const retry = await store.acquireSession("tab-ambiguous");
  assert.equal(retry.status, "already_acquired");
  assert.equal(retry.fence, firstError.result.fence);
  assert.equal(retry.expiresAt, originalExpiry);
  assertUncertaintyRepaired(retry.durability);
  await store.close();
});
