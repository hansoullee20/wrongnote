import { useState } from "react";

export default function CardsView({ cards }) {
  const [i, setI] = useState(0);
  const [flipped, setFlipped] = useState(false);

  if (cards.length === 0) {
    return (
      <div className="view">
        <div className="empty">
          카드 없음. 기록에서 "재유도함"을 선택하면 자동 생성된다.
        </div>
      </div>
    );
  }

  const idx = Math.min(i, cards.length - 1);
  const card = cards[idx];

  return (
    <div className="view cards-view">
      <div className="card-count">
        {idx + 1} / {cards.length}
      </div>
      <button
        type="button"
        className={`flashcard${flipped ? " flipped" : ""}`}
        onClick={() => setFlipped((f) => !f)}
      >
        <div className="card-side-label">{flipped ? "뒷면" : "앞면"}</div>
        <div className="card-text">{flipped ? card.back : card.front}</div>
        <div className="card-hint">탭하면 뒤집힘</div>
      </button>
      <button
        type="button"
        className="next-btn"
        onClick={() => {
          setI((idx + 1) % cards.length);
          setFlipped(false);
        }}
      >
        다음
      </button>
    </div>
  );
}
