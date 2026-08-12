import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { QueueError } from "./errors.js";
import { startCompanionHttp } from "./httpRuntime.js";
import { createWrongnoteMcpServer } from "./mcpServer.js";

export async function startWrongnoteMcp({ env = process.env, logger = console } = {}) {
  const companion = await startCompanionHttp({ env, logger });
  let stdio;
  try {
    stdio = serveStdio(() => createWrongnoteMcpServer(companion.store, { logger }), {
      onerror(error) {
        logger?.error?.("wrongnote MCP stdio error", error);
      },
    });
  } catch (err) {
    try {
      await companion.close();
    } catch (cleanupErr) {
      throw new QueueError(
        "mcp_startup_cleanup_failed",
        "MCP stdio startup failed and the companion runtime could not be closed",
        { cause: err, cleanupCause: cleanupErr, queueFile: companion.file }
      );
    }
    throw err;
  }

  let closed = false;
  let closeFlight = null;
  async function close() {
    if (closed) return;
    if (closeFlight) return closeFlight;
    closeFlight = (async () => {
      let stdioError;
      try {
        await stdio.close();
      } catch (err) {
        stdioError = err;
      }

      try {
        await companion.close();
      } catch (companionError) {
        if (stdioError) {
          throw new QueueError("mcp_shutdown_cleanup_failed", "MCP stdio and companion runtime both failed to close", {
            stdioError,
            companionError,
            queueFile: companion.file,
          });
        }
        throw companionError;
      }
      if (stdioError) throw stdioError;
      closed = true;
    })().finally(() => {
      if (!closed) closeFlight = null;
    });
    return closeFlight;
  }

  return {
    companion,
    stdio,
    close,
  };
}
