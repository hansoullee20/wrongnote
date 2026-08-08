import { useEffect, useMemo, useRef, useState } from "react";
import {
  RECHECK_DAYS,
  FAIL_RECHECK_DAYS,
  DAY_MS,
  fmtDate,
  uid,
  isRecheckDue,
  noteImageIds,
  shuffle,
  CAUSES,
  USER_DATA_KEY,
} from "./constants.js";
import {
  loadAll,
  saveNotes,
  saveCards,
  savePref,
  WRITE_ERROR_MESSAGE,
} from "./storage.js";
import {
  requestPersistentStorage,
  markUserDataWritten,
} from "./storageHealth.js";
import { migrateCard } from "./migrate.js";
import { scheduleCard, dueCards } from "./srs.js";
import { deleteImages, gcImages } from "./imageStore.js";
import { PALETTES, DEFAULT_PALETTE, isPalette } from "./palettes.js";
import ProblemsView from "./views/ProblemsView.jsx";
import RecordView from "./views/RecordView.jsx";
import SolveView from "./views/SolveView.jsx";
import CardsView from "./views/CardsView.jsx";
import StatsView from "./views/StatsView.jsx";
import SettingsView from "./views/SettingsView.jsx";

const TABS = [
  { id: "problems", label: "문제" },
  { id: "solve", label: "풀기" },
  { id: "cards", label: "카드" },
  { id: "stats", label: "통계" },
];

const THEME_KEY = "wr_theme";
const PALETTE_KEY = "wr_palette";

/* 사용자 **선택**과 실제 **적용값**은 다른 개념이다.
   예전엔 첫 실행 때 시스템 값을 읽어 "light"/"dark"로 굳혀 저장했기 때문에,
   그 뒤로는 기기 설정을 바꿔도 앱이 따라가지 않았다. 이제 선택은
   system|light|dark로 저장하고, 화면에 찍는 값은 거기서 파생시킨다.
   기존 사용자의 "light"/"dark" 저장값은 그대로 유효한 선택으로 읽힌다. */
const isThemePreference = (v) =>
  v === "system" || v === "light" || v === "dark";

function initialThemePreference() {
  const saved = localStorage.getItem(THEME_KEY);
  return isThemePreference(saved) ? saved : "system";
}

const systemScheme = () =>
  window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";

function initialPalette() {
  const saved = localStorage.getItem(PALETTE_KEY);
  return isPalette(saved) ? saved : DEFAULT_PALETTE;
}

export default function App() {
  // 부팅 시 1회 로드 + 마이그레이션. 파싱 실패면 저장을 잠가 원본을 보호한다.
  const [boot] = useState(loadAll);
  const [themePreference, setThemePreference] = useState(initialThemePreference);
  const [systemTheme, setSystemTheme] = useState(systemScheme);
  const [palette, setPalette] = useState(initialPalette);

  /* 시스템 설정을 **계속** 따라간다 — 앱이 열려 있는 동안 기기 모드가 바뀌면
     즉시 반영되어야 한다. addEventListener를 못 쓰는 환경(구형 Safari)에는
     addListener로 물러난다. */
  useEffect(() => {
    const mq = window.matchMedia?.("(prefers-color-scheme: dark)");
    if (!mq) return undefined;
    const onChange = (e) => setSystemTheme(e.matches ? "dark" : "light");
    /* 최초 읽기와 구독 사이에 기기 설정이 바뀌면 그 변화를 놓친다 —
       다음 변경이 올 때까지 낡은 값으로 남는다. 구독 직후 한 번 맞춘다. */
    setSystemTheme(mq.matches ? "dark" : "light");
    if (mq.addEventListener) mq.addEventListener("change", onChange);
    else if (mq.addListener) mq.addListener(onChange);
    return () => {
      if (mq.removeEventListener) mq.removeEventListener("change", onChange);
      else if (mq.removeListener) mq.removeListener(onChange);
    };
  }, []);

  // 화면에 실제로 찍는 값. data-theme은 계속 light|dark 둘뿐이다.
  const theme = themePreference === "system" ? systemTheme : themePreference;

  /* 팔레트 × 주간/야간 두 축을 항상 명시한다 — 브라우저가 임의로 색을 뒤집지 않게.
     상태표시줄 색(theme-color)도 골라둔 팔레트의 지면색으로 맞춰야
     안드로이드에서 위쪽만 딴 색으로 뜨지 않는다. */
  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute("data-theme", theme);
    root.setAttribute("data-palette", palette);
    /* 꽉 찬 저장소에서 ☾ 한 번에 앱이 죽으면 안 된다. 설정은 사용자 데이터가
       아니라 취향이라 저장 실패해도 화면에는 적용하고 조용히 넘어간다 —
       배너는 노트/카드 저장 실패가 띄운다. */
    savePref(THEME_KEY, themePreference); // 선택을 저장한다 (해석 결과가 아니라)
    savePref(PALETTE_KEY, palette);

    const p = PALETTES.find((x) => x.id === palette) ?? PALETTES[0];
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute("content", theme === "dark" ? p.night.paper : p.day.paper);
  }, [theme, themePreference, palette]);
  const [notes, setNotes] = useState(boot.notes);
  const [cards, setCards] = useState(boot.cards);
  /* 두 실패는 성격이 다르다 — storage.js의 loadAll 주석 참고.
     parseError: 메모리가 비어 있다 → 내보내기까지 막는다 (빈 백업 방지)
     writeError: 메모리는 온전하다 → 내보내기는 열어둔다 (유일한 구조 수단) */
  const parseError = boot.error;
  const [writeError, setWriteError] = useState(boot.writeError);
  // 사용자가 실제로 노트를 만들었을 때만 참 — 시드/마이그레이션 쓰기와 구분한다
  const pendingPersistRequest = useRef(false);

  /* 이 플래그는 나중에 추가됐다. 이미 노트를 쌓아둔 사용자는 addNote를 다시
     부르기 전까지 플래그가 없어서 **백업 경고가 조용히 꺼진다** — 정작 잃을
     게 가장 많은 사람이 경고를 못 받는다. 부팅 때 한 번 메운다.

     새 설치는 storage.js가 시드 저장 **전에** "0"을 각인하므로, 키가 아예
     없는데 노트가 있다 = 플래그 도입 이전부터 쓰던 사용자다. */
  useEffect(() => {
    /* 키가 **아예 없을 때만** 메운다. "0"은 "새 설치임을 이미 확인했다"는
       뜻이라 덮어쓰면 안 된다 — StrictMode 2회차는 시드가 저장된 뒤라
       hadStoredData가 참이므로, !hasUserData()로 판정하면 새 설치를
       기존 사용자로 잘못 승격시킨다. */
    if (boot.hadStoredData && localStorage.getItem(USER_DATA_KEY) === null) {
      markUserDataWritten();
    }
  }, [boot.hadStoredData]);
  const storageLocked = Boolean(parseError) || Boolean(writeError);

  /* 배너는 탭 화면(.paper-sheet)과 **시트 안쪽 둘 다** 띄운다.
     기록 시트는 .paper-sheet 밖의 전체화면 오버레이라, 시트에만 안 띄우면
     하필 사용자가 새 노트를 쓰는 순간 — 저장 안 될 데이터를 만드는 바로 그
     순간 — 경고가 가려진다. */
  const storageBanner = storageLocked ? (
    <div className="audit-warn" role="alert">
      {parseError || writeError}
    </div>
  ) : null;
  const [tab, setTab] = useState("problems");
  // 기록 폼은 탭이 아니라 오버레이 — 매일 하는 건 복습이고 기록은 가끔이다
  const [recording, setRecording] = useState(false);
  // 설정도 오버레이 — 탭은 데이터에만 쓴다
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [editingNoteId, setEditingNoteId] = useState(null);
  // 문제 그리드에서 바로 세션을 시작할 때 넘기는 큐
  const [pendingQueue, setPendingQueue] = useState(null);
  // 통계 → 문제 탭 그룹 이동 요청 {group, unattemptedOnly}
  const [problemNavRequest, setProblemNavRequest] = useState(null);
  const [filter, setFilter] = useState({ tag: "", cause: "", topicMain: "" });

  useEffect(() => {
    if (storageLocked) return;
    if (!saveNotes(notes)) {
      setWriteError(WRITE_ERROR_MESSAGE);
      return;
    }
    /* 영구 저장소는 **실제 노트가 디스크에 안착한 뒤** 한 번만 요청한다.
       부팅마다 물으면 잔소리가 되고, 시드/마이그레이션 쓰기로 요청하면
       사용자가 아직 아무것도 안 만든 시점에 프롬프트가 뜬다.
       크롬은 참여도 휴리스틱으로 조용히 승인하기도 하므로, 진짜 기록이
       생긴 순간이 승인 확률이 가장 높은 시점이기도 하다. */
    if (pendingPersistRequest.current) {
      pendingPersistRequest.current = false;
      requestPersistentStorage();
    }
  }, [notes, storageLocked]);
  useEffect(() => {
    if (storageLocked) return;
    if (!saveCards(cards)) setWriteError(WRITE_ERROR_MESSAGE);
  }, [cards, storageLocked]);

  // 풀기 배지 — 풀기 세션과 동일한 isRecheckDue 기준
  const recheckDueCount = useMemo(
    () => notes.filter((n) => isRecheckDue(n)).length,
    [notes]
  );

  // 카드 복습 배지
  const cardDueCount = useMemo(() => dueCards(cards).length, [cards]);

  /** derived=yes면 "지위 오해" 자동 태그 — 생성/수정 공통 규칙 */
  function applyDerivedTag(draft) {
    if (draft.derived === "yes" && !draft.tags.includes("지위 오해")) {
      return { ...draft, tags: [...draft.tags, "지위 오해"] };
    }
    return draft;
  }

  function addNote(rawDraft) {
    pendingPersistRequest.current = true;
    markUserDataWritten();
    const draft = applyDerivedTag(rawDraft);
    const ts = Date.now();
    const note = {
      ...draft,
      id: uid(),
      ts,
      date: fmtDate(ts),
      rechecked: false,
      recheckResult: null,
      recheckCount: 0,
      nextRecheckTs: null,
    };
    setNotes((ns) => [note, ...ns]);

    // 재유도 → 플래시카드 자동 생성.
    // 빈 뒷면 금지: optSol 없으면 만들지 않는다. 생성 시에만 (수정 시 X).
    if (note.derived === "yes" && note.problem && note.optSol?.trim()) {
      setCards((cs) => {
        if (cs.some((c) => c.noteId === note.id || c.front === note.problem)) {
          return cs;
        }
        return [
          ...cs,
          migrateCard({
            id: uid(),
            noteId: note.id,
            subject: note.subject,
            front: note.problem,
            back: note.optSol,
          }),
        ];
      });
    }
  }

  function updateNote(id, rawPatch) {
    const patch = applyDerivedTag(rawPatch);
    setNotes((ns) =>
      ns.map((n) =>
        n.id === id
          ? {
              ...n,
              ...patch,
              // 불변 필드는 원본 유지
              id: n.id,
              ts: n.ts,
              date: n.date,
              rechecked: n.rechecked,
              recheckResult: n.recheckResult,
              recheckCount: n.recheckCount,
              nextRecheckTs: n.nextRecheckTs,
            }
          : n
      )
    );
  }

  function deleteNote(id) {
    // 노트의 첨부 사진도 IDB에서 정리 (문제 사진 + 풀이 사진)
    const target = notes.find((n) => n.id === id);
    const ids = noteImageIds(target);
    /* 저장이 잠긴 상태에서는 사진을 지우지 않는다. IDB는 localStorage와 다른
       저장소라 잠금이 안 걸리는데, 노트 삭제는 디스크에 안 남는다. 그대로 두면
       새로고침 때 노트는 되살아나고 사진만 영구히 사라진다.
       ⚠️ 이건 최소 완화책이다 — 첫 저장 실패가 감지되기 *전*의 삭제에는
       여전히 창이 남는다. 근본 수정(영속 성공 뒤에만 수거)은 별도 Tier 2. */
    if (ids.length && !storageLocked) deleteImages(ids);
    setNotes((ns) => ns.filter((n) => n.id !== id));
    // 이 노트에서 자동 생성된 카드도 정리 (수동 카드는 noteId=null이라 생존)
    setCards((cs) => cs.filter((c) => c.noteId !== id));
  }

  /**
   * 다시 풀기 결과 1회분을 노트에 쌓는다 (v5: 시도별 실패 원인 포함).
   * 틀렸다고 노트의 주원인을 자동으로 바꾸지 않는다 — 잘못된 재분류는
   * 잘못된 처방으로 이어진다. 대신 세션 요약에서 사용자에게 물어본다.
   * fail인데 원인이 유효하지 않으면 저장하지 않는다 — 분류 없는
   * fail이 쌓이면 통계가 다시 거짓말을 하게 된다.
   */
  function recordAttempt(id, draft) {
    const now = draft.ts ?? Date.now();
    const correct = Boolean(draft.correct);
    if (!correct && !CAUSES.includes(draft.cause)) return;

    const attempt = {
      id: draft.id ?? uid(),
      ts: now,
      answer: draft.answer ?? "",
      correct,
      result: correct ? "pass" : "fail",
      seconds: Number.isFinite(draft.seconds) ? draft.seconds : null,
      // pass에 딸려온 원인은 버린다 — pass에는 실패 원인이 없다
      cause: correct ? "" : draft.cause,
      tags: correct ? [] : [...(draft.tags || [])],
      memo: correct ? "" : (draft.memo ?? ""),
      source: draft.source,
    };

    setNotes((ns) =>
      ns.map((n) => {
        if (n.id !== id) return n;
        return {
          ...n,
          attempts: [...(n.attempts || []), attempt],
          rechecked: true,
          recheckResult: correct ? "pass" : "fail",
          recheckCount: n.recheckCount + 1,
          nextRecheckTs:
            now + (correct ? RECHECK_DAYS : FAIL_RECHECK_DAYS) * DAY_MS,
        };
      })
    );
  }

  function setCorrectAnswer(id, correctAnswer) {
    setNotes((ns) =>
      ns.map((n) => (n.id === id ? { ...n, correctAnswer } : n))
    );
  }

  // ---- 카드 CRUD + 채점 ----
  function gradeCard(id, grade) {
    setCards((cs) =>
      cs.map((c) => (c.id === id ? scheduleCard(c, grade) : c))
    );
  }

  function addCard({ front, back, subject }) {
    setCards((cs) => [
      ...cs,
      migrateCard({ id: uid(), noteId: null, subject, front, back }),
    ]);
  }

  function updateCard(id, patch) {
    setCards((cs) =>
      cs.map((c) => (c.id === id ? { ...c, ...patch, id: c.id } : c))
    );
  }

  function deleteCard(id) {
    setCards((cs) => cs.filter((c) => c.id !== id));
  }

  function replaceAll(newNotes, newCards) {
    /* 가져오기도 진짜 사용자 데이터를 쓴다 — 기기를 갈아탄 직후가 내구성이
       가장 절실한 순간인데, addNote에서만 요청하면 그때를 놓친다. */
    pendingPersistRequest.current = true;
    markUserDataWritten();
    setNotes(newNotes);
    setCards(newCards);
    // 가져온 노트가 참조하지 않는 고아 사진 정리.
    // 풀이 사진을 빠뜨리면 GC가 살아 있는 사진을 지운다 — 누수가 아니라 손실이다.
    // 저장이 잠겼으면 GC도 돌리지 않는다 — 교체 결과가 디스크에 안 남는데
    // 옛 사진을 수거하면 새로고침 후 옛 노트가 없는 사진을 가리킨다.
    if (!storageLocked) gcImages(newNotes.flatMap(noteImageIds));
  }

  function gotoProblemsWithTopic(topicMain) {
    setFilter({ tag: "", cause: "", topicMain });
    setTab("problems");
  }

  return (
    <div className="app">
      <header className="masthead">
        <span className="masthead-sub">수능 대비</span>
        <h1 className="masthead-title">오답노트</h1>
        <span className="masthead-stamp">{notes.length}문제</span>
        <button
          type="button"
          className="theme-toggle"
          aria-label={theme === "dark" ? "주간 모드로 전환" : "야간 모드로 전환"}
          /* 한 번 누르면 "지금 이걸로" 라는 명시적 선택이다 — system에서
             벗어나 고정된다. 다시 자동으로 두려면 설정에서 고른다. */
          onClick={() => setThemePreference(theme === "dark" ? "light" : "dark")}
        >
          {theme === "dark" ? "☀" : "☾"}
        </button>
        <button
          type="button"
          className="theme-toggle settings-open"
          aria-label="설정"
          onClick={() => setSettingsOpen(true)}
        >
          ⚙
        </button>
      </header>

      <nav className="tabs">
        {TABS.map((t) => {
          const badge =
            t.id === "solve"
              ? recheckDueCount
              : t.id === "cards"
                ? cardDueCount
                : 0;
          return (
            <button
              key={t.id}
              type="button"
              className={`tab${tab === t.id ? " on" : ""}`}
              onClick={() => setTab(t.id)}
            >
              {t.label}
              {badge > 0 && <span className="tab-badge">{badge}</span>}
            </button>
          );
        })}
      </nav>

      <div className="paper-sheet">
        {/* 시트가 열려 있으면 배경 배너는 렌더하지 않는다 — 시각적으로는 덮이지만
            접근성 트리에는 같은 경고가 두 벌 남기 때문이다. 기록 시트는 자체
            배너를 갖고, 설정 시트는 상황별 안내를 따로 띄운다. */}
        {!recording && !settingsOpen && storageBanner}
        {tab === "problems" && (
          <ProblemsView
            notes={notes}
            cardDueCount={cardDueCount}
            filter={filter}
            setFilter={setFilter}
            navigationRequest={problemNavRequest}
            onConsumeNavigationRequest={() => setProblemNavRequest(null)}
            onOpenNote={(id) => {
              setEditingNoteId(id);
              setRecording(true);
            }}
            onSolveNote={(id) => {
              const n = notes.find((x) => x.id === id);
              setPendingQueue({
                ids: [id],
                label: n ? n.problem : "다시 풀기",
                source: "manual",
              });
              setTab("solve");
            }}
            onRecord={() => {
              setEditingNoteId(null);
              setRecording(true);
            }}
            onStartDue={() => {
              setPendingQueue({
                ids: notes.filter((n) => isRecheckDue(n)).map((n) => n.id),
                label: "오늘 볼 것",
                source: "scheduled",
              });
              setTab("solve");
            }}
            onStartRandom={(pool, size) => {
              const shuffled = shuffle(pool);
              setPendingQueue({
                ids: shuffled.slice(0, size).map((n) => n.id),
                label: filter.cause ? `${filter.cause}에서` : "전체에서",
                source: "random",
              });
              setTab("solve");
            }}
          />
        )}
        {tab === "solve" && (
          <SolveView
            notes={notes}
            cardDueCount={cardDueCount}
            filter={filter}
            initialQueue={pendingQueue}
            onConsumeInitialQueue={() => setPendingQueue(null)}
            onRecordAttempt={recordAttempt}
            onSetCorrectAnswer={setCorrectAnswer}
            onOpenNote={(id) => {
              setEditingNoteId(id);
              setRecording(true);
            }}
            onGotoCards={() => setTab("cards")}
          />
        )}
        {tab === "cards" && (
          <CardsView
            cards={cards}
            onGrade={gradeCard}
            onAdd={addCard}
            onUpdate={updateCard}
            onDelete={deleteCard}
          />
        )}
        {tab === "stats" && (
          <StatsView
            notes={notes}
            cards={cards}
            onTopicClick={gotoProblemsWithTopic}
            onGotoGroup={(group, unattemptedOnly) => {
              setProblemNavRequest({ group, unattemptedOnly });
              setTab("problems");
            }}
          />
        )}
      </div>

      {settingsOpen && (
        <div className="sheet">
          <div className="sheet-head">
            <span className="sheet-title">설정</span>
            <div className="sheet-actions">
              <button
                type="button"
                className="sheet-close"
                onClick={() => setSettingsOpen(false)}
              >
                닫기 ✕
              </button>
            </div>
          </div>
          <div className="sheet-body">
            <SettingsView
              notes={notes}
              cards={cards}
              parseError={parseError}
              writeError={writeError}
              onReplaceAll={replaceAll}
              palette={palette}
              onSetPalette={setPalette}
              theme={theme}
              themePreference={themePreference}
              onSetThemePreference={setThemePreference}
            />
          </div>
        </div>
      )}

      {recording && (
        <div className="sheet">
          <div className="sheet-head">
            <span className="sheet-title">
              {editingNoteId ? "오답 수정" : "오답 기록"}
            </span>
            <div className="sheet-actions">
              {editingNoteId && (
                <button
                  type="button"
                  className="sheet-delete"
                  onClick={() => {
                    if (confirm("이 기록을 삭제할까?")) {
                      deleteNote(editingNoteId);
                      setRecording(false);
                      setEditingNoteId(null);
                    }
                  }}
                >
                  이 기록 삭제
                </button>
              )}
              <button
                type="button"
                className="sheet-close"
                onClick={() => {
                  setRecording(false);
                  setEditingNoteId(null);
                }}
              >
                닫기 ✕
              </button>
            </div>
          </div>
          <div className="sheet-body">
            {storageBanner}
            <RecordView
              storageLocked={storageLocked}
              notes={notes}
              onAdd={(payload) => {
                addNote(payload);
                setRecording(false);
              }}
              onUpdate={(id, payload) => {
                updateNote(id, payload);
                setRecording(false);
                setEditingNoteId(null);
              }}
              initialEditId={editingNoteId}
              onCancelEdit={() => setEditingNoteId(null)}
            />
          </div>
        </div>
      )}
    </div>
  );
}
