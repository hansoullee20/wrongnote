import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import { QueueError, fail } from "./errors.js";

const host = () => os.hostname();

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

export const lockPathForQueue = (queueFile) => `${queueFile}.lock`;

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

export async function acquireQueueLock(lockPath, { fsImpl = fs, now = () => Date.now() } = {}) {
  const holder = {
    pid: process.pid,
    hostname: host(),
    token: crypto.randomUUID(),
    startedAt: now(),
  };

  let handle;
  try {
    handle = await fsImpl.open(lockPath, "wx", 0o600);
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

  try {
    await handle.writeFile(JSON.stringify(holder), "utf8");
    await handle.sync();
  } catch (err) {
    if (await sameInode(handle, lockPath, fsImpl)) {
      await fsImpl.unlink(lockPath).catch(() => {});
    }
    throw err;
  } finally {
    await handle.close().catch(() => {});
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

export async function unlockDeadQueueLock(lockPath, { fsImpl = fs } = {}) {
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
  await fsImpl.unlink(lockPath);
  return { status: "unlocked", lockPath, holder: info.holder };
}
