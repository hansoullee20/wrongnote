import { seedNotes, seedCards } from "./seed.js";
import { SCHEMA_VERSION, migrateNote, migrateCard } from "./migrate.js";
import { USER_DATA_KEY } from "./constants.js";

const NOTES_KEY = "wr_notes";
const CARDS_KEY = "wr_cards";
const LEGACY_CARDS_KEY = "gap_cards"; // v1 카드 키 — 읽기 전용으로 유지
const VERSION_KEY = "wr_schema_version";
/* 스키마를 올리기 직전 원본 스냅샷. **전이(from→to)마다** 따로 남긴다.
   출발 버전만으로 키를 만들면 안 된다: 구버전 코드가 마커를 5로 되돌린 뒤
   다시 올라올 때, 옛날에 찍힌 wr_backup_v5가 이미 있다는 이유로 정작
   필요한 새 스냅샷이 조용히 생략된다 (6→5→7 오염). 전이 키는 그 충돌
   자체가 불가능하다. 같은 전이 안에서는 **처음 찍은 것**을 지킨다. */
const backupKeyFor = (fromVersion, toVersion) =>
  `wr_backup_v${fromVersion}_to_v${toVersion}`;

/* 저장된 스키마 마커를 읽는다. 없으면 1 (버전 표기 이전 설치).
   정수 십진 문자열만 신뢰한다 — 그 밖의 쓰레기("banana", "6.5", "1e3")는
   Number()로 읽으면 NaN이나 엉뚱한 수가 되고, NaN < SCHEMA_VERSION 은
   false라서 **스냅샷이 조용히 생략된다**. 판별 불가면 1로 후퇴한다:
   가장 보수적인 해석이라 반드시 스냅샷을 시도하게 된다. */
function readStoredVersion() {
  const raw = localStorage.getItem(VERSION_KEY);
  if (raw === null) return 1;
  if (!/^[1-9]\d*$/.test(raw)) return 1;
  const n = Number(raw);
  if (Number.isSafeInteger(n)) return n;
  /* 자릿수가 안전 정수를 넘는 숫자 문자열. 1로 후퇴하면 "미래 버전"을
     "아주 오래된 버전"으로 뒤집어 읽고 마이그레이션해버린다 — 정확히
     막으려던 방향이다. 판별은 못 해도 **크다는 사실**은 확실하므로
     다운그레이드로 분류해 잠근다. */
  return Number.MAX_SAFE_INTEGER;
}

function parseArray(raw) {
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) throw new Error("not an array");
  return parsed;
}

/* 저장 실패(용량 초과 등)는 던지지 않는다. 던지면 부팅 경로에서는
   useState(loadAll) 안이라 영구 백지가 되고, 저장 이펙트 안에서는
   React가 트리를 언마운트한다. 어느 쪽이든 데이터를 구조할 화면이 사라진다.
   대신 실패를 값으로 돌려주고 호출부가 잠근다. */
function safeSet(key, value) {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

export const WRITE_ERROR_MESSAGE =
  "저장 공간이 부족하거나 브라우저 저장소에 쓸 수 없다. 원본 보호를 위해 저장을 " +
  "중단했다. 지금부터의 변경은 저장되지 않는다. 먼저 내보낸 뒤 이 사이트의 " +
  "저장공간을 정리하고 앱을 다시 열어라.";

/* 스냅샷 실패 — 원인은 용량이지만 사용자가 할 일이 다르다. 여기서는 아직
   아무것도 망가지지 않았고, 공간을 비우고 다시 열면 정상 진행된다. */
export const SNAPSHOT_ERROR_MESSAGE =
  "업그레이드 직전 백업을 만들지 못해 저장을 보류했다. 데이터는 그대로이고 " +
  "화면에도 정상으로 보인다. 먼저 내보낸 뒤 저장공간을 정리하고 앱을 다시 열어라.";

/* 다운그레이드 잠금 — 용량 문제와는 다른 사건이므로 문구를 섞으면 안 된다.
   "저장공간을 정리해라"는 지시가 여기서는 틀린 처방이다. */
export const DOWNGRADE_ERROR_MESSAGE =
  "저장된 데이터가 지금 열린 앱보다 새 버전이다. 데이터 보호를 위해 저장을 " +
  "잠갔다 — 보기와 내보내기는 된다. 앱을 새로고침해 최신 버전으로 열어라.";

/**
 * 전체 로드 + 마이그레이션. 앱 부팅 시 1회 호출.
 *
 * 실패는 두 종류이고 **절대 합치면 안 된다**:
 * - `error` (파싱 실패): 원본을 못 읽었다. 메모리의 notes/cards는 빈 배열이다.
 *   따라서 이 상태에서는 내보내기도 막아야 한다 — 안 막으면 "정상 백업"처럼
 *   보이는 빈 파일을 만들어준다. 원본은 localStorage에 그대로 있다.
 * - `writeError` (쓰기 실패): 읽기는 성공했다. 메모리 데이터는 온전하고
 *   디스크가 뒤처진다. 내보내기가 유일한 구조 수단이므로 반드시 열어둔다.
 *
 * @returns {{notes: object[], cards: object[], error: string, writeError: string}}
 */
export function loadAll() {
  const storedVersion = readStoredVersion();
  const rawNotes = localStorage.getItem(NOTES_KEY);
  const rawCards =
    localStorage.getItem(CARDS_KEY) ?? localStorage.getItem(LEGACY_CARDS_KEY);

  /* 구버전 코드가 새 데이터를 연 상황 (Pages 롤백 등). 마커를 되돌려 쓰면
     나중에 올라올 때 백업 판정이 오염된다 — 읽기·내보내기만 열고 저장 전체를
     잠근다. 이 잠금은 이 코드부터의 다운그레이드만 막는다는 것에 주의:
     이미 배포된 과거 코드는 고칠 수 없다. 과거 코드가 남긴 오염은 아래
     전이 키가 무력화한다. */
  const isDowngrade = storedVersion > SCHEMA_VERSION;

  let error = "";
  let writeError = "";
  let notes;
  let cards;

  /* 새 설치임을 **시드를 저장하기 전에, 동기적으로** 각인한다.
     StrictMode가 useState(loadAll) 초기화를 두 번 부르는데, 1회차가 시드를
     저장해버리면 2회차는 "저장된 노트가 있다"를 보고 기존 사용자로 오판한다.
     여기서 먼저 찍어두면 2회차도 같은 결론에 도달한다. */
  // 다운그레이드 잠금 중에는 이 각인도 쓰기다 — 잠갔으면 하나도 쓰지 않는다
  if (
    !isDowngrade &&
    rawNotes === null &&
    localStorage.getItem(USER_DATA_KEY) === null
  ) {
    safeSet(USER_DATA_KEY, "0"); // 시드는 사용자 데이터가 아니다
  }

  try {
    notes = rawNotes === null ? seedNotes() : parseArray(rawNotes);
  } catch {
    error = "노트 데이터 파싱 실패 — 저장이 잠겼다. 원본은 그대로 있다.";
    notes = [];
  }

  try {
    cards = rawCards === null ? seedCards() : parseArray(rawCards);
  } catch {
    error = error || "카드 데이터 파싱 실패 — 저장이 잠겼다. 원본은 그대로 있다.";
    cards = [];
  }

  /* 앞으로 데이터 손실을 막기 위해, 파싱에 성공한 경우에만 마이그레이션한다. */
  if (!error) {
    const now = Date.now();
    notes = notes.map(migrateNote);
    cards = cards.map((c) => migrateCard(c, now));
  }

  if (isDowngrade) {
    writeError = DOWNGRADE_ERROR_MESSAGE;
  } else if (!error && storedVersion < SCHEMA_VERSION) {
    /* 전이 직전 원본을 처음 한 번만 저장한다. snapshot 자체가 실패하면
       marker/notes/cards 어느 것도 쓰지 않는다. */
    const backupKey = backupKeyFor(storedVersion, SCHEMA_VERSION);
    const alreadyBackedUp = localStorage.getItem(backupKey) !== null;
    const snapshot = JSON.stringify({
      version: storedVersion,
      notes: rawNotes,
      cards: rawCards,
    });
    if (!alreadyBackedUp && !safeSet(backupKey, snapshot)) {
      writeError = SNAPSHOT_ERROR_MESSAGE;
    }
  }

  if (!isDowngrade && !error && !writeError) {
    /* marker를 마지막에 쓴다. notes/cards 중 하나라도 못 쓰면 marker가 앞서가면
       다음 부팅이 migration을 건너뛰므로, 실패는 marker 이전에서 멈춰야 한다. */
    if (!safeSet(NOTES_KEY, JSON.stringify(notes))) {
      writeError = WRITE_ERROR_MESSAGE;
    } else if (!safeSet(CARDS_KEY, JSON.stringify(cards))) {
      writeError = WRITE_ERROR_MESSAGE;
    } else if (!safeSet(VERSION_KEY, String(SCHEMA_VERSION))) {
      writeError = WRITE_ERROR_MESSAGE;
    }
  }

  return {
    notes,
    cards,
    error,
    writeError,
    hadStoredData: rawNotes !== null,
    dataVersion: isDowngrade ? storedVersion : SCHEMA_VERSION,
  };
}

/** @returns {boolean} 저장 성공 여부. 실패해도 던지지 않는다 */
export const saveNotes = (notes) => safeSet(NOTES_KEY, JSON.stringify(notes));
/** @returns {boolean} 저장 성공 여부. 실패해도 던지지 않는다 */
export const saveCards = (cards) => safeSet(CARDS_KEY, JSON.stringify(cards));
/** 설정(테마·팔레트)용 안전 쓰기 — 꽉 찬 저장소에서 토글이 앱을 죽이면 안 된다 */
export const savePref = (key, value) => safeSet(key, value);

/**
 * AI queue의 accepted/replay dedupe는 React 메모리 상태가 아니라 이 함수가
 * 읽은 **현재 영속 bytes**를 증거로 삼는다. 파싱 실패/키 없음/잘못된 id는
 * 전부 false로 fail-closed 한다.
 */
export function hasPersistedAiEvent(eventId) {
  if (typeof eventId !== "string" || eventId.length === 0) return false;
  try {
    const raw = localStorage.getItem(NOTES_KEY);
    if (raw === null) return false;
    return parseArray(raw).some((note) => note && note.aiEventId === eventId);
  } catch {
    return false;
  }
}

/** 백업 내보내기용 버전 포함 봉투 */
export function exportEnvelope(notes, cards, version = SCHEMA_VERSION) {
  return { version, notes, cards };
}

/**
 * 가져오기: v1 백업({notes,cards})과 v2 백업({version,notes,cards}) 모두
 * 마이그레이션을 거쳐 현재 스키마로 올린다.
 * @throws 형태가 다르면 Error
 */
export function importEnvelope(parsed) {
  if (!parsed || !Array.isArray(parsed.notes) || !Array.isArray(parsed.cards)) {
    throw new Error("invalid shape");
  }
  /* 봉투 버전은 지금까지 **쓰이지 않았다** — 내보낼 때 적고 읽을 때 무시했다.
     지금은 필드가 전부 spread로 보존돼 우연히 무해하지만, 미래 스키마 파일을
     구버전 코드가 받아들이면 그 파일의 뜻을 모른 채 현재 스키마로 다시 써서
     되돌릴 수 없게 만든다. 버전이 있으면 검증하고, 없으면(레거시 v1 백업)
     예전처럼 받아준다. */
  if (parsed.version !== undefined) {
    const v = parsed.version;
    if (!Number.isSafeInteger(v) || v < 1 || v > SCHEMA_VERSION) {
      throw new Error("unsupported version");
    }
  }
  const now = Date.now();
  return {
    notes: parsed.notes.map(migrateNote),
    cards: parsed.cards.map((c) => migrateCard(c, now)),
  };
}

export function downloadJSON(filename, dataObj) {
  const blob = new Blob([JSON.stringify(dataObj, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
