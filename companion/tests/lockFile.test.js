import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { acquireQueueLock } from "../src/lockFile.js";

let tmpRoot;
const freshLock = async (name) => {
  tmpRoot ??= await fs.mkdtemp(path.join(os.tmpdir(), "wrongnote-lock-"));
  return path.join(tmpRoot, `${name}-${Math.random().toString(16).slice(2)}.lock`);
};

/* 잠금 자체를 직접 시험한다. 스토어를 통해서만 보면 store.close()의 멱등
   가드가 이 계층의 결함을 가린다 — 실제로 그렇게 한 번 놓쳤다. */

test("a released lock can be acquired again", async () => {
  const lockPath = await freshLock("reacquire");
  const first = await acquireQueueLock(lockPath);
  await first.release();
  const second = await acquireQueueLock(lockPath);
  await second.release();
});

test("a stale release does not delete a lock re-acquired by the same process", async () => {
  const lockPath = await freshLock("stale-release");
  const first = await acquireQueueLock(lockPath);
  await first.release();

  const second = await acquireQueueLock(lockPath);

  /* 같은 pid·hostname이라 순진한 해제는 여기서 남의 잠금을 지운다.
     지워지면 세 번째가 잠금을 얻어 소유자가 둘이 된다. */
  await first.release();

  await assert.rejects(
    () => acquireQueueLock(lockPath),
    /in use/i,
    "the second holder must still own the lock"
  );
  await second.release();
});

test("release is idempotent and never removes a later holder's lock", async () => {
  const lockPath = await freshLock("idempotent");
  const first = await acquireQueueLock(lockPath);
  await first.release();
  await first.release();
  await first.release();

  const second = await acquireQueueLock(lockPath);
  await first.release();
  await assert.rejects(() => acquireQueueLock(lockPath), /in use/i);
  await second.release();
});

test("a live holder's lock is not stolen", async () => {
  const lockPath = await freshLock("live");
  const held = await acquireQueueLock(lockPath);
  await assert.rejects(() => acquireQueueLock(lockPath), /in use/i);
  await held.release();
});
