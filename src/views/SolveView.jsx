import { useEffect, useMemo, useRef, useState } from "react";
import { CAUSES, CHOICES, isRecheckDue } from "../constants.js";
import { getImage } from "../imageStore.js";
import { Chip } from "../components.jsx";

const fmtSec = (s) =>
  s >= 60 ? `${Math.floor(s / 60)}분 ${String(s % 60).padStart(2, "0")}초` : `${s}초`;

/** 캡처가 있으면 캡처, 없으면 원문 텍스트 */
function Shot({ note }) {
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

  if (url) return <img className="solve-shot" src={url} alt="문제 캡처" />;
  return (
    <div className="solve-shot solve-shot--text">
      {note.question?.trim() || (
        <span className="muted">
          캡처도 원문도 없다. 문제집을 보고 풀어라 — {note.problem}
        </span>
      )}
    </div>
  );
}

/** 흘러가는 타이머. 문제가 뜨는 순간 시작한다. */
function Timer({ startedAt }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [startedAt]);
  const sec = Math.max(0, Math.floor((now - startedAt) / 1000));
  return (
    <span className="timer">
      <span className="timer-num">
        {String(Math.floor(sec / 60)).padStart(2, "0")}:
        {String(sec % 60).padStart(2, "0")}
      </span>
      <span className="timer-cap">재는 중</span>
    </span>
  );
}

export default function SolveView({
  notes,
  cardDueCount,
  initialQueue,
  onConsumeInitialQueue,
  onRecordAttempt,
  onSetCorrectAnswer,
  onOpenNote,
  onGotoCards,
}) {
  const [queue, setQueue] = useState([]); // 노트 id 배열
  const [index, setIndex] = useState(0);
  const [results, setResults] = useState([]); // {id, correct, seconds, answer}
  const [phase, setPhase] = useState("idle"); // idle | solving | graded | summary
  const [picked, setPicked] = useState("");
  const [freeAnswer, setFreeAnswer] = useState("");
  const [answerFix, setAnswerFix] = useState(""); // 정답이 비어 있을 때 지금 입력
  const [randomSize, setRandomSize] = useState(5);
  const [scope, setScope] = useState({ label: "", cause: "" });
  const startedAt = useRef(0);

  const dueNotes = useMemo(() => notes.filter((n) => isRecheckDue(n)), [notes]);

  const start = (ids, label) => {
    if (ids.length === 0) return;
    setQueue(ids);
    setIndex(0);
    setResults([]);
    setPicked("");
    setFreeAnswer("");
    setAnswerFix("");
    setScope({ label });
    setPhase("solving");
    startedAt.current = Date.now();
  };

  // 문제 그리드의 '바로 시작' / '랜덤' 진입
  useEffect(() => {
    if (!initialQueue) return;
    start(initialQueue.ids, initialQueue.label);
    onConsumeInitialQueue();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialQueue]);

  const current = useMemo(
    () => notes.find((n) => n.id === queue[index]),
    [notes, queue, index]
  );

  /* 큐에 담긴 노트가 도중에 사라지면(삭제 등) 세션을 끝낸다 */
  useEffect(() => {
    if (phase === "solving" && queue.length > 0 && !current) setPhase("summary");
  }, [phase, queue, current]);

  if (phase === "idle") {
    return (
      <div className="view">
        <div className={`mode${dueNotes.length ? " primary" : ""}`}>
          <span className="mode-num">{dueNotes.length}</span>
          <div className="mode-body">
            <div className="mode-title">오늘 볼 것</div>
            <div className="mode-desc">
              복습 주기가 돌아온 문제들. 이것부터 하는 게 맞다.
            </div>
          </div>
          <button
            type="button"
            className="mode-go"
            disabled={dueNotes.length === 0}
            onClick={() =>
              start(
                dueNotes.map((n) => n.id),
                "오늘 볼 것"
              )
            }
          >
            시작
          </button>
        </div>

        <div className="mode">
          <span className="mode-num">∞</span>
          <div className="mode-body">
            <div className="mode-title">랜덤으로 뽑기</div>
            <div className="mode-desc">
              일정과 상관없이 실전처럼. 약점만 골라서 뽑을 수도 있다.
            </div>
            <div className="mode-picker">
              {[5, 10].map((n) => (
                <Chip
                  key={n}
                  label={`${n}문제`}
                  active={randomSize === n}
                  onClick={() => setRandomSize(n)}
                />
              ))}
              <Chip
                label="전체에서"
                active={!scope.cause}
                onClick={() => setScope((s) => ({ ...s, cause: "" }))}
              />
              {CAUSES.map((c) => (
                <Chip
                  key={c}
                  label={c.split(" ")[0]}
                  active={scope.cause === c}
                  onClick={() =>
                    setScope((s) => ({ ...s, cause: s.cause === c ? "" : c }))
                  }
                />
              ))}
            </div>
          </div>
          <button
            type="button"
            className="mode-go ghost"
            onClick={() => {
              const pool = scope.cause
                ? notes.filter((n) => n.cause === scope.cause)
                : notes;
              const shuffled = [...pool].sort(() => Math.random() - 0.5);
              start(
                shuffled.slice(0, randomSize).map((n) => n.id),
                scope.cause ? `${scope.cause}에서` : "전체에서"
              );
            }}
          >
            뽑기
          </button>
        </div>

        {cardDueCount > 0 && (
          <div className="mode">
            <span className="mode-num">{cardDueCount}</span>
            <div className="mode-body">
              <div className="mode-title">암기 카드</div>
              <div className="mode-desc">
                문제를 다시 푸는 게 아니라 개념·공식을 떠올리는 쪽.
              </div>
            </div>
            <button type="button" className="mode-go ghost" onClick={onGotoCards}>
              카드로
            </button>
          </div>
        )}
      </div>
    );
  }

  if (phase === "summary") {
    const solved = results.length;
    const right = results.filter((r) => r.correct).length;
    const totalSec = results.reduce((a, r) => a + r.seconds, 0);
    const wrongIds = results.filter((r) => !r.correct).map((r) => r.id);

    const lines = results.map((r) => {
      const n = notes.find((x) => x.id === r.id);
      const past = (n?.attempts || []).slice(0, -1);
      const prevSame = past.filter(
        (a) => !a.correct && a.answer && a.answer === r.answer
      ).length;
      const firstSec = past[0]?.seconds;
      return { r, n, prevSame, firstSec };
    });

    return (
      <div className="view">
        <div className="sum-head">
          <span className="sum-score">
            {right}
            <small> / {solved}</small>
          </span>
          <div className="sum-meta">
            {scope.label}
            <br />
            {solved - right > 0 ? `${solved - right}개는 또 틀렸다` : "전부 맞았다"}
          </div>
          <div className="sum-time">
            총 {fmtSec(totalSec)}
            <br />
            문제당 평균 {fmtSec(Math.round(totalSec / Math.max(1, solved)))}
          </div>
        </div>

        {lines.some(({ r }) => r.correct) && (
          <div className="sec-label">좋아진 것</div>
        )}
        {lines
          .filter(({ r }) => r.correct)
          .map(({ r, n, firstSec }) => (
            <div key={r.id} className="card-line good">
              <span className="cl-id">{n?.problem}</span>
              <span className="cl-body">
                {firstSec && firstSec > r.seconds
                  ? `${fmtSec(firstSec)} → ${fmtSec(r.seconds)} 로 줄고 이번엔 맞음.`
                  : `${fmtSec(r.seconds)} 만에 맞음.`}
              </span>
              <span className="cl-mark o">○</span>
            </div>
          ))}

        {lines.some(({ r }) => !r.correct) && (
          <div className="sec-label">아직인 것</div>
        )}
        {lines
          .filter(({ r }) => !r.correct)
          .map(({ r, n, prevSame, firstSec }) => (
            <div key={r.id} className="card-line bad">
              <span className="cl-id">{n?.problem}</span>
              <span className="cl-body">
                {prevSame > 0 ? (
                  <>
                    <b>
                      {r.answer}를 {prevSame + 1}번째 골랐다.
                    </b>{" "}
                    {firstSec && firstSec > r.seconds
                      ? `시간은 ${fmtSec(firstSec)} → ${fmtSec(r.seconds)}로 줄었는데 답은 그대로. 빨리 틀리고 있다 — 접근 자체가 굳었다는 뜻.`
                      : "같은 함정에 반복해서 걸린다."}
                  </>
                ) : (
                  `${n?.recheckCount || 1}번째 오답. 다음 복습이 내일로 당겨진다.`
                )}
              </span>
              <span className="cl-mark x">✗</span>
            </div>
          ))}

        {/* 실행 실수로 기록했는데 같은 오답을 반복하면 분류 자체가 틀렸을 수 있다 */}
        {lines
          .filter(
            ({ r, n, prevSame }) =>
              !r.correct && prevSame >= 1 && n?.cause === "실행 실수"
          )
          .map(({ n }) => (
            <div key={n.id} className="callout">
              <span className="callout-mark">확인</span>
              <div className="callout-body">
                <b>{n.problem}</b> 는 <b>실행 실수</b> 로 기록해뒀는데 같은 오답을
                반복해서 골랐다. 계산이 미끄러진 게 아니라{" "}
                <b>개념이나 접근이 비어 있을</b> 가능성이 높다. 주원인을 다시
                볼까?
                <br />
                <button
                  type="button"
                  className="callout-act"
                  onClick={() => onOpenNote(n.id)}
                >
                  주원인 고치기
                </button>
              </div>
            </div>
          ))}

        <div className="end-row">
          {wrongIds.length > 0 && (
            <button
              type="button"
              className="end-btn ghost"
              onClick={() => start(wrongIds, `틀린 ${wrongIds.length}개 다시`)}
            >
              틀린 {wrongIds.length}개만 다시
            </button>
          )}
          <button
            type="button"
            className="end-btn"
            onClick={() => setPhase("idle")}
          >
            끝내기
          </button>
        </div>
      </div>
    );
  }

  if (!current) return <div className="view"><div className="empty">문제 없음.</div></div>;

  const answer = picked || freeAnswer.trim();
  const knownCorrect = current.correctAnswer?.trim();
  const past = current.attempts || [];
  const lastWrong = [...past].reverse().find((a) => !a.correct);

  function grade(forcedCorrect) {
    const seconds = Math.max(1, Math.round((Date.now() - startedAt.current) / 1000));
    const correct =
      forcedCorrect !== undefined
        ? forcedCorrect
        : answer === knownCorrect;

    // 정답이 비어 있던 노트라면 지금 입력한 정답을 저장해 다음부터 자동 채점되게
    const fix = answerFix.trim();
    if (!knownCorrect && fix) onSetCorrectAnswer(current.id, fix);

    onRecordAttempt(current.id, { answer, correct, seconds });
    setResults((rs) => [...rs, { id: current.id, correct, seconds, answer }]);
    setPhase("graded");
  }

  function next() {
    if (index + 1 >= queue.length) {
      setPhase("summary");
      return;
    }
    setIndex((i) => i + 1);
    setPicked("");
    setFreeAnswer("");
    setAnswerFix("");
    setPhase("solving");
    startedAt.current = Date.now();
  }

  const justResult = results[results.length - 1];

  return (
    <div className="view">
      <div className="solve-head">
        <span className="solve-kind">
          {scope.label || "다시 풀기"}
        </span>
        <span className="solve-scope">{current.topicMain}</span>
        <span className="solve-prog">
          {index + 1} / {queue.length}
        </span>
        {phase === "solving" && <Timer startedAt={startedAt.current} />}
      </div>

      <Shot note={current} />

      {phase === "solving" && (
        <>
          <div className="veil">
            <span className="veil-mark">가림</span>
            최적 풀이 · 처음 틀린 이유 · 내가 썼던 풀이 — 채점하면 공개된다
          </div>

          <div className="ans-block">
            <div className="ans-label">
              {knownCorrect
                ? "다시 풀고 답을 고르면 자동으로 채점된다"
                : "이 문제는 정답이 기록돼 있지 않다 — 지금 넣어두면 다음부터 자동 채점된다"}
            </div>
            <div className="ans-row">
              {CHOICES.map((c) => (
                <button
                  key={c}
                  type="button"
                  className={`ans-opt${picked === c ? " picked" : ""}`}
                  onClick={() => {
                    setPicked(picked === c ? "" : c);
                    setFreeAnswer("");
                  }}
                >
                  {c}
                </button>
              ))}
              <span className="ans-or">또는</span>
              <input
                className="ans-input"
                placeholder="주관식 답"
                value={freeAnswer}
                onChange={(e) => {
                  setFreeAnswer(e.target.value);
                  setPicked("");
                }}
              />
            </div>

            {!knownCorrect && (
              <div className="ans-row ans-fix">
                <span className="ans-fix-label">정답</span>
                {CHOICES.map((c) => (
                  <button
                    key={c}
                    type="button"
                    className={`ans-opt sm${answerFix === c ? " right" : ""}`}
                    onClick={() => setAnswerFix(answerFix === c ? "" : c)}
                  >
                    {c}
                  </button>
                ))}
                <input
                  className="ans-input"
                  placeholder="주관식 정답"
                  value={CHOICES.includes(answerFix) ? "" : answerFix}
                  onChange={(e) => setAnswerFix(e.target.value)}
                />
              </div>
            )}
          </div>

          {knownCorrect || answerFix.trim() ? (
            <div className="grade-row">
              <button
                type="button"
                className="grade-btn no"
                disabled={!answer}
                onClick={() =>
                  grade(
                    knownCorrect
                      ? undefined
                      : answer === answerFix.trim()
                  )
                }
              >
                채점하기
              </button>
            </div>
          ) : (
            /* 정답을 모르는 채로 넘어가야 할 때 — 자기 채점 (정직하게 표시) */
            <div className="grade-row">
              <button
                type="button"
                className="grade-btn ok"
                onClick={() => grade(true)}
              >
                맞았다
              </button>
              <button
                type="button"
                className="grade-btn no"
                onClick={() => grade(false)}
              >
                또 틀렸다
              </button>
            </div>
          )}
        </>
      )}

      {phase === "graded" && justResult && (
        <>
          <div className="verdict">
            <span
              className={`verdict-stamp${justResult.correct ? " ok" : ""}`}
            >
              {justResult.correct ? "맞음" : "또 틀림"}
            </span>
            <span className="verdict-text">
              {current.recheckCount}번째 시도 · 재검증{" "}
              {justResult.correct ? "통과" : "실패"}로 기록됨
              <br />
              {justResult.correct
                ? "다음 복습은 2주 뒤로 밀린다"
                : "다음 복습은 내일로 당겨진다"}
            </span>
          </div>

          <div className="time-line">
            이번 <span className="time-now">{fmtSec(justResult.seconds)}</span>
            {past.length > 1 && (
              <span className="time-past">
                · 지난번 {fmtSec(past[past.length - 2].seconds)}
                {past.length > 2 && ` · 처음 ${fmtSec(past[0].seconds)}`}
              </span>
            )}
          </div>

          {(knownCorrect || current.correctAnswer) && (
            <div className="ans-compare">
              <div>
                <div className="ans-cell-label">이번에 고른 답</div>
                <div
                  className={`ans-cell-val ${justResult.correct ? "right" : "wrong"}`}
                >
                  {justResult.answer || "—"}
                </div>
              </div>
              <div>
                <div className="ans-cell-label">정답</div>
                <div className="ans-cell-val right">
                  {current.correctAnswer || "—"}
                </div>
              </div>
              {lastWrong && (
                <div>
                  <div className="ans-cell-label">지난번에 고른 답</div>
                  <div className="ans-cell-val wrong">{lastWrong.answer}</div>
                </div>
              )}
            </div>
          )}

          {current.optSol?.trim() ? (
            <div className="reveal">
              <div className="reveal-title">최적 풀이</div>
              <div className="sol-shot">{current.optSol}</div>
            </div>
          ) : (
            <div className="reveal empty-sol">
              <div className="reveal-title">최적 풀이가 비어 있다</div>
              <button
                type="button"
                className="callout-act"
                onClick={() => onOpenNote(current.id)}
              >
                지금 추가
              </button>
            </div>
          )}

          <div className="reveal past">
            <div className="reveal-title">처음 틀렸을 때</div>
            <div className="past-row">
              {current.cause && <span className="cause-pill">{current.cause}</span>}
              {current.tags.map((t) => (
                <span key={t} className="sub-pill">
                  {t}
                </span>
              ))}
            </div>
            {current.mySol?.trim() && (
              <div className="past-quote">{current.mySol}</div>
            )}
          </div>

          <div className="end-row">
            <button type="button" className="end-btn" onClick={next}>
              {index + 1 >= queue.length ? "결과 보기" : "다음 문제"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
