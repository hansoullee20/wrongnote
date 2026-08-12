import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createQueueStore } from "../src/queueStore.js";
import {
  acquireQueueLock,
  inspectQueueLock,
  lockPathForQueue,
  recoveryPathForLock,
} from "../src/lockFile.js";

async function tempFile(name) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), `wrongnote-final-${name}-`));
  return path.join(dir, "ai-queue-v2.json");
}

function ioError(code, message = code) {
  const err = new Error(message);
  err.code = code;
  return err;
}

test("post-create recovery probe failure removes the lock we just created", async () => {
  const file = await tempFile("lock-second-check");
  const lockPath = lockPathForQueue(file);
  const recoveryPath = recoveryPathForLock(lockPath);
  let recoveryStats = 0;
  const spy = {
    ...fs,
    async stat(p) {
      if (String(p) === String(recoveryPath)) {
        recoveryStats += 1;
        if (recoveryStats === 2) throw ioError("EIO", "second recovery probe failed");
      }
      return fs.stat(p);
    },
  };

  await assert.rejects(
    () => acquireQueueLock(lockPath, { fsImpl: spy }),
    (err) => err.code === "EIO"
  );
  assert.equal((await inspectQueueLock(lockPath)).exists, false);
});

test("failed cleanup after post-create acquisition failure is explicit", async () => {
  const file = await tempFile("lock-cleanup-loud");
  const lockPath = lockPathForQueue(file);
  const recoveryPath = recoveryPathForLock(lockPath);
  let recoveryStats = 0;
  const spy = {
    ...fs,
    async stat(p) {
      if (String(p) === String(recoveryPath)) {
        recoveryStats += 1;
        if (recoveryStats === 2) throw ioError("EIO", "second recovery probe failed");
      }
      return fs.stat(p);
    },
    async unlink(p) {
      if (String(p) === String(lockPath)) throw ioError("EACCES", "cannot remove owned lock");
      return fs.unlink(p);
    },
  };

  await assert.rejects(
    () => acquireQueueLock(lockPath, { fsImpl: spy }),
    (err) =>
      err.code === "lock_cleanup_failed" &&
      err.cause?.code === "EIO" &&
      err.cleanupCause?.code === "EACCES"
  );
  assert.equal((await inspectQueueLock(lockPath)).exists, true);
  await fs.unlink(lockPath);
});

test("startup failure does not hide a failed process-lock release", async () => {
  const file = await tempFile("startup-cleanup");
  const lockPath = lockPathForQueue(file);
  const spy = {
    ...fs,
    async readFile(p, enc) {
      if (String(p) === String(file)) throw ioError("EIO", "canonical read failed");
      return fs.readFile(p, enc);
    },
    async unlink(p) {
      if (String(p) === String(lockPath)) throw ioError("EACCES", "lock release failed");
      return fs.unlink(p);
    },
  };

  await assert.rejects(
    () => createQueueStore({ file, fsImpl: spy }),
    (err) =>
      err.code === "startup_lock_cleanup_failed" &&
      err.cause?.code === "EIO" &&
      err.cleanupCause?.code === "EACCES"
  );
  assert.equal((await inspectQueueLock(lockPath)).exists, true);
  await fs.unlink(lockPath);
});

test("changed pre-commit failure cannot mask pre-existing durability uncertainty", async () => {
  const file = await tempFile("sticky-uncertainty");
  const dir = path.dirname(file);
  let failTargetDirSync = true;
  let failRename = false;
  const spy = {
    ...fs,
    async open(p, flags, mode) {
      const handle = await fs.open(p, flags, mode);
      if (String(p) !== String(dir) || flags !== "r") return handle;
      return new Proxy(handle, {
        get(target, key) {
          if (key === "sync") {
            return async () => {
              if (failTargetDirSync) {
                failTargetDirSync = false;
                throw ioError("EIO", "first directory fsync failed");
              }
              return target.sync();
            };
          }
          const value = target[key];
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
    },
    async rename(from, to) {
      if (failRename && String(to) === String(file)) {
        throw ioError("ENOSPC", "second mutation cannot reach rename");
      }
      return fs.rename(from, to);
    },
  };

  const store = await createQueueStore({ file, fsImpl: spy });
  await assert.rejects(
    () => store.submit("event-a", { value: "A" }),
    (err) => err.code === "committed_durability_uncertain"
  );
  assert.equal((await store.health()).durability, "uncertain");

  failRename = true;
  await assert.rejects(
    () => store.submit("event-b", { value: "B" }),
    (err) => err.code === "ENOSPC" && err.durability === "uncertain"
  );

  assert.deepEqual((await store.list()).map((item) => item.eventId), ["event-a"]);
  assert.equal((await store.health()).durability, "uncertain");
  await store.close();
});
