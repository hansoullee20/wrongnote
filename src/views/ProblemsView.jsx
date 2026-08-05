import { useEffect, useMemo, useState } from "react";
import { CAUSES, MATH_TOPICS, isRecheckDue } from "../constants.js";
import {
  buildReviewGroups,
  REVIEW_STATE_LABELS,
  getLastAttempt,
  formatDaysAgo,
  isUnattempted,
} from "../review.js";
import { getImage } from "../imageStore.js";
import { Chip, TrajectoryDots } from "../components.jsx";

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
    <div className="prob-shot prob-shot--text">
      {text || <span className="prob-shot-none">캡처 없음</span>}
    </div>
  );
}

export default function ProblemsView({
  notes,
  cardDueCount,
  filter,
  setFilter,
  navigationRequest,
  onConsumeNavigationRequest,
  onOpenNote,
  onSolveNote,
  onRecord,
  onStartDue,
  onStartRandom,
}) {
  const [randomSize, setRandomSize] = useState(5);
  // 졸업은 기본 접힘 — 매일 볼 것은 불안정이지 졸업이 아니다
  const [graduatedOpen, setGraduatedOpen] = useState(false);
  // 통계의 '미재풀이' 탭 진입 — 불안정 중 attempt 0회만 표시
  const [unattemptedOnly, setUnattemptedOnly] = useState(false);

  /* 통계에서 넘어온 그룹 이동 요청을 소비한다 */
  useEffect(() => {
    if (!navigationRequest) return;
    setUnattemptedOnly(Boolean(navigationRequest.unattemptedOnly));
    if (navigationRequest.group === "graduated") setGraduatedOpen(true);
    const group = navigationRequest.group;
    requestAnimationFrame(() => {
      document
        .querySelector(`.review-group.${group}`)
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    onConsumeNavigationRequest();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigationRequest]);

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

  /* 안정성 그룹 — 불안정이 맨 앞. 예약(due)은 별도 축이라 '오늘' 표시로 남긴다 */
  const groups = useMemo(() => buildReviewGroups(visible), [visible]);
  const recheckDueCount = useMemo(() => notes.filter((n) => isRecheckDue(n)).length, [notes]);
  const todayCount = recheckDueCount + cardDueCount;

  const renderCard = (n) => {
    const last = getLastAttempt(n);
    return (
      <div
        key={n.id}
        className={`prob-card${isRecheckDue(n) ? " due" : ""}`}
      >
        {/* 카드 본문 탭 = 바로 풀기. 수정은 오른쪽 위 연필로 */}
        <button
          type="button"
          className="prob-card-main"
          onClick={() => onSolveNote(n.id)}
        >
          <ProblemShot note={n} />
          <div className="prob-meta">
            <div className="prob-id">{n.problem}</div>
            <div className="prob-topic">
              {n.topicMain}
              {n.topicSub ? ` · ${n.topicSub}` : ""}
            </div>
            <div className="prob-traj">
              <TrajectoryDots attempts={n.attempts} />
              {last && (
                <span className="prob-last">{formatDaysAgo(last.ts)}</span>
              )}
            </div>
            {n.cause ? (
              <span className="prob-cause">{n.cause}</span>
            ) : (
              <span className="prob-cause none">미분류</span>
            )}
          </div>
          {isRecheckDue(n) && <span className="prob-flag">오늘</span>}
        </button>
        <button
          type="button"
          className="prob-card-edit"
          aria-label={`${n.problem} 수정`}
          onClick={() => onOpenNote(n.id)}
        >
          ✎
        </button>
      </div>
    );
  };

  const groupOrder = [
    {
      key: "unstable",
      notes: unattemptedOnly
        ? groups.unstable.filter(isUnattempted)
        : groups.unstable,
    },
    { key: "progress", notes: groups.progress },
    { key: "graduated", notes: groups.graduated },
  ];

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

      {groupOrder.map(({ key, notes: groupNotes }) => {
        if (groupNotes.length === 0) return null;
        const collapsible = key === "graduated";
        const open = !collapsible || graduatedOpen;
        return (
          <section key={key} className={`review-group ${key}`}>
            {collapsible ? (
              <button
                type="button"
                className="group-label group-toggle"
                onClick={() => setGraduatedOpen((o) => !o)}
              >
                {REVIEW_STATE_LABELS[key]} {groupNotes.length}
                <span className="fold-arrow">{open ? "▾" : "▸"}</span>
              </button>
            ) : (
              <div className="group-label">
                {REVIEW_STATE_LABELS[key]} {groupNotes.length}
                {key === "unstable" && unattemptedOnly && (
                  <Chip
                    label="미재풀이만 ✕"
                    active
                    onClick={() => setUnattemptedOnly(false)}
                  />
                )}
              </div>
            )}
            {open && <div className="prob-grid">{groupNotes.map(renderCard)}</div>}
          </section>
        );
      })}

      <button type="button" className="fab" onClick={onRecord}>
        ＋ 기록
      </button>
    </div>
  );
}
