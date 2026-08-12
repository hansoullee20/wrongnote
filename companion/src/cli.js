#!/usr/bin/env node
import { queueFilePath } from "./config.js";
import {
  inspectQueueLock,
  inspectRecoveryGuard,
  lockPathForQueue,
  unlockDeadQueueLock,
} from "./lockFile.js";

function usage() {
  console.error("usage: wrongnote-queue doctor [queue-file] | unlock [queue-file]");
  process.exitCode = 2;
}

const [command, explicitFile] = process.argv.slice(2);
if (!command || !["doctor", "unlock"].includes(command)) {
  usage();
} else {
  const queueFile = explicitFile || queueFilePath();
  const lockPath = lockPathForQueue(queueFile);
  const quoted = JSON.stringify(queueFile);
  try {
    if (command === "doctor") {
      const [lock, recovery] = await Promise.all([
        inspectQueueLock(lockPath),
        inspectRecoveryGuard(lockPath),
      ]);
      console.log(
        JSON.stringify(
          {
            queueFile,
            lockPath,
            lock,
            recovery,
            guidance: recovery.exists
              ? "A recovery guard exists. Do not edit the queue file or start another unlock. If its holder is dead, stop all companion/recovery processes and inspect the .recovery file manually."
              : lock.exists
                ? `Do not edit the queue file. If this is a local lock and the holder is definitively dead, run: wrongnote-queue unlock ${quoted}`
                : "No process lock is present. Do not edit the queue file as a lock-recovery step.",
          },
          null,
          2
        )
      );
    } else {
      const result = await unlockDeadQueueLock(lockPath);
      console.log(JSON.stringify({ queueFile, ...result }, null, 2));
    }
  } catch (err) {
    console.error(
      JSON.stringify(
        {
          error: err?.code || "error",
          message: err?.message || String(err),
          queueFile,
          lockPath,
          guidance: `Do not edit or delete the queue state file. Run: wrongnote-queue doctor ${quoted}`,
        },
        null,
        2
      )
    );
    process.exitCode = 1;
  }
}
