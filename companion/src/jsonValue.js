import crypto from "node:crypto";
import { MAX_PAYLOAD_BYTES } from "./config.js";
import { fail } from "./errors.js";

const FORBIDDEN_KEYS = new Set(["__proto__", "prototype", "constructor"]);
const MAX_DEPTH = 100;

function scalar(value, path) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) fail("invalid_payload", `${path} contains a non-finite number`);
    return value;
  }
  return undefined;
}

function snapshotJson(value, path, seen, depth) {
  const s = scalar(value, path);
  if (s !== undefined || value === null) return s;
  if (depth > MAX_DEPTH) fail("invalid_payload", `${path} exceeds maximum nesting depth ${MAX_DEPTH}`);
  if (!value || typeof value !== "object") {
    fail("invalid_payload", `${path} contains unsupported type ${typeof value}`);
  }
  if (seen.has(value)) fail("invalid_payload", `${path} contains a cycle`);
  seen.add(value);

  try {
    if (Array.isArray(value)) {
      const keys = Reflect.ownKeys(value);
      if (keys.some((k) => typeof k === "symbol")) fail("invalid_payload", `${path} contains symbol properties`);
      const extra = keys.filter((k) => k !== "length" && !/^(0|[1-9]\d*)$/.test(k));
      if (extra.length) fail("invalid_payload", `${path} contains non-index array properties`);
      const out = [];
      for (let i = 0; i < value.length; i += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(i));
        if (!descriptor) fail("invalid_payload", `${path} is a sparse array`);
        if (!("value" in descriptor) || descriptor.get || descriptor.set) {
          fail("invalid_payload", `${path}[${i}] uses an accessor property`);
        }
        if (!descriptor.enumerable) fail("invalid_payload", `${path}[${i}] is non-enumerable`);
        out.push(snapshotJson(descriptor.value, `${path}[${i}]`, seen, depth + 1));
      }
      return out;
    }

    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) {
      fail("invalid_payload", `${path} must contain plain JSON objects only`);
    }
    const out = Object.create(null);
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key === "symbol") fail("invalid_payload", `${path} contains symbol properties`);
      if (FORBIDDEN_KEYS.has(key)) fail("invalid_payload", `${path} contains forbidden key ${key}`);
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !("value" in descriptor) || descriptor.get || descriptor.set) {
        fail("invalid_payload", `${path}.${key} uses an accessor property`);
      }
      if (!descriptor.enumerable) fail("invalid_payload", `${path}.${key} is non-enumerable`);
      out[key] = snapshotJson(descriptor.value, `${path}.${key}`, seen, depth + 1);
    }
    return out;
  } finally {
    seen.delete(value);
  }
}

function assertStoredJson(value, path = "payload", depth = 0) {
  const s = scalar(value, path);
  if (s !== undefined || value === null) return;
  if (depth > MAX_DEPTH) fail("corrupt_queue", `${path} exceeds maximum nesting depth ${MAX_DEPTH}`);
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) assertStoredJson(value[i], `${path}[${i}]`, depth + 1);
    return;
  }
  if (!value || typeof value !== "object") fail("corrupt_queue", `${path} contains a non-JSON value`);
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) fail("corrupt_queue", `${path} is not a plain JSON object`);
  for (const key of Object.keys(value)) {
    if (FORBIDDEN_KEYS.has(key)) fail("corrupt_queue", `${path} contains forbidden key ${key}`);
    assertStoredJson(value[key], `${path}.${key}`, depth + 1);
  }
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
  const rawSnapshot = snapshotJson(payload, "payload", new WeakSet(), 0);
  const serialized = JSON.stringify(rawSnapshot);
  const bytes = Buffer.byteLength(serialized, "utf8");
  if (bytes > maxBytes) fail("payload_too_large", `payload exceeds ${maxBytes} bytes`, { bytes });
  const snapshot = JSON.parse(serialized);
  return { snapshot, bytes, hash: payloadHash(snapshot) };
}

export function payloadHash(payload) {
  assertStoredJson(payload);
  return crypto.createHash("sha256").update(JSON.stringify(canonicalize(payload))).digest("hex");
}

export function assertStoredPayload(payload, expectedHash, path) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    fail("corrupt_queue", `${path}.payload must be a non-null JSON object`);
  }
  assertStoredJson(payload, `${path}.payload`);
  const actual = payloadHash(payload);
  if (actual !== expectedHash) fail("corrupt_queue", `${path}.payload does not match payloadHash`);
}
