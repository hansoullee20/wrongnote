import { seedNotes, seedCards } from "./seed.js";
import { SCHEMA_VERSION, migrateNote, migrateCard } from "./migrate.js";
import { USER_DATA_KEY } from "./constants.js";

const NOTES_KEY = "wr_notes";
const CARDS_KEY = "wr_cards";
const LEGACY_CARDS_KEY = "gap_cards"; // v1 카드 키 — 읽기 전용으로 유지
const VERSION_KEY = "wr_schema_version";
/* 스키마를 올리기 직전 원본 스냅샷. 버전마다 따로 남긴다 —
   키를 하나로 두면 첫 마이그레이션 때 한 번 찍고 그 뒤로는
   영영 안 찍혀서, 정작 위험한 후속 업그레이드가 무방비가 된다. */
const backupKeyFor = (version) => `wr_backup_v${version}`;

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
  const storedVersion = Number(localStorage.getItem(VERSION_KEY) || 1);
  const rawNotes = localStorage.getItem(NOTES_KEY);
  const rawCards =
    localStorage.getItem(CARDS_KEY) ?? localStorage.getItem(LEGACY_CARDS_KEY);

  // 마이그레이션 직전, 원본 문자열 그대로 스냅샷 (버전당 1회, 조용히)
  const backupKey = backupKeyFor(storedVersion);
  if (
    storedVersion < SCHEMA_VERSION &&
    (rawNotes !== null || rawCards !== null) &&
    localStorage.getItem(backupKey) === null
  ) {
    try {
      localStorage.setItem(
        backupKey,
        JSON.stringify({ savedAt: Date.now(), notes: rawNotes, cards: rawCards })
      );
    } catch {
      // 백업 실패(용량 등)해도 로드는 계속한다
    }
  }

  let error = "";
  let writeError = "";
  let notes;
  let cards;

  /* 새 설치임을 **시드를 저장하기 전에, 동기적으로** 각인한다.
     StrictMode가 useState(loadAll) 초기화를 두 번 부르는데, 1회차가 시드를
     저장해버리면 2회차는 "저장된 노트가 있다"를 보고 기존 사용자로 오판한다.
     여기서 먼저 찍어두면 2회차도 같은 결론에 도달한다. */
  if (rawNotes === null && localStorage.getItem(USER_DATA_KEY) === null) {
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

  const now = Date.now();
  notes = notes.map(migrateNote);
  cards = cards.map((c) => migrateCard(c, now));

  // 정상 로드일 때만 마이그레이션 결과를 영속화하고 버전 승격 (idempotent)
  // 순서는 notes → cards → 버전. localStorage에 트랜잭션이 없어 부분 성공이
  // 가능하지만, 버전 승격이 마지막이라 다음 부팅에서 멱등 마이그레이션을 다시 돈다.
  if (!error) {
    const ok =
      safeSet(NOTES_KEY, JSON.stringify(notes)) &&
      safeSet(CARDS_KEY, JSON.stringify(cards)) &&
      safeSet(VERSION_KEY, String(SCHEMA_VERSION));
    if (!ok) writeError = WRITE_ERROR_MESSAGE;
  }

  /* 이미 저장된 노트가 있었다 = 기존 사용자다. 시드 첫 실행과 구분해야
     사용자 데이터 플래그를 뒤늦게 채울 수 있다 (storageHealth를 여기서
     import하면 순환이 되므로 사실만 돌려주고 판단은 App이 한다). */
  return { notes, cards, error, writeError, hadStoredData: rawNotes !== null };
}

/** @returns {boolean} 저장 성공 여부. 실패해도 던지지 않는다 */
export const saveNotes = (notes) => safeSet(NOTES_KEY, JSON.stringify(notes));
/** @returns {boolean} 저장 성공 여부. 실패해도 던지지 않는다 */
export const saveCards = (cards) => safeSet(CARDS_KEY, JSON.stringify(cards));
/** 설정(테마·팔레트)용 안전 쓰기 — 꽉 찬 저장소에서 토글이 앱을 죽이면 안 된다 */
export const savePref = (key, value) => safeSet(key, value);

/** 백업 내보내기용 버전 포함 봉투 */
export function exportEnvelope(notes, cards) {
  return { version: SCHEMA_VERSION, notes, cards };
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
