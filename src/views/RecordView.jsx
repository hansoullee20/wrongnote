import { useRef, useState } from "react";
import { Button, Field } from "../components.jsx";
import { compressImage, putImage } from "../imageStore.js";

export default function RecordView({ note, onSave, onClose }) {
  const [draft, setDraft] = useState(() => ({ problem: note?.problem || "", question: note?.question || "", topicSub: note?.topicSub || "", tags: note?.tags || [], memo: note?.memo || "", images: note?.images || [] }));
  const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const fileRef = useRef(null);
  async function addPhotos(files) { if (!files?.length || busy) return; setBusy(true); setError(""); try { const ids = []; for (const file of files) ids.push(await putImage(await compressImage(file))); setDraft((d) => ({ ...d, images: [...d.images, ...ids] })); } catch { setError("Could not save that photo. Try again."); } finally { setBusy(false); } }
  const capture = !note;
  return <div className="sheet"><div className="sheet-head"><span className="sheet-title">{capture ? "Add a card" : "Edit details"}</span><Button onClick={onClose}>Close</Button></div><div className="sheet-body"><Field label="Photos"><input ref={fileRef} type="file" accept="image/*" capture="environment" multiple onChange={(e) => addPhotos([...e.target.files])} /><div className="hint">{draft.images.length} attached</div></Field>{!capture && <><Field label="Title"><input value={draft.problem} onChange={(e) => setDraft({ ...draft, problem: e.target.value })} /></Field><Field label="Topic"><input value={draft.topicSub} onChange={(e) => setDraft({ ...draft, topicSub: e.target.value })} /></Field><Field label="Tags (comma separated)"><input value={draft.tags.join(", ")} onChange={(e) => setDraft({ ...draft, tags: e.target.value.split(",").map((x) => x.trim()).filter(Boolean) })} /></Field><Field label="Note"><textarea value={draft.memo} onChange={(e) => setDraft({ ...draft, memo: e.target.value })} /></Field></>}{error && <div className="io-error">{error}</div>}<Button variant="primary" block size="lg" disabled={busy || (capture && !draft.images.length)} onClick={() => onSave(draft)}>{capture ? "Save" : "Save details"}</Button></div></div>;
}
