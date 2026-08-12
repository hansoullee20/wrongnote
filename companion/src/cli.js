#!/usr/bin/env node
import { queueFilePath } from "./config.js";
import { QueueError } from "./errors.js";
import {
  inspectQueueLock,
  inspectRecoveryGuard,
  lockPathForQueue,
  unlockDeadQueueLock,
} from "./lockFile.js";
import { createQueueStore } from "./queueStore.js";

function usage() {
  console.error(
    "usage: wrongnote-queue doctor [queue-file] | unlock [queue-file] | rejected [queue-file] | requeue <rejection-id> [queue-file]"
  );
  process.exitCode = 2;
}

async function withClosedStore(queueFile, fn) {
  const store = await createQueueStore({ file: queueFile });
  let result;
  let primaryError;
  try {
    result = await fn(store);
  } catch (err) {
    primaryError = err;
  }

  try {
    await store.close();
  } catch (cleanupErr) {
    if (primaryError) {
      throw new QueueError("cli_store_cleanup_failed", "queue recovery command failed and the store could not close", {
        cause: primaryError,
        cleanupCause: cleanupErr,
        queueFile,
      });
    }
    throw cleanupErr;
  }

  if (primaryError) throw primaryError;
  return result;
}

function rejectedSummary(record) {
  return {
    rejectionId: record.rejectionId,
    eventId: record.eventId,
    error: record.error,
    rejectedAt: record.rejectedAt,
    requeuedItemId: record.requeuedItemId,
    payloadRetained: record.payload !== null,
  };
}

const args = process.argv.slice(2);
const command = args[0];
if (!command || !["doctor", "unlock", "rejected", "requeue"].includes(command)) {
  usage();
} else {
  let rejectionId;
  let explicitFile;
  if (command === "requeue") {
    rejectionId = args[1];
    explicitFile = args[2];
    if (!rejectionId || args.length > 3) {
      usage();
      rejectionId = null;
    }
  } else {
    explicitFile = args[1];
    if (args.length > 2) usage();
  }

  if (process.exitCode !== 2 && (command !== "requeue" || rejectionId)) {
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
      } else if (command === "unlock") {
        const result = await unlockDeadQueueLock(lockPath);
        console.log(JSON.stringify({ queueFile, ...result }, null, 2));
      } else if (command === "rejected") {
        const records = await withClosedStore(queueFile, (store) => store.listRejected());
        console.log(
          JSON.stringify(
            {
              queueFile,
              rejected: records.map(rejectedSummary),
              guidance:
                "Stop any running wrongnote-mcp/wrongnote-companion owner before recovery. Requeue only a rejection you have inspected: wrongnote-queue requeue <rejection-id> [queue-file]",
            },
            null,
            2
          )
        );
      } else {
        const result = await withClosedStore(queueFile, (store) => store.requeue(rejectionId));
        console.log(JSON.stringify({ queueFile, rejectionId, ...result }, null, 2));
        if (!["requeued", "already_requeued"].includes(result.status)) process.exitCode = 1;
      }
    } catch (err) {
      console.error(
        JSON.stringify(
          {
            error: err?.code || "error",
            message: err?.message || String(err),
            queueFile,
            lockPath,
            guidance:
              command === "rejected" || command === "requeue"
                ? `Stop any active wrongnote-mcp/wrongnote-companion owner, then run: wrongnote-queue doctor ${quoted}. Never edit or delete the queue state file.`
                : `Do not edit or delete the queue state file. Run: wrongnote-queue doctor ${quoted}`,
          },
          null,
          2
        )
      );
      process.exitCode = 1;
    }
  }
}
