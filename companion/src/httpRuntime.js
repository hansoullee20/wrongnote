import { BIND_ADDRESS, queueAllowedOrigins, queueFilePath, queuePort } from "./config.js";
import { QueueError } from "./errors.js";
import { createHttpTransport } from "./httpServer.js";
import { createQueueStore } from "./queueStore.js";

export async function startCompanionHttp({ env = process.env, logger = console } = {}) {
  const file = queueFilePath(env);
  const port = queuePort(env);
  const allowedOrigins = queueAllowedOrigins(env);
  const store = await createQueueStore({ file });
  let transport;
  try {
    transport = createHttpTransport({ store, allowedOrigins, host: BIND_ADDRESS, port, logger });
    const address = await transport.listen();
    return {
      store,
      transport,
      file,
      allowedOrigins,
      address,
      async close() {
        let transportError;
        try {
          await transport.close();
        } catch (err) {
          transportError = err;
        }
        try {
          await store.close();
        } catch (storeError) {
          if (transportError) {
            throw new QueueError("http_shutdown_cleanup_failed", "HTTP transport and queue store both failed to close", {
              transportError,
              storeError,
              queueFile: file,
            });
          }
          throw storeError;
        }
        if (transportError) throw transportError;
      },
    };
  } catch (err) {
    try {
      await store.close();
    } catch (cleanupErr) {
      throw new QueueError(
        "http_startup_cleanup_failed",
        `HTTP companion startup failed and the queue store could not be closed: ${file}`,
        {
          queueFile: file,
          cause: err,
          cleanupCause: cleanupErr,
        }
      );
    }
    throw err;
  }
}
