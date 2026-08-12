import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createQueueStore } from "../src/queueStore.js";
import { createHttpTransport } from "../src/httpServer.js";
import { QueueCommitError } from "../src/errors.js";

const ORIGIN = "https://hansoullee20.github.io";

async function tempFile(name) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), `wrongnote-http-${name}-`));
  return path.join(dir, "ai-queue-v2.json");
}

async function start(t, store, options = {}) {
  const transport = createHttpTransport({
    store,
    allowedOrigins: [ORIGIN],
    port: 0,
    logger: { error() {} },
    ...options,
  });
  const address = await transport.listen();
  t.after(async () => {
    await transport.close();
  });
  return {
    transport,
    base: `http://127.0.0.1:${address.port}`,
  };
}

async function jsonFetch(url, { method = "GET", origin = ORIGIN, body, headers = {} } = {}) {
  const response = await fetch(url, {
    method,
    headers: {
      Origin: origin,
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...headers,
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const text = await response.text();
  return { response, body: text ? JSON.parse(text) : null };
}

test("transport binds only to IPv4 loopback and health exposes exact-origin CORS", async (t) => {
  const store = await createQueueStore({ file: await tempFile("health") });
  t.after(() => store.close());
  const { transport, base } = await start(t, store);

  assert.equal(transport.address().address, "127.0.0.1");
  const { response, body } = await jsonFetch(`${base}/v1/health`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("access-control-allow-origin"), ORIGIN);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(body.ok, true);
  assert.equal(body.transportVersion, 1);
  assert.equal(body.activeItems, 0);
});

test("a browser request from any unlisted origin is rejected before dispatch", async (t) => {
  let healthCalls = 0;
  const store = {
    async health() {
      healthCalls += 1;
      return { status: "ok" };
    },
  };
  const { base } = await start(t, store);
  const { response, body } = await jsonFetch(`${base}/v1/health`, { origin: "https://evil.example" });
  assert.equal(response.status, 403);
  assert.equal(response.headers.get("access-control-allow-origin"), null);
  assert.equal(body.error.code, "origin_forbidden");
  assert.equal(healthCalls, 0);
});

test("preflight is non-mutating and old PNA compatibility is origin-scoped", async (t) => {
  let calls = 0;
  const store = new Proxy(
    {},
    {
      get() {
        return async () => {
          calls += 1;
          return { status: "unexpected" };
        };
      },
    }
  );
  const { base } = await start(t, store);
  const response = await fetch(`${base}/v1/claim`, {
    method: "OPTIONS",
    headers: {
      Origin: ORIGIN,
      "Access-Control-Request-Method": "POST",
      "Access-Control-Request-Headers": "content-type",
      "Access-Control-Request-Private-Network": "true",
    },
  });
  assert.equal(response.status, 204);
  assert.equal(response.headers.get("access-control-allow-origin"), ORIGIN);
  assert.equal(response.headers.get("access-control-allow-private-network"), "true");
  assert.match(response.headers.get("access-control-allow-methods"), /POST/);
  assert.equal(calls, 0);

  const denied = await fetch(`${base}/v1/claim`, {
    method: "OPTIONS",
    headers: {
      Origin: "https://evil.example",
      "Access-Control-Request-Method": "POST",
      "Access-Control-Request-Private-Network": "true",
    },
  });
  assert.equal(denied.status, 403);
  assert.equal(denied.headers.get("access-control-allow-private-network"), null);
});

test("state-changing routes require JSON and exact request shapes", async (t) => {
  const store = await createQueueStore({ file: await tempFile("shape") });
  t.after(() => store.close());
  const { base } = await start(t, store);

  const simpleFormLike = await fetch(`${base}/v1/session/acquire`, {
    method: "POST",
    headers: { Origin: ORIGIN, "Content-Type": "text/plain" },
    body: JSON.stringify({ sessionId: "tab-a" }),
  });
  assert.equal(simpleFormLike.status, 415);
  assert.equal((await store.health()).session, null);

  const extra = await jsonFetch(`${base}/v1/session/acquire`, {
    method: "POST",
    body: { sessionId: "tab-a", surprise: true },
  });
  assert.equal(extra.response.status, 400);
  assert.equal(extra.body.error.code, "bad_request");
  assert.equal((await store.health()).session, null);

  const valid = await jsonFetch(`${base}/v1/session/acquire`, {
    method: "POST",
    body: { sessionId: "tab-a" },
  });
  assert.equal(valid.response.status, 200);
  assert.equal(valid.body.status, "acquired");
  assert.ok(Number.isSafeInteger(valid.body.fence));
});

test("browser lifecycle can claim and settle a directly queued analysis", async (t) => {
  const store = await createQueueStore({ file: await tempFile("lifecycle") });
  t.after(() => store.close());
  await store.submit("event-http-1", { version: 1, analysis: { topicMain: "수II·미분" } });
  const { base } = await start(t, store);

  const acquired = await jsonFetch(`${base}/v1/session/acquire`, {
    method: "POST",
    body: { sessionId: "tab-http" },
  });
  const claimed = await jsonFetch(`${base}/v1/claim`, {
    method: "POST",
    body: { sessionId: "tab-http", fence: acquired.body.fence },
  });
  assert.equal(claimed.body.status, "delivered");
  assert.equal(claimed.body.eventId, "event-http-1");
  assert.equal(claimed.body.payload.analysis.topicMain, "수II·미분");

  const settled = await jsonFetch(`${base}/v1/settle`, {
    method: "POST",
    body: {
      sessionId: "tab-http",
      fence: acquired.body.fence,
      receipt: claimed.body.receipt,
      outcome: "accepted",
    },
  });
  assert.equal(settled.body.status, "accepted");
  assert.equal((await store.list()).length, 0);
  assert.equal((await store.listAccepted())[0].eventId, "event-http-1");
});

test("transport preserves committed-durability uncertainty instead of flattening it", async (t) => {
  const store = {
    async acquireSession() {
      throw new QueueCommitError("directory fsync failed after rename", {
        result: { status: "acquired", sessionId: "tab-u", fence: 7, expiresAt: 12345 },
      });
    },
  };
  const { base } = await start(t, store);
  const { response, body } = await jsonFetch(`${base}/v1/session/acquire`, {
    method: "POST",
    body: { sessionId: "tab-u" },
  });
  assert.equal(response.status, 503);
  assert.equal(body.ok, false);
  assert.equal(body.error.code, "committed_durability_uncertain");
  assert.equal(body.error.committed, true);
  assert.equal(body.error.durability, "uncertain");
  assert.equal(body.error.result.status, "acquired");
  assert.equal(body.error.result.fence, 7);
});

test("request body limit fails before queue dispatch", async (t) => {
  let calls = 0;
  const store = {
    async acquireSession() {
      calls += 1;
      return { status: "acquired", fence: 1 };
    },
  };
  const { base } = await start(t, store, { bodyLimitBytes: 64 });
  const { response, body } = await jsonFetch(`${base}/v1/session/acquire`, {
    method: "POST",
    body: { sessionId: "x".repeat(100) },
  });
  assert.equal(response.status, 413);
  assert.equal(body.error.code, "request_too_large");
  assert.equal(calls, 0);
});

test("transport constructor refuses non-loopback binding", () => {
  assert.throws(
    () => createHttpTransport({ store: {}, allowedOrigins: [ORIGIN], host: "0.0.0.0", port: 0 }),
    /must bind to 127\.0\.0\.1/
  );
});
