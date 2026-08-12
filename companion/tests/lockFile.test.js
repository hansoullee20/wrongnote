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

/* 해제 도중의 일시적 읽기 실패를 삼키면, 잠금 파일은 남는데 "놓았다"고
   표시된다. 재시도는 아무것도 안 하고, 그 잠금의 pid는 **우리 자신**이라
   회수 대상도 아니다 — 이 프로세스가 사는 동안 큐를 다시 열 수 없다. */
const failReadOnce = () => {
  const control = { fail: true };
  return {
    control,
    impl: {
      ...fs,
      async readFile(p, enc) {
        if (control.fail && String(p).endsWith(".lock")) {
          control.fail = false;
          const err = new Error("injected EIO");
          err.code = "EIO";
          throw err;
        }
        return fs.readFile(p, enc);
      },
    },
  };
};

test("a transient read failure during release is reported, not latched", async () => {
  const lockPath = await freshLock("transient");
  const { impl } = failReadOnce();
  const held = await acquireQueueLock(lockPath, { fsImpl: impl });

  await assert.rejects(() => held.release(), /EIO/, "the failure must surface");

  // 잠금은 아직 우리 것이다 — 재시도가 실제로 **파일을 지워야** 한다.
  // "다시 잡을 수 있다"로는 부족하다: 흘린 잠금 회수 경로가 그것을 가려서,
  // 재시도가 아무 일도 안 해도 통과해버린다.
  await held.release();
  await assert.rejects(
    () => fs.access(lockPath),
    /ENOENT/,
    "a successful retry must actually remove the lock file"
  );
});

/* 소유 확인과 unlink 사이에 await가 있다. 동시에 부른 두 해제가 모두 "우리
   것"을 보고 나면, 늦게 깨어난 쪽은 그 사이 남이 새로 잡은 잠금 파일을 지운다.
   해제는 몇 번을 겹쳐 불러도 unlink를 한 번만 해야 한다. */
test("concurrent releases perform exactly one unlink", async () => {
  const lockPath = await freshLock("concurrent");
  let unlinks = 0;
  const spy = {
    ...fs,
    async unlink(p) {
      if (String(p) === lockPath) unlinks += 1;
      return fs.unlink(p);
    },
  };

  const held = await acquireQueueLock(lockPath, { fsImpl: spy });
  await Promise.all([held.release(), held.release(), held.release()]);

  assert.equal(unlinks, 1, "overlapping releases must collapse into one");
  await assert.rejects(() => fs.access(lockPath), /ENOENT/);
});

test("a lock stranded by this process can be reclaimed by it", async () => {
  const lockPath = await freshLock("stranded");
  await fs.writeFile(
    lockPath,
    JSON.stringify({
      pid: process.pid, // 우리 pid지만 우리가 들고 있는 토큰이 아니다
      hostname: os.hostname(),
      token: "a-token-nobody-holds",
      startedAt: Date.now(),
    }),
    "utf8"
  );

  const lock = await acquireQueueLock(lockPath);
  await lock.release();
});

test("a live holder's lock is not stolen", async () => {
  const lockPath = await freshLock("live");
  const held = await acquireQueueLock(lockPath);
  await assert.rejects(() => acquireQueueLock(lockPath), /in use/i);
  await held.release();
});
