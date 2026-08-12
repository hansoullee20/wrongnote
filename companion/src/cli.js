#!/usr/bin/env node
import { queueFilePath } from "./config.js";
import { inspectQueueLock, lockPathForQueue, unlockDeadQueueLock } from "./lockFile.js";

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
  try {
    if (command === "doctor") {
      const info = await inspectQueueLock(lockPath);
      console.log(JSON.stringify({
        queueFile,
        lockPath,
        ...info,
        guidance: info.exists
          ? "Do not edit the queue file. If this is a local lock and the holder is definitively dead, run: wrongnote-queue unlock"
          : "No process lock is present. Do not edit the queue file as a lock-recovery step.",
      }, null, 2));
    } else {
      const result = await unlockDeadQueueLock(lockPath);
      console.log(JSON.stringify({ queueFile, ...result }, null, 2));
    }
  } catch (err) {
    console.error(JSON.stringify({
      error: err?.code || "error",
      message: err?.message || String(err),
      queueFile,
      lockPath,
      guidance: "Do not edit or delete the queue state file. Run doctor again and inspect the reported holder.",
    }, null, 2));
    process.exitCode = 1;
  }
}
