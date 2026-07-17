import { useMemo } from "react";
import { isRecheckDue } from "../constants.js";
import { TagBadges, Badge, Button } from "../components.jsx";

export default function RecheckView({ notes, onResolve }) {
  // App의 탭 배지와 동일한 기준 (isRecheckDue)
  const due = useMemo(() => notes.filter((n) => isRecheckDue(n)), [notes]);

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
            <Badge tone="info">{n.subject}</Badge>
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
            <Button variant="success" onClick={() => onResolve(n.id, "pass")}>
              <span className="grade-mark pass">○</span> 맞음 → 실행 실수 확정
            </Button>
            <Button variant="danger" onClick={() => onResolve(n.id, "fail")}>
              <span className="grade-mark fail">✗</span> 또 틀림 → 개념 갭
              재분류
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}
