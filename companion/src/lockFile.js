import fs from "node:fs/promises";
import os from "node:os";

/* 한 큐 파일 = 한 소유 프로세스.

   이 아키텍처는 의도적으로 로컬 컴패니언 하나다. 그러니 그 불변식을 코드가
   직접 강제한다 — MCP 호스트는 흔히 자기 서버 프로세스를 띄우므로 "하나만
   뜬다"는 가정으로는 부족하다. 잠금이 없으면 두 스토어가 같은 상태를 읽고
   서로의 쓰기를 덮어써서, 이미 성공한 분석이 소리 없이 사라진다.

   O_EXCL 생성이 원자적 획득 수단이다. 두 번째 프로세스는 조용히 공유하지
   않고 시끄럽게 실패한다. */

const isAlive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    /* ESRCH = 그런 프로세스 없음. EPERM = 살아 있는데 내 것이 아님 —
       살아 있다는 뜻이므로 절대 뺏지 않는다. */
    return err.code !== "ESRCH";
  }
};

async function readHolder(lockPath, fsImpl) {
  try {
    return JSON.parse(await fsImpl.readFile(lockPath, "utf8"));
  } catch {
    return null; // 없거나 못 읽는다
  }
}

/* 회수는 보수적으로. **오래돼 보인다**는 이유로는 절대 깨지 않는다 —
   느린 저장이 진행 중인 살아 있는 컴패니언을 죽이는 길이다.
   같은 호스트이고 그 pid가 확실히 죽었을 때만 회수한다. 다른 호스트의 잠금은
   (공유 파일시스템일 수 있다) 아무리 오래돼도 건드리지 않는다. */
function reclaimable(holder) {
  if (!holder || typeof holder !== "object") return false;
  if (holder.hostname !== os.hostname()) return false;
  if (!Number.isInteger(holder.pid) || holder.pid <= 0) return false;
  if (holder.pid === process.pid) return false;
  return !isAlive(holder.pid);
}

const inUse = (lockPath, holder) =>
  new Error(
    `queue file is already in use: ${lockPath} is held by ` +
      (holder
        ? `pid ${holder.pid} on ${holder.hostname}`
        : "an unreadable lock file") +
      `. Only one companion may own a queue. If you are certain no companion is ` +
      `running, remove the lock file by hand.`
  );

export async function acquireQueueLock(lockPath, { fsImpl = fs } = {}) {
  const write = async () => {
    const handle = await fsImpl.open(lockPath, "wx", 0o600);
    try {
      await handle.writeFile(
        JSON.stringify({
          pid: process.pid,
          hostname: os.hostname(),
          startedAt: Date.now(),
        }),
        "utf8"
      );
      await handle.sync();
    } finally {
      await handle.close();
    }
  };

  try {
    await write();
  } catch (err) {
    if (err.code !== "EEXIST") throw err;

    const holder = await readHolder(lockPath, fsImpl);
    if (!reclaimable(holder)) throw inUse(lockPath, holder);

    /* 죽은 프로세스가 남긴 잠금. 지우고 **다시 O_EXCL로** 만든다 — 같은
       판단을 한 다른 프로세스와 경합하더라도 생성에서 한 쪽만 이긴다. */
    await fsImpl.unlink(lockPath).catch(() => {});
    try {
      await write();
    } catch (again) {
      if (again.code !== "EEXIST") throw again;
      throw inUse(lockPath, await readHolder(lockPath, fsImpl));
    }
  }

  return {
    path: lockPath,
    async release() {
      /* 내 잠금일 때만 지운다. 이미 회수돼 남이 들고 있으면 건드리지 않는다. */
      const holder = await readHolder(lockPath, fsImpl);
      if (holder?.pid === process.pid && holder?.hostname === os.hostname()) {
        await fsImpl.unlink(lockPath).catch(() => {});
      }
    },
  };
}
