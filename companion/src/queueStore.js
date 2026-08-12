import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { acquireQueueLock } from "./lockFile.js";
import {
  QUEUE_FORMAT_VERSION,
  LEASE_MS,
  TOMBSTONE_MS,
  MAX_ACTIVE_ITEMS,
  MAX_PAYLOAD_BYTES,
} from "./config.js";

/* 불변식: 조용한 소실 없음 / 살아 있는 소비자는 최대 하나 / accepted는 앱이
   노트를 **durable하게 저장한 뒤에만** / 재배달은 탐지 가능하고 멱등하다.

   "정확히 한 번"은 이 큐 혼자 보장할 수 없다. 앱이 저장을 마친 뒤 ACK가
   유실되면 재배달은 정당하다. 큐의 몫은 그것을 탐지 가능하게 만드는 것이고,
   무해하게 만드는 것은 앱의 몫이다 — 저장된 노트에 분석 신원을 함께 남겨야
   한다 (커밋 5).

   한 분석은 여전히 세 상태 중 하나로 끝난다: waiting / accepted / rejected.

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
  validateRecords(parsed, file);
  return {
    version: QUEUE_FORMAT_VERSION,
    items: parsed.items,
    rejected: parsed.rejected,
  };
}

const isText = (v) => typeof v === "string" && v.length > 0;
const isNum = (v) => typeof v === "number" && Number.isFinite(v);

/* 배열인지만 보고 안에 든 레코드를 안 보면, 멀쩡히 시작한 뒤 특정 항목이
   영원히 청구 불가가 되거나(state를 모름), 큐 머리를 막거나(payload 없음),
   죽은 소유자의 항목이 영영 안 돌아온다(leaseExpiresAt이 숫자가 아님).
   조용히 잘못 도는 것이 시끄럽게 실패하는 것보다 나쁘다. */
function validateRecords(parsed, file) {
  const fail = (what) => {
    throw new Error(
      `queue file is structurally invalid: ${what} in ${file} (left untouched — inspect it by hand)`
    );
  };
  const ids = new Set();
  const receipts = new Set();
  const takeId = (id, where) => {
    if (!isText(id)) fail(`${where}.id is missing or not a string`);
    if (ids.has(id)) fail(`duplicate id "${id}" (${where})`);
    ids.add(id);
  };
  const takeReceipt = (receipt, where) => {
    if (!isText(receipt)) return;
    if (receipts.has(receipt)) fail(`duplicate receipt (${where})`);
    receipts.add(receipt);
  };

  parsed.items.forEach((item, i) => {
    const where = `items[${i}]`;
    if (!item || typeof item !== "object" || Array.isArray(item)) fail(`${where} is not an object`);
    takeId(item.id, where);
    if (!isText(item.fingerprint)) fail(`${where}.fingerprint is missing or not a string`);
    if (!isNum(item.createdAt)) fail(`${where}.createdAt is not a number`);
    if (!["waiting", "leased", "accepted"].includes(item.state)) {
      fail(`${where}.state is ${item.state === undefined ? "missing" : `unknown ("${item.state}")`}`);
    }
    if (item.state === "accepted") {
      if (!isNum(item.settledAt)) fail(`${where}.settledAt is not a number`);
    } else if (item.payload === undefined || item.payload === null) {
      fail(`${where}.payload is missing but the item is ${item.state}`);
    }
    if (item.state === "leased") {
      if (!isText(item.leaseOwner)) fail(`${where}.leaseOwner is missing`);
      if (!isText(item.leaseReceipt)) fail(`${where}.leaseReceipt is missing`);
      if (!isNum(item.leaseExpiresAt)) fail(`${where}.leaseExpiresAt is not a number`);
    }
    takeReceipt(item.leaseReceipt, where);
    takeReceipt(item.expiredReceipt, where);
  });

  parsed.rejected.forEach((rec, i) => {
    const where = `rejected[${i}]`;
    if (!rec || typeof rec !== "object" || Array.isArray(rec)) fail(`${where} is not an object`);
    takeId(rec.id, where);
    if (rec.payload === undefined || rec.payload === null) fail(`${where}.payload is missing`);
    if (!isText(rec.fingerprint)) fail(`${where}.fingerprint is missing or not a string`);
    if (!isNum(rec.createdAt)) fail(`${where}.createdAt is not a number`);
    if (!isNum(rec.rejectedAt)) fail(`${where}.rejectedAt is not a number`);
    if (typeof rec.error !== "string") fail(`${where}.error is not a string`);
  });
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

  /* 여기가 커밋 지점이다. rename이 성공한 순간 변경은 이미 파일시스템에 있다.
     이 뒤의 실패는 "일어나지 않았다"가 아니라 "일어났지만 내구성이 의심스럽다"이다.
     호출자에게는 올려보내되, 되돌리면 안 된다 — 되돌리면 살아 있는 상태와
     디스크가 갈라지고, 실패했다고 보고한 변경이 재시작 후 되살아난다. */
  const applied = (err) => Object.assign(err, { appliedToDisk: true });

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
    if (!UNSUPPORTED_DIR_FSYNC.has(err.code)) throw applied(err);
    return; // Windows: 디렉터리를 읽기로 열 수 없다 — 플랫폼 속성이다
  }
  try {
    await dirHandle.sync();
  } catch (err) {
    /* EINVAL/ENOTSUP는 "이 파일시스템은 디렉터리 fsync를 지원하지 않는다"는
       뜻이다. EIO·ENOSPC는 그렇지 않다 — 그건 진짜 실패고 올려보내야 한다. */
    if (!UNSUPPORTED_DIR_FSYNC.has(err.code)) throw applied(err);
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

  /* 잠금은 readState **이전**에 잡는다. 먼저 읽고 나중에 잠그면, 그 사이에
     다른 프로세스가 쓴 내용을 못 본 채로 소유권만 얻는다. */
  await fsImpl.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const lock = await acquireQueueLock(`${file}.lock`, { fsImpl });
  let state;
  try {
    state = await readState(file, fsImpl);
  } catch (err) {
    await lock.release();
    throw err;
  }

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
        /* rename 이후 실패는 이미 디스크에 반영됐다. 후보를 유지해야 살아 있는
           상태와 파일이 같은 이야기를 한다. 오류는 그대로 올려보낸다 —
           내구성이 의심스럽다는 사실 자체는 삼키지 않는다. */
        if (!err?.appliedToDisk) state = previous;
        throw err;
      }
    });

  let closed = false;
  let releaseDone = false;
  const alive = () => {
    /* 닫힌 뒤에도 동작하면 잠금 없이 파일을 쓴다 — A가 막으려던 상태 그대로다. */
    if (closed) throw new Error("queue store is closed");
  };

  /* 읽기도 같은 줄에 세운다. 그래야 진행 중인 변경의 후보 상태가 아니라
     확정된 상태를 본다. */
  const read = (fn) => enqueue(async () => fn());

  /* 만료된 리스는 waiting으로 되돌린다. 브라우저 탭이 죽으면 이 경로로만
     항목이 돌아온다 — 명시적 release는 죽은 탭이 보낼 수 없다. */
  function expireLeases() {
    const t = now();
    for (const item of state.items) {
      if (item.state === "leased" && item.leaseExpiresAt <= t) {
        /* 영수증을 지우지 않고 옆으로 옮긴다. 앱이 노트를 저장한 직후 리스가
           만료되는 경우, 아무도 새로 가져가지 않았다면 그 늦은 정산은
           받아들여야 한다 — 아니면 이미 저장된 분석이 다시 배달된다. */
        item.state = "waiting";
        item.expiredReceipt = item.leaseReceipt;
        item.expiredOwner = item.leaseOwner;
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
      alive();
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
      alive();
      if (typeof consumerId !== "string" || consumerId.length === 0) {
        /* 호출자 소유 객체를 상태에 넣으면, 나중에 그 객체가 순환 참조가 되는
           것만으로 쓰기 없이 스토어가 망가진다. 문자열만 받는다. */
        throw new Error("claim requires a non-empty string consumerId");
      }
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
          /* 새 소유자가 생기면 만료된 영수증은 더 이상 이 항목을 대변하지
             못한다. 늦은 정산은 이 시점부터 "gone"이 되어야 한다. */
          target.expiredReceipt = null;
          target.expiredOwner = null;
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
      alive();
      if (!["accepted", "rejected", "released"].includes(outcome)) {
        throw new Error(`unknown outcome: ${outcome}`);
      }
      return mutate(() => {
        expireLeases();

        let item = state.items.find(
          (i) => i.state === "leased" && i.leaseReceipt === receipt
        );
        let owner = item?.leaseOwner;

        if (!item) {
          /* 리스는 만료됐지만 아직 아무도 가져가지 않은 항목. 앱은 이미 저장을
             마쳤을 수 있으므로 이 정산을 버리면 중복 배달이 된다. */
          item = state.items.find(
            (i) => i.state === "waiting" && i.expiredReceipt === receipt
          );
          owner = item?.expiredOwner;
        }
        if (!item) return "gone";
        if (owner !== consumerId) return "conflict";

        if (outcome === "released") {
          item.state = "waiting";
          item.leaseOwner = null;
          item.leaseReceipt = null;
          item.leaseExpiresAt = null;
          item.expiredReceipt = null;
          item.expiredOwner = null;
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
          item.expiredReceipt = null;
          item.expiredOwner = null;
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

    /* 거부 이력은 지우지 않는다. 왜 실패했는지가 유일하게 남아 있는 곳이고,
       사용자가 요청한 분석의 마지막 흔적이다. 재시도는 그 레코드를 없애는
       것이 아니라 **연결된 새 항목**을 만드는 일이다.

       레코드당 한 번만 되살린다. 무한히 돌 수 있으면 같은 분석이 몇 벌이든
       생기고, 이미 재시도가 도는 중에 또 부르면 사본이 둘이 된다. 다시 거부되면
       그때 새 레코드가 쌓이므로 이력은 끊기지 않는다. */
    async requeue(id) {
      alive();
      return mutate(() => {
        const dead = state.rejected.find((r) => r.id === id);
        if (!dead) return "gone";
        if (dead.requeuedAt) return "gone";

        const retry = {
          id: randomId(),
          payload: clone(dead.payload),
          fingerprint: dead.fingerprint,
          createdAt: dead.createdAt,
          state: "waiting",
          leaseOwner: null,
          leaseReceipt: null,
          leaseExpiresAt: null,
          expiredReceipt: null,
          expiredOwner: null,
          settledAt: null,
          originRejectionId: dead.id,
        };
        state.items.push(retry);
        dead.requeuedAt = now();
        dead.retryItemId = retry.id;
        return "requeued";
      });
    },

    async listRejected() {
      alive();
      return read(() => clone(state.rejected));
    },

    async list() {
      alive();
      return read(() => clone(state.items));
    },

    /* 잠금은 프로세스 수명 동안 유지된다. 닫을 때만 놓는다. */
    /* 잠금은 프로세스 수명 동안 유지된다. 닫을 때만 놓는다.
       해제가 실패하면 오류를 올려보내고 잠금은 계속 우리 것이다 — close()를
       다시 부르면 재시도된다. 스토어 자체는 이미 못 쓰는 상태다. */
    async close() {
      if (releaseDone) return; // 멱등
      closed = true;
      await chain.catch(() => {});
      await lock.release();
      releaseDone = true;
    },
  };
}
