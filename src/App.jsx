import { useEffect, useState } from "react";
import { loadAll, saveNotes, WRITE_ERROR_MESSAGE } from "./storage.js";
import { uid, fmtDate } from "./constants.js";
import { migrateNote } from "./migrate.js";
import { applyOutcome, loadTodaySession, saveTodaySession } from "./today.js";
import TodayView from "./views/TodayView.jsx";
import RecordView from "./views/RecordView.jsx";

export default function App() {
  const [boot] = useState(loadAll);
  const [notes, setNotes] = useState(boot.notes);
  const [session, setSession] = useState(() => loadTodaySession(boot.notes));
  const [recording, setRecording] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [writeError, setWriteError] = useState(boot.writeError);

  useEffect(() => {
    if (!boot.error && !saveNotes(notes)) setWriteError(WRITE_ERROR_MESSAGE);
  }, [notes, boot.error]);

  function saveSession(next) { setSession(next); saveTodaySession(next); }
  function addNote(draft) {
    const now = Date.now();
    const note = migrateNote({ ...draft, id: uid(), ts: now, date: fmtDate(now), savedAt: now, images: draft.images || [] });
    setNotes((all) => [note, ...all]);
    setRecording(false);
  }
  function updateNote(id, patch) { setNotes((all) => all.map((n) => n.id === id ? migrateNote({ ...n, ...patch, id: n.id, savedAt: n.savedAt }) : n)); setRecording(false); setEditingId(null); }
  function recordOutcome(id, outcome) {
    if (!session.cardIds.includes(id) || session.completedIds.includes(id)) return;
    setNotes((all) => all.map((n) => n.id === id ? applyOutcome(n, outcome) : n));
    saveSession({ ...session, completedIds: [...session.completedIds, id] });
  }
  return <div className="app"><header className="masthead"><span className="masthead-sub">Study, one card at a time</span><h1 className="masthead-title">Wrongnote</h1></header><main className="paper-sheet">{writeError && <div className="audit-warn">{writeError}</div>}<TodayView notes={notes} session={session} onOutcome={recordOutcome} onShrink={() => saveSession({ ...session, shrunkTo1: true })} onCapture={() => { setEditingId(null); setRecording(true); }} onEdit={(id) => { setEditingId(id); setRecording(true); }} /></main>{recording && <RecordView note={notes.find((n) => n.id === editingId)} onSave={editingId ? (patch) => updateNote(editingId, patch) : addNote} onClose={() => { setRecording(false); setEditingId(null); }} />}</div>;
}
