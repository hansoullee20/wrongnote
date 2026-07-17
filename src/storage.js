import { seedNotes, seedCards } from "./seed.js";
import { SCHEMA_VERSION, migrateNote, migrateCard } from "./migrate.js";

const NOTES_KEY = "wr_notes";
const CARDS_KEY = "wr_cards";
const LEGACY_CARDS_KEY = "gap_cards"; // v1 카드 키 — 읽기 전용으로 유지
const VERSION_KEY = "wr_schema_version";
const BACKUP_V1_KEY = "wr_backup_v1"; // v1→v2 직전 원본 스냅샷

function parseArray(raw) {
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) throw new Error("not an array");
  return parsed;
}

/**
 * 전체 로드 + 마이그레이션. 앱 부팅 시 1회 호출.
 * 파싱 실패 시 데이터를 절대 덮어쓰지 않도록 error를 반환한다 —
 * App은 error가 있으면 저장 이펙트를 잠근다.
 * @returns {{notes: object[], cards: object[], error: string}}
 */
export function loadAll() {
  const storedVersion = Number(localStorage.getItem(VERSION_KEY) || 1);
  const rawNotes = localStorage.getItem(NOTES_KEY);
  const rawCards =
    localStorage.getItem(CARDS_KEY) ?? localStorage.getItem(LEGACY_CARDS_KEY);

  // v1→v2 최초 마이그레이션 직전, 원본 문자열 그대로 스냅샷 (1회만, 조용히)
  if (
    storedVersion < SCHEMA_VERSION &&
    (rawNotes !== null || rawCards !== null) &&
    localStorage.getItem(BACKUP_V1_KEY) === null
  ) {
    try {
      localStorage.setItem(
        BACKUP_V1_KEY,
        JSON.stringify({ savedAt: Date.now(), notes: rawNotes, cards: rawCards })
      );
    } catch {
      // 백업 실패(용량 등)해도 로드는 계속한다
    }
  }

  let error = "";
  let notes;
  let cards;

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
  if (!error) {
    localStorage.setItem(NOTES_KEY, JSON.stringify(notes));
    localStorage.setItem(CARDS_KEY, JSON.stringify(cards));
    localStorage.setItem(VERSION_KEY, String(SCHEMA_VERSION));
  }

  return { notes, cards, error };
}

export const saveNotes = (notes) =>
  localStorage.setItem(NOTES_KEY, JSON.stringify(notes));
export const saveCards = (cards) =>
  localStorage.setItem(CARDS_KEY, JSON.stringify(cards));

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
