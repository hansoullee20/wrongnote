import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { QueueError } from "./errors.js";
import { startCompanionHttp } from "./httpRuntime.js";
import { createWrongnoteMcpServer } from "./mcpServer.js";

export async function startWrongnoteMcp({ env = process.env, logger = console } = {}) {
  let companion = null;
  let companionFlight = null;
  let closing = false;
  let closed = false;

  async function getCompanion() {
    if (companion) return companion;
    if (closing || closed) {
      throw new QueueError("mcp_closing", "Wrongnote MCP runtime is closing");
    }
    if (companionFlight) return companionFlight;

    companionFlight = startCompanionHttp({ env, logger })
      .then((runtime) => {
        companion = runtime;
        logger?.error?.(
          `Wrongnote browser bridge listening on http://${runtime.address.address}:${runtime.address.port}`
        );
        return runtime;
      })
      .catch((err) => {
        companionFlight = null;
        if (err instanceof QueueError) throw err;
        logger?.error?.("wrongnote companion startup failed", err);
        throw new QueueError("companion_startup_failed", "Wrongnote local companion could not start", {
          cause: err,
        });
      });

    return companionFlight;
  }

  const lazyProducerStore = {
    async submit(eventId, payload) {
      const runtime = await getCompanion();
      return runtime.store.submit(eventId, payload);
    },
  };

  let stdio;
  try {
    // Do not acquire the queue lock or bind HTTP during MCP discovery/handshake.
    // Modern stdio auto-negotiation may use a disposable sibling process for
    // server/discover; ownership begins only when the actual model submits work.
    stdio = serveStdio(() => createWrongnoteMcpServer(lazyProducerStore, { logger }), {
      onerror(error) {
        logger?.error?.("wrongnote MCP stdio error", error);
      },
    });
  } catch (err) {
    throw err;
  }

  let closeFlight = null;
  async function close() {
    if (closed) return;
    if (closeFlight) return closeFlight;
    closing = true;

    closeFlight = (async () => {
      let stdioError;
      try {
        await stdio.close();
      } catch (err) {
        stdioError = err;
      }

      // A tool call may have been starting the companion while the transport closed.
      // Wait for that startup to settle so a newly-acquired lock/server cannot escape
      // shutdown after stdio has already disappeared.
      if (!companion && companionFlight) {
        try {
          await companionFlight;
        } catch {
          // The startup path already logged/wrapped its own failure. There is no
          // companion runtime to close in this branch.
        }
      }

      let companionError;
      if (companion) {
        try {
          await companion.close();
        } catch (err) {
          companionError = err;
        }
      }

      if (stdioError && companionError) {
        throw new QueueError("mcp_shutdown_cleanup_failed", "MCP stdio and companion runtime both failed to close", {
          stdioError,
          companionError,
          queueFile: companion?.file,
        });
      }
      if (companionError) throw companionError;
      if (stdioError) throw stdioError;
      closed = true;
    })().finally(() => {
      if (!closed) closing = false;
      closeFlight = null;
    });
    return closeFlight;
  }

  return {
    stdio,
    getCompanion,
    get companion() {
      return companion;
    },
    close,
  };
}
