import { seedNotes, seedCards } from "./seed.js";
import { SCHEMA_VERSION, migrateNote, migrateCard } from "./migrate.js";
import { USER_DATA_KEY } from "./constants.js";

/* 노트와 카드를 함께 담는 단일 권위 키. 한 번의 setItem이 둘 다 옮기므로
   "노트는 저장되고 카드는 실패했다"가 **구조적으로 불가능해진다.**
   따로 쓰던 시절엔 addNote가 한 렌더에서 둘을 바꾸는데 두 이펙트가 같은
   flush에서 같은 stale storageLocked를 캡처해, 큰 notes만 실패하고 작은
   cards는 성공 → 없는 노트를 가리키는 고아 카드가 남았다. */
const STATE_KEY = "wr_state";
/* 아래 셋은 wr_state 이전의 키다. **읽기 전용으로 영구 보존한다** —
   지우는 것도 실패할 수 있는 쓰기라, 실패를 견디는 게 목적인 경로에
   새 실패 지점을 만들 이유가 없다. 전환 뒤에는 전환 직전 상태의 사본으로 남는다. */
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
  const rawState = localStorage.getItem(STATE_KEY);
  const rawNotes = localStorage.getItem(NOTES_KEY);
  const rawCards =
    localStorage.getItem(CARDS_KEY) ?? localStorage.getItem(LEGACY_CARDS_KEY);
  const hadStoredData = rawState !== null || rawNotes !== null;

  /* 마이그레이션 직전, 원본 문자열 그대로 스냅샷 (버전당 1회, 조용히).
     rawState도 담는다 — 안 담으면 wr_state 사용자의 다음 스키마 승격 때
     notes/cards가 둘 다 null인 **빈 백업**이 찍힌다. 백업처럼 보이는데
     아무것도 안 들어 있는 게 백업이 없는 것보다 나쁘다. */
  const backupKey = backupKeyFor(storedVersion);
  if (
    storedVersion < SCHEMA_VERSION &&
    (rawState !== null || rawNotes !== null || rawCards !== null) &&
    localStorage.getItem(backupKey) === null
  ) {
    try {
      localStorage.setItem(
        backupKey,
        JSON.stringify({
          savedAt: Date.now(),
          notes: rawNotes,
          cards: rawCards,
          state: rawState,
        })
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
  if (!hadStoredData && localStorage.getItem(USER_DATA_KEY) === null) {
    safeSet(USER_DATA_KEY, "0"); // 시드는 사용자 데이터가 아니다
  }

  if (rawState !== null) {
    /* wr_state가 있으면 **그것만 본다.** 못 읽어도 레거시로 내려가지 않는다:
       반쯤 쓰인 봉투를 낡은 레거시 데이터로 덮어 가리는 게 되고, 그건 E-2가
       없애려는 바로 그 불일치다. 못 쓰겠으면 파싱 실패로 시끄럽게 잠근다.
       tests/helpers.js의 읽기 규칙과 같은 규칙이다 — 앱과 테스트가 저장소에
       대해 서로 다른 말을 하면 어느 쪽도 믿을 수 없다. */
    try {
      const env = JSON.parse(rawState);
      if (!env || !Array.isArray(env.notes) || !Array.isArray(env.cards)) {
        throw new Error("not an envelope");
      }
      notes = env.notes;
      cards = env.cards;
    } catch {
      error = "저장 데이터 파싱 실패 — 저장이 잠겼다. 원본은 그대로 있다.";
      notes = [];
      cards = [];
    }
  } else {
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
  }

  const now = Date.now();
  notes = notes.map(migrateNote);
  cards = cards.map((c) => migrateCard(c, now));

  /* 정상 로드일 때만 마이그레이션 결과를 영속화하고 버전 승격 (idempotent).
     노트·카드는 이제 한 번의 쓰기다. 버전 승격은 여전히 마지막이라,
     상태만 쓰이고 버전이 실패해도 다음 부팅에서 멱등 마이그레이션을 다시 돈다.

     레거시 → wr_state 전환은 **버전 승격이 아니다.** 노트·카드의 모양이
     양쪽에서 같아서 마이그레이션이 아니라 담는 그릇만 바뀌는 것이고,
     SCHEMA_VERSION을 올리면 아무 변환도 없는 승격이 기록에 남는다.
     전환 쓰기가 용량으로 실패하면 레거시 경로 그대로 다음 부팅에 재시도한다 —
     원자성은 아직 못 얻지만 손실은 없고, 쓰기 실패는 배너로 보인다. */
  if (!error) {
    const ok =
      saveState(notes, cards) && safeSet(VERSION_KEY, String(SCHEMA_VERSION));
    if (!ok) writeError = WRITE_ERROR_MESSAGE;
  }

  /* 이미 저장된 노트가 있었다 = 기존 사용자다. 시드 첫 실행과 구분해야
     사용자 데이터 플래그를 뒤늦게 채울 수 있다 (storageHealth를 여기서
     import하면 순환이 되므로 사실만 돌려주고 판단은 App이 한다). */
  return { notes, cards, error, writeError, hadStoredData };
}

/**
 * 노트와 카드를 **한 번의 쓰기로** 영속화한다. 성공/실패가 둘에 함께 적용된다.
 *
 * 봉투 모양은 exportEnvelope와 같다 — 저장된 상태와 내보낸 파일이 같은 형식이면
 * 읽는 쪽이 하나만 알면 된다. version은 그래서 들어간다(자기서술적 형식).
 * 스키마 버전의 권위는 여전히 wr_schema_version이고 loadAll도 그쪽을 읽는다.
 *
 * @returns {boolean} 저장 성공 여부. 실패해도 던지지 않는다
 */
export const saveState = (notes, cards) =>
  safeSet(STATE_KEY, JSON.stringify({ version: SCHEMA_VERSION, notes, cards }));
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
