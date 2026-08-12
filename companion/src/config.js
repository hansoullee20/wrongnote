import os from "node:os";
import path from "node:path";

export const BIND_ADDRESS = "127.0.0.1";
export const DEFAULT_PORT = 43119;
export const QUEUE_FORMAT_VERSION = 2;
export const SESSION_LEASE_MS = 60_000;
export const MAX_ACTIVE_ITEMS = 100;
export const MAX_PAYLOAD_BYTES = 256 * 1024;
export const MAX_EVENT_ID_BYTES = 512;
export const MAX_ERROR_CHARS = 2000;

export const queueFilePath = (env = process.env) =>
  env.WRONGNOTE_QUEUE_FILE ||
  path.join(os.homedir(), ".wrongnote", "ai-queue-v2.json");

export const queuePort = (env = process.env) =>
  Number(env.WRONGNOTE_QUEUE_PORT) || DEFAULT_PORT;
