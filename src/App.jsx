import { useEffect, useMemo, useState } from "react";
import { DAY_MS, RECHECK_DAYS, fmtDate, uid } from "./constants.js";
import { loadNotes, loadCards, saveNotes, saveCards } from "./storage.js";
import RecordView from "./views/RecordView.jsx";
import RecheckView from "./views/RecheckView.jsx";
import CardsView from "./views/CardsView.jsx";
import StatsView from "./views/StatsView.jsx";

const TABS = [
  { id: "record", label: "기록" },
  { id: "recheck", label: "재검증" },
  { id: "cards", label: "카드" },
  { id: "stats", label: "통계" },
];

export default function App() {
  const [notes, setNotes] = useState(loadNotes);
  const [cards, setCards] = useState(loadCards);
  const [tab, setTab] = useState("record");
  const [filter, setFilter] = useState({ tag: "", topicMain: "" });

  useEffect(() => saveNotes(notes), [notes]);
  useEffect(() => saveCards(cards), [cards]);

  const dueCount = useMemo(
    () =>
      notes.filter(
        (n) => !n.rechecked && Date.now() - n.ts >= RECHECK_DAYS * DAY_MS
      ).length,
    [notes]
  );

  function addNote(draft) {
    const ts = Date.now();
    let tags = draft.tags;
    if (draft.derived === "yes" && !tags.includes("지위 오해")) {
      tags = [...tags, "지위 오해"];
    }
    const note = {
      ...draft,
      tags,
      id: uid(),
      ts,
      date: fmtDate(ts),
      rechecked: false,
      recheckResult: null,
    };
    setNotes((ns) => [note, ...ns]);

    // 재유도 → 플래시카드 자동 생성 (동일 front 존재 시 스킵)
    if (note.derived === "yes") {
      setCards((cs) => {
        const front = note.problem;
        if (!front || cs.some((c) => c.front === front)) return cs;
        return [
          ...cs,
          {
            id: uid(),
            noteId: note.id,
            subject: note.subject,
            front,
            back: note.optSol,
          },
        ];
      });
    }
  }

  function deleteNote(id) {
    setNotes((ns) => ns.filter((n) => n.id !== id));
  }

  function resolveRecheck(id, result) {
    setNotes((ns) =>
      ns.map((n) => {
        if (n.id !== id) return n;
        if (result === "pass") {
          return { ...n, rechecked: true, recheckResult: "pass" };
        }
        const tags = n.tags.filter((t) => t !== "실행 실수");
        if (!tags.includes("개념 오류")) tags.push("개념 오류");
        return {
          ...n,
          rechecked: true,
          recheckResult: "fail",
          tags,
          memo: (n.memo ? n.memo + " " : "") + "[재검증 실패→개념갭]",
        };
      })
    );
  }

  function replaceAll(newNotes, newCards) {
    setNotes(newNotes);
    setCards(newCards);
  }

  function gotoRecordWithTopic(topicMain) {
    setFilter({ tag: "", topicMain });
    setTab("record");
  }

  return (
    <div className="app">
      <header className="masthead">
        <span className="masthead-sub">대학수학능력시험 대비</span>
        <h1 className="masthead-title">오답노트</h1>
        <span className="masthead-stamp">채점완료</span>
      </header>

      <nav className="tabs">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`tab${tab === t.id ? " on" : ""}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
            {t.id === "recheck" && dueCount > 0 ? ` ${dueCount}` : ""}
          </button>
        ))}
      </nav>

      <div className="paper-sheet">
      {tab === "record" && (
        <RecordView
          notes={notes}
          onAdd={addNote}
          onDelete={deleteNote}
          filter={filter}
          setFilter={setFilter}
        />
      )}
      {tab === "recheck" && (
        <RecheckView notes={notes} onResolve={resolveRecheck} />
      )}
      {tab === "cards" && <CardsView cards={cards} />}
      {tab === "stats" && (
        <StatsView
          notes={notes}
          cards={cards}
          onReplaceAll={replaceAll}
          onTopicClick={gotoRecordWithTopic}
        />
      )}
      </div>
    </div>
  );
}
