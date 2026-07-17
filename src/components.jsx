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
