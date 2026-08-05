import { useEffect, useMemo, useState } from "react";
import { CAUSES, MATH_TOPICS, isRecheckDue } from "../constants.js";
import { getImage } from "../imageStore.js";
import { Chip } from "../components.jsx";

/**
 * 문제 캡처 썸네일. 없으면 문제 원문 텍스트로 대신한다 —
 * 목록에서 문제가 안 보이면 오답노트로서 의미가 없다.
 */
function ProblemShot({ note }) {
  const [url, setUrl] = useState("");
  const firstId = note.images?.[0];

  useEffect(() => {
    if (!firstId) return undefined;
    let alive = true;
    let created = "";
    (async () => {
      const blob = await getImage(firstId);
      if (!blob) return;
      created = URL.createObjectURL(blob);
      if (alive) setUrl(created);
      else URL.revokeObjectURL(created);
    })();
    return () => {
      alive = false;
      if (created) URL.revokeObjectURL(created);
    };
  }, [firstId]);

  if (url) return <img className="prob-shot" src={url} alt="" />;

  const text = note.question?.trim() || note.mySol?.trim();
  return (
    <div
      className={`prob-shot prob-shot--text${text ? "" : " prob-shot--empty"}`}
    >
      {text || <span className="prob-shot-none">사진 없음</span>}
    </div>
  );
}

export default function ProblemsView({
  notes,
  cardDueCount,
  filter,
  setFilter,
  onOpenNote,
  onRecord,
  onStartDue,
  onStartRandom,
}) {
  const [randomSize, setRandomSize] = useState(5);

  const causeCounts = useMemo(() => {
    const map = new Map(CAUSES.map((c) => [c, 0]));
    notes.forEach((n) => {
      if (map.has(n.cause)) map.set(n.cause, map.get(n.cause) + 1);
    });
    return map;
  }, [notes]);

  const topicsInUse = useMemo(() => {
    const present = new Set(notes.map((n) => n.topicMain).filter(Boolean));
    const order = Object.keys(MATH_TOPICS);
    return [
      ...order.filter((t) => present.has(t)),
      ...[...present].filter((t) => !order.includes(t)),
    ];
  }, [notes]);

  const visible = useMemo(
    () =>
      notes.filter(
        (n) =>
          (!filter.cause || n.cause === filter.cause) &&
          (!filter.topicMain || n.topicMain === filter.topicMain)
      ),
    [notes, filter]
  );

  /* 복습할 것이 앞으로 온다 — "오늘 뭐 하지"를 사용자가 고르지 않게 한다 */
  const due = useMemo(() => visible.filter((n) => isRecheckDue(n)), [visible]);
  const rest = useMemo(() => visible.filter((n) => !isRecheckDue(n)), [visible]);
  const recheckDueCount = useMemo(() => notes.filter((n) => isRecheckDue(n)).length, [notes]);
  const todayCount = recheckDueCount + cardDueCount;

  const renderCard = (n) => (
    <button
      key={n.id}
      type="button"
      className={`prob-card${isRecheckDue(n) ? " due" : ""}`}
      onClick={() => onOpenNote(n.id)}
    >
      <ProblemShot note={n} />
      <div className="prob-meta">
        <div className="prob-id">
          {n.problem}
          {n.recheckCount > 0 && (
            <span className="prob-try">{n.recheckCount + 1}번째</span>
          )}
        </div>
        <div className="prob-topic">
          {n.topicMain}
          {n.topicSub ? ` · ${n.topicSub}` : ""}
        </div>
        {n.cause ? (
          <span className="prob-cause">{n.cause}</span>
        ) : (
          <span className="prob-cause none">미분류</span>
        )}
      </div>
      {isRecheckDue(n) && <span className="prob-flag">오늘</span>}
    </button>
  );

  return (
    <div className="view">
      {todayCount > 0 && (
        <div className="today-strip">
          <span className="today-num">{todayCount}</span>
          <span className="today-text">
            오늘 볼 것 — 재검증 {recheckDueCount}, 카드 {cardDueCount}
            <br />
            아래 그리드 맨 앞에 모여 있다
          </span>
          <button type="button" className="today-go" onClick={onStartDue}>
            바로 시작
          </button>
        </div>
      )}

      <div className="filter-bar">
        <Chip
          label={`전체 ${notes.length}`}
          active={!filter.cause}
          onClick={() => setFilter((f) => ({ ...f, cause: "" }))}
        />
        {CAUSES.map((c) => (
          <Chip
            key={c}
            label={`${c.split(" ")[0]} ${causeCounts.get(c)}`}
            active={filter.cause === c}
            onClick={() =>
              setFilter((f) => ({ ...f, cause: f.cause === c ? "" : c }))
            }
          />
        ))}
        <span className="filter-spacer" />
        <select
          className="topic-select"
          value={filter.topicMain}
          onChange={(e) =>
            setFilter((f) => ({ ...f, topicMain: e.target.value }))
          }
        >
          <option value="">토픽 전체</option>
          {topicsInUse.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        {onStartRandom && (
          <button
            type="button"
            className="btn-random"
            disabled={visible.length === 0}
            onClick={() => onStartRandom(visible, randomSize)}
          >
            랜덤 {randomSize}문제
          </button>
        )}
      </div>

      {visible.length === 0 && (
        <div className="empty">
          {notes.length === 0
            ? "기록 없음. 오른쪽 아래 + 기록으로 시작해라."
            : "이 조건에 맞는 문제 없음."}
        </div>
      )}

      {due.length > 0 && (
        <>
          <div className="group-label">오늘 볼 것</div>
          <div className="prob-grid">{due.map(renderCard)}</div>
        </>
      )}

      {rest.length > 0 && (
        <>
          {due.length > 0 && <div className="group-label">그 밖에</div>}
          <div className="prob-grid">{rest.map(renderCard)}</div>
        </>
      )}

      <button type="button" className="fab" onClick={onRecord}>
        ＋ 기록
      </button>
    </div>
  );
}
