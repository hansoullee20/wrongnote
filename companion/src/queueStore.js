import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import {
  QUEUE_FORMAT_VERSION,
  LEASE_MS,
  TOMBSTONE_MS,
  MAX_ACTIVE_ITEMS,
  MAX_PAYLOAD_BYTES,
} from "./config.js";

/* 한 분석은 반드시 세 상태 중 하나로 끝난다: waiting / accepted / rejected.
   조용히 사라지는 경로가 있으면 그건 결함이다 (.reviews/mcp-plan-merged.md §1).

   - waiting  : 아직 아무도 못 가져갔거나, 가져갔다가 놓아준 것
   - leased   : 한 소비자가 들고 있다 (waiting의 하위 상태 — 리스가 끝나면 돌아온다)
   - accepted : 앱이 **저장까지** 마쳤다. 묘비만 남긴다 (중복 판정용)
   - rejected : 배달은 됐지만 parseAiImport가 거부했다. dead-letter로 옮겨
                무기한 보존한다. 다시 안 물리고, 사라지지도 않는다.

   accepted 정산은 초안 초기화가 아니라 **저장** 시점이다. 초기화에서 정산하면
   폼을 닫기만 해도 분석이 증발한다 — 위 불변식 위반이다. */

const clone = (v) => JSON.parse(JSON.stringify(v));

/* 키 순서가 달라도 같은 분석이면 같은 지문이어야 한다. 배열 순서는 의미가
   있으므로 보존한다 (개념 목록의 순서는 데이터다). */
function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.keys(value)
      .sort()
      .reduce((acc, k) => {
        acc[k] = canonicalize(value[k]);
        return acc;
      }, {});
  }
  return value;
}

const fingerprintOf = (payload) =>
  crypto.createHash("sha256").update(JSON.stringify(canonicalize(payload))).digest("hex");

const randomId = () => crypto.randomBytes(12).toString("hex");

/* 디렉터리 fsync를 **구조적으로** 못 하는 경우들. Windows는 디렉터리를 읽기로
   열지 못하고(EISDIR/EPERM/EACCES), 일부 파일시스템은 디렉터리 fsync 자체를
   거부한다(EINVAL/ENOTSUP). EIO·ENOSPC는 여기 없다 — 그건 한계가 아니라 사고다. */
const UNSUPPORTED_DIR_FSYNC = new Set([
  "EISDIR",
  "EPERM",
  "EACCES",
  "EINVAL",
  "ENOTSUP",
  "EOPNOTSUPP",
]);

const emptyState = () => ({
  version: QUEUE_FORMAT_VERSION,
  items: [],
  rejected: [],
});

async function readState(file, fsImpl) {
  let raw;
  try {
    raw = await fsImpl.readFile(file, "utf8");
  } catch (err) {
    if (err.code === "ENOENT") return emptyState();
    throw err;
  }

  /* 못 읽는 파일을 빈 상태로 덮어쓰면 그 안에 있던 분석이 전부 사라진다.
     읽기 실패는 시작 실패로 끝낸다 — 파일은 그대로 두고 사람이 본다. */
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(
      `queue file is not valid JSON: ${file} (left untouched — inspect it by hand)`
    );
  }
  if (!parsed || parsed.version !== QUEUE_FORMAT_VERSION) {
    throw new Error(
      `queue file has unsupported version ${parsed?.version} (expected ${QUEUE_FORMAT_VERSION}): ${file}`
    );
  }
  /* JSON으로 읽힌다고 멀쩡한 파일이 아니다. items가 배열이 아닐 때 조용히
     []로 갈아끼우면 그 안에 있던 분석이 전부 사라지고 시작은 성공한다 —
     파싱 실패보다 나쁘다. 아무도 눈치채지 못하기 때문이다.
     빠진 키도 똑같이 거부한다. 이 포맷은 항상 두 배열을 함께 쓴다. */
  for (const key of ["items", "rejected"]) {
    if (!Array.isArray(parsed[key])) {
      throw new Error(
        `queue file is structurally invalid: "${key}" is ${
          key in parsed ? `not an array (${typeof parsed[key]})` : "missing"
        } in ${file} (left untouched — inspect it by hand)`
      );
    }
  }
  return {
    version: QUEUE_FORMAT_VERSION,
    items: parsed.items,
    rejected: parsed.rejected,
  };
}

/* 같은 디렉터리 임시 파일 → fsync → rename. rename은 원자적이라 중간에
   죽어도 이전 파일이 통째로 남는다. 부분 기록된 파일이 보이는 창이 없다. */
async function writeStateAtomic(file, state, fsImpl) {
  const dir = path.dirname(file);
  await fsImpl.mkdir(dir, { recursive: true, mode: 0o700 });
  const tmp = path.join(dir, `.${path.basename(file)}.tmp-${process.pid}-${randomId()}`);
  const handle = await fsImpl.open(tmp, "w", 0o600);
  try {
    await handle.writeFile(JSON.stringify(state, null, 2), "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  await fsImpl.rename(tmp, file);

  /* rename만으로는 전원이 나갔을 때 살아남는다는 보장이 없다. 파일 내용은
     fsync했지만 **디렉터리 엔트리**는 아직 디스크에 없을 수 있고, 그러면
     rename 자체가 통째로 사라진다 — 첫 저장이었다면 파일이 아예 없다.
     디렉터리를 열어 fsync해야 "넣은 분석은 남는다"가 참이 된다.

     프로세스만 죽는 경우(SIGKILL)는 페이지 캐시가 살아 있어 이게 없어도
     통과한다. 즉 SIGKILL 테스트는 이 결함을 잡지 못한다. */
  /* 여기서 모든 오류를 삼키면 안 된다. "이 플랫폼은 디렉터리 fsync를 못 한다"와
     "fsync가 실패했다"는 전혀 다른 사건이다. 후자를 삼키면 디스크에 닿지 못한
     쓰기가 성공한 durable write로 보고된다 — 큐가 막으려던 바로 그 조용한
     소실이다. 플랫폼 한계만 좁게 봐준다. */
  let dirHandle;
  try {
    dirHandle = await fsImpl.open(dir, "r");
  } catch (err) {
    if (!UNSUPPORTED_DIR_FSYNC.has(err.code)) throw err;
    return; // Windows: 디렉터리를 읽기로 열 수 없다 — 플랫폼 속성이다
  }
  try {
    await dirHandle.sync();
  } catch (err) {
    /* EINVAL/ENOTSUP는 "이 파일시스템은 디렉터리 fsync를 지원하지 않는다"는
       뜻이다. EIO·ENOSPC는 그렇지 않다 — 그건 진짜 실패고 올려보내야 한다. */
    if (!UNSUPPORTED_DIR_FSYNC.has(err.code)) throw err;
  } finally {
    /* 닫기 실패는 내구성과 무관하다 — sync는 이미 끝났다. */
    await dirHandle.close().catch(() => {});
  }
}

export async function createQueueStore({
  file,
  leaseMs = LEASE_MS,
  tombstoneMs = TOMBSTONE_MS,
  now = () => Date.now(),
  /* 테스트가 fsync/rename 순서를 관찰할 수 있도록 열어둔 이음매.
     운영 경로는 항상 node:fs/promises 그대로다. */
  fsImpl = fs,
} = {}) {
  if (!file) throw new Error("queue store requires a file path");

  let state = await readState(file, fsImpl);

  /* 모든 변경을 한 줄로 세운다. MCP 쪽 submit과 HTTP 쪽 claim이 동시에 와도
     읽고-고치고-쓰는 구간이 겹치지 않는다. 겹치면 나중에 쓴 쪽이 앞의 변경을
     통째로 되돌린다 (lost update). */
  let chain = Promise.resolve();
  const enqueue = (fn) => {
    const run = chain.then(fn);
    // 한 번 실패해도 줄이 끊기면 안 된다
    chain = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  };

  /* copy-on-write. 후보 상태를 만들어 거기에 변경을 가하고, **디스크에 앉은
     뒤에만** 그것을 현재 상태로 삼는다.

     제자리에서 고치고 나중에 저장하면, 저장이 실패했을 때 호출자에게는
     "실패"라고 알리면서 스토어는 그 변경을 계속 사실로 취급한다. 그리고 다음
     성공한 쓰기가 실패했다고 보고된 변경을 조용히 디스크에 박아 넣는다.

     가장 나쁜 경우는 accepted 정산이다: 메모리는 accepted인데 디스크는 leased면,
     프로세스가 죽은 뒤 앱이 이미 저장한 분석이 다시 배달된다 — exactly-once
     위반이다. 개별 메서드를 손보지 않고 이 지점 하나로 막는다. */
  const mutate = (fn) =>
    enqueue(async () => {
      const previous = state;
      state = clone(previous);
      try {
        const result = await fn();
        await writeStateAtomic(file, state, fsImpl);
        return result;
      } catch (err) {
        state = previous; // 후보를 통째로 버린다
        throw err;
      }
    });

  /* 읽기도 같은 줄에 세운다. 그래야 진행 중인 변경의 후보 상태가 아니라
     확정된 상태를 본다. */
  const read = (fn) => enqueue(async () => fn());

  /* 만료된 리스는 waiting으로 되돌린다. 브라우저 탭이 죽으면 이 경로로만
     항목이 돌아온다 — 명시적 release는 죽은 탭이 보낼 수 없다. */
  function expireLeases() {
    const t = now();
    for (const item of state.items) {
      if (item.state === "leased" && item.leaseExpiresAt <= t) {
        item.state = "waiting";
        item.leaseOwner = null;
        item.leaseReceipt = null;
        item.leaseExpiresAt = null;
      }
    }
  }

  function pruneTombstones() {
    const t = now();
    state.items = state.items.filter(
      (i) => i.state !== "accepted" || t - i.settledAt < tombstoneMs
    );
    /* rejected는 자르지 않는다. 사용자가 요청한 분석이고, 왜 실패했는지가
       유일하게 남아 있는 곳이다. */
  }

  function findDuplicate(fingerprint) {
    const active = state.items.find((i) => i.fingerprint === fingerprint);
    if (active) return { id: active.id, state: active.state };
    const dead = state.rejected.find((r) => r.fingerprint === fingerprint);
    /* 이미 거부된 것과 같은 내용이면 다시 큐에 넣지 않는다. 같은 페이로드는
       같은 이유로 또 거부된다. 되살리려면 requeue를 쓴다 — 그래야 "왜
       아무 일도 안 일어나지"가 아니라 "거부된 상태다"가 보인다. */
    if (dead) return { id: dead.id, state: "rejected" };
    return null;
  }

  return {
    async submit(payload) {
      const serialized = JSON.stringify(payload);
      if (serialized === undefined) throw new Error("payload is not serializable");
      if (Buffer.byteLength(serialized, "utf8") > MAX_PAYLOAD_BYTES) {
        throw new Error(`payload exceeds ${MAX_PAYLOAD_BYTES} bytes`);
      }

      return mutate(() => {
        expireLeases();
        pruneTombstones();

        const fingerprint = fingerprintOf(payload);
        const duplicate = findDuplicate(fingerprint);
        if (duplicate) {
          return { id: duplicate.id, duplicate: true, state: duplicate.state };
        }

        const active = state.items.filter((i) => i.state !== "accepted");
        if (active.length >= MAX_ACTIVE_ITEMS) {
          throw new Error(`queue is full (${MAX_ACTIVE_ITEMS} active items)`);
        }

        const item = {
          id: randomId(),
          payload: clone(payload),
          fingerprint,
          createdAt: now(),
          state: "waiting",
          leaseOwner: null,
          leaseReceipt: null,
          leaseExpiresAt: null,
          settledAt: null,
        };
        state.items.push(item);
        return { id: item.id, duplicate: false, state: "waiting" };
      });
    },

    async claim(consumerId) {
      if (!consumerId) throw new Error("claim requires a consumerId");
      return mutate(() => {
        expireLeases();

        /* 같은 소비자가 이미 들고 있는 게 있으면 그걸 그대로 돌려준다.
           새 항목을 얹어주면 한 탭이 두 개를 들고 하나를 잃어버린다. */
        const held = state.items.find(
          (i) => i.state === "leased" && i.leaseOwner === consumerId
        );
        const target =
          held || state.items.find((i) => i.state === "waiting");
        if (!target) return null;

        if (!held) {
          target.state = "leased";
          target.leaseOwner = consumerId;
          target.leaseReceipt = randomId();
        }
        target.leaseExpiresAt = now() + leaseMs;
        return {
          id: target.id,
          receipt: target.leaseReceipt,
          payload: clone(target.payload),
        };
      });
    },

    /* outcome: "accepted" | "rejected" | "released"
       반환: "settled" | "gone" | "conflict"
       - gone     : 그 영수증은 이미 끝났거나 리스가 만료돼 남에게 갔다
       - conflict : 살아 있는 리스인데 주인이 아니다 */
    async settle(consumerId, receipt, outcome, { error = "" } = {}) {
      if (!["accepted", "rejected", "released"].includes(outcome)) {
        throw new Error(`unknown outcome: ${outcome}`);
      }
      return mutate(() => {
        expireLeases();

        const item = state.items.find((i) => i.leaseReceipt === receipt);
        if (!item || item.state !== "leased") return "gone";
        if (item.leaseOwner !== consumerId) return "conflict";

        if (outcome === "released") {
          item.state = "waiting";
          item.leaseOwner = null;
          item.leaseReceipt = null;
          item.leaseExpiresAt = null;
          return "settled";
        }

        if (outcome === "accepted") {
          /* 묘비만 남긴다 — payload는 앱이 노트로 저장했으므로 여기 둘 이유가
             없다. 지문은 재전송 중복 판정에 필요하다. */
          item.state = "accepted";
          item.payload = null;
          item.leaseOwner = null;
          item.leaseReceipt = null;
          item.leaseExpiresAt = null;
          item.settledAt = now();
          return "settled";
        }

        // rejected — 큐 머리에서 치우되 버리지는 않는다
        state.items = state.items.filter((i) => i.id !== item.id);
        state.rejected.push({
          id: item.id,
          payload: item.payload,
          fingerprint: item.fingerprint,
          createdAt: item.createdAt,
          rejectedAt: now(),
          error: String(error || "").slice(0, 2000),
        });
        return "settled";
      });
    },

    async requeue(id) {
      return mutate(() => {
        const idx = state.rejected.findIndex((r) => r.id === id);
        if (idx === -1) return "gone";
        const [dead] = state.rejected.splice(idx, 1);
        state.items.push({
          id: dead.id,
          payload: dead.payload,
          fingerprint: dead.fingerprint,
          createdAt: dead.createdAt,
          state: "waiting",
          leaseOwner: null,
          leaseReceipt: null,
          leaseExpiresAt: null,
          settledAt: null,
        });
        return "requeued";
      });
    },

    async listRejected() {
      return read(() => clone(state.rejected));
    },

    async list() {
      return read(() => clone(state.items));
    },
  };
}
