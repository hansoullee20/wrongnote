import { QUEUE_FORMAT_VERSION, MAX_ACTIVE_ITEMS, MAX_EVENT_ID_BYTES } from "./config.js";
import { assertStoredPayload } from "./jsonValue.js";
import { fail } from "./errors.js";

const HASH_RE = /^[0-9a-f]{64}$/;

export const emptyState = () => ({
  version: QUEUE_FORMAT_VERSION,
  nextFence: 1,
  session: null,
  items: [],
  accepted: [],
  rejected: [],
});

function object(value, path) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("corrupt_queue", `${path} must be an object`);
  }
}

function exactKeys(value, keys, path) {
  object(value, path);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((k, i) => k !== expected[i])) {
    fail("corrupt_queue", `${path} has unexpected or missing fields`);
  }
}

function string(value, path, { nonempty = true } = {}) {
  if (typeof value !== "string" || (nonempty && value.length === 0)) {
    fail("corrupt_queue", `${path} must be ${nonempty ? "a non-empty" : "a"} string`);
  }
}

function time(value, path) {
  if (!Number.isFinite(value) || value < 0) fail("corrupt_queue", `${path} must be a finite timestamp`);
}

function positiveInt(value, path) {
  if (!Number.isSafeInteger(value) || value <= 0) fail("corrupt_queue", `${path} must be a positive integer`);
}

function hash(value, path) {
  if (typeof value !== "string" || !HASH_RE.test(value)) fail("corrupt_queue", `${path} must be a sha256 hex hash`);
}

export function assertEventId(eventId, code = "invalid_event_id") {
  if (typeof eventId !== "string" || eventId.trim().length === 0) {
    fail(code, "eventId must be a non-empty string");
  }
  const bytes = Buffer.byteLength(eventId, "utf8");
  if (bytes > MAX_EVENT_ID_BYTES) fail(code, `eventId exceeds ${MAX_EVENT_ID_BYTES} bytes`, { bytes });
  return eventId;
}

export function assertSessionId(sessionId, code = "invalid_session") {
  if (typeof sessionId !== "string" || sessionId.trim().length === 0) {
    fail(code, "sessionId must be a non-empty string");
  }
  if (Buffer.byteLength(sessionId, "utf8") > 512) fail(code, "sessionId is too long");
  return sessionId;
}

function validateItem(item, i) {
  const p = `items[${i}]`;
  exactKeys(item, ["id", "eventId", "payloadHash", "payload", "createdAt", "retryOfRejectionId"], p);
  string(item.id, `${p}.id`);
  assertEventId(item.eventId, "corrupt_queue");
  hash(item.payloadHash, `${p}.payloadHash`);
  assertStoredPayload(item.payload, item.payloadHash, p);
  time(item.createdAt, `${p}.createdAt`);
  if (item.retryOfRejectionId !== null) string(item.retryOfRejectionId, `${p}.retryOfRejectionId`);
}

function validateAccepted(rec, i) {
  const p = `accepted[${i}]`;
  exactKeys(rec, ["eventId", "itemId", "receipt", "payloadHash", "acceptedAt"], p);
  assertEventId(rec.eventId, "corrupt_queue");
  string(rec.itemId, `${p}.itemId`);
  string(rec.receipt, `${p}.receipt`);
  hash(rec.payloadHash, `${p}.payloadHash`);
  time(rec.acceptedAt, `${p}.acceptedAt`);
}

function validateRejected(rec, i) {
  const p = `rejected[${i}]`;
  exactKeys(
    rec,
    ["rejectionId", "eventId", "itemId", "receipt", "payloadHash", "payload", "error", "rejectedAt", "requeuedItemId"],
    p
  );
  string(rec.rejectionId, `${p}.rejectionId`);
  assertEventId(rec.eventId, "corrupt_queue");
  string(rec.itemId, `${p}.itemId`);
  string(rec.receipt, `${p}.receipt`);
  hash(rec.payloadHash, `${p}.payloadHash`);
  string(rec.error, `${p}.error`, { nonempty: false });
  time(rec.rejectedAt, `${p}.rejectedAt`);
  if (rec.requeuedItemId !== null) string(rec.requeuedItemId, `${p}.requeuedItemId`);
  if (rec.requeuedItemId === null) {
    if (rec.payload === null) fail("corrupt_queue", `${p} has no payload but was never requeued`);
    assertStoredPayload(rec.payload, rec.payloadHash, p);
  } else {
    if (rec.payload !== null) fail("corrupt_queue", `${p} retained a full payload after requeue compaction`);
  }
}

function validateSession(session, nextFence, activeIds) {
  if (session === null) return;
  exactKeys(session, ["sessionId", "fence", "acquiredAt", "renewedAt", "expiresAt", "delivery"], "session");
  assertSessionId(session.sessionId, "corrupt_queue");
  positiveInt(session.fence, "session.fence");
  if (session.fence >= nextFence) fail("corrupt_queue", "session.fence must be lower than nextFence");
  time(session.acquiredAt, "session.acquiredAt");
  time(session.renewedAt, "session.renewedAt");
  time(session.expiresAt, "session.expiresAt");
  if (session.renewedAt < session.acquiredAt) fail("corrupt_queue", "session.renewedAt precedes acquiredAt");
  if (session.expiresAt < session.renewedAt) fail("corrupt_queue", "session.expiresAt precedes renewedAt");
  if (session.delivery === null) return;
  exactKeys(session.delivery, ["itemId", "receipt", "deliveredAt"], "session.delivery");
  string(session.delivery.itemId, "session.delivery.itemId");
  string(session.delivery.receipt, "session.delivery.receipt");
  time(session.delivery.deliveredAt, "session.delivery.deliveredAt");
  if (!activeIds.has(session.delivery.itemId)) {
    fail("corrupt_queue", "session.delivery points to a missing active item");
  }
}

export function validateState(state) {
  exactKeys(state, ["version", "nextFence", "session", "items", "accepted", "rejected"], "queue");
  if (state.version !== QUEUE_FORMAT_VERSION) {
    fail("unsupported_queue_version", `queue version ${state.version} is not supported`);
  }
  positiveInt(state.nextFence, "nextFence");
  if (!Array.isArray(state.items) || !Array.isArray(state.accepted) || !Array.isArray(state.rejected)) {
    fail("corrupt_queue", "items, accepted and rejected must all be arrays");
  }
  if (state.items.length > MAX_ACTIVE_ITEMS) fail("corrupt_queue", "active queue exceeds configured maximum");

  state.items.forEach(validateItem);
  state.accepted.forEach(validateAccepted);
  state.rejected.forEach(validateRejected);

  const activeIds = new Set();
  const allItemIds = new Set();
  const receipts = new Set();
  const rejectionIds = new Set();
  const hashByEvent = new Map();
  const activeEvents = new Set();
  const acceptedEvents = new Set();

  const seeItemId = (id, path) => {
    if (allItemIds.has(id)) fail("corrupt_queue", `duplicate itemId ${id} at ${path}`);
    allItemIds.add(id);
  };
  const seeReceipt = (receipt, path) => {
    if (receipts.has(receipt)) fail("corrupt_queue", `duplicate receipt ${receipt} at ${path}`);
    receipts.add(receipt);
  };
  const seeEventHash = (eventId, payloadHash, path) => {
    const prior = hashByEvent.get(eventId);
    if (prior && prior !== payloadHash) fail("corrupt_queue", `eventId ${eventId} has inconsistent payload hashes at ${path}`);
    hashByEvent.set(eventId, payloadHash);
  };

  state.items.forEach((item, i) => {
    seeItemId(item.id, `items[${i}]`);
    if (activeEvents.has(item.eventId)) fail("corrupt_queue", `duplicate active eventId ${item.eventId}`);
    activeEvents.add(item.eventId);
    activeIds.add(item.id);
    seeEventHash(item.eventId, item.payloadHash, `items[${i}]`);
  });

  state.accepted.forEach((rec, i) => {
    seeItemId(rec.itemId, `accepted[${i}]`);
    seeReceipt(rec.receipt, `accepted[${i}]`);
    if (acceptedEvents.has(rec.eventId)) fail("corrupt_queue", `duplicate accepted eventId ${rec.eventId}`);
    if (activeEvents.has(rec.eventId)) fail("corrupt_queue", `eventId ${rec.eventId} is both active and accepted`);
    acceptedEvents.add(rec.eventId);
    seeEventHash(rec.eventId, rec.payloadHash, `accepted[${i}]`);
  });

  state.rejected.forEach((rec, i) => {
    seeItemId(rec.itemId, `rejected[${i}]`);
    seeReceipt(rec.receipt, `rejected[${i}]`);
    if (rejectionIds.has(rec.rejectionId)) fail("corrupt_queue", `duplicate rejectionId ${rec.rejectionId}`);
    rejectionIds.add(rec.rejectionId);
    seeEventHash(rec.eventId, rec.payloadHash, `rejected[${i}]`);
  });

  validateSession(state.session, state.nextFence, activeIds);
  if (state.session?.delivery) seeReceipt(state.session.delivery.receipt, "session.delivery");

  /* Requeue history is a per-event linear chain, not just a bag of records.
     A compacted rejection must lead to exactly one concrete successor; two
     histories cannot fork into the same item, form a cycle, or leave two
     unresolved heads. Otherwise an event can validate yet become unreachable
     and impossible to requeue/resubmit. */
  const nodeByItemId = new Map();
  const rejectionById = new Map();
  const incomingByItemId = new Map();
  const outgoingByItemId = new Map();
  const nodesByEvent = new Map();

  const addNode = (itemId, kind, record) => {
    const node = { itemId, kind, record, eventId: record.eventId, payloadHash: record.payloadHash };
    nodeByItemId.set(itemId, node);
    const group = nodesByEvent.get(record.eventId) || [];
    group.push(node);
    nodesByEvent.set(record.eventId, group);
  };

  for (const item of state.items) addNode(item.id, "active", item);
  for (const rec of state.accepted) addNode(rec.itemId, "accepted", rec);
  for (const rec of state.rejected) {
    addNode(rec.itemId, "rejected", rec);
    rejectionById.set(rec.rejectionId, rec);
  }

  for (const rec of state.rejected) {
    if (!rec.requeuedItemId) continue;
    const target = nodeByItemId.get(rec.requeuedItemId);
    if (!target || target.eventId !== rec.eventId || target.payloadHash !== rec.payloadHash) {
      fail("corrupt_queue", `rejection ${rec.rejectionId} points to a missing or mismatched retry`);
    }
    if (incomingByItemId.has(target.itemId)) {
      fail("corrupt_queue", `multiple rejection records point to retry item ${target.itemId}`);
    }
    incomingByItemId.set(target.itemId, rec);
    outgoingByItemId.set(rec.itemId, target.itemId);
  }

  for (const item of state.items) {
    const incoming = incomingByItemId.get(item.id);
    if (item.retryOfRejectionId === null) {
      if (incoming) {
        fail("corrupt_queue", `active retry ${item.id} is linked from rejection ${incoming.rejectionId} but has no backlink`);
      }
      continue;
    }
    const dead = rejectionById.get(item.retryOfRejectionId);
    if (!dead || dead.eventId !== item.eventId || dead.payloadHash !== item.payloadHash) {
      fail("corrupt_queue", `active retry ${item.id} does not match its rejection history`);
    }
    if (dead.requeuedItemId !== item.id || incoming?.rejectionId !== dead.rejectionId) {
      fail("corrupt_queue", `active retry ${item.id} and rejection ${dead.rejectionId} are not bidirectionally linked`);
    }
  }

  for (const [eventId, nodes] of nodesByEvent) {
    const roots = nodes.filter((node) => !incomingByItemId.has(node.itemId));
    const sinks = nodes.filter((node) => !outgoingByItemId.has(node.itemId));
    if (roots.length !== 1 || sinks.length !== 1) {
      fail("corrupt_queue", `eventId ${eventId} does not form one linear lifecycle chain`);
    }

    const seen = new Set();
    let cursor = roots[0].itemId;
    while (cursor) {
      if (seen.has(cursor)) fail("corrupt_queue", `eventId ${eventId} contains a rejection-history cycle`);
      seen.add(cursor);
      cursor = outgoingByItemId.get(cursor) || null;
    }
    if (seen.size !== nodes.length) {
      fail("corrupt_queue", `eventId ${eventId} contains disconnected lifecycle history`);
    }
  }

  return state;
}
