import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { createQueueStore } from "../src/queueStore.js";

const execFileAsync = promisify(execFile);
const CLI = fileURLToPath(new URL("../src/cli.js", import.meta.url));

async function tempFile(name) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), `wrongnote-cli-${name}-`));
  return path.join(dir, "ai-queue-v2.json");
}

async function runCli(...args) {
  const { stdout, stderr } = await execFileAsync(process.execPath, [CLI, ...args], {
    windowsHide: true,
    maxBuffer: 1024 * 1024,
  });
  return { stdout, stderr, json: stdout.trim() ? JSON.parse(stdout) : null };
}

test("rejected + requeue CLI preserves evidence and revives exactly one active item", async () => {
  const file = await tempFile("requeue");
  let store = await createQueueStore({ file });
  await store.submit("event-dead", { version: 1, analysis: { topicMain: "수II·미분" } });
  const session = await store.acquireSession("tab");
  const delivery = await store.claim("tab", session.fence);
  const rejected = await store.settle("tab", session.fence, delivery.receipt, "rejected", {
    error: "browser parseAiImport rejected payload",
  });
  await store.close();

  const listed = await runCli("rejected", file);
  assert.equal(listed.json.rejected.length, 1);
  assert.equal(listed.json.rejected[0].rejectionId, rejected.rejectionId);
  assert.equal(listed.json.rejected[0].eventId, "event-dead");
  assert.equal(listed.json.rejected[0].payloadRetained, true);
  assert.equal(listed.json.rejected[0].error, "browser parseAiImport rejected payload");
  assert.doesNotMatch(listed.stdout, /topicMain/, "summary command must not dump the retained AI payload");

  const requeued = await runCli("requeue", rejected.rejectionId, file);
  assert.equal(requeued.json.status, "requeued");
  assert.equal(requeued.json.eventId, "event-dead");

  store = await createQueueStore({ file });
  const active = await store.list();
  const history = await store.listRejected();
  assert.deepEqual(active.map((item) => item.eventId), ["event-dead"]);
  assert.equal(history.length, 1);
  assert.equal(history[0].error, "browser parseAiImport rejected payload");
  assert.equal(history[0].payload, null);
  assert.equal(history[0].requeuedItemId, active[0].id);
  await store.close();

  const again = await runCli("requeue", rejected.rejectionId, file);
  assert.equal(again.json.status, "already_requeued");
  store = await createQueueStore({ file });
  assert.equal((await store.list()).length, 1);
  await store.close();
});

test("dead-letter CLI fails closed while another companion owns the queue", async () => {
  const file = await tempFile("owned");
  const store = await createQueueStore({ file });
  try {
    await assert.rejects(
      () => runCli("rejected", file),
      (err) => {
        assert.equal(err.code, 1);
        const body = JSON.parse(String(err.stderr));
        assert.equal(body.error, "queue_locked");
        assert.match(body.guidance, /Stop any active wrongnote-mcp\/wrongnote-companion owner/);
        return true;
      }
    );
  } finally {
    await store.close();
  }
});
