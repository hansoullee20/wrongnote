import crypto from "node:crypto";
import fs from "node:fs/promises";
import { MAX_ACTIVE_ITEMS, MAX_ERROR_CHARS, SESSION_LEASE_MS } from "./config.js";
import { QueueCommitError, fail } from "./errors.js";
import { snapshotPayload } from "./jsonValue.js";
import { acquireQueueLock, lockPathForQueue } from "./lockFile.js";
import path from "node:path";
import { ensureDirectoryDurable, quarantineOrphanTemps, readTextIfExists, writeStateAtomic } from "./persistence.js";
import { assertEventId, assertSessionId, emptyState, validateState } from "./state.js";

const clone = (value) => structuredClone(value);
const id = () => crypto.randomUUID();

function parseState(raw, file) {
  if (raw === null) return emptyState();
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    fail("corrupt_queue", `queue file is not valid JSON: ${file} (left untouched)`);
  }
  return validateState(parsed);
}

function requireNonemptyString(value, code, name) {
  if (typeof value !== "string" || value.trim().length === 0) fail(code, `${name} must be a non-empty string`);
  return value;
}

export async function createQueueStore({
  file,
  leaseMs = SESSION_LEASE_MS,
  now = () => Date.now(),
  fsImpl = fs,
  platform = process.platform,
} = {}) {
  if (typeof file !== "string" || file.length === 0) throw new Error("queue store requires a file path");
  if (!Number.isFinite(leaseMs) || leaseMs <= 0) throw new Error("leaseMs must be positive");

  const bootstrapDurability = await ensureDirectoryDurable(path.dirname(file), { fsImpl, platform });
  const lockPath = lockPathForQueue(file);
  const lock = await acquireQueueLock(lockPath, { fsImpl, now });
  let state;
  let quarantine = { count: 0, paths: [] };
  try {
    state = parseState(await readTextIfExists(file, { fsImpl }), file);
    validateState(state);
    quarantine = await quarantineOrphanTemps(file, { fsImpl, platform });
  } catch (err) {
    await lock.release().catch(() => {});
    throw err;
  }

  const bootstrapReasons = [...new Set([
    ...bootstrapDurability.degradedReasons,
    ...(quarantine.degradedReasons || []),
  ])];
  let durability = bootstrapReasons.length ? "degraded" : "durable";
  let degradedReasons = [...bootstrapReasons];
  let lastNow = 0;
  let chain = Promise.resolve();
  let closed = false;
  let closing = false;
  let closeFlight = null;

  const clock = () => {
    const raw = Number(now());
    if (!Number.isFinite(raw) || raw < 0) throw new Error("clock returned an invalid timestamp");
    lastNow = Math.max(lastNow, raw);
    return lastNow;
  };

  const enqueue = (fn) => {
    const run = chain.then(() => {
      if (closed || closing) fail("store_closed", "queue store is closing or closed");
      return fn();
    });
    chain = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  };

  const applyPersistedDurability = (persisted) => {
    degradedReasons = [...new Set([...bootstrapReasons, ...persisted.degradedReasons])];
    durability = degradedReasons.length ? "degraded" : persisted.durability;
  };

  const resultWithDurability = (result) => ({
    ...(result || {}),
    durability,
    degradedReasons: [...degradedReasons],
  });

  async function persist(candidate, result) {
    try {
      const persisted = await writeStateAtomic(file, candidate, { fsImpl, platform });
      state = candidate;
      applyPersistedDurability(persisted);
      return resultWithDurability(result);
    } catch (err) {
      if (err instanceof QueueCommitError || err?.committed === true) {
        state = candidate;
        durability = "uncertain";
        err.result = result;
        throw err;
      }
      throw err;
    }
  }

  async function transact(fn) {
    return enqueue(async () => {
      const candidate = clone(state);
      const tx = await fn(candidate);
      if (!tx || tx.changed !== true) {
        if (durability === "uncertain") {
          try {
            const persisted = await writeStateAtomic(file, state, { fsImpl, platform });
            applyPersistedDurability(persisted);
          } catch (err) {
            if (err instanceof QueueCommitError || err?.committed === true) {
              durability = "uncertain";
              err.result = tx?.result;
              throw err;
            }
            err.durability = "uncertain";
            err.result = tx?.result;
            throw err;
          }
        }
        return resultWithDurability(tx?.result);
      }
      validateState(candidate);
      return persist(candidate, tx.result);
    });
  }

  function auth(candidate, sessionId, fence) {
    assertSessionId(sessionId);
    if (!Number.isSafeInteger(fence) || fence <= 0) fail("invalid_fence", "fence must be a positive integer");
    const s = candidate.session;
    if (!s) return { status: "no_session" };
    if (fence !== s.fence) return { status: "stale_fence", currentFence: s.fence };
    if (sessionId !== s.sessionId) return { status: "not_owner" };
    return { status: "ok", session: s };
  }

  function renew(s, t) {
    s.renewedAt = t;
    s.expiresAt = t + leaseMs;
  }

  function terminalByReceipt(candidate, receipt) {
    const accepted = candidate.accepted.find((r) => r.receipt === receipt);
    if (accepted) return { kind: "accepted", record: accepted };
    const rejected = candidate.rejected.find((r) => r.receipt === receipt);
    if (rejected) return { kind: "rejected", record: rejected };
    return null;
  }

  return {
    async submit(eventId, payload) {
      assertEventId(eventId);
      const snap = snapshotPayload(payload);
      return transact((candidate) => {
        const active = candidate.items.find((i) => i.eventId === eventId);
        const accepted = candidate.accepted.find((r) => r.eventId === eventId);
        const rejected = candidate.rejected.find((r) => r.eventId === eventId && r.requeuedItemId === null);
        const existing = active || accepted || rejected;
        if (existing) {
          if (existing.payloadHash !== snap.hash) {
            return {
              changed: false,
              result: { status: "idempotency_conflict", eventId, existingHash: existing.payloadHash, submittedHash: snap.hash },
            };
          }
          if (active) {
            const delivered = candidate.session?.delivery?.itemId === active.id;
            return { changed: false, result: { status: "duplicate", state: delivered ? "delivered" : "waiting", eventId, itemId: active.id } };
          }
          if (accepted) return { changed: false, result: { status: "duplicate", state: "accepted", eventId, itemId: accepted.itemId } };
          return {
            changed: false,
            result: {
              status: "duplicate",
              state: "rejected",
              eventId,
              rejectionId: rejected.rejectionId,
            },
          };
        }
        if (candidate.items.length >= MAX_ACTIVE_ITEMS) {
          return { changed: false, result: { status: "queue_full", limit: MAX_ACTIVE_ITEMS } };
        }
        const item = {
          id: id(),
          eventId,
          payloadHash: snap.hash,
          payload: snap.snapshot,
          createdAt: clock(),
          retryOfRejectionId: null,
        };
        candidate.items.push(item);
        return { changed: true, result: { status: "waiting", eventId, itemId: item.id } };
      });
    },

    async acquireSession(sessionId) {
      assertSessionId(sessionId);
      return transact((candidate) => {
        const t = clock();
        if (candidate.session && t < candidate.session.expiresAt) {
          return {
            changed: false,
            result: { status: "busy", expiresAt: candidate.session.expiresAt },
          };
        }
        const fence = candidate.nextFence;
        candidate.nextFence += 1;
        candidate.session = {
          sessionId,
          fence,
          acquiredAt: t,
          renewedAt: t,
          expiresAt: t + leaseMs,
          delivery: null,
        };
        return { changed: true, result: { status: "acquired", sessionId, fence, expiresAt: t + leaseMs } };
      });
    },

    async renewSession(sessionId, fence) {
      return transact((candidate) => {
        const a = auth(candidate, sessionId, fence);
        if (a.status !== "ok") return { changed: false, result: a };
        const t = clock();
        if (t >= a.session.expiresAt) return { changed: false, result: { status: "lease_expired" } };
        renew(a.session, t);
        return { changed: true, result: { status: "renewed", expiresAt: a.session.expiresAt } };
      });
    },

    async claim(sessionId, fence) {
      return transact((candidate) => {
        const a = auth(candidate, sessionId, fence);
        if (a.status !== "ok") return { changed: false, result: a };
        const t = clock();
        if (t >= a.session.expiresAt) return { changed: false, result: { status: "lease_expired" } };

        if (a.session.delivery) {
          const item = candidate.items.find((i) => i.id === a.session.delivery.itemId);
          if (!item) fail("corrupt_queue", "current delivery points to a missing item");
          renew(a.session, t);
          return {
            changed: true,
            result: {
              status: "delivered",
              repeated: true,
              eventId: item.eventId,
              itemId: item.id,
              receipt: a.session.delivery.receipt,
              payload: clone(item.payload),
              expiresAt: a.session.expiresAt,
            },
          };
        }

        const item = candidate.items[0];
        if (!item) return { changed: false, result: { status: "empty" } };
        const receipt = id();
        a.session.delivery = { itemId: item.id, receipt, deliveredAt: t };
        renew(a.session, t);
        return {
          changed: true,
          result: {
            status: "delivered",
            repeated: false,
            eventId: item.eventId,
            itemId: item.id,
            receipt,
            payload: clone(item.payload),
            expiresAt: a.session.expiresAt,
          },
        };
      });
    },

    async settle(sessionId, fence, receipt, outcome, { error = "" } = {}) {
      assertSessionId(sessionId);
      requireNonemptyString(receipt, "invalid_receipt", "receipt");
      if (!["accepted", "rejected", "released"].includes(outcome)) {
        fail("invalid_outcome", `unknown settlement outcome: ${outcome}`);
      }
      return transact((candidate) => {
        const a = auth(candidate, sessionId, fence);
        if (a.status !== "ok") return { changed: false, result: a };

        if (!a.session.delivery) {
          const terminal = terminalByReceipt(candidate, receipt);
          return {
            changed: false,
            result: terminal
              ? { status: "already_settled", outcome: terminal.kind, eventId: terminal.record.eventId }
              : { status: "receipt_mismatch" },
          };
        }
        if (a.session.delivery.receipt !== receipt) {
          const terminal = terminalByReceipt(candidate, receipt);
          return {
            changed: false,
            result: terminal
              ? { status: "already_settled", outcome: terminal.kind, eventId: terminal.record.eventId }
              : { status: "receipt_mismatch", currentReceipt: a.session.delivery.receipt },
          };
        }

        const itemIndex = candidate.items.findIndex((i) => i.id === a.session.delivery.itemId);
        if (itemIndex === -1) return { changed: false, result: { status: "not_found" } };
        const item = candidate.items[itemIndex];
        const t = clock();

        if (outcome === "released") {
          a.session.delivery = null;
          renew(a.session, t);
          return { changed: true, result: { status: "released", eventId: item.eventId, itemId: item.id } };
        }

        candidate.items.splice(itemIndex, 1);
        a.session.delivery = null;
        renew(a.session, t);

        if (outcome === "accepted") {
          candidate.accepted.push({
            eventId: item.eventId,
            itemId: item.id,
            receipt,
            payloadHash: item.payloadHash,
            acceptedAt: t,
          });
          return { changed: true, result: { status: "accepted", eventId: item.eventId, itemId: item.id } };
        }

        const rejection = {
          rejectionId: id(),
          eventId: item.eventId,
          itemId: item.id,
          receipt,
          payloadHash: item.payloadHash,
          payload: item.payload,
          error: String(error ?? "").slice(0, MAX_ERROR_CHARS),
          rejectedAt: t,
          requeuedItemId: null,
        };
        candidate.rejected.push(rejection);
        return {
          changed: true,
          result: { status: "rejected", eventId: item.eventId, itemId: item.id, rejectionId: rejection.rejectionId },
        };
      });
    },

    async requeue(rejectionId) {
      requireNonemptyString(rejectionId, "invalid_rejection_id", "rejectionId");
      return transact((candidate) => {
        const dead = candidate.rejected.find((r) => r.rejectionId === rejectionId);
        if (!dead) return { changed: false, result: { status: "not_found" } };
        const accepted = candidate.accepted.find((r) => r.eventId === dead.eventId);
        if (accepted) return { changed: false, result: { status: "already_settled", outcome: "accepted", eventId: dead.eventId } };
        const active = candidate.items.find((i) => i.eventId === dead.eventId);
        if (active) {
          return { changed: false, result: { status: "already_requeued", eventId: dead.eventId, itemId: active.id } };
        }
        if (dead.requeuedItemId || dead.payload === null) {
          return {
            changed: false,
            result: { status: "already_requeued", eventId: dead.eventId, itemId: dead.requeuedItemId },
          };
        }
        if (candidate.items.length >= MAX_ACTIVE_ITEMS) {
          return { changed: false, result: { status: "queue_full", limit: MAX_ACTIVE_ITEMS } };
        }
        const item = {
          id: id(),
          eventId: dead.eventId,
          payloadHash: dead.payloadHash,
          payload: clone(dead.payload),
          createdAt: clock(),
          retryOfRejectionId: dead.rejectionId,
        };
        candidate.items.push(item);
        dead.requeuedItemId = item.id;
        dead.payload = null;
        return { changed: true, result: { status: "requeued", eventId: item.eventId, itemId: item.id, rejectionId } };
      });
    },

    async releaseSession(sessionId, fence) {
      return transact((candidate) => {
        const a = auth(candidate, sessionId, fence);
        if (a.status !== "ok") return { changed: false, result: a };
        const hadDelivery = Boolean(a.session.delivery);
        candidate.session = null;
        return { changed: true, result: { status: "session_released", deliveryReturned: hadDelivery } };
      });
    },

    async list() {
      return enqueue(() => clone(state.items));
    },

    async listRejected() {
      return enqueue(() => clone(state.rejected));
    },

    async listAccepted() {
      return enqueue(() => clone(state.accepted));
    },

    async health() {
      return enqueue(() => ({
        status: "ok",
        durability,
        degradedReasons: [...degradedReasons],
        quarantinedTemps: quarantine.count,
        activeItems: state.items.length,
        rejected: state.rejected.length,
        accepted: state.accepted.length,
        session: state.session
          ? {
              sessionId: state.session.sessionId,
              fence: state.session.fence,
              expiresAt: state.session.expiresAt,
              hasDelivery: Boolean(state.session.delivery),
            }
          : null,
      }));
    },

    async close() {
      if (closed) return;
      if (closeFlight) return closeFlight;
      closing = true;
      const pending = chain;
      closeFlight = (async () => {
        await pending.catch(() => {});
        await lock.release();
        closed = true;
      })().finally(() => {
        if (!closed) closing = false;
        closeFlight = null;
      });
      return closeFlight;
    },
  };
}
