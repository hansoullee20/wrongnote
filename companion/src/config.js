import os from "node:os";
import path from "node:path";

export const BIND_ADDRESS = "127.0.0.1";
export const DEFAULT_PORT = 43119;
export const HTTP_TRANSPORT_VERSION = 1;
export const HTTP_BODY_LIMIT_BYTES = 32 * 1024;
export const DEFAULT_ALLOWED_ORIGINS = Object.freeze([
  "https://hansoullee20.github.io",
]);

export const QUEUE_FORMAT_VERSION = 2;
export const SESSION_LEASE_MS = 60_000;
export const MAX_ACTIVE_ITEMS = 100;
export const MAX_PAYLOAD_BYTES = 256 * 1024;
export const MAX_EVENT_ID_BYTES = 512;
export const MAX_ERROR_CHARS = 2000;

export const queueFilePath = (env = process.env) =>
  env.WRONGNOTE_QUEUE_FILE ||
  path.join(os.homedir(), ".wrongnote", "ai-queue-v2.json");

export const queuePort = (env = process.env) => {
  const raw = env.WRONGNOTE_QUEUE_PORT;
  if (raw === undefined || raw === "") return DEFAULT_PORT;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1 || value > 65535) {
    throw new Error("WRONGNOTE_QUEUE_PORT must be an integer from 1 to 65535");
  }
  return value;
};

function normalizeOrigin(value) {
  const text = String(value ?? "").trim();
  if (!text) throw new Error("allowed origin must not be empty");
  const url = new URL(text);
  if (!["https:", "http:"].includes(url.protocol)) {
    throw new Error(`allowed origin must use http or https: ${text}`);
  }
  if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new Error(`allowed origin must be an origin without path/query/fragment: ${text}`);
  }
  return url.origin;
}

export const queueAllowedOrigins = (env = process.env) => {
  const raw = env.WRONGNOTE_ALLOWED_ORIGINS;
  const values = raw === undefined
    ? DEFAULT_ALLOWED_ORIGINS
    : raw.split(",").map((value) => value.trim()).filter(Boolean);
  if (!values.length) throw new Error("WRONGNOTE_ALLOWED_ORIGINS must contain at least one origin");
  return [...new Set(values.map(normalizeOrigin))];
};
