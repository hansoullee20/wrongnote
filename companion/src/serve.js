#!/usr/bin/env node
import { pathToFileURL } from "node:url";
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

async function main() {
  const runtime = await startCompanionHttp();
  console.log(
    JSON.stringify(
      {
        status: "listening",
        address: runtime.address.address,
        port: runtime.address.port,
        queueFile: runtime.file,
        allowedOrigins: runtime.allowedOrigins,
      },
      null,
      2
    )
  );

  let stopping = false;
  const stop = async (signal) => {
    if (stopping) return;
    stopping = true;
    try {
      await runtime.close();
      console.log(JSON.stringify({ status: "stopped", signal }));
    } catch (err) {
      console.error(
        JSON.stringify({
          status: "shutdown_failed",
          signal,
          code: err?.code || "error",
          message: err?.message || String(err),
        })
      );
      process.exitCode = 1;
    }
  };

  process.once("SIGINT", () => void stop("SIGINT"));
  process.once("SIGTERM", () => void stop("SIGTERM"));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(
      JSON.stringify({
        status: "startup_failed",
        code: err?.code || "error",
        message: err?.message || String(err),
      })
    );
    process.exitCode = 1;
  });
}
