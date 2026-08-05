import { useEffect, useMemo, useState } from "react";
import {
  RECHECK_DAYS,
  FAIL_RECHECK_DAYS,
  DAY_MS,
  fmtDate,
  uid,
  isRecheckDue,
  CAUSES,
} from "./constants.js";
import { loadAll, saveNotes, saveCards } from "./storage.js";
import { migrateCard } from "./migrate.js";
import { scheduleCard, dueCards } from "./srs.js";
import { deleteImages, gcImages } from "./imageStore.js";
import ProblemsView from "./views/ProblemsView.jsx";
import RecordView from "./views/RecordView.jsx";
import SolveView from "./views/SolveView.jsx";
import CardsView from "./views/CardsView.jsx";
import StatsView from "./views/StatsView.jsx";

const TABS = [
  { id: "problems", label: "문제" },
  { id: "solve", label: "풀기" },
  { id: "cards", label: "카드" },
  { id: "stats", label: "통계" },
];

export default function App() {
  // 부팅 시 1회 로드 + 마이그레이션. 파싱 실패면 저장을 잠가 원본을 보호한다.
  const [boot] = useState(loadAll);
  const [notes, setNotes] = useState(boot.notes);
  const [cards, setCards] = useState(boot.cards);
  const storageLocked = Boolean(boot.error);
  const [tab, setTab] = useState("problems");
  // 기록 폼은 탭이 아니라 오버레이 — 매일 하는 건 복습이고 기록은 가끔이다
  const [recording, setRecording] = useState(false);
  const [editingNoteId, setEditingNoteId] = useState(null);
  // 문제 그리드에서 바로 세션을 시작할 때 넘기는 큐
  const [pendingQueue, setPendingQueue] = useState(null);
  // 통계 → 문제 탭 그룹 이동 요청 {group, unattemptedOnly}
  const [problemNavRequest, setProblemNavRequest] = useState(null);
  const [filter, setFilter] = useState({ tag: "", cause: "", topicMain: "" });

  useEffect(() => {
    if (!storageLocked) saveNotes(notes);
  }, [notes, storageLocked]);
  useEffect(() => {
    if (!storageLocked) saveCards(cards);
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
    // 노트의 첨부 사진도 IDB에서 정리
    const target = notes.find((n) => n.id === id);
    if (target?.images?.length) deleteImages(target.images);
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
    setNotes(newNotes);
    setCards(newCards);
    // 가져온 노트가 참조하지 않는 고아 사진 정리
    gcImages(newNotes.flatMap((n) => n.images || []));
  }

  function gotoProblemsWithTopic(topicMain) {
    setFilter({ tag: "", cause: "", topicMain });
    setTab("problems");
  }

  return (
    <div className="app">
      <header className="masthead">
        <span className="masthead-sub">대학수학능력시험 대비</span>
        <h1 className="masthead-title">오답노트</h1>
        <span className="masthead-stamp">채점완료</span>
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
        {storageLocked && <div className="audit-warn">{boot.error}</div>}
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
              const shuffled = [...pool].sort(() => Math.random() - 0.5);
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
            onReplaceAll={replaceAll}
            onTopicClick={gotoProblemsWithTopic}
            onGotoGroup={(group, unattemptedOnly) => {
              setProblemNavRequest({ group, unattemptedOnly });
              setTab("problems");
            }}
          />
        )}
      </div>

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
            <RecordView
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
              onDelete={(id) => {
                deleteNote(id);
                setRecording(false);
                setEditingNoteId(null);
              }}
              filter={filter}
              setFilter={setFilter}
              formOnly
              initialEditId={editingNoteId}
              onCancelEdit={() => setEditingNoteId(null)}
            />
          </div>
        </div>
      )}
    </div>
  );
}
