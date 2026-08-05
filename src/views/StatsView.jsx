import { useMemo } from "react";
import { CAUSES, MATH_TOPICS, isRecheckDue } from "../constants.js";
import {
  buildReviewGroups,
  isUnattempted,
  calculateImprovement,
  buildTagTrend,
} from "../review.js";
import { Section } from "../components.jsx";

export default function StatsView({
  notes,
  cards,
  onReplaceAll,
  onTopicClick,
  onGotoGroup,
}) {
  /* 재풀이 궤적 — ProblemsView와 같은 셀렉터를 쓴다 (숫자가 어긋나면 안 된다) */
  const groups = useMemo(() => buildReviewGroups(notes), [notes]);
  const unattemptedCount = useMemo(
    () => groups.unstable.filter(isUnattempted).length,
    [groups]
  );
  const improvement = useMemo(() => calculateImprovement(notes), [notes]);
  const tagTrend = useMemo(() => buildTagTrend(notes), [notes]);
  const maxTrend = tagTrend.reduce(
    (m, r) => Math.max(m, r.recent, r.previous),
    1
  );

  const tagCounts = useMemo(() => {
    const m = new Map();
    notes.forEach((n) => n.tags.forEach((t) => m.set(t, (m.get(t) || 0) + 1)));
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [notes]);
  const maxTagCount = tagCounts.length ? tagCounts[0][1] : 1;

  /* 주원인 분포 — 노트당 1개라 합계가 노트 수와 일치한다.
     미분류는 묻지 않고 따로 센다. */
  const causeCounts = useMemo(() => {
    const counts = CAUSES.map((cause) => ({
      cause,
      count: notes.filter((n) => n.cause === cause).length,
    }));
    counts.sort((a, b) => b.count - a.count);
    return counts;
  }, [notes]);
  const maxCauseCount = causeCounts.length ? causeCounts[0].count : 1;
  const unclassified = useMemo(
    () => notes.filter((n) => !n.cause).length,
    [notes]
  );

  const matrix = useMemo(() => {
    const topics = [...new Set(notes.map((n) => n.topicMain).filter(Boolean))];
    const order = Object.keys(MATH_TOPICS);
    topics.sort(
      (a, b) =>
        ((order.indexOf(a) + 1 || 999) - (order.indexOf(b) + 1 || 999)) ||
        a.localeCompare(b)
    );
    return topics.map((topic) => {
      const tn = notes.filter((n) => n.topicMain === topic);
      return {
        topic,
        cells: CAUSES.map((cause) => tn.filter((n) => n.cause === cause).length),
        none: tn.filter((n) => !n.cause).length,
      };
    });
  }, [notes]);

  /* 가장 약한 칸 하나만 강조 — 표를 훑지 않아도 눈에 박히게 */
  const worst = useMemo(() => {
    let best = null;
    matrix.forEach((row, r) =>
      row.cells.forEach((v, c) => {
        if (v > 0 && (!best || v > best.v)) best = { r, c, v };
      })
    );
    return best;
  }, [matrix]);

  const audit = useMemo(() => {
    // 완료 = 한 번이라도 재검증한 노트 (반복 사이클 도입 후 기준)
    const done = notes.filter((n) => n.recheckCount > 0);
    const pass = done.filter((n) => n.recheckResult === "pass").length;
    const fail = done.filter((n) => n.recheckResult === "fail").length;
    const waiting = notes.filter((n) => isRecheckDue(n)).length;
    const rate = pass + fail > 0 ? fail / (pass + fail) : 0;
    return { done: done.length, pass, fail, waiting, rate };
  }, [notes]);

  return (
    <div className="view">
      <Section title="재풀이 궤적">
        <div className="audit-grid">
          <button
            type="button"
            className="audit-cell traj-cell"
            onClick={() => onGotoGroup("unstable", false)}
          >
            <div className="audit-num red">{groups.unstable.length}</div>
            <div className="audit-label">불안정</div>
          </button>
          <button
            type="button"
            className="audit-cell traj-cell"
            onClick={() => onGotoGroup("progress", false)}
          >
            <div className="audit-num">{groups.progress.length}</div>
            <div className="audit-label">진행 중</div>
          </button>
          <button
            type="button"
            className="audit-cell traj-cell"
            onClick={() => onGotoGroup("graduated", false)}
          >
            <div className="audit-num green">{groups.graduated.length}</div>
            <div className="audit-label">졸업</div>
          </button>
          <button
            type="button"
            className="audit-cell traj-cell"
            onClick={() => onGotoGroup("unstable", true)}
          >
            <div className="audit-num">{unattemptedCount}</div>
            {/* 불안정의 부분집합 — 네 숫자를 합산하면 안 된다 */}
            <div className="audit-label">미재풀이 · 불안정 중</div>
          </button>
        </div>
        <div className="improve-line">
          {improvement.eligible > 0 ? (
            <>
              틀렸던 {improvement.eligible}건 중 {improvement.improved}건 개선
              — <b>{Math.round(improvement.rate * 100)}%</b>
            </>
          ) : (
            "아직 재풀이에서 틀린 기록이 없다 — 개선율은 fail 이후에 계산된다"
          )}
        </div>
        <div className="hint">숫자를 탭하면 문제 탭의 해당 그룹으로 간다</div>
      </Section>

      <Section title="재풀이 포함 태그 변화">
        {tagTrend.length === 0 && <div className="empty">데이터 없음.</div>}
        {tagTrend.map((row) => {
          const lowVolume = row.recent + row.previous < 2;
          const marker = lowVolume
            ? ""
            : row.recent > row.previous
              ? "up"
              : row.recent < row.previous
                ? "down"
                : "";
          return (
            <div key={row.tag} className="trend-row">
              <span className="bar-label">{row.tag}</span>
              <div className="trend-bars">
                <div className="bar-track sm">
                  <div
                    className="bar-fill prev"
                    style={{ width: `${(row.previous / maxTrend) * 100}%` }}
                  />
                </div>
                <div className="bar-track sm">
                  <div
                    className="bar-fill"
                    style={{ width: `${(row.recent / maxTrend) * 100}%` }}
                  />
                </div>
              </div>
              <span className="trend-counts">
                {row.previous}→{row.recent}
              </span>
              {marker === "up" && (
                <span className="trend-marker up">↑ 증가</span>
              )}
              {marker === "down" && (
                <span className="trend-marker down">↓ 감소</span>
              )}
              <span className="bar-count">{row.total}</span>
            </div>
          );
        })}
        <div className="hint">
          직전 14일 → 최근 14일 (기록 + 재풀이 실패). 맨 오른쪽은 전체 발생
          수 — 전체는 줄 수 없으니 추이는 두 창 비교로 본다
        </div>
      </Section>

      <Section title="주원인 분포">
        {notes.length === 0 && <div className="empty">데이터 없음.</div>}
        {causeCounts.map(({ cause, count }) => (
          <div key={cause} className="bar-row">
            <span className="bar-label">{cause}</span>
            <div className="bar-track">
              {count > 0 && (
                <div
                  className="bar-fill"
                  style={{ width: `${(count / maxCauseCount) * 100}%` }}
                />
              )}
            </div>
            <span className="bar-count">{count}</span>
          </div>
        ))}
        {unclassified > 0 && (
          <div className="unclassified">
            <span className="unclassified-num">{unclassified}</span>
            <span className="unclassified-text">
              주원인이 비어 있는 노트. 옛 분류에서 뜻을 확정할 수 없어 추측하지
              않고 남겨뒀다 — 기록 뷰에서 하나씩 골라주면 위 통계에 합류한다.
            </span>
          </div>
        )}
      </Section>

      {/* 최초 기록만 센다 — 재풀이 포함 집계는 위 '태그 변화' 섹션 */}
      <Section title="최초 기록 세부 태그 분포">
        {tagCounts.length === 0 && <div className="empty">데이터 없음.</div>}
        {tagCounts.map(([tag, count]) => (
          <div key={tag} className="bar-row">
            <span className="bar-label">{tag}</span>
            <div className="bar-track">
              <div
                className="bar-fill"
                style={{ width: `${(count / maxTagCount) * 100}%` }}
              />
            </div>
            <span className="bar-count">{count}</span>
          </div>
        ))}
      </Section>

      <Section title="토픽 × 주원인">
        {matrix.length === 0 && <div className="empty">데이터 없음.</div>}
        {matrix.length > 0 && (
          <table className="matrix">
            <thead>
              <tr>
                <th>토픽</th>
                {CAUSES.map((c) => (
                  <th key={c}>{c.split(" ")[0]}</th>
                ))}
                {unclassified > 0 && <th>미분류</th>}
              </tr>
            </thead>
            <tbody>
              {matrix.map((row, r) => (
                <tr key={row.topic} onClick={() => onTopicClick(row.topic)}>
                  <td className="matrix-topic">{row.topic}</td>
                  {row.cells.map((v, c) => (
                    <td
                      key={CAUSES[c]}
                      className={
                        worst && worst.r === r && worst.c === c
                          ? "hit worst"
                          : v
                            ? "hit"
                            : ""
                      }
                    >
                      {v || ""}
                    </td>
                  ))}
                  {unclassified > 0 && (
                    <td className={row.none ? "dim" : ""}>{row.none || ""}</td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div className="hint">
          진한 칸이 제일 약한 지점. 행 탭 → 기록 뷰에서 해당 토픽 필터
        </div>
      </Section>

      <Section title="재검증 감사">
        <div className="audit-grid">
          <div className="audit-cell">
            <div className="audit-num">{audit.done}</div>
            <div className="audit-label">완료</div>
          </div>
          <div className="audit-cell">
            <div className="audit-num green">{audit.pass}</div>
            <div className="audit-label">실행 확정</div>
          </div>
          <div className="audit-cell">
            <div className="audit-num red">{audit.fail}</div>
            <div className="audit-label">개념 갭 재분류</div>
          </div>
          <div className="audit-cell">
            <div className="audit-num">{audit.waiting}</div>
            <div className="audit-label">대기</div>
          </div>
        </div>
        {audit.done > 0 && audit.rate > 0.4 && (
          <div className="audit-warn">
            재분류율 {Math.round(audit.rate * 100)}% — 실행 실수 자가 태깅이
            개념 갭을 가리고 있음. 태깅 기준 재점검.
          </div>
        )}
      </Section>

    </div>
  );
}
