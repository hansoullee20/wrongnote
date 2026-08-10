import { useMemo, useState } from "react";
import { Button, Section } from "../components.jsx";
import { buildGroups, retryRate } from "../today.js";

export default function TodayView({ notes, session, onOutcome, onShrink, onCapture, onEdit }) {
  const [group, setGroup] = useState(null);
  const [message, setMessage] = useState("");
  const ids = session.shrunkTo1 ? session.cardIds.slice(0, 1) : session.cardIds;
  const queue = ids.map((id) => notes.find((n) => n.id === id)).filter(Boolean);
  const current = queue.find((n) => !session.completedIds.includes(n.id));
  const pending = notes.filter((n) => !n.retired && !n.topicSub && !(n.tags || []).length).length;
  const rate = retryRate(notes);
  const groups = useMemo(() => buildGroups(notes), [notes]);
  return <div className="view today-view">
    <div className="today-summary">
      <span>{pending} awaiting analysis</span>
      <span>7-day retry rate: {rate === null ? "—" : `${Math.round(rate * 100)}%`}</span>
    </div>
    <Button variant="primary" block size="lg" onClick={onCapture}>Add a card</Button>
    {current ? <Section title="Today">
      <div className="today-card">
        <strong>{current.problem || "Awaiting analysis"}</strong>
        {current.question && <p>{current.question}</p>}
        <Button variant="neutral" onClick={() => onEdit(current.id)}>Edit details</Button>
      </div>
      <div className="today-outcomes">
        <Button variant="neutral" onClick={() => { onOutcome(current.id, "correct"); setMessage("Saved."); }}>Correct</Button>
        <Button variant="neutral" onClick={() => { onOutcome(current.id, "incorrect"); setMessage("Saved to review again."); }}>Incorrect</Button>
        <Button variant="neutral" onClick={() => { onOutcome(current.id, "lucky_guess"); setMessage("Saved to review again."); }}>Lucky guess</Button>
      </div>
      {message && <div className="hint">{message}</div>}
      {!session.completedIds.length && ids.length > 1 && <button className="today-one" type="button" onClick={onShrink}>Just 1 today</button>}
    </Section> : <Section title="Today"><p>Done for today. Okay to close.</p></Section>}
    {groups.length > 0 && <Section title="Repeat patterns">
      {groups.map((g) => <button className="group-link" type="button" key={g.key} onClick={() => setGroup(g)}>{g.topicSub} · {g.tag} ×{g.cards.length}</button>)}
    </Section>}
    {group && <div className="sheet"><div className="sheet-head"><span className="sheet-title">{group.topicSub} · {group.tag} ×{group.cards.length}</span><Button onClick={() => setGroup(null)}>Close</Button></div><div className="sheet-body">{group.cards.map((c) => <div className="today-card" key={c.id}>{c.problem || "Awaiting analysis"}</div>)}</div></div>}
  </div>;
}
