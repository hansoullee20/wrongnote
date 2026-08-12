import http from "node:http";
import {
  BIND_ADDRESS,
  DEFAULT_PORT,
  HTTP_BODY_LIMIT_BYTES,
  HTTP_TRANSPORT_VERSION,
} from "./config.js";
import { QueueError } from "./errors.js";

const JSON_TYPE_RE = /^application\/json(?:\s*;|$)/i;
const ALLOWED_METHODS = new Set(["GET", "POST", "OPTIONS"]);
const ALLOWED_REQUEST_HEADERS = new Set(["content-type"]);

function jsonHeaders(extra = {}) {
  return {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "X-Wrongnote-Transport-Version": String(HTTP_TRANSPORT_VERSION),
    ...extra,
  };
}

function sendJson(res, statusCode, body, extraHeaders = {}) {
  if (res.headersSent) return;
  res.writeHead(statusCode, jsonHeaders(extraHeaders));
  res.end(JSON.stringify(body));
}

function ownSerializableDetails(err) {
  const details = {};
  for (const key of [
    "committed",
    "durability",
    "degradedReasons",
    "result",
    "bytes",
    "limit",
    "currentFence",
  ]) {
    if (err?.[key] !== undefined) details[key] = err[key];
  }
  return details;
}

function serializeError(err) {
  if (err instanceof QueueError || typeof err?.code === "string") {
    return {
      code: err.code || "queue_error",
      message: err.message || "queue operation failed",
      ...ownSerializableDetails(err),
    };
  }
  return {
    code: "internal_error",
    message: "companion internal error",
  };
}

function httpStatusForError(err) {
  if (err?.code === "request_too_large") return 413;
  if (err?.code === "unsupported_media_type") return 415;
  if (err?.code === "origin_forbidden") return 403;
  if (err?.code === "committed_durability_uncertain") return 503;
  if (err?.code === "store_closed") return 503;
  if (typeof err?.code === "string" && err.code.startsWith("invalid_")) return 400;
  if (err?.code === "bad_json" || err?.code === "bad_request") return 400;
  return 500;
}

function transportError(code, message, details = {}) {
  return new QueueError(code, message, details);
}

function normalizeAllowedOrigins(values) {
  if (!Array.isArray(values) || values.length === 0) {
    throw new Error("HTTP transport requires at least one allowed origin");
  }
  const out = new Set();
  for (const value of values) {
    const url = new URL(value);
    if (!["https:", "http:"].includes(url.protocol) || url.origin !== value) {
      throw new Error(`invalid allowed origin: ${value}`);
    }
    out.add(url.origin);
  }
  return out;
}

function originPolicy(req, allowedOrigins) {
  const raw = req.headers.origin;
  if (raw === undefined) return { origin: null, browserCors: false };
  if (typeof raw !== "string" || !allowedOrigins.has(raw)) {
    throw transportError("origin_forbidden", "request origin is not allowed");
  }
  return { origin: raw, browserCors: true };
}

function corsHeaders(origin) {
  if (!origin) return { Vary: "Origin" };
  return {
    "Access-Control-Allow-Origin": origin,
    Vary: "Origin",
  };
}

function parseRequestedHeaders(value) {
  if (!value) return [];
  return String(value)
    .split(",")
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean);
}

function handlePreflight(req, res, origin) {
  const requestedMethod = String(req.headers["access-control-request-method"] || "").toUpperCase();
  if (!requestedMethod || !ALLOWED_METHODS.has(requestedMethod) || requestedMethod === "OPTIONS") {
    sendJson(res, 400, { ok: false, error: { code: "bad_preflight", message: "unsupported preflight method" } }, corsHeaders(origin));
    return;
  }

  const requestedHeaders = parseRequestedHeaders(req.headers["access-control-request-headers"]);
  const unsupported = requestedHeaders.filter((header) => !ALLOWED_REQUEST_HEADERS.has(header));
  if (unsupported.length) {
    sendJson(
      res,
      400,
      { ok: false, error: { code: "bad_preflight", message: `unsupported request headers: ${unsupported.join(", ")}` } },
      corsHeaders(origin)
    );
    return;
  }

  const headers = {
    ...corsHeaders(origin),
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "600",
  };

  // Backward compatibility for Chromium builds that still send the old PNA
  // preflight. Current Local Network Access is permission-gated in the browser;
  // this header is not treated as the primary security boundary.
  if (req.headers["access-control-request-private-network"] === "true") {
    headers["Access-Control-Allow-Private-Network"] = "true";
  }

  res.writeHead(204, {
    "Cache-Control": "no-store",
    "X-Wrongnote-Transport-Version": String(HTTP_TRANSPORT_VERSION),
    ...headers,
  });
  res.end();
}

async function readJsonBody(req, limitBytes) {
  const contentType = req.headers["content-type"];
  if (typeof contentType !== "string" || !JSON_TYPE_RE.test(contentType)) {
    throw transportError("unsupported_media_type", "POST requests require Content-Type: application/json");
  }

  const declared = req.headers["content-length"];
  if (declared !== undefined) {
    const n = Number(declared);
    if (!Number.isFinite(n) || n < 0) throw transportError("bad_request", "invalid Content-Length");
    if (n > limitBytes) throw transportError("request_too_large", `request body exceeds ${limitBytes} bytes`, { limit: limitBytes });
  }

  const chunks = [];
  let bytes = 0;
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > limitBytes) {
      throw transportError("request_too_large", `request body exceeds ${limitBytes} bytes`, { bytes, limit: limitBytes });
    }
    chunks.push(chunk);
  }

  if (bytes === 0) throw transportError("bad_json", "request body must contain a JSON object");
  let value;
  try {
    value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw transportError("bad_json", "request body is not valid JSON");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw transportError("bad_request", "request body must be a JSON object");
  }
  return value;
}

function exactBody(body, required, optional = []) {
  const allowed = new Set([...required, ...optional]);
  const keys = Object.keys(body);
  const missing = required.filter((key) => !Object.hasOwn(body, key));
  const extra = keys.filter((key) => !allowed.has(key));
  if (missing.length || extra.length) {
    const parts = [];
    if (missing.length) parts.push(`missing: ${missing.join(", ")}`);
    if (extra.length) parts.push(`unexpected: ${extra.join(", ")}`);
    throw transportError("bad_request", `invalid request shape (${parts.join("; ")})`);
  }
  return body;
}

async function dispatch(store, method, pathname, body) {
  if (method === "GET" && pathname === "/v1/health") {
    return { statusCode: 200, body: { ok: true, transportVersion: HTTP_TRANSPORT_VERSION, ...(await store.health()) } };
  }

  if (method !== "POST") return null;

  switch (pathname) {
    case "/v1/session/acquire": {
      exactBody(body, ["sessionId"]);
      return { statusCode: 200, body: { ok: true, ...(await store.acquireSession(body.sessionId)) } };
    }
    case "/v1/session/renew": {
      exactBody(body, ["sessionId", "fence"]);
      return { statusCode: 200, body: { ok: true, ...(await store.renewSession(body.sessionId, body.fence)) } };
    }
    case "/v1/claim": {
      exactBody(body, ["sessionId", "fence"]);
      return { statusCode: 200, body: { ok: true, ...(await store.claim(body.sessionId, body.fence)) } };
    }
    case "/v1/settle": {
      exactBody(body, ["sessionId", "fence", "receipt", "outcome"], ["error"]);
      const options = Object.hasOwn(body, "error") ? { error: body.error } : {};
      return {
        statusCode: 200,
        body: { ok: true, ...(await store.settle(body.sessionId, body.fence, body.receipt, body.outcome, options)) },
      };
    }
    case "/v1/session/release": {
      exactBody(body, ["sessionId", "fence"]);
      return { statusCode: 200, body: { ok: true, ...(await store.releaseSession(body.sessionId, body.fence)) } };
    }
    default:
      return null;
  }
}

export function createHttpTransport({
  store,
  allowedOrigins,
  host = BIND_ADDRESS,
  port = DEFAULT_PORT,
  bodyLimitBytes = HTTP_BODY_LIMIT_BYTES,
  logger = console,
} = {}) {
  if (!store || typeof store !== "object") throw new Error("HTTP transport requires a queue store");
  if (host !== BIND_ADDRESS) throw new Error(`HTTP transport must bind to ${BIND_ADDRESS}`);
  if (!Number.isSafeInteger(port) || port < 0 || port > 65535) throw new Error("HTTP transport port must be 0..65535");
  if (!Number.isSafeInteger(bodyLimitBytes) || bodyLimitBytes <= 0) throw new Error("bodyLimitBytes must be a positive integer");
  const originSet = normalizeAllowedOrigins(allowedOrigins);

  const server = http.createServer(async (req, res) => {
    let origin = null;
    try {
      const policy = originPolicy(req, originSet);
      origin = policy.origin;

      if (req.method === "OPTIONS") {
        if (!policy.browserCors) throw transportError("origin_forbidden", "preflight requires an allowed Origin");
        handlePreflight(req, res, origin);
        return;
      }

      if (!ALLOWED_METHODS.has(req.method)) {
        sendJson(
          res,
          405,
          { ok: false, error: { code: "method_not_allowed", message: "method not allowed" } },
          { ...corsHeaders(origin), Allow: "GET, POST, OPTIONS" }
        );
        return;
      }

      const url = new URL(req.url || "/", `http://${BIND_ADDRESS}`);
      if (url.search) throw transportError("bad_request", "query parameters are not part of the transport protocol");
      const body = req.method === "POST" ? await readJsonBody(req, bodyLimitBytes) : undefined;
      const result = await dispatch(store, req.method, url.pathname, body);
      if (!result) {
        sendJson(res, 404, { ok: false, error: { code: "not_found", message: "unknown transport endpoint" } }, corsHeaders(origin));
        return;
      }
      sendJson(res, result.statusCode, result.body, corsHeaders(origin));
    } catch (err) {
      if (!(err instanceof QueueError) && err?.code !== "ECONNRESET") {
        logger?.error?.("wrongnote companion HTTP error", err);
      }
      if (!res.headersSent) {
        sendJson(res, httpStatusForError(err), { ok: false, error: serializeError(err) }, corsHeaders(origin));
      } else {
        res.destroy();
      }
    }
  });

  server.keepAliveTimeout = 5_000;
  server.headersTimeout = 10_000;
  server.requestTimeout = 15_000;

  let listening = false;

  return {
    server,
    async listen() {
      if (listening) return this.address();
      await new Promise((resolve, reject) => {
        const onError = (err) => {
          server.off("listening", onListening);
          reject(err);
        };
        const onListening = () => {
          server.off("error", onError);
          resolve();
        };
        server.once("error", onError);
        server.once("listening", onListening);
        server.listen({ host, port, exclusive: true });
      });
      listening = true;
      return this.address();
    },
    address() {
      const value = server.address();
      if (!value || typeof value === "string") return null;
      return { address: value.address, family: value.family, port: value.port };
    },
    async close() {
      if (!listening) return;
      await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
      listening = false;
    },
  };
}
