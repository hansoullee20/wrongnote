const NOTES_KEY = "wr_notes";

/**
 * Queue acceptance/redelivery dedupe must be based on bytes that actually made
 * it to Wrongnote's durable note store, not React state. Fail closed when the
 * store is absent, malformed, or the event id is invalid.
 */
export function hasPersistedAiEvent(eventId) {
  if (typeof eventId !== "string" || eventId.length === 0) return false;
  try {
    const raw = localStorage.getItem(NOTES_KEY);
    if (raw === null) return false;
    const notes = JSON.parse(raw);
    return Array.isArray(notes) && notes.some((note) => note && note.aiEventId === eventId);
  } catch {
    return false;
  }
}
