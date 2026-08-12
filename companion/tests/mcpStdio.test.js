import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport, getDefaultEnvironment } from "@modelcontextprotocol/client/stdio";
import { lockPathForQueue } from "../src/lockFile.js";
import { WRONGNOTE_SUBMIT_TOOL } from "../src/mcpServer.js";

const MCP_ENTRY = fileURLToPath(new URL("../src/mcp.js", import.meta.url));

async function tempFile(name) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), `wrongnote-mcp-stdio-${name}-`));
  return path.join(dir, "ai-queue-v2.json");
}

async function reservePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen({ host: "127.0.0.1", port: 0, exclusive: true }, resolve);
  });
  const address = server.address();
  const port = address.port;
  await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  return port;
}

async function createSpawnedClient(file, port, clientOptions) {
  const stderr = [];
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [MCP_ENTRY],
    env: {
      ...getDefaultEnvironment(),
      WRONGNOTE_QUEUE_FILE: file,
      WRONGNOTE_QUEUE_PORT: String(port),
      WRONGNOTE_ALLOWED_ORIGINS: "https://hansoullee20.github.io",
    },
    stderr: "pipe",
  });
  transport.stderr?.on("data", (chunk) => stderr.push(chunk.toString("utf8")));
  const client = new Client({ name: "wrongnote-stdio-test", version: "1.0.0" }, clientOptions);
  await client.connect(transport);
  return { client, stderr };
}

async function assertLockGone(file) {
  await assert.rejects(() => fs.stat(lockPathForQueue(file)), (err) => err.code === "ENOENT");
}

async function assertQueueAbsent(file) {
  await assert.rejects(() => fs.stat(file), (err) => err.code === "ENOENT");
}

test("spawned wrongnote-mcp lists and calls the producer tool over legacy stdio", { timeout: 20_000 }, async (t) => {
  const file = await tempFile("call");
  const port = await reservePort();
  const { client, stderr } = await createSpawnedClient(file, port);
  t.after(async () => {
    await client.close().catch(() => {});
  });

  const tools = await client.listTools();
  assert.deepEqual(tools.tools.map((tool) => tool.name), [WRONGNOTE_SUBMIT_TOOL]);
  await assertLockGone(file);
  await assertQueueAbsent(file);

  const result = await client.callTool({
    name: WRONGNOTE_SUBMIT_TOOL,
    arguments: {
      eventId: "stdio-event-1",
      payload: { version: 1, analysis: { topicMain: "수II·미분" } },
    },
  });
  assert.notEqual(result.isError, true);
  assert.equal(result.structuredContent?.status, "waiting");

  await client.close();

  const state = JSON.parse(await fs.readFile(file, "utf8"));
  assert.equal(state.items.length, 1);
  assert.equal(state.items[0].eventId, "stdio-event-1");
  assert.match(stderr.join(""), /Wrongnote MCP running on stdio/);
  await assertLockGone(file);
});

test("modern stdio auto-negotiation can probe side-effect free then start the real owner", { timeout: 30_000 }, async (t) => {
  const file = await tempFile("modern-probe");
  const port = await reservePort();
  const { client } = await createSpawnedClient(file, port, { versionNegotiation: { mode: "auto" } });
  t.after(async () => {
    await client.close().catch(() => {});
  });

  assert.equal(client.getProtocolEra(), "modern");
  const tools = await client.listTools();
  assert.deepEqual(tools.tools.map((tool) => tool.name), [WRONGNOTE_SUBMIT_TOOL]);
  await assertLockGone(file);
  await assertQueueAbsent(file);

  const result = await client.callTool({
    name: WRONGNOTE_SUBMIT_TOOL,
    arguments: {
      eventId: "modern-event-1",
      payload: { version: 1, analysis: { topicMain: "수II·미분" } },
    },
  });
  assert.equal(result.structuredContent?.status, "waiting");

  await client.close();
  const state = JSON.parse(await fs.readFile(file, "utf8"));
  assert.deepEqual(state.items.map((item) => item.eventId), ["modern-event-1"]);
  await assertLockGone(file);
});

test("MCP entrypoint and producer modules contain no console.log stdout writes", async () => {
  const files = [
    new URL("../src/mcp.js", import.meta.url),
    new URL("../src/mcpRuntime.js", import.meta.url),
    new URL("../src/mcpServer.js", import.meta.url),
  ];
  for (const url of files) {
    const source = await fs.readFile(url, "utf8");
    assert.doesNotMatch(source, /console\.log\s*\(/, `${fileURLToPath(url)} must keep stdout protocol-only`);
  }
});
