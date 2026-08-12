import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  acquireQueueLock,
  inspectRecoveryGuard,
  lockPathForQueue,
  recoveryPathForLock,
  unlockDeadQueueLock,
} from "../src/lockFile.js";

async function tempLock() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "wrongnote-recovery-"));
  return lockPathForQueue(path.join(dir, "ai-queue-v2.json"));
}

test("manual recovery is serialized and blocks replacement ownership", async () => {
  const lockPath = await tempLock();
  const recoveryPath = recoveryPathForLock(lockPath);
  const deadHolder = {
    pid: 2147483647,
    hostname: os.hostname(),
    token: "dead-token",
    startedAt: Date.now() - 1000,
  };
  await fs.writeFile(lockPath, JSON.stringify(deadHolder), "utf8");

  let recoveryCreated;
  const recoverySeen = new Promise((resolve) => { recoveryCreated = resolve; });
  let unblockRead;
  const readBlocked = new Promise((resolve) => { unblockRead = resolve; });
  let held = true;
  const spy = {
    ...fs,
    async open(p, flags, mode) {
      const h = await fs.open(p, flags, mode);
      if (String(p) === recoveryPath && flags === "wx") recoveryCreated();
      return h;
    },
    async readFile(p, enc) {
      if (String(p) === lockPath && held) {
        held = false;
        await readBlocked;
      }
      return fs.readFile(p, enc);
    },
  };

  const first = unlockDeadQueueLock(lockPath, { fsImpl: spy });
  await recoverySeen;
  await assert.rejects(
    () => unlockDeadQueueLock(lockPath),
    (e) => e.code === "recovery_in_progress"
  );
  await assert.rejects(
    () => acquireQueueLock(lockPath),
    (e) => e.code === "queue_recovery_in_progress"
  );

  unblockRead();
  assert.equal((await first).status, "unlocked");
  assert.equal((await inspectRecoveryGuard(lockPath)).exists, false);

  const replacement = await acquireQueueLock(lockPath);
  await replacement.release();
});
