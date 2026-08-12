import crypto from "node:crypto";
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

/* 없음(null)과 못 읽음(예외)을 구분한다. 전부 null로 뭉개면 일시적 읽기 실패가
   "잠금 없음"으로 둔갑하고, 해제 쪽에서는 놓지도 못한 잠금을 놓았다고 믿는다. */
async function readHolder(lockPath, fsImpl) {
  let raw;
  try {
    raw = await fsImpl.readFile(lockPath, "utf8");
  } catch (err) {
    if (err.code === "ENOENT") return null;
    throw err;
  }
  try {
    return JSON.parse(raw);
  } catch {
    return {}; // 있긴 한데 알아볼 수 없다 — 소유자 미상이지 부재가 아니다
  }
}

/* 이 프로세스가 지금 들고 있는 토큰들. 잠금 파일의 pid가 우리 자신일 때
   "우리가 흘린 잠금"과 "우리가 지금 쓰는 잠금"을 가르는 유일한 근거다. */
const heldTokens = new Set();

/* 회수는 보수적으로. **오래돼 보인다**는 이유로는 절대 깨지 않는다 —
   느린 저장이 진행 중인 살아 있는 컴패니언을 죽이는 길이다.
   같은 호스트이고 그 pid가 확실히 죽었을 때만 회수한다. 다른 호스트의 잠금은
   (공유 파일시스템일 수 있다) 아무리 오래돼도 건드리지 않는다. */
function reclaimable(holder) {
  if (!holder || typeof holder !== "object") return false;
  if (holder.hostname !== os.hostname()) return false;
  if (!Number.isInteger(holder.pid) || holder.pid <= 0) return false;
  if (holder.pid === process.pid) {
    /* 우리 pid인데 우리가 들고 있는 토큰이 아니다 — 해제에 실패해 흘린
       잠금이다. 이걸 회수 불가로 두면 이 프로세스는 자기가 흘린 잠금 때문에
       큐를 영영 못 연다. 살아 있는 우리 잠금(토큰 보유)은 그대로 지킨다. */
    return !heldTokens.has(holder.token);
  }
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
  /* pid + hostname만으로는 소유를 식별하기에 부족하다. 같은 프로세스가 잠금을
     놓았다가 다시 잡으면 옛 핸들이 보기에도 "내 잠금"이다. 획득마다 고유한
     토큰을 박아 그 인스턴스만 자기 것을 지우게 한다. */
  const token = crypto.randomUUID();
  const write = async () => {
    const handle = await fsImpl.open(lockPath, "wx", 0o600);
    try {
      await handle.writeFile(
        JSON.stringify({
          pid: process.pid,
          hostname: os.hostname(),
          token,
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
    heldTokens.add(token);
  } catch (err) {
    if (err.code !== "EEXIST") throw err;

    const holder = await readHolder(lockPath, fsImpl);
    if (!reclaimable(holder)) throw inUse(lockPath, holder);

    /* 죽은 프로세스가 남긴 잠금. 지우고 **다시 O_EXCL로** 만든다 — 같은
       판단을 한 다른 프로세스와 경합하더라도 생성에서 한 쪽만 이긴다. */
    await fsImpl.unlink(lockPath).catch(() => {});
    try {
      await write();
      heldTokens.add(token);
    } catch (again) {
      if (again.code !== "EEXIST") throw again;
      throw inUse(lockPath, await readHolder(lockPath, fsImpl).catch(() => null));
    }
  }

  return {
    path: lockPath,
    async release() {
      /* 토큰 보유 여부가 곧 "아직 안 놓았다"이다. 별도 플래그를 먼저 세우면,
         해제가 실패했는데도 놓았다고 기록되어 재시도가 막힌다. 그 잠금의 pid는
         우리 자신이라 회수 대상도 아니어서 이 프로세스는 큐를 영영 못 연다. */
      if (!heldTokens.has(token)) return; // 이미 놓았다 — 멱등

      /* 읽기 실패는 올려보낸다. 여기서 삼키면 놓지도 못한 잠금을 놓았다고
         믿게 된다. 토큰은 그대로 두므로 재시도가 가능하다. */
      const holder = await readHolder(lockPath, fsImpl);

      if (holder === null || holder.token !== token) {
        /* 이미 사라졌거나 그 사이 남이 잡았다. 어느 쪽이든 우리가 지울 것은
           없다 — 남의 잠금을 지우면 소유자가 둘이 된다. */
        heldTokens.delete(token);
        return;
      }

      try {
        await fsImpl.unlink(lockPath);
      } catch (err) {
        if (err.code !== "ENOENT") throw err; // 토큰 유지 → 재시도 가능
      }
      heldTokens.delete(token);
    },
  };
}
