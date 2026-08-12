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
import { useCompanionInbox } from "./useCompanionInbox.js";
import ProblemsView from "./views/ProblemsView.jsx";
import RecordView from "./views/RecordView.jsx";
import AiReviewView from "./views/AiReviewView.jsx";
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
const LOCALE_KEY = "wr_locale";

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

function initialLocale() {
  return localStorage.getItem(LOCALE_KEY) === "en" ? "en" : "ko";
}

export default function App() {
  // 부팅 시 1회 로드 + 마이그레이션. 파싱 실패면 저장을 잠가 원본을 보호한다.
  const [boot] = useState(loadAll);
  const [themePreference, setThemePreference] = useState(initialThemePreference);
  const [systemTheme, setSystemTheme] = useState(systemScheme);
  const [palette, setPalette] = useState(initialPalette);
  const [locale, setLocale] = useState(initialLocale);

  useEffect(() => {
    const mq = window.matchMedia?.("(prefers-color-scheme: dark)");
    if (!mq) return undefined;
    const onChange = (e) => setSystemTheme(e.matches ? "dark" : "light");
    setSystemTheme(mq.matches ? "dark" : "light");
    if (mq.addEventListener) mq.addEventListener("change", onChange);
    else if (mq.addListener) mq.addListener(onChange);
    return () => {
      if (mq.removeEventListener) mq.removeEventListener("change", onChange);
      else if (mq.removeListener) mq.removeListener(onChange);
    };
  }, []);

  const theme = themePreference === "system" ? systemTheme : themePreference;

  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute("data-theme", theme);
    root.setAttribute("data-palette", palette);
    savePref(THEME_KEY, themePreference);
    savePref(PALETTE_KEY, palette);
    savePref(LOCALE_KEY, locale);

    const p = PALETTES.find((x) => x.id === palette) ?? PALETTES[0];
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute("content", theme === "dark" ? p.night.paper : p.day.paper);
  }, [theme, themePreference, palette, locale]);

  const [notes, setNotes] = useState(boot.notes);
  const [cards, setCards] = useState(boot.cards);
  const parseError = boot.error;
  const [writeError, setWriteError] = useState(boot.writeError);
  const pendingPersistRequest = useRef(false);
  const pendingImageDeletes = useRef([]);
  // AI queue의 accepted는 note localStorage 쓰기가 성공한 뒤에만 보낸다.
  const pendingAiAcceptRef = useRef(null);

  const [tab, setTab] = useState("problems");
  const [recording, setRecording] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [editingNoteId, setEditingNoteId] = useState(null);
  const [pendingQueue, setPendingQueue] = useState(null);
  const [problemNavRequest, setProblemNavRequest] = useState(null);
  const [filter, setFilter] = useState({ tag: "", cause: "", topicMain: "" });
  const [aiReviewOpen, setAiReviewOpen] = useState(false);
  const [aiSaving, setAiSaving] = useState(false);

  useEffect(() => {
    if (boot.hadStoredData && localStorage.getItem(USER_DATA_KEY) === null) {
      markUserDataWritten();
    }
  }, [boot.hadStoredData]);

  const storageLocked = Boolean(parseError) || Boolean(writeError);

  const {
    ready: aiReady,
    notice: aiNotice,
    dismissNotice: dismissAiNotice,
    releaseReady: releaseAiReady,
    acceptReady: acceptAiReady,
    rejectReady: rejectAiReady,
  } = useCompanionInbox({
    // 폼을 쓰는 동안 새 delivery를 claim하지 않는다. 이미 받은 delivery는
    // hook이 lease를 계속 갱신하므로 검토 중 사라지지 않는다.
    enabled: !storageLocked && !recording && !settingsOpen && !aiReviewOpen,
  });

  const storageBanner = storageLocked ? (
    <div className="audit-warn" role="alert">
      {parseError || writeError}
    </div>
  ) : null;

  useEffect(() => {
    if (storageLocked) return;
    if (!saveNotes(notes)) {
      pendingAiAcceptRef.current = null;
      setAiSaving(false);
      setWriteError(WRITE_ERROR_MESSAGE);
      return;
    }

    if (pendingImageDeletes.current.length) {
      const ids = [...new Set(pendingImageDeletes.current)];
      pendingImageDeletes.current = [];
      Promise.resolve(deleteImages(ids)).catch(() => {});
    }

    if (pendingPersistRequest.current) {
      pendingPersistRequest.current = false;
      requestPersistentStorage();
    }

    /* accept-on-save invariant: 이 effect의 saveNotes 성공 이전에는 절대
       companion에 accepted를 보내지 않는다. ACK가 유실되더라도 aiEventId가
       이미 note에 영속되어 있으므로 재전달 시 중복 생성 없이 다시 ACK할 수 있다. */
    if (pendingAiAcceptRef.current) {
      pendingAiAcceptRef.current = null;
      setAiSaving(false);
      setAiReviewOpen(false);
      void acceptAiReady();
    }
  }, [notes, storageLocked, acceptAiReady]);

  useEffect(() => {
    if (storageLocked) return;
    if (!saveCards(cards)) setWriteError(WRITE_ERROR_MESSAGE);
  }, [cards, storageLocked]);

  /* 브라우저가 note 저장에는 성공했지만 queue settlement 응답을 잃고 죽은 경우,
     같은 event가 다시 온다. 이미 영속된 aiEventId를 발견하면 사용자에게 같은
     기록을 또 만들라고 하지 않고 accepted ACK만 복구한다. 현재 저장 중인 event는
     위 saveNotes effect가 책임지므로 여기서 먼저 ACK하면 안 된다. */
  useEffect(() => {
    if (!aiReady || pendingAiAcceptRef.current) return;
    if (notes.some((note) => note.aiEventId && note.aiEventId === aiReady.eventId)) {
      setAiReviewOpen(false);
      void acceptAiReady();
    }
  }, [aiReady, notes, acceptAiReady]);

  useEffect(() => {
    if (aiReviewOpen && !aiReady && !aiSaving) setAiReviewOpen(false);
  }, [aiReviewOpen, aiReady, aiSaving]);

  const recheckDueCount = useMemo(
    () => notes.filter((n) => isRecheckDue(n)).length,
    [notes]
  );
  const cardDueCount = useMemo(() => dueCards(cards).length, [cards]);

  function applyDerivedTag(draft) {
    if (draft.derived === "yes" && !draft.tags.includes("지위 오해")) {
      return { ...draft, tags: [...draft.tags, "지위 오해"] };
    }
    return draft;
  }

  function addNote(rawDraft, { aiEventId = "" } = {}) {
    pendingPersistRequest.current = true;
    markUserDataWritten();
    const draft = applyDerivedTag(rawDraft);
    const ts = Date.now();
    const note = {
      ...draft,
      aiEventId,
      id: uid(),
      ts,
      date: fmtDate(ts),
      rechecked: false,
      recheckResult: null,
      recheckCount: 0,
      nextRecheckTs: null,
    };
    setNotes((ns) => [note, ...ns]);

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
    return note;
  }

  function addAiNote(rawDraft, eventId) {
    if (!eventId || aiSaving || storageLocked) return;
    if (notes.some((note) => note.aiEventId === eventId)) {
      setAiReviewOpen(false);
      void acceptAiReady();
      return;
    }
    pendingAiAcceptRef.current = { eventId };
    setAiSaving(true);
    addNote(rawDraft, { aiEventId: eventId });
  }

  function updateNote(id, rawPatch, removedImageIds = []) {
    const patch = applyDerivedTag(rawPatch);
    if (removedImageIds.length) {
      pendingImageDeletes.current.push(...removedImageIds);
    }
    setNotes((ns) =>
      ns.map((n) =>
        n.id === id
          ? {
              ...n,
              ...patch,
              id: n.id,
              ts: n.ts,
              date: n.date,
              rechecked: n.rechecked,
              recheckResult: n.recheckResult,
              recheckCount: n.recheckCount,
              nextRecheckTs: n.nextRecheckTs,
              // AI event identity is immutable note provenance. Manual edit must
              // not erase or replace it with a draft field.
              aiEventId: n.aiEventId || "",
            }
          : n
      )
    );
  }

  function deleteNote(id) {
    const target = notes.find((n) => n.id === id);
    const ids = noteImageIds(target);
    if (ids.length) pendingImageDeletes.current.push(...ids);
    setNotes((ns) => ns.filter((n) => n.id !== id));
    setCards((cs) => cs.filter((c) => c.noteId !== id));
  }

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
      assisted: draft.assisted === true,
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
    pendingPersistRequest.current = true;
    markUserDataWritten();
    setNotes(newNotes);
    setCards(newCards);
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
        {!recording && !settingsOpen && storageBanner}

        {!recording && !settingsOpen && aiNotice && (
          <div className="audit-warn" role="status" data-testid="ai-inbox-notice">
            {aiNotice}{" "}
            <button type="button" className="sheet-close" onClick={dismissAiNotice}>
              닫기
            </button>
          </div>
        )}

        {aiReady && !recording && !settingsOpen && !aiReviewOpen && (
          <div className="form-shell" data-testid="ai-inbox-badge">
            <button
              type="button"
              className="btn btn--ink btn--block"
              onClick={() => setAiReviewOpen(true)}
            >
              ✦ AI 분석 1 · {aiReady.imported.problem || "새 분석"} 검토
            </button>
          </div>
        )}

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
              dataVersion={boot.dataVersion}
              onReplaceAll={replaceAll}
              palette={palette}
              onSetPalette={setPalette}
              theme={theme}
              themePreference={themePreference}
              onSetThemePreference={setThemePreference}
              locale={locale}
              onSetLocale={setLocale}
            />
          </div>
        </div>
      )}

      {aiReviewOpen && aiReady && (
        <div className="sheet" data-testid="ai-review-sheet">
          <div className="sheet-head">
            <span className="sheet-title">AI 분석 검토</span>
            <div className="sheet-actions">
              <button
                type="button"
                className="sheet-close"
                disabled={aiSaving}
                onClick={() => {
                  setAiReviewOpen(false);
                  void releaseAiReady();
                }}
              >
                나중에 ✕
              </button>
            </div>
          </div>
          <div className="sheet-body">
            {storageBanner}
            <AiReviewView
              delivery={aiReady}
              saving={aiSaving}
              onSave={(payload) => addAiNote(payload, aiReady.eventId)}
              onReject={(reason) => {
                setAiSaving(false);
                setAiReviewOpen(false);
                void rejectAiReady(reason);
              }}
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
              notes={notes}
              onAdd={(payload) => {
                addNote(payload);
                setRecording(false);
              }}
              onUpdate={(id, payload, removedImageIds) => {
                updateNote(id, payload, removedImageIds);
                setRecording(false);
                setEditingNoteId(null);
              }}
              initialEditId={editingNoteId}
              onCancelEdit={() => setEditingNoteId(null)}
              locale={locale}
            />
          </div>
        </div>
      )}
    </div>
  );
}
