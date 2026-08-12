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
  assert.equal(retry.durability, "durable");
  assert.ok(probe.syncCount() > before, "duplicate retry must perform a durability repair write");
  assert.equal((await store.health()).durability, "durable");
  await store.close();
});
