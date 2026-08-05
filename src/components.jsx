import { useEffect, useState } from "react";
import { GATE_CHECKLIST } from "./constants.js";
import { getTrajectory } from "./review.js";
import { getImage } from "./imageStore.js";

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

export function TagBadges({ tags }) {
  return (
    <div className="tag-badges">
      {tags.map((t) => (
        <span key={t} className="tag-badge">
          {t}
        </span>
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
 *   as?: keyof JSX.IntrinsicElements,
 *   interactive?: boolean,
 *   className?: string,
 *   children: import('react').ReactNode,
 * }} props
 */
export function Card({ as: Tag = "div", interactive = false, className = "", ...rest }) {
  const cls = ["card", interactive ? "card--interactive" : "", className]
    .filter(Boolean)
    .join(" ");
  return <Tag className={cls} {...rest} />;
}

/**
 * 접이식 헤더 카드. open/onToggle 주면 controlled, 아니면 자체 상태.
 * @param {{
 *   title: import('react').ReactNode,
 *   open?: boolean,
 *   onToggle?: () => void,
 *   defaultOpen?: boolean,
 *   children: import('react').ReactNode,
 * }} props
 */
export function Panel({ title, open, onToggle, defaultOpen = true, children }) {
  const [selfOpen, setSelfOpen] = useState(defaultOpen);
  const isControlled = open !== undefined;
  const isOpen = isControlled ? open : selfOpen;
  const toggle = isControlled ? onToggle : () => setSelfOpen((o) => !o);
  return (
    <div className="card panel">
      <button type="button" className="panel-head" onClick={toggle}>
        <span>{title}</span>
        <span className="fold-arrow">{isOpen ? "▾" : "▸"}</span>
      </button>
      {isOpen && children}
    </div>
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
 * 재풀이 궤적 도트 — 오래된 것 → 최신. 색이 아니라 모양(●/○)으로
 * 갈라 보이게 하고, 스크린리더용 라벨을 단다.
 * @param {{ attempts: object[] }} props
 */
export function TrajectoryDots({ attempts }) {
  const recent = getTrajectory({ attempts });
  if (recent.length === 0) {
    return <span className="traj-none">미재풀이</span>;
  }
  return (
    <span className="traj" role="img" aria-label="재풀이 궤적">
      {recent.map((a) => (
        <span
          key={a.id ?? a.ts}
          className={`traj-dot ${a.correct ? "pass" : "fail"}`}
          aria-label={a.correct ? "통과" : "실패"}
        >
          {a.correct ? "○" : "●"}
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
        <TrajectoryDots attempts={all} />
      </div>
      {all.length === 0 && <div className="hint">아직 다시 푼 적 없음</div>}
      {all.map((a) => (
        <div key={a.id ?? a.ts} className="attempt-line">
          <span className="attempt-date">{fmtShortDate(a.ts)}</span>
          <span className={`grade-mark ${a.correct ? "pass" : "fail"}`}>
            {a.correct ? "○" : "✗"}
          </span>
          <span className="attempt-body">
            {a.correct ? "통과" : a.cause || "원인 미기록"}
            {!a.correct && a.tags?.length > 0 && ` · ${a.tags.join(" · ")}`}
            {a.answer && ` — ${a.answer}`}
            {a.seconds != null && ` — ${fmtSecShort(a.seconds)}`}
          </span>
          {a.memo && <span className="attempt-memo">{a.memo}</span>}
        </div>
      ))}
    </div>
  );
}

/**
 * IndexedDB에 저장된 문제 사진 썸네일 목록 + 탭하면 전체 화면.
 * @param {{ ids: string[] }} props
 */
export function NoteImages({ ids }) {
  const [urls, setUrls] = useState([]); // [{id, url}]
  const [viewing, setViewing] = useState(null); // 전체 화면 중인 url

  useEffect(() => {
    let alive = true;
    const created = [];
    (async () => {
      const loaded = [];
      for (const id of ids || []) {
        const blob = await getImage(id);
        if (blob) {
          const url = URL.createObjectURL(blob);
          created.push(url);
          loaded.push({ id, url });
        }
      }
      if (alive) setUrls(loaded);
      else created.forEach((u) => URL.revokeObjectURL(u));
    })();
    return () => {
      alive = false;
      created.forEach((u) => URL.revokeObjectURL(u));
    };
  }, [ids]);

  if (!ids?.length || urls.length === 0) return null;

  return (
    <>
      <div className="note-images">
        {urls.map(({ id, url }) => (
          <button
            key={id}
            type="button"
            className="note-image-thumb"
            onClick={() => setViewing(url)}
          >
            <img src={url} alt="문제 사진" />
          </button>
        ))}
      </div>
      {viewing && (
        <button
          type="button"
          className="lightbox"
          onClick={() => setViewing(null)}
        >
          <img src={viewing} alt="문제 사진 크게 보기" />
        </button>
      )}
    </>
  );
}
