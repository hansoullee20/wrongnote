import { useMemo, useState } from "react";
import { SUBJECTS } from "../constants.js";
import { dueCards } from "../srs.js";
import { Button, Field, Badge, ChipRow } from "../components.jsx";

const emptyCardDraft = { front: "", back: "", subject: "수학" };

/** 복습 세션 — due 카드를 하나씩 뒤집고 채점 */
function ReviewSession({ cards, onGrade }) {
  const [flipped, setFlipped] = useState(false);
  const [doneCount, setDoneCount] = useState(0);

  const due = useMemo(() => dueCards(cards), [cards]);

  if (due.length === 0) {
    return (
      <>
        <div className="card-count">
          오늘 복습 완료 {doneCount > 0 ? `— ${doneCount}장 했다` : ""}
        </div>
        <div className="empty">
          복습 예정 카드 없음. 내일 다시 오면 된다.
        </div>
      </>
    );
  }

  const card = due[0];

  const grade = (g) => {
    onGrade(card.id, g);
    setFlipped(false);
    setDoneCount((c) => c + 1);
  };

  return (
    <>
      <div className="card-count">
        남은 카드 {due.length}장 · 완료 {doneCount}장
      </div>
      <button
        type="button"
        className={`flashcard${flipped ? " flipped" : ""}`}
        onClick={() => setFlipped((f) => !f)}
      >
        <div className="card-side-label">{flipped ? "뒷면" : "앞면"}</div>
        <div className="card-text">{flipped ? card.back : card.front}</div>
        <div className="card-hint">
          {flipped ? "기억났으면 채점해라" : "떠올린 다음 탭해서 확인"}
        </div>
      </button>
      {flipped ? (
        <div className="grade-row">
          <Button variant="danger" onClick={() => grade("again")}>
            다시
          </Button>
          <Button variant="neutral" onClick={() => grade("good")}>
            좋음
          </Button>
          <Button variant="success" onClick={() => grade("easy")}>
            쉬움
          </Button>
        </div>
      ) : (
        <div className="hint">앞면 보고 스스로 인출 → 탭 → 채점</div>
      )}
    </>
  );
}

/** 카드 관리 — 전체 목록 + 추가/수정/삭제 */
function ManageCards({ cards, onAdd, onUpdate, onDelete }) {
  const [draft, setDraft] = useState(emptyCardDraft);
  const [editingId, setEditingId] = useState(null);

  const canSubmit = draft.front.trim() && draft.back.trim();

  const submit = () => {
    if (!canSubmit) return;
    if (editingId) {
      onUpdate(editingId, {
        front: draft.front.trim(),
        back: draft.back.trim(),
        subject: draft.subject,
      });
    } else {
      onAdd({
        front: draft.front.trim(),
        back: draft.back.trim(),
        subject: draft.subject,
      });
    }
    setDraft(emptyCardDraft);
    setEditingId(null);
  };

  const startEdit = (card) => {
    setEditingId(card.id);
    setDraft({ front: card.front, back: card.back, subject: card.subject });
  };

  return (
    <>
      <div className="form-group">
        <div className="form-group-title">
          {editingId ? "카드 수정 중" : "카드 추가"}
        </div>
        <ChipRow
          options={SUBJECTS}
          value={draft.subject}
          onPick={(s) => setDraft((d) => ({ ...d, subject: s }))}
        />
        <Field label="앞면 — 질문/인출 단서">
          <textarea
            rows={2}
            value={draft.front}
            onChange={(e) =>
              setDraft((d) => ({ ...d, front: e.target.value }))
            }
          />
        </Field>
        <Field label="뒷면 — 답/유도 과정">
          <textarea
            rows={2}
            value={draft.back}
            onChange={(e) => setDraft((d) => ({ ...d, back: e.target.value }))}
          />
        </Field>
        <div className="grade-row">
          <Button variant="primary" disabled={!canSubmit} onClick={submit}>
            {editingId ? "수정 저장" : "추가"}
          </Button>
          {editingId && (
            <Button
              variant="neutral"
              onClick={() => {
                setEditingId(null);
                setDraft(emptyCardDraft);
              }}
            >
              취소
            </Button>
          )}
        </div>
      </div>

      <div className="note-list">
        {cards.length === 0 && <div className="empty">카드 없음.</div>}
        {cards.map((c) => (
          <div key={c.id} className="note">
            <div className="note-row">
              <div className="note-row-head">
                <Badge tone="info">{c.subject}</Badge>
                <span className="note-prob">{c.front}</span>
                <span className="note-date">
                  {c.state === "new" ? "새 카드" : `${c.interval}일 간격`}
                </span>
              </div>
              <div className="note-preview">{c.back}</div>
              <div className="card-manage-actions">
                <Button variant="neutral" onClick={() => startEdit(c)}>
                  수정
                </Button>
                <Button
                  variant="danger"
                  onClick={() => {
                    if (confirm("이 카드를 삭제할까?")) onDelete(c.id);
                  }}
                >
                  삭제
                </Button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

export default function CardsView({ cards, onGrade, onAdd, onUpdate, onDelete }) {
  const [mode, setMode] = useState("review"); // 'review' | 'manage'

  if (cards.length === 0 && mode === "review") {
    return (
      <div className="view cards-view">
        <div className="empty">
          카드 없음. 기록에서 "재유도함"을 선택하면 자동 생성되고, 카드
          관리에서 직접 추가할 수도 있다.
        </div>
        <Button variant="neutral" onClick={() => setMode("manage")}>
          카드 관리
        </Button>
      </div>
    );
  }

  return (
    <div className="view cards-view">
      <div className="mode-row">
        <Button
          variant={mode === "review" ? "primary" : "neutral"}
          onClick={() => setMode("review")}
        >
          복습
        </Button>
        <Button
          variant={mode === "manage" ? "primary" : "neutral"}
          onClick={() => setMode("manage")}
        >
          카드 관리
        </Button>
      </div>

      {mode === "review" ? (
        <ReviewSession cards={cards} onGrade={onGrade} />
      ) : (
        <ManageCards
          cards={cards}
          onAdd={onAdd}
          onUpdate={onUpdate}
          onDelete={onDelete}
        />
      )}
    </div>
  );
}
