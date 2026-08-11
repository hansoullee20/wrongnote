import { GATE_CHECKLIST } from "./constants.js";
import { getTrajectory } from "./review.js";

export function Chip({ label, active, onClick, className = "" }) {
  return (
    <button
      type="button"
      className={`chip${active ? " on" : ""}${className ? ` ${className}` : ""}`}
      onClick={onClick}
    >
      {label}
    </button>
  );
}

export function ChipRow({ options, value, onPick, className = "" }) {
  return (
    <div className="chip-row">
      {options.map((o) => (
        <Chip
          key={o}
          label={o}
          active={value === o}
          onClick={() => onPick(o)}
          className={className}
        />
      ))}
    </div>
  );
}

export function MultiChipRow({ options, selected, onToggle, className = "" }) {
  return (
    <div className="chip-row">
      {options.map((o) => (
        <Chip
          key={o}
          label={o}
          active={selected.includes(o)}
          onClick={() => onToggle(o)}
          className={className}
        />
      ))}
    </div>
  );
}

/**
 * @param {{
 *   variant?: 'primary'|'success'|'danger'|'neutral'|'ghost'|'ink',
 *   size?: 'md'|'lg',
 *   block?: boolean,
 *   disabled?: boolean,
 *   type?: string,
 *   onClick?: () => void,
 *   className?: string,
 *   children: import('react').ReactNode,
 * }} props
 */
export function Button({
  variant = "neutral",
  size = "md",
  block = false,
  disabled = false,
  type = "button",
  onClick,
  className = "",
  children,
}) {
  const cls = [
    "btn",
    `btn--${variant}`,
    `btn--${size}`,
    block ? "btn--block" : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <button type={type} className={cls} disabled={disabled} onClick={onClick}>
      {children}
    </button>
  );
}

/**
 * @param {{
 *   title: import('react').ReactNode,
 *   actions?: import('react').ReactNode,
 *   className?: string,
 *   children: import('react').ReactNode,
 * }} props
 */
export function Section({ title, actions, className = "", children }) {
  return (
    <section className={`card section${className ? ` ${className}` : ""}`}>
      <div className="section-head">
        <h2 className="section-title">{title}</h2>
        {actions}
      </div>
      {children}
    </section>
  );
}

/**
 * @param {{
 *   label: import('react').ReactNode,
 *   hint?: import('react').ReactNode,
 *   error?: import('react').ReactNode,
 *   htmlFor?: string,
 *   children: import('react').ReactNode,
 * }} props
 */
export function Field({ label, hint, error, htmlFor, className = "", children }) {
  return (
    <div className={`ui-field${className ? ` ${className}` : ""}`}>
      <label className="ui-field-label" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
      {error ? (
        <div className="ui-field-error">{error}</div>
      ) : hint ? (
        <div className="hint">{hint}</div>
      ) : null}
    </div>
  );
}

/**
 * @param {{
 *   tone?: 'neutral'|'success'|'error'|'warning'|'info',
 *   className?: string,
 *   children: import('react').ReactNode,
 * }} props
 */
export function Badge({ tone = "neutral", className = "", children }) {
  return (
    <span className={`badge badge--${tone}${className ? ` ${className}` : ""}`}>
      {children}
    </span>
  );
}

/**
 * 실행 실수 하드 게이트 — 기록·재풀이 분류가 같은 체크리스트를 쓴다.
 * 체크 상태는 부모가 관리하고, 저장 가능 여부도 부모가 판단한다.
 * @param {{ checks: boolean[], onToggle: (index: number) => void }} props
 */
export function ExecutionGate({ checks, onToggle }) {
  return (
    <div className="gate">
      <div className="gate-title">판정 체크 — 4항목 전부 체크해야 저장 가능</div>
      {GATE_CHECKLIST.map((item, i) => (
        <label key={i} className="gate-item">
          <input
            type="checkbox"
            checked={checks[i]}
            onChange={() => onToggle(i)}
          />
          <span>{item}</span>
        </label>
      ))}
    </div>
  );
}

/**
 * 시도 하나를 세 상태로 읽는다: 실패 / 도움받은 통과 / 독립 통과.
 * 궤적과 이력이 **같은 함수**를 써야 한 화면 안에서 다른 말을 하지 않는다.
 * 구분은 색이 아니라 글자(✕ ✓* ✓)와 라벨이 짊어진다 — 색맹·흑백에서도 읽힌다.
 * @param {object} a attempt
 */
function readAttemptMark(a) {
  if (!a.correct) {
    return { kind: "fail", glyph: "✕", label: a.cause || "원인 미기록" };
  }
  return a.assisted
    ? { kind: "assisted", glyph: "✓", star: true, label: "도움받음" }
    : { kind: "pass", glyph: "✓", label: "통과" };
}

/**
 * 재풀이 궤적 — 오래된 것 → 최신. 도움받은 통과는 ✓* 로 따로 보인다.
 * @param {{ attempts: object[] }} props
 */
export function TrajectoryDots({ attempts }) {
  const recent = getTrajectory({ attempts });
  if (recent.length === 0) {
    return <span className="traj-none">미재풀이</span>;
  }
  const marks = recent.map(readAttemptMark);
  /* role="img"는 하위를 **평탄화**한다 — 도트마다 aria-label을 달아봐야
     보조기기에는 "재풀이 궤적" 한 마디만 들리고 도움 여부는 사라진다.
     그래서 순서대로 이어붙인 라벨을 부모 이름에 싣고, 도트는 장식으로 숨긴다. */
  return (
    <span
      className="traj"
      role="img"
      aria-label={`재풀이 궤적: ${marks.map((m) => m.label).join(", ")}`}
    >
      {recent.map((a, i) => (
        <span
          key={a.id ?? a.ts}
          className={`traj-dot ${marks[i].kind}`}
          aria-hidden="true"
        >
          {marks[i].glyph}
          {/* 별표를 따로 빼야 ✓* 가 넓어져도 도트 줄이 들쭉날쭉해지지 않는다 */}
          {marks[i].star && <span className="traj-star">*</span>}
        </span>
      ))}
    </span>
  );
}

const fmtSecShort = (s) =>
  s == null
    ? ""
    : s >= 60
      ? `${Math.floor(s / 60)}분 ${String(s % 60).padStart(2, "0")}초`
      : `${s}초`;

const fmtShortDate = (ts) => {
  const d = new Date(ts);
  return `${d.getMonth() + 1}/${d.getDate()}`;
};

/**
 * 시도 로그 (읽기 전용) — 수정 오버레이 하단에서 이 문제의 재풀이
 * 궤적 전체를 보여준다. 편집·삭제는 이번 범위에 없다.
 * @param {{ attempts: object[] }} props
 */
export function AttemptHistory({ attempts }) {
  const all = Array.isArray(attempts) ? attempts : [];
  return (
    <div className="attempt-history">
      <div className="attempt-history-head">
        <span className="label">재풀이 이력</span>
        {all.length > 0 && <TrajectoryDots attempts={all} />}
      </div>
      {all.length === 0 && <div className="hint">아직 다시 푼 적 없음</div>}
      {all.map((a) => {
        const m = readAttemptMark(a);
        return (
          <div key={a.id ?? a.ts} className="attempt-line">
            <span className="attempt-date">{fmtShortDate(a.ts)}</span>
            {/* 라벨은 바로 옆 본문이 글로 말한다 — 여기 aria-label을 달면
                role 없는 span이라 무시되거나 같은 말을 두 번 읽는다 */}
            <span className={`grade-mark ${m.kind}`} aria-hidden="true">
              {m.glyph}
              {m.star && <span className="traj-star">*</span>}
            </span>
            <span className="attempt-body">
              {m.label}
              {!a.correct && a.tags?.length > 0 && ` · ${a.tags.join(" · ")}`}
              {a.answer && ` — ${a.answer}`}
              {a.seconds != null && ` — ${fmtSecShort(a.seconds)}`}
            </span>
            {a.memo && <span className="attempt-memo">{a.memo}</span>}
          </div>
        );
      })}
    </div>
  );
}
