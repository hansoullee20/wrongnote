import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { QueueCommitError } from "../src/errors.js";
import { createWrongnoteMcpServer, submitWrongnoteAnalysis, WRONGNOTE_SUBMIT_TOOL } from "../src/mcpServer.js";
import { createQueueStore } from "../src/queueStore.js";

async function tempFile(name) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), `wrongnote-mcp-${name}-`));
  return path.join(dir, "ai-queue-v2.json");
}

const PAYLOAD = {
  version: 1,
  locale: "ko",
  question: { problem: "26 수능 미적분 30" },
  analysis: { topicMain: "수II·미분", cause: "개념 부족" },
};

async function connect(server) {
  const client = new Client({ name: "wrongnote-test-client", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  return { client, close: () => client.close() };
}

test("MCP exposes exactly the narrow producer tool", async (t) => {
  const store = { async submit() { return { status: "waiting", eventId: "event-1", itemId: "item-1", durability: "durable", degradedReasons: [] }; } };
  const server = createWrongnoteMcpServer(store, { logger: { error() {} } });
  t.after(() => server.close());
  const { client, close } = await connect(server);
  t.after(close);

  const listed = await client.listTools();
  assert.deepEqual(listed.tools.map((tool) => tool.name), [WRONGNOTE_SUBMIT_TOOL]);
  assert.match(listed.tools[0].description, /Queue one completed Wrongnote AI analysis/);
  assert.equal(listed.tools[0].annotations?.idempotentHint, true);
  assert.equal(listed.tools[0].annotations?.destructiveHint, false);
});

test("MCP tool queues an analysis into the real durable store", async (t) => {
  const store = await createQueueStore({ file: await tempFile("real-store") });
  t.after(() => store.close());
  const server = createWrongnoteMcpServer(store, { logger: { error() {} } });
  t.after(() => server.close());
  const { client, close } = await connect(server);
  t.after(close);

  const result = await client.callTool({
    name: WRONGNOTE_SUBMIT_TOOL,
    arguments: { eventId: "analysis-event-1", payload: PAYLOAD },
  });

  assert.notEqual(result.isError, true);
  assert.equal(result.structuredContent?.ok, true);
  assert.equal(result.structuredContent?.status, "waiting");
  assert.equal(result.structuredContent?.eventId, "analysis-event-1");
  const items = await store.list();
  assert.equal(items.length, 1);
  assert.equal(items[0].eventId, "analysis-event-1");
  assert.deepEqual(items[0].payload, PAYLOAD);
});

test("exact MCP retry keeps one queue event and reports duplicate", async (t) => {
  const store = await createQueueStore({ file: await tempFile("duplicate") });
  t.after(() => store.close());
  const server = createWrongnoteMcpServer(store, { logger: { error() {} } });
  t.after(() => server.close());
  const { client, close } = await connect(server);
  t.after(close);

  const args = { eventId: "analysis-event-retry", payload: PAYLOAD };
  const first = await client.callTool({ name: WRONGNOTE_SUBMIT_TOOL, arguments: args });
  const second = await client.callTool({ name: WRONGNOTE_SUBMIT_TOOL, arguments: args });
  assert.equal(first.structuredContent?.status, "waiting");
  assert.equal(second.structuredContent?.status, "duplicate");
  assert.notEqual(second.isError, true);
  assert.equal((await store.list()).length, 1);
});

test("eventId collision with different content is a visible tool error", async (t) => {
  const store = await createQueueStore({ file: await tempFile("conflict") });
  t.after(() => store.close());
  const server = createWrongnoteMcpServer(store, { logger: { error() {} } });
  t.after(() => server.close());
  const { client, close } = await connect(server);
  t.after(close);

  await client.callTool({ name: WRONGNOTE_SUBMIT_TOOL, arguments: { eventId: "same-id", payload: PAYLOAD } });
  const conflict = await client.callTool({
    name: WRONGNOTE_SUBMIT_TOOL,
    arguments: { eventId: "same-id", payload: { ...PAYLOAD, locale: "en" } },
  });
  assert.equal(conflict.isError, true);
  assert.equal(conflict.structuredContent?.ok, false);
  assert.equal(conflict.structuredContent?.status, "idempotency_conflict");
  assert.match(conflict.content[0].text, /different content/);
});

test("post-commit ambiguity tells the model to retry the exact same eventId", async () => {
  const store = {
    async submit() {
      throw new QueueCommitError("renamed but directory fsync failed", {
        result: { status: "waiting", eventId: "event-ambiguous", itemId: "item-ambiguous" },
      });
    },
  };
  const result = await submitWrongnoteAnalysis(
    store,
    { eventId: "event-ambiguous", payload: PAYLOAD },
    { logger: { error() {} } }
  );
  assert.equal(result.isError, true);
  assert.equal(result.structuredContent.code, "committed_durability_uncertain");
  assert.equal(result.structuredContent.committed, true);
  assert.equal(result.structuredContent.result.status, "waiting");
  assert.match(result.content[0].text, /exact same eventId event-ambiguous/);
  assert.match(result.content[0].text, /do not generate a new eventId/i);
});

test("invalid queue payload remains a tool-level error, not a saved event", async (t) => {
  const store = await createQueueStore({ file: await tempFile("invalid-payload") });
  t.after(() => store.close());
  const result = await submitWrongnoteAnalysis(
    store,
    { eventId: "invalid-date", payload: { created: new Date() } },
    { logger: { error() {} } }
  );
  assert.equal(result.isError, true);
  assert.equal(result.structuredContent.code, "invalid_payload");
  assert.equal((await store.list()).length, 0);
});
