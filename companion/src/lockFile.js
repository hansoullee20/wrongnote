import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import { QueueError, fail } from "./errors.js";

const host = () => os.hostname();
const holderShape = (now) => ({
  pid: process.pid,
  hostname: host(),
  token: crypto.randomUUID(),
  startedAt: now(),
});

function validHolder(value) {
  return Boolean(
    value &&
      typeof value === "object" &&
      Number.isInteger(value.pid) &&
      value.pid > 0 &&
      typeof value.hostname === "string" &&
      value.hostname.length > 0 &&
      typeof value.token === "string" &&
      value.token.length > 0 &&
      Number.isFinite(value.startedAt)
  );
}

async function readHolder(lockPath, fsImpl = fs) {
  let raw;
  try {
    raw = await fsImpl.readFile(lockPath, "utf8");
  } catch (err) {
    if (err?.code === "ENOENT") return null;
    throw err;
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    fail("lock_unreadable", `process lock is not valid JSON: ${lockPath}`);
  }
  if (!validHolder(parsed)) fail("lock_unreadable", `process lock has invalid contents: ${lockPath}`);
  return parsed;
}

function processStatus(pid) {
  try {
    process.kill(pid, 0);
    return "alive";
  } catch (err) {
    if (err?.code === "ESRCH") return "dead";
    if (err?.code === "EPERM") return "alive";
    return "unknown";
  }
}

async function sameInode(handle, lockPath, fsImpl) {
  try {
    const [a, b] = await Promise.all([handle.stat(), fsImpl.stat(lockPath)]);
    return a.dev === b.dev && a.ino === b.ino;
  } catch {
    return false;
  }
}

async function exclusiveMarker(markerPath, holder, fsImpl) {
  let handle;
  try {
    handle = await fsImpl.open(markerPath, "wx", 0o600);
    await handle.writeFile(JSON.stringify(holder), "utf8");
    await handle.sync();
  } catch (err) {
    if (handle && (await sameInode(handle, markerPath, fsImpl))) {
      await fsImpl.unlink(markerPath).catch(() => {});
    }
    throw err;
  } finally {
    if (handle) await handle.close().catch(() => {});
  }
}

async function markerExists(markerPath, fsImpl) {
  try {
    await fsImpl.stat(markerPath);
    return true;
  } catch (err) {
    if (err?.code === "ENOENT") return false;
    throw err;
  }
}

export const lockPathForQueue = (queueFile) => `${queueFile}.lock`;
export const recoveryPathForLock = (lockPath) => `${lockPath}.recovery`;

export async function inspectQueueLock(lockPath, { fsImpl = fs } = {}) {
  const holder = await readHolder(lockPath, fsImpl);
  if (!holder) return { exists: false, lockPath };
  const local = holder.hostname === host();
  return {
    exists: true,
    lockPath,
    holder,
    local,
    process: local ? processStatus(holder.pid) : "remote",
  };
}

export async function inspectRecoveryGuard(lockPath, { fsImpl = fs } = {}) {
  const recoveryPath = recoveryPathForLock(lockPath);
  const holder = await readHolder(recoveryPath, fsImpl);
  if (!holder) return { exists: false, recoveryPath };
  const local = holder.hostname === host();
  return {
    exists: true,
    recoveryPath,
    holder,
    local,
    process: local ? processStatus(holder.pid) : "remote",
  };
}

export async function acquireQueueLock(lockPath, { fsImpl = fs, now = () => Date.now() } = {}) {
  const recoveryPath = recoveryPathForLock(lockPath);
  if (await markerExists(recoveryPath, fsImpl)) {
    throw new QueueError("queue_recovery_in_progress", `queue lock recovery is in progress: ${recoveryPath}`, {
      lockPath,
      recoveryPath,
    });
  }

  const holder = holderShape(now);
  try {
    await exclusiveMarker(lockPath, holder, fsImpl);
  } catch (err) {
    if (err?.code !== "EEXIST") throw err;
    const current = await inspectQueueLock(lockPath, { fsImpl }).catch((inspectErr) => {
      throw new QueueError(
        "queue_locked",
        `queue lock already exists and could not be inspected: ${lockPath}`,
        { lockPath, cause: inspectErr }
      );
    });
    throw new QueueError("queue_locked", `queue file is already owned by another companion: ${lockPath}`, {
      lockPath,
      holder: current.holder,
      holderStatus: current.process,
    });
  }

  // Recovery may have started after our first check. It cannot safely coexist with a
  // new owner, so back out while our token is still the only cooperative owner.
  if (await markerExists(recoveryPath, fsImpl)) {
    const current = await readHolder(lockPath, fsImpl);
    if (current?.token === holder.token) await fsImpl.unlink(lockPath).catch(() => {});
    throw new QueueError("queue_recovery_in_progress", `queue lock recovery started during acquisition: ${recoveryPath}`, {
      lockPath,
      recoveryPath,
    });
  }

  let released = false;
  let releaseFlight = null;

  async function releaseOnce() {
    if (released) return;
    const current = await readHolder(lockPath, fsImpl);
    if (current === null) {
      released = true;
      return;
    }
    if (current.token !== holder.token) {
      released = true;
      return;
    }
    await fsImpl.unlink(lockPath);
    released = true;
  }

  return {
    lockPath,
    holder: { ...holder },
    release() {
      if (releaseFlight) return releaseFlight;
      releaseFlight = releaseOnce().finally(() => {
        releaseFlight = null;
      });
      return releaseFlight;
    },
  };
}

async function acquireRecoveryGuard(lockPath, { fsImpl = fs, now = () => Date.now() } = {}) {
  const recoveryPath = recoveryPathForLock(lockPath);
  const holder = holderShape(now);
  try {
    await exclusiveMarker(recoveryPath, holder, fsImpl);
  } catch (err) {
    if (err?.code === "EEXIST") {
      throw new QueueError("recovery_in_progress", `another lock-recovery command is already running: ${recoveryPath}`, {
        lockPath,
        recoveryPath,
      });
    }
    throw err;
  }
  return {
    recoveryPath,
    async release() {
      const current = await readHolder(recoveryPath, fsImpl);
      if (current?.token === holder.token) await fsImpl.unlink(recoveryPath);
    },
  };
}

export async function unlockDeadQueueLock(lockPath, { fsImpl = fs, now = () => Date.now() } = {}) {
  const guard = await acquireRecoveryGuard(lockPath, { fsImpl, now });
  try {
    const info = await inspectQueueLock(lockPath, { fsImpl });
    if (!info.exists) return { status: "absent", lockPath };
    if (!info.local) {
      fail("unlock_refused", `lock belongs to another host: ${info.holder.hostname}`, { lockPath, holder: info.holder });
    }
    if (info.process !== "dead") {
      fail("unlock_refused", `lock holder pid ${info.holder.pid} is not definitively dead`, {
        lockPath,
        holder: info.holder,
        holderStatus: info.process,
      });
    }
    const again = await readHolder(lockPath, fsImpl);
    if (!again || again.token !== info.holder.token) {
      fail("unlock_raced", "lock changed while preparing manual unlock; retry inspection", { lockPath });
    }
    // While the recovery guard exists, cooperative acquireQueueLock calls cannot remain owners,
    // and a second unlock command cannot enter. The old check/unlink replacement race is closed.
    await fsImpl.unlink(lockPath);
    return { status: "unlocked", lockPath, holder: info.holder };
  } finally {
    await guard.release();
  }
}
