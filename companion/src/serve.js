#!/usr/bin/env node
import { startCompanionHttp } from "./httpRuntime.js";

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
