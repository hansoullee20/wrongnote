import crypto from "node:crypto";
import { MAX_PAYLOAD_BYTES } from "./config.js";
import { fail } from "./errors.js";

const FORBIDDEN_KEYS = new Set(["__proto__", "prototype", "constructor"]);

function assertJsonValue(value, path = "payload") {
  if (value === null) return;

  const t = typeof value;
  if (t === "string" || t === "boolean") return;
  if (t === "number") {
    if (!Number.isFinite(value)) fail("invalid_payload", `${path} contains a non-finite number`);
    return;
  }

  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) assertJsonValue(value[i], `${path}[${i}]`);
    return;
  }

  if (t === "object") {
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) {
      fail("invalid_payload", `${path} must contain JSON objects only`);
    }
    for (const key of Object.keys(value)) {
      if (FORBIDDEN_KEYS.has(key)) fail("invalid_payload", `${path} contains forbidden key ${key}`);
      assertJsonValue(value[key], `${path}.${key}`);
    }
    return;
  }

  fail("invalid_payload", `${path} contains unsupported type ${t}`);
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    const out = Object.create(null);
    for (const key of Object.keys(value).sort()) out[key] = canonicalize(value[key]);
    return out;
  }
  return value;
}

export function snapshotPayload(payload, maxBytes = MAX_PAYLOAD_BYTES) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    fail("invalid_payload", "payload must be a non-null JSON object");
  }
  assertJsonValue(payload);
  const serialized = JSON.stringify(payload);
  const bytes = Buffer.byteLength(serialized, "utf8");
  if (bytes > maxBytes) fail("payload_too_large", `payload exceeds ${maxBytes} bytes`, { bytes });
  const snapshot = JSON.parse(serialized);
  assertJsonValue(snapshot);
  return { snapshot, bytes, hash: payloadHash(snapshot) };
}

export function payloadHash(payload) {
  assertJsonValue(payload);
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(canonicalize(payload)))
    .digest("hex");
}

export function assertStoredPayload(payload, expectedHash, path) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    fail("corrupt_queue", `${path}.payload must be a non-null JSON object`);
  }
  assertJsonValue(payload, `${path}.payload`);
  const actual = payloadHash(payload);
  if (actual !== expectedHash) {
    fail("corrupt_queue", `${path}.payload does not match payloadHash`);
  }
}
