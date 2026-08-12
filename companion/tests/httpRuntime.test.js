import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { startCompanionHttp } from "../src/httpRuntime.js";
import { inspectQueueLock, lockPathForQueue } from "../src/lockFile.js";

async function tempFile(name) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), `wrongnote-http-runtime-${name}-`));
  return path.join(dir, "ai-queue-v2.json");
}

async function occupyLoopbackPort() {
  const server = http.createServer((_req, res) => res.end("occupied"));
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen({ host: "127.0.0.1", port: 0, exclusive: true }, resolve);
  });
  const address = server.address();
  return {
    port: address.port,
    close: () => new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve()))),
  };
}

test("EADDRINUSE during HTTP startup releases the queue process lock", async (t) => {
  const file = await tempFile("port-in-use");
  const blocker = await occupyLoopbackPort();
  t.after(() => blocker.close());

  await assert.rejects(
    () =>
      startCompanionHttp({
        env: {
          WRONGNOTE_QUEUE_FILE: file,
          WRONGNOTE_QUEUE_PORT: String(blocker.port),
          WRONGNOTE_ALLOWED_ORIGINS: "https://hansoullee20.github.io",
        },
        logger: { error() {} },
      }),
    (err) => err.code === "EADDRINUSE"
  );

  assert.equal((await inspectQueueLock(lockPathForQueue(file))).exists, false);
});

test("invalid transport configuration fails before queue ownership is acquired", async () => {
  const file = await tempFile("bad-config");
  await assert.rejects(
    () =>
      startCompanionHttp({
        env: {
          WRONGNOTE_QUEUE_FILE: file,
          WRONGNOTE_QUEUE_PORT: "not-a-port",
        },
      }),
    /WRONGNOTE_QUEUE_PORT/
  );
  assert.equal((await inspectQueueLock(lockPathForQueue(file))).exists, false);
});
