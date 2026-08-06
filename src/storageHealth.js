/**
 * 저장소 건강 상태 — 브라우저 메타데이터만 다룬다. 노트/카드 데이터는 건드리지 않는다.
 *
 * 왜 필요한가: 이 앱은 서버가 없고 기기 한 대에만 산다. 그런데 origin 저장소가
 * 기본은 **best-effort**라, 안드로이드가 공간이 부족하면 **조용히 통째로 지운다.**
 * 쿼터 초과보다 이쪽이 실제로 데이터를 잃는 경로다 —
 * 노트 2,000건이라야 2.4MB라 쿼터에는 닿지도 않는다.
 *
 * 여기 쓰는 두 키는 `wr_state`(E-2가 만들 예정) **바깥의 최상위 메타데이터**다.
 * E-2의 envelope는 이 키들을 읽지도, 옮기지도, 지우지도 않는다 —
 * 설정 성격이라 노트/카드와 생명주기가 다르다.
 */
import { DAY_MS } from "./constants.js";
import { savePref } from "./storage.js";

const PERSIST_KEY = "wr_meta_persistence_v1";
const LAST_EXPORT_KEY = "wr_meta_last_exported_at";

/** 마지막 내보내기가 이보다 오래되면 설정에서 조용히 알린다.
    수능 대비는 매일 쌓이므로 2주는 너무 느슨하다. */
export const EXPORT_STALE_AFTER_MS = 7 * DAY_MS;

const readJSON = (key) => {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? null : JSON.parse(raw);
  } catch {
    return null;
  }
};

/**
 * 영구 저장소 요청. 자동 경로는 **딱 한 번만** 시도한다 —
 * 실행할 때마다 물으면 잔소리가 되고, 크롬은 참여도 휴리스틱으로
 * 프롬프트 없이 승인하기도 해서 반복 호출에 의미가 없다.
 *
 * @param {{force?: boolean}} opts force=true는 설정 화면의 명시적 재시도 전용
 * @returns {Promise<string>} granted|denied|unsupported|unavailable|skipped
 */
export async function requestPersistentStorage({ force = false } = {}) {
  const s = typeof navigator !== "undefined" ? navigator.storage : undefined;
  if (!s || typeof s.persist !== "function" || typeof s.persisted !== "function") {
    savePref(PERSIST_KEY, JSON.stringify({ outcome: "unsupported", checkedAt: Date.now() }));
    return "unsupported";
  }
  // 자동 경로는 이미 판정이 있으면 건너뛴다. 재시도는 사용자가 설정에서 누를 때만.
  if (!force && readJSON(PERSIST_KEY) !== null) return "skipped";

  let outcome;
  try {
    // 이미 영구면 persist()를 부르지 않는다 — 불필요한 프롬프트를 만들 이유가 없다
    outcome = (await s.persisted()) ? "granted" : (await s.persist()) ? "granted" : "denied";
  } catch {
    outcome = "unavailable";
  }
  savePref(PERSIST_KEY, JSON.stringify({ outcome, checkedAt: Date.now() }));
  return outcome;
}

/**
 * 설정 화면용 실시간 조회. 캐시된 판정이 아니라 **지금** 값을 읽는다 —
 * 크롬이 나중에 승인해줬을 수 있는데 옛 "denied"를 보여주면 거짓말이 된다.
 * 두 API는 독립적으로 실패할 수 있어 따로 판정한다.
 */
export async function readStorageHealth() {
  const s = typeof navigator !== "undefined" ? navigator.storage : undefined;
  if (!s) return { supported: false, persisted: null, usage: null, quota: null };

  const [p, e] = await Promise.allSettled([
    typeof s.persisted === "function" ? s.persisted() : Promise.reject(),
    typeof s.estimate === "function" ? s.estimate() : Promise.reject(),
  ]);

  const est = e.status === "fulfilled" && e.value ? e.value : {};
  const num = (v) => (Number.isFinite(v) ? v : null);

  return {
    supported: true,
    canRequest: typeof s.persist === "function",
    persisted: p.status === "fulfilled" ? Boolean(p.value) : null,
    usage: num(est.usage),
    quota: num(est.quota),
  };
}

export const readLastExportedAt = () => {
  const v = Number(localStorage.getItem(LAST_EXPORT_KEY));
  return Number.isFinite(v) && v > 0 ? v : null;
};

/** 내보내기가 **끝난 뒤에만** 기록한다. 실패해도 내보내기를 깨뜨리지 않는다. */
export const recordExportedAt = (now) => savePref(LAST_EXPORT_KEY, String(now));

export const isExportStale = (lastAt, now) =>
  lastAt === null || now - lastAt >= EXPORT_STALE_AFTER_MS;

/** 바이트 → 사람이 읽는 크기. 값이 없으면 빈 문자열 (없는 걸 0으로 꾸미지 않는다) */
export const fmtBytes = (b) => {
  if (!Number.isFinite(b)) return "";
  if (b < 1024) return `${b}B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)}KB`;
  return `${(b / 1024 / 1024).toFixed(1)}MB`;
};
