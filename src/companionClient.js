export const COMPANION_BASE_URL = "http://127.0.0.1:43119/v1";

export class CompanionHttpError extends Error {
  constructor(message, { status = 0, code = "companion_error", details = {} } = {}) {
    super(message);
    this.name = "CompanionHttpError";
    this.status = status;
    this.code = code;
    Object.assign(this, details);
  }
}

function protocolError(message, details = {}) {
  return new CompanionHttpError(message, {
    status: 0,
    code: "bad_companion_response",
    details,
  });
}

function assertObject(value, message) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw protocolError(message);
  }
  return value;
}

async function readResponse(response) {
  let body;
  try {
    body = await response.json();
  } catch {
    throw protocolError("Wrongnote companion returned non-JSON data", {
      httpStatus: response.status,
    });
  }
  assertObject(body, "Wrongnote companion returned an invalid response object");

  if (!response.ok || body.ok === false) {
    const error = assertObject(body.error, "Wrongnote companion returned an invalid error object");
    throw new CompanionHttpError(
      typeof error.message === "string" ? error.message : "Wrongnote companion request failed",
      {
        status: response.status,
        code: typeof error.code === "string" ? error.code : "companion_error",
        details: error,
      }
    );
  }

  if (body.ok !== true) {
    throw protocolError("Wrongnote companion response is missing ok=true", {
      httpStatus: response.status,
    });
  }
  return body;
}

export function createCompanionClient({
  baseUrl = COMPANION_BASE_URL,
  fetchImpl = globalThis.fetch,
} = {}) {
  if (typeof fetchImpl !== "function") throw new Error("companion client requires fetch");
  const base = String(baseUrl).replace(/\/+$/, "");

  async function request(path, { method = "GET", body, signal, keepalive = false } = {}) {
    let response;
    try {
      response = await fetchImpl(`${base}${path}`, {
        method,
        mode: "cors",
        credentials: "omit",
        cache: "no-store",
        redirect: "error",
        referrerPolicy: "no-referrer",
        signal,
        keepalive,
        headers: body === undefined ? undefined : { "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (err) {
      if (err?.name === "AbortError") throw err;
      throw new CompanionHttpError("Wrongnote companion is unavailable", {
        code: "companion_unavailable",
        details: { cause: err },
      });
    }
    return readResponse(response);
  }

  return {
    health(options) {
      return request("/health", options);
    },
    acquireSession(sessionId, options) {
      return request("/session/acquire", {
        ...options,
        method: "POST",
        body: { sessionId },
      });
    },
    renewSession(sessionId, fence, options) {
      return request("/session/renew", {
        ...options,
        method: "POST",
        body: { sessionId, fence },
      });
    },
    claim(sessionId, fence, options) {
      return request("/claim", {
        ...options,
        method: "POST",
        body: { sessionId, fence },
      });
    },
    settle(sessionId, fence, receipt, outcome, { error, signal, keepalive = false } = {}) {
      const body = { sessionId, fence, receipt, outcome };
      if (error !== undefined) body.error = error;
      return request("/settle", {
        method: "POST",
        body,
        signal,
        keepalive,
      });
    },
    releaseSession(sessionId, fence, options = {}) {
      return request("/session/release", {
        ...options,
        method: "POST",
        body: { sessionId, fence },
      });
    },
  };
}

export function newCompanionSessionId(cryptoImpl = globalThis.crypto) {
  if (cryptoImpl?.randomUUID) {
    return `wrongnote-tab-${cryptoImpl.randomUUID()}`;
  }
  if (cryptoImpl?.getRandomValues) {
    const bytes = new Uint8Array(16);
    cryptoImpl.getRandomValues(bytes);
    const token = Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
    return `wrongnote-tab-${token}`;
  }
  throw new Error("browser does not provide a secure random source for companion session ids");
}
