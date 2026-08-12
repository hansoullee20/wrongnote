import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createQueueStore } from "../src/queueStore.js";

async function tempFile(name) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), `wrongnote-graph-${name}-`));
  return path.join(dir, "ai-queue-v2.json");
}
const PAYLOAD = { version: 1, analysis: { topicMain: "수II·미분" } };

async function twoRejectionChain(file) {
  const store = await createQueueStore({ file });
  await store.submit("event-1", PAYLOAD);
  const session = await store.acquireSession("tab");
  let d = await store.claim("tab", session.fence);
  const r1 = await store.settle("tab", session.fence, d.receipt, "rejected", { error: "one" });
  await store.requeue(r1.rejectionId);
  d = await store.claim("tab", session.fence);
  await store.settle("tab", session.fence, d.receipt, "rejected", { error: "two" });
  await store.close();
  return JSON.parse(await fs.readFile(file, "utf8"));
}

test("rejection-history cycle is corrupt rather than permanently unresubmittable", async () => {
  const file = await tempFile("cycle");
  const state = await twoRejectionChain(file);
  const [first, second] = state.rejected;
  second.payload = null;
  second.requeuedItemId = first.itemId;
  await fs.writeFile(file, JSON.stringify(state), "utf8");
  await assert.rejects(() => createQueueStore({ file }), (e) => e.code === "corrupt_queue");
});

test("one event cannot have two disconnected unresolved rejection heads", async () => {
  const file = await tempFile("fork");
  const state = await twoRejectionChain(file);
  const last = state.rejected.at(-1);
  state.rejected.push({
    ...structuredClone(last),
    rejectionId: "fork-rejection",
    itemId: "fork-item",
    receipt: "fork-receipt",
    rejectedAt: last.rejectedAt + 1,
  });
  await fs.writeFile(file, JSON.stringify(state), "utf8");
  await assert.rejects(() => createQueueStore({ file }), (e) => e.code === "corrupt_queue");
});

test("submit finds the unresolved rejection head from linkage, not array order", async () => {
  const file = await tempFile("reorder");
  const state = await twoRejectionChain(file);
  state.rejected.reverse();
  await fs.writeFile(file, JSON.stringify(state), "utf8");
  const store = await createQueueStore({ file });
  const duplicate = await store.submit("event-1", PAYLOAD);
  assert.equal(duplicate.status, "duplicate");
  assert.equal(duplicate.state, "rejected");
  await store.close();
});
