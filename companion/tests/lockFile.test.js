import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

import { acquireQueueLock } from "../src/lockFile.js";

let tmpRoot;
const freshLock = async (name) => {
  tmpRoot ??= await fs.mkdtemp(path.join(os.tmpdir(), "wrongnote-lock-"));
  return path.join(tmpRoot, `${name}-${Math.random().toString(16).slice(2)}.lock`);
};

/* 자동 회수는 삭제됐다. 확률적 탈취 알고리즘을 싣느니 시끄럽게 실패하고
   사람이 복구하는 편이 낫다 — 두 소유자가 생기면 이미 성공한 분석이
   조용히 사라지고, 아무도 그 사실을 모른다.

   그래서 이 파일의 규칙은 하나다: 잠금 파일이 있으면 잡지 않는다. */

test("an uncontested lock is acquired and can be released", async () => {
  const lockPath = await freshLock("plain");
  const lock = await acquireQueueLock(lockPath);
  await lock.release();
  const second = await acquireQueueLock(lockPath);
  await second.release();
});

test("a live holder's lock is never taken", async () => {
  const lockPath = await freshLock("live");
  const held = await acquireQueueLock(lockPath);
  await assert.rejects(() => acquireQueueLock(lockPath), /in use/i);
  await held.release();
});

test("a lock left by a dead process is NOT reclaimed automatically", async () => {
  const lockPath = await freshLock("dead");
  const dead = spawn(process.execPath, ["-e", "process.exit(0)"]);
  const deadPid = dead.pid;
  await new Promise((r) => dead.on("exit", r));

  await fs.writeFile(
    lockPath,
    JSON.stringify({ pid: deadPid, hostname: os.hostname(), startedAt: Date.now() }),
    "utf8"
  );

  /* 죽은 게 확실해 보여도 잡지 않는다. unlink → create 순서는 원자적이지
     않아서, 같은 판단을 한 두 프로세스가 서로의 잠금을 지우고 둘 다 성공한다. */
  await assert.rejects(() => acquireQueueLock(lockPath), /in use/i);
  await assert.doesNotReject(() => fs.access(lockPath), "the lock must be left alone");
});

test("the failure tells the user exactly what to do", async () => {
  const lockPath = await freshLock("guidance");
  await fs.writeFile(
    lockPath,
    JSON.stringify({ pid: 4242, hostname: "some-host", startedAt: 0 }),
    "utf8"
  );

  const err = await acquireQueueLock(lockPath).then(
    () => null,
    (e) => e
  );
  assert.ok(err, "acquisition must fail");
  const text = String(err.message);
  assert.match(text, /4242/, "names the recorded pid");
  assert.match(text, /some-host/, "names the recorded host");
  assert.ok(text.includes(lockPath), "names the lock path");
  assert.match(text, /queue file/i, "warns not to touch the queue file");
});

test("an unreadable lock also fails closed", async () => {
  const lockPath = await freshLock("garbage");
  await fs.writeFile(lockPath, "not json at all", "utf8");
  await assert.rejects(() => acquireQueueLock(lockPath), /in use/i);
  await assert.doesNotReject(() => fs.access(lockPath));
});

/* 획득 도중 실패하면 우리가 방금 만든 inode만 치운다. 남기면 아무도 못 여는
   잠금이 되고, 그건 우리가 만든 사고다. */
test("a failure while writing the lock does not leave an unopenable lock behind", async () => {
  const lockPath = await freshLock("halfwritten");
  const spy = {
    ...fs,
    async open(p, flags, mode) {
      const handle = await fs.open(p, flags, mode);
      if (String(p) !== lockPath) return handle;
      return new Proxy(handle, {
        get(target, key) {
          if (key === "writeFile") {
            return async () => {
              const err = new Error("injected ENOSPC");
              err.code = "ENOSPC";
              throw err;
            };
          }
          const value = target[key];
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
    },
  };

  await assert.rejects(() => acquireQueueLock(lockPath, { fsImpl: spy }), /ENOSPC/);
  await assert.rejects(() => fs.access(lockPath), /ENOENT/, "the half-written lock is gone");
  await assert.doesNotReject(() => acquireQueueLock(lockPath).then((l) => l.release()));
});

/* ── 해제 ─────────────────────────────────────────────────────────── */

test("a transient read failure during release is reported, not latched", async () => {
  const lockPath = await freshLock("transient");
  const control = { fail: true };
  const spy = {
    ...fs,
    async readFile(p, enc) {
      if (control.fail && String(p) === lockPath) {
        control.fail = false;
        const err = new Error("injected EIO");
        err.code = "EIO";
        throw err;
      }
      return fs.readFile(p, enc);
    },
  };

  const held = await acquireQueueLock(lockPath, { fsImpl: spy });
  await assert.rejects(() => held.release(), /EIO/);

  await held.release();
  await assert.rejects(
    () => fs.access(lockPath),
    /ENOENT/,
    "a successful retry must actually remove the lock file"
  );
});

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

test("release after a completed release is a silent no-op", async () => {
  const lockPath = await freshLock("idempotent");
  const held = await acquireQueueLock(lockPath);
  await held.release();
  await assert.doesNotReject(() => held.release());
  await assert.doesNotReject(() => held.release());
});

/* 소유권을 잃은 순간은 조용히 넘어가면 안 된다. 잠금이 사라졌거나 남의
   것으로 바뀌었다는 건 단일 소유자 불변식이 이미 깨졌다는 뜻이고,
   성공으로 보고하면 그 사실이 영영 드러나지 않는다. */
test("releasing a lock that vanished reports the ownership break", async () => {
  const lockPath = await freshLock("vanished");
  const held = await acquireQueueLock(lockPath);
  await fs.unlink(lockPath); // 밖에서 사라졌다

  await assert.rejects(() => held.release(), /ownership/i);
});

test("releasing a lock replaced by another owner reports it and leaves it alone", async () => {
  const lockPath = await freshLock("replaced");
  const held = await acquireQueueLock(lockPath);
  await fs.writeFile(
    lockPath,
    JSON.stringify({ pid: 5, hostname: "elsewhere", token: "not-ours", startedAt: 0 }),
    "utf8"
  );

  await assert.rejects(() => held.release(), /ownership/i);
  const still = JSON.parse(await fs.readFile(lockPath, "utf8"));
  assert.equal(still.token, "not-ours", "we must not delete someone else's lock");
});
