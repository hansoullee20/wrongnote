import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

import { createQueueStore } from "../src/queueStore.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const storeModule = path.join(here, "..", "src", "queueStore.js");

let tmpRoot;
const freshFile = async (name) => {
  tmpRoot ??= await fs.mkdtemp(path.join(os.tmpdir(), "wrongnote-queue-"));
  return path.join(tmpRoot, `${name}-${Math.random().toString(16).slice(2)}.json`);
};

const ANALYSIS = {
  version: 1,
  locale: "ko",
  question: { problem: "3번", plainText: "문제", latex: "", correctAnswer: "4" },
  analysis: { topicMain: "수II·미분", cause: "실행 실수" },
};

/* 1 — 프로세스가 갑자기 죽어도 넣은 분석은 살아 있어야 한다.
   in-memory 큐였다면 여기서 사라진다. 사용자가 Claude에게 시킨 작업이
   재부팅 한 번에 증발하는 것이 durable 큐를 고른 이유다. */
test("SIGKILL after enqueue: the analysis survives", async () => {
  const file = await freshFile("kill");
  const child = spawn(process.execPath, [
    "-e",
    `import(${JSON.stringify(storeModule)}).then(async (m) => {
       const q = await m.createQueueStore({ file: ${JSON.stringify(file)} });
       await q.submit(${JSON.stringify(ANALYSIS)});
       console.log("enqueued");
       setInterval(() => {}, 1000);
     })`,
  ]);

  await new Promise((resolve, reject) => {
    child.stdout.on("data", (d) => String(d).includes("enqueued") && resolve());
    child.on("error", reject);
    child.on("exit", (code) => reject(new Error(`child exited early: ${code}`)));
  });
  child.kill("SIGKILL");

  const store = await createQueueStore({ file });
  const items = await store.list();
  assert.equal(items.length, 1);
  assert.equal(items[0].state, "waiting");
  assert.deepEqual(items[0].payload, ANALYSIS);
});

/* 2 — 탭이 둘이어도 한 항목은 한 명만 들고 있다. */
test("two claimers: at most one holds a live lease", async () => {
  const store = await createQueueStore({ file: await freshFile("two") });
  await store.submit(ANALYSIS);

  const a = await store.claim("tab-a");
  const b = await store.claim("tab-b");

  assert.ok(a, "first claimer gets the item");
  assert.equal(b, null, "second claimer gets nothing while the lease is live");

  const leased = (await store.list()).filter((i) => i.state === "leased");
  assert.equal(leased.length, 1);
  assert.equal(leased[0].leaseOwner, "tab-a");
});

/* 3 — 들고 있던 탭이 죽으면 명시적 release가 올 수 없다. 리스 만료만이
   항목을 되찾는 경로다. */
test("expired lease returns the item to waiting", async () => {
  let clock = 1_000_000;
  const store = await createQueueStore({
    file: await freshFile("lease"),
    leaseMs: 60_000,
    now: () => clock,
  });
  await store.submit(ANALYSIS);

  const first = await store.claim("dying-tab");
  assert.ok(first);
  assert.equal(await store.claim("other-tab"), null);

  clock += 60_001; // 탭이 죽은 채 리스가 만료됐다

  const second = await store.claim("other-tab");
  assert.ok(second, "the item comes back after the lease expires");
  assert.deepEqual(second.payload, ANALYSIS);
  assert.notEqual(second.receipt, first.receipt, "a new lease means a new receipt");
});

/* 4 — 저장까지 끝난 분석은 두 번 다시 배달되지 않는다. 호스트가 같은 것을
   재전송해도 마찬가지다. */
test("an accepted item never reappears, even on resubmit", async () => {
  const store = await createQueueStore({ file: await freshFile("accepted") });
  await store.submit(ANALYSIS);

  const claimed = await store.claim("tab");
  assert.equal(await store.settle("tab", claimed.receipt, "accepted"), "settled");

  assert.equal(await store.claim("tab"), null);

  const again = await store.submit(ANALYSIS);
  assert.equal(again.duplicate, true);
  assert.equal(again.state, "accepted");
  assert.equal(await store.claim("tab"), null, "resubmit must not resurrect it");
});

/* 5 — 거부된 항목이 큐 머리에 남으면 뒤에 온 정상 분석이 영원히 못 나온다.
   폴링마다 같은 오류만 반복된다. */
test("a rejected item never blocks the queue head", async () => {
  const store = await createQueueStore({ file: await freshFile("head") });
  const bad = { ...ANALYSIS, question: { problem: "BAD" } };
  const good = { ...ANALYSIS, question: { problem: "GOOD" } };
  await store.submit(bad);
  await store.submit(good);

  const first = await store.claim("tab");
  assert.equal(first.payload.question.problem, "BAD");
  await store.settle("tab", first.receipt, "rejected", { error: "unsupported AI analysis file" });

  const second = await store.claim("tab");
  assert.ok(second, "the next analysis is reachable");
  assert.equal(second.payload.question.problem, "GOOD");
});

/* 6 — 왜 실패했는지가 유일하게 남는 곳이다. 재시작에서 날아가면 진단이 끝난다. */
test("rejected payload, error and timestamp survive a restart", async () => {
  const file = await freshFile("dead");
  const store = await createQueueStore({ file });
  await store.submit(ANALYSIS);
  const claimed = await store.claim("tab");
  await store.settle("tab", claimed.receipt, "rejected", { error: "boom" });

  const reopened = await createQueueStore({ file });
  const dead = await reopened.listRejected();
  assert.equal(dead.length, 1);
  assert.deepEqual(dead[0].payload, ANALYSIS);
  assert.equal(dead[0].error, "boom");
  assert.equal(typeof dead[0].rejectedAt, "number");
  assert.equal((await reopened.list()).length, 0, "it is not in the active queue");
});

/* 7 — 되살리기는 정확히 한 번이어야 한다. 두 번 먹히면 같은 분석이 두 벌
   생긴다. */
test("requeue moves rejected back to waiting exactly once", async () => {
  const store = await createQueueStore({ file: await freshFile("requeue") });
  await store.submit(ANALYSIS);
  const claimed = await store.claim("tab");
  await store.settle("tab", claimed.receipt, "rejected", { error: "bad" });

  const [dead] = await store.listRejected();
  assert.equal(await store.requeue(dead.id), "requeued");
  assert.equal(await store.requeue(dead.id), "gone", "second requeue is a no-op");

  const items = await store.list();
  assert.equal(items.length, 1);
  assert.equal(items[0].state, "waiting");
  assert.equal((await store.listRejected()).length, 0);
});

/* 8a — 못 읽는 파일을 빈 상태로 덮어쓰면 그 안의 분석이 전부 사라진다.
   시작을 실패시키고 파일은 손대지 않는다. */
test("a malformed queue file fails startup and is left byte-identical", async () => {
  const file = await freshFile("corrupt");
  const garbage = '{"version":1,"items":[ this is not json';
  await fs.writeFile(file, garbage, "utf8");

  await assert.rejects(() => createQueueStore({ file }), /not valid JSON/);
  assert.equal(await fs.readFile(file, "utf8"), garbage, "the file must not be rewritten");
});

/* 8a-2 — JSON으로는 읽히지만 구조가 망가진 파일. 파싱이 되니 "정상"으로
   보이고, items를 조용히 []로 갈아끼우면 그 안에 있던 분석이 전부 사라진다.
   파싱 실패보다 이쪽이 더 위험하다 — 아무도 눈치채지 못한다. */
for (const [label, bad] of [
  ["items가 배열이 아니다", { version: 1, items: { nope: true }, rejected: [] }],
  ["items가 없다", { version: 1, rejected: [] }],
  ["rejected가 배열이 아니다", { version: 1, items: [], rejected: "gone" }],
  ["rejected가 없다", { version: 1, items: [] }],
]) {
  test(`structurally corrupt queue file (${label}) fails startup instead of discarding`, async () => {
    const file = await freshFile("structure");
    const raw = JSON.stringify(bad);
    await fs.writeFile(file, raw, "utf8");

    await assert.rejects(() => createQueueStore({ file }), /queue file/);
    assert.equal(await fs.readFile(file, "utf8"), raw, "the file must not be rewritten");
  });
}

/* 8b — 쓰기 도중 죽어도 이전 내용이 통째로 남아야 한다. 임시 파일 → rename이
   원자적이므로, 남은 임시 파일은 본 파일을 건드리지 못한다. */
test("an interrupted write cannot erase previously queued items", async () => {
  const file = await freshFile("interrupted");
  const store = await createQueueStore({ file });
  await store.submit(ANALYSIS);
  const before = await fs.readFile(file, "utf8");

  // 죽은 프로세스가 남기고 간 반쯤 쓰인 임시 파일
  const dir = path.dirname(file);
  await fs.writeFile(
    path.join(dir, `.${path.basename(file)}.tmp-99999-deadbeef`),
    '{"version":1,"items":[',
    "utf8"
  );

  const reopened = await createQueueStore({ file });
  assert.equal(await fs.readFile(file, "utf8"), before, "the live file is untouched");
  const items = await reopened.list();
  assert.equal(items.length, 1);
  assert.deepEqual(items[0].payload, ANALYSIS);
});

/* 9 — rename 뒤 디렉터리 fsync. 내용만 fsync하고 rename하면 전원이 나갔을 때
   디렉터리 엔트리가 없어 rename 자체가 사라진다 — 첫 저장이었다면 파일이
   통째로 없다.

   위의 SIGKILL 테스트는 이걸 못 잡는다. 프로세스만 죽으면 페이지 캐시가
   살아 있어서 fsync가 하나도 없어도 통과한다. 진짜 전원 차단은 이 하네스로
   재현할 수 없으므로, 순서 자체를 관찰해서 고정한다. */
test("the directory is fsynced after rename, not just the file", async () => {
  const file = await freshFile("dirsync");
  const dir = path.dirname(file);
  const events = [];

  const spy = {
    ...fs,
    async open(p, flags, mode) {
      const handle = await fs.open(p, flags, mode);
      return new Proxy(handle, {
        get(target, key) {
          if (key === "sync") {
            return async () => {
              events.push({ type: "sync", path: String(p) });
              return target.sync();
            };
          }
          const value = target[key];
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
    },
    async rename(from, to) {
      const result = await fs.rename(from, to);
      events.push({ type: "rename", path: String(to) });
      return result;
    },
  };

  const store = await createQueueStore({ file, fsImpl: spy });
  await store.submit(ANALYSIS);

  const renameAt = events.findIndex((e) => e.type === "rename" && e.path === file);
  const dirSyncAt = events.findIndex((e) => e.type === "sync" && e.path === dir);

  assert.ok(renameAt >= 0, "the state file is published by rename");
  assert.ok(dirSyncAt >= 0, "the containing directory is fsynced");
  assert.ok(
    dirSyncAt > renameAt,
    "the directory fsync must come after the rename — before it, the entry it is meant to persist does not exist yet"
  );
});

/* 소유자가 아닌 쪽의 정산은 남의 리스를 끊지 못한다. */
test("settling someone else's live lease is a conflict, not a settlement", async () => {
  const store = await createQueueStore({ file: await freshFile("owner") });
  await store.submit(ANALYSIS);
  const claimed = await store.claim("tab-a");

  assert.equal(await store.settle("tab-b", claimed.receipt, "accepted"), "conflict");
  assert.equal(await store.settle("tab-a", claimed.receipt, "accepted"), "settled");
  assert.equal(await store.settle("tab-a", claimed.receipt, "accepted"), "gone");
});
