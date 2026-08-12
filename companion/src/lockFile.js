import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";

/* 한 큐 파일 = 한 소유 프로세스. 그 불변식을 코드가 강제한다 — MCP 호스트는
   흔히 자기 서버 프로세스를 띄우므로 "하나만 뜬다"는 가정으로는 부족하다.

   규칙은 하나뿐이다: **잠금 파일이 있으면 잡지 않는다.**

   자동 회수(죽은 pid로 판단해 뺏기)는 의도적으로 없다. unlink → O_EXCL create는
   원자적이지 않아서, 같은 죽은 소유자를 본 두 프로세스가 서로의 새 잠금을 지우고
   둘 다 성공한다. 그러면 각자 오래된 스냅샷 위에서 쓰기를 하고, 이미 성공한
   분석이 조용히 사라진다 — 잠금이 막으려던 바로 그 사고다.

   원자적 탈취를 흉내 내느니 시끄럽게 실패하고 사람이 복구한다. 자동 크래시
   복구가 필요해지면 그때 OS 기반 advisory lock으로 간다. 확률적 회수
   알고리즘은 싣지 않는다. */

/* 이 프로세스가 지금 들고 있는 토큰들. 해제가 자기 획득분만 지우게 하는
   근거이고, 실패한 해제를 재시도 가능하게 남기는 자리이기도 하다. */
const heldTokens = new Set();

async function readHolder(lockPath, fsImpl) {
  let raw;
  try {
    raw = await fsImpl.readFile(lockPath, "utf8");
  } catch (err) {
    if (err.code === "ENOENT") return null;
    throw err; // 일시적 읽기 실패를 "없음"으로 뭉개면 놓지도 못한 잠금을 놓았다고 믿는다
  }
  try {
    return JSON.parse(raw);
  } catch {
    return {}; // 있긴 한데 알아볼 수 없다 — 부재가 아니다
  }
}

const inUse = (lockPath, holder) =>
  new Error(
    `queue file is already in use.\n` +
      `  lock: ${lockPath}\n` +
      `  held by: ${
        holder && holder.pid
          ? `pid ${holder.pid} on ${holder.hostname ?? "an unrecorded host"}`
          : "an unreadable lock file"
      }\n` +
      `Only one companion may own a queue, and this lock is never broken\n` +
      `automatically. If you are certain no companion is running, confirm that\n` +
      `process is stopped and then delete the lock file above — and only that\n` +
      `file. Do not touch the queue file itself; your queued analyses are in it.`
  );

export async function acquireQueueLock(lockPath, { fsImpl = fs } = {}) {
  const token = crypto.randomUUID();

  let handle;
  try {
    handle = await fsImpl.open(lockPath, "wx", 0o600);
  } catch (err) {
    if (err.code !== "EEXIST") throw err;
    /* 있으면 끝이다. 내용을 읽는 건 사람에게 알려주기 위해서일 뿐,
       뺏을지 말지를 판단하기 위해서가 아니다. */
    throw inUse(lockPath, await readHolder(lockPath, fsImpl).catch(() => null));
  }

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
  } catch (err) {
    /* 이 inode는 방금 이 호출이 만들었다. 그러니 치우는 게 안전하다 — 남겨두면
       아무도 열 수 없는 반쪽짜리 잠금이 되고, 그건 우리가 만든 사고다. */
    await handle.close().catch(() => {});
    await fsImpl.unlink(lockPath).catch(() => {});
    throw err;
  }
  await handle.close();

  heldTokens.add(token);

  /* 겹쳐 부른 해제는 하나로 합친다. 소유 확인과 unlink 사이에 await가 있어,
     각자 진행하면 늦게 깨어난 쪽이 그 사이 생긴 잠금을 지운다. */
  let inFlight = null;

  const doRelease = async () => {
    const holder = await readHolder(lockPath, fsImpl);

    if (holder === null || holder.token !== token) {
      /* 우리 잠금이 사라졌거나 남의 것으로 바뀌었다. 단일 소유자 불변식은
         이미 이 시점 이전에 깨졌다. 성공으로 보고하면 그 사실이 영영
         드러나지 않는다 — 남의 잠금은 건드리지 않고, 시끄럽게 알린다. */
      heldTokens.delete(token);
      throw new Error(
        `lock ownership was lost before release: ${lockPath} ` +
          `${holder === null ? "no longer exists" : "is now held by someone else"}. ` +
          `Another process may have been writing this queue.`
      );
    }

    try {
      await fsImpl.unlink(lockPath);
    } catch (err) {
      if (err.code !== "ENOENT") throw err; // 토큰 유지 → 재시도 가능
    }
    heldTokens.delete(token);
  };

  return {
    path: lockPath,
    release() {
      if (!heldTokens.has(token)) return Promise.resolve(); // 이미 놓았다 — 멱등
      if (inFlight) return inFlight;
      inFlight = doRelease().finally(() => {
        inFlight = null;
      });
      return inFlight;
    },
  };
}
