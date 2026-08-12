#!/usr/bin/env node
import { startWrongnoteMcp } from "./mcpRuntime.js";

async function main() {
  const runtime = await startWrongnoteMcp({
    logger: {
      error(...args) {
        console.error(...args);
      },
    },
  });

  console.error(
    `Wrongnote MCP running on stdio; browser bridge http://${runtime.companion.address.address}:${runtime.companion.address.port}`
  );

  let stopping = false;
  const stop = async (reason) => {
    if (stopping) return;
    stopping = true;
    try {
      await runtime.close();
      console.error(`Wrongnote MCP stopped (${reason})`);
    } catch (err) {
      console.error(
        JSON.stringify({
          status: "shutdown_failed",
          reason,
          code: err?.code || "error",
          message: err?.message || String(err),
        })
      );
      process.exitCode = 1;
    }
  };

  process.once("SIGINT", () => void stop("SIGINT"));
  process.once("SIGTERM", () => void stop("SIGTERM"));
  process.stdin.once("end", () => void stop("stdin-end"));
  process.stdin.once("close", () => void stop("stdin-close"));
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
