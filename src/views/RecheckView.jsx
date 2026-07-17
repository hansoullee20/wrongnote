import { useMemo } from "react";
import { DAY_MS, RECHECK_DAYS } from "../constants.js";
import { TagBadges } from "../components.jsx";

export default function RecheckView({ notes, onResolve }) {
  const due = useMemo(
    () =>
      notes.filter(
        (n) => !n.rechecked && Date.now() - n.ts >= RECHECK_DAYS * DAY_MS
      ),
    [notes]
  );

  return (
    <div className="view">
      <div className="notice">
        풀이 안 보고 cold re-solve. 또 틀리면 개념 갭 자동 재분류.
      </div>

      {due.length === 0 && (
        <div className="empty">
          재검증 대기 항목 없음. 기록 후 14일 지난 항목이 여기 표시된다.
        </div>
      )}

      {due.map((n) => (
        <div key={n.id} className="recheck-item">
          <div className="rc-head">
            <span className="note-subj">{n.subject}</span>
            <span className="note-prob">{n.problem}</span>
            <span className="note-topic">
              {n.topicMain}
              {n.topicSub ? `·${n.topicSub}` : ""}
            </span>
            <span className="note-date">{n.date}</span>
          </div>
          {n.question && <div className="rc-question">{n.question}</div>}
          <TagBadges tags={n.tags} />
          <div className="rc-actions">
            <button
              type="button"
              className="rc-pass"
              onClick={() => onResolve(n.id, "pass")}
            >
              맞음 → 실행 실수 확정
            </button>
            <button
              type="button"
              className="rc-fail"
              onClick={() => onResolve(n.id, "fail")}
            >
              또 틀림 → 개념 갭 재분류
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
