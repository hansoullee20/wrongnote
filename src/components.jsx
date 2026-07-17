import { useState } from "react";

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
 *   variant?: 'primary'|'success'|'danger'|'neutral'|'ghost',
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
