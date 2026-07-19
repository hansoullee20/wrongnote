import { useEffect, useMemo, useRef, useState } from "react";
import {
  SUBJECTS,
  CAUSES,
  CAUSE_HINTS,
  CAUSE_EXECUTION,
  MATH_ERROR_TAGS,
  MATH_TOPICS,
  GATE_CHECKLIST,
} from "../constants.js";
import {
  ChipRow,
  MultiChipRow,
  Chip,
  TagBadges,
  Panel,
  Button,
  Field,
  Badge,
  NoteImages,
} from "../components.jsx";
import { ocrImage } from "../ocr.js";
import { copyText } from "../clipboard.js";
import {
  compressImage,
  putImage,
  deleteImages,
  getImage,
} from "../imageStore.js";

/** 첨부 사진 썸네일 — 새 사진은 blob url, 기존 사진은 IDB에서 로드 */
function PhotoThumb({ photo }) {
  const [url, setUrl] = useState(photo.url || null);
  useEffect(() => {
    if (photo.url || !photo.id) return undefined;
    let alive = true;
    let created = null;
    getImage(photo.id).then((blob) => {
      if (blob && alive) {
        created = URL.createObjectURL(blob);
        setUrl(created);
      }
    });
    return () => {
      alive = false;
      if (created) URL.revokeObjectURL(created);
    };
  }, [photo]);
  return url ? (
    <img src={url} alt="첨부 사진" />
  ) : (
    <span className="photo-loading">…</span>
  );
}

function buildClassifyPrompt(draft) {
  const isMath = draft.subject === "수학";
  const lines = [
    `수능 ${draft.subject} 오답 분류를 도와줘. 아래 문제를 보고:`,
    isMath
      ? "1) 토픽을 아래 [토픽 목록]에서 대단원 1개 + 소단원 1개로 골라줘."
      : "1) 어떤 유형의 문제인지 한 줄로 말해줘.",
    "2) 주원인을 아래 [주원인]에서 딱 하나 골라줘 (내 풀이 참고).",
    "",
    "[문제]",
    draft.question.trim() || "(원문 없음 — 문제 식별: " + draft.problem + ")",
  ];
  if (draft.mySol.trim()) {
    lines.push("", "[내 풀이]", draft.mySol.trim());
  }
  if (isMath) {
    lines.push("", "[토픽 목록]");
    for (const [main, subs] of Object.entries(MATH_TOPICS)) {
      lines.push(`${main}: ${subs.join(", ")}`);
    }
  }
  lines.push(
    "",
    "[주원인]",
    CAUSES.join(", ") +
      (isMath ? ` / 수학 세부: ${MATH_ERROR_TAGS.join(", ")}` : "")
  );
  return lines.join("\n");
}

const emptyDraft = (subject = "수학") => ({
  subject,
  cause: "",
  correctAnswer: "",
  myAnswer: "",
  examTime: "",
  problem: "",
  topicMain: "",
  topicSub: "",
  question: "",
  mySol: "",
  optSol: "",
  derived: null,
  tags: [],
  memo: "",
});

export default function RecordView({
  notes,
  onAdd,
  onUpdate,
  onDelete,
  filter,
  setFilter,
  formOnly = false,
  initialEditId = null,
}) {
  const [draft, setDraft] = useState(() => emptyDraft());
  const [formOpen, setFormOpen] = useState(true);
  const [checks, setChecks] = useState([false, false, false, false]);
  const [expandedId, setExpandedId] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [ocr, setOcr] = useState({ busy: false, label: "", error: "" });
  const [copied, setCopied] = useState("");
  const ocrInputRef = useRef(null);

  // 첨부 사진: {id}=IDB에 이미 저장(수정 모드), {blob,url}=이번에 붙인 것(저장 시 기록)
  const [photos, setPhotos] = useState([]);
  const originalImageIds = useRef([]); // 수정 시작 시점의 저장된 사진 id

  function clearPendingPhotos() {
    setPhotos((ps) => {
      ps.forEach((p) => p.url && URL.revokeObjectURL(p.url));
      return [];
    });
  }

  /** 노트를 폼에 불러와 수정 모드 시작 */
  // 그리드에서 문제를 탭해 들어온 경우 해당 노트를 편집 상태로 연다
  useEffect(() => {
    if (!initialEditId) return;
    const n = notes.find((x) => x.id === initialEditId);
    if (n) startEdit(n);
    // 최초 진입 시 1회만 — 이후 사용자가 취소하면 다시 열리면 안 된다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialEditId]);

  function startEdit(n) {
    setDraft({
      subject: n.subject,
      problem: n.problem,
      topicMain: n.topicMain,
      topicSub: n.topicSub,
      question: n.question,
      mySol: n.mySol,
      optSol: n.optSol,
      cause: n.cause ?? "",
      correctAnswer: n.correctAnswer ?? "",
      myAnswer: n.myAnswer ?? "",
      examTime: n.examTime ?? "",
      derived: n.derived,
      tags: n.tags,
      memo: n.memo,
    });
    clearPendingPhotos();
    originalImageIds.current = n.images || [];
    setPhotos((n.images || []).map((id) => ({ id })));
    setEditingId(n.id);
    setChecks([false, false, false, false]); // 게이트는 수정에도 다시 통과해야 함
    setFormOpen(true);
    setExpandedId(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  /** 수정 취소 — 반쯤 고친 draft가 새 노트로 새는 것 방지 */
  function cancelEdit() {
    setEditingId(null);
    setDraft(emptyDraft(draft.subject));
    setChecks([false, false, false, false]);
    clearPendingPhotos();
    originalImageIds.current = [];
  }

  async function handleCopyPrompt() {
    const ok = await copyText(buildClassifyPrompt(draft));
    setCopied(ok ? "복사됨 — 클로드 앱에 붙여넣어라" : "복사 실패");
    setTimeout(() => setCopied(""), 2500);
  }

  async function handleOcrFile(e) {
    const file = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!file) return;

    // 1) 사진 첨부 — OCR 성패와 무관하게 사진은 남는다
    setOcr({ busy: true, label: "사진 처리 중…", error: "" });
    const blob = await compressImage(file);
    setPhotos((ps) => [...ps, { blob, url: URL.createObjectURL(blob) }]);

    // 2) 글자 추출 시도
    setOcr({ busy: true, label: "준비 중…", error: "" });
    try {
      const text = await ocrImage(file, (m) => {
        if (m.status === "recognizing text") {
          setOcr({
            busy: true,
            label: `인식 중 ${Math.round(m.progress * 100)}%`,
            error: "",
          });
        } else {
          setOcr({
            busy: true,
            label: "언어 데이터 로딩 중… (최초 1회만 오래 걸림)",
            error: "",
          });
        }
      });
      const cleaned = text.replace(/\n{3,}/g, "\n\n").trim();
      if (!cleaned) throw new Error("empty");
      setDraft((d) => ({
        ...d,
        question: d.question ? `${d.question}\n${cleaned}` : cleaned,
      }));
      setOcr({ busy: false, label: "", error: "" });
    } catch {
      setOcr({
        busy: false,
        label: "",
        error: "글자 인식 실패 — 사진은 첨부됐다. 직접 입력해도 된다.",
      });
    }
  }

  function removePhoto(index) {
    setPhotos((ps) => {
      const p = ps[index];
      if (p?.url) URL.revokeObjectURL(p.url);
      return ps.filter((_, i) => i !== index);
    });
  }

  const isMath = draft.subject === "수학";
  const gateActive = isMath && draft.cause === CAUSE_EXECUTION;
  const gatePassed = !gateActive || checks.every(Boolean);
  const canSave =
    draft.problem.trim().length > 0 && draft.cause !== "" && gatePassed;

  const set = (patch) => setDraft((d) => ({ ...d, ...patch }));

  const toggleTag = (tag) =>
    set({
      tags: draft.tags.includes(tag)
        ? draft.tags.filter((t) => t !== tag)
        : [...draft.tags, tag],
    });

  const pickDerived = (val) => {
    setDraft((d) => {
      const tags =
        val === "yes" && !d.tags.includes("지위 오해")
          ? [...d.tags, "지위 오해"]
          : d.tags;
      return { ...d, derived: val, tags };
    });
  };

  const submit = async () => {
    if (!canSave) return;

    // 이번에 붙인 사진을 IDB에 기록, 유지한 기존 id와 합침
    const imageIds = [];
    for (const p of photos) {
      if (p.id) {
        imageIds.push(p.id);
      } else {
        imageIds.push(await putImage(p.blob));
        if (p.url) URL.revokeObjectURL(p.url);
      }
    }
    // 수정 중 제거한 기존 사진은 IDB에서도 삭제
    const removed = originalImageIds.current.filter(
      (id) => !imageIds.includes(id)
    );
    if (removed.length) await deleteImages(removed);

    const payload = { ...draft, problem: draft.problem.trim(), images: imageIds };
    if (editingId) {
      onUpdate(editingId, payload); // 수정 시 자동 카드 생성 없음
      setEditingId(null);
    } else {
      onAdd(payload);
    }
    setDraft(emptyDraft(draft.subject));
    setChecks([false, false, false, false]);
    setPhotos([]);
    originalImageIds.current = [];
  };

  // 반복 오류 마커: topicMain+topicSub × 태그 조합 누적 횟수 (렌더 시 파생)
  const repeatCounts = useMemo(() => {
    const map = new Map();
    for (const n of notes) {
      for (const t of n.tags) {
        const key = `${n.topicMain}||${n.topicSub}||${t}`;
        map.set(key, (map.get(key) || 0) + 1);
      }
    }
    return map;
  }, [notes]);

  const repeatN = (n) => {
    let max = 0;
    for (const t of n.tags) {
      const c = repeatCounts.get(`${n.topicMain}||${n.topicSub}||${t}`) || 0;
      if (c > max) max = c;
    }
    return max >= 2 ? max : 0;
  };

  const tagsInUse = useMemo(() => {
    const present = new Set();
    notes.forEach((n) => n.tags.forEach((t) => present.add(t)));
    const order = [...CAUSES, ...MATH_ERROR_TAGS];
    return [
      ...order.filter((t) => present.has(t)),
      ...[...present].filter((t) => !order.includes(t)),
    ];
  }, [notes]);

  const visible = useMemo(
    () =>
      notes.filter(
        (n) =>
          (!filter.tag || n.tags.includes(filter.tag)) &&
          (!filter.topicMain || n.topicMain === filter.topicMain)
      ),
    [notes, filter]
  );

  return (
    <div className="view">
      <Panel
        title={editingId ? "오답 수정 중" : "오답 기록"}
        open={formOpen}
        onToggle={() => setFormOpen((o) => !o)}
      >
        <div className="form">
          {/* ── 분류 ── */}
          <div className="form-group">
            <div className="form-group-title">분류</div>
            <ChipRow
              options={SUBJECTS}
              value={draft.subject}
              onPick={(s) =>
                set({ subject: s, topicMain: "", topicSub: "", derived: null })
              }
            />
            <Field label="문제 식별" htmlFor="rec-problem">
              <input
                id="rec-problem"
                type="text"
                placeholder="예: 6모 Q22"
                value={draft.problem}
                onChange={(e) => set({ problem: e.target.value })}
              />
            </Field>
            {isMath && (
              <>
                <div className="label">토픽 — 대단원</div>
                <ChipRow
                  options={Object.keys(MATH_TOPICS)}
                  value={draft.topicMain}
                  onPick={(m) =>
                    set({
                      topicMain: m === draft.topicMain ? "" : m,
                      topicSub: "",
                    })
                  }
                />
                {draft.topicMain && (
                  <>
                    <div className="label">소단원</div>
                    <ChipRow
                      options={MATH_TOPICS[draft.topicMain]}
                      value={draft.topicSub}
                      onPick={(s) =>
                        set({ topicSub: s === draft.topicSub ? "" : s })
                      }
                    />
                  </>
                )}
              </>
            )}
          </div>

          {/* ── 내용 ── */}
          <div className="form-group">
            <div className="form-group-title">내용</div>
            <div className="ocr-row">
              <Button
                variant="ghost"
                disabled={ocr.busy}
                onClick={() => ocrInputRef.current && ocrInputRef.current.click()}
              >
                {ocr.busy ? ocr.label : "사진 첨부 + 글자 추출"}
              </Button>
              <input
                ref={ocrInputRef}
                type="file"
                accept="image/*"
                style={{ display: "none" }}
                onChange={handleOcrFile}
              />
              <Button
                variant="ghost"
                disabled={
                  !draft.question.trim() &&
                  !draft.mySol.trim() &&
                  !draft.problem.trim()
                }
                onClick={handleCopyPrompt}
              >
                {copied || "분류 프롬프트 복사"}
              </Button>
            </div>
            {ocr.error && <div className="io-error">{ocr.error}</div>}
            {photos.length > 0 && (
              <div className="photo-strip">
                {photos.map((p, i) => (
                  <div key={p.id || p.url} className="photo-strip-item">
                    <PhotoThumb photo={p} />
                    <button
                      type="button"
                      className="photo-remove"
                      onClick={() => removePhoto(i)}
                      aria-label="사진 제거"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            )}
            <Field label="문제 원문 (선택)" hint="사진 OCR 결과가 여기 들어감">
              <textarea
                rows={2}
                value={draft.question}
                onChange={(e) => set({ question: e.target.value })}
              />
            </Field>
            <Field label="내 풀이 — 실패 지점">
              <textarea
                rows={2}
                value={draft.mySol}
                onChange={(e) => set({ mySol: e.target.value })}
              />
            </Field>
            <Field label="최적 풀이 — 시험 전략 포함">
              <textarea
                rows={2}
                value={draft.optSol}
                onChange={(e) => set({ optSol: e.target.value })}
              />
            </Field>
          </div>

          {/* ── 태그 & 판정 ── */}
          <div className="form-group">
            <div className="form-group-title">태그 &amp; 판정</div>
            {isMath && (
              <>
                <div className="label">표준 항목 인출</div>
                <ChipRow
                  options={["즉시 인출함", "재유도함"]}
                  value={
                    draft.derived === "yes"
                      ? "재유도함"
                      : draft.derived === "no"
                        ? "즉시 인출함"
                        : ""
                  }
                  onPick={(label) =>
                    pickDerived(label === "재유도함" ? "yes" : "no")
                  }
                />
                {draft.derived === "yes" && (
                  <div className="hint">
                    → "지위 오해" 자동 태그 + 플래시카드 자동 생성 (front=문제,
                    back=최적 풀이)
                  </div>
                )}
              </>
            )}

            <div className="label">주원인 — 하나만</div>
            <ChipRow
              options={CAUSES}
              value={draft.cause}
              onPick={(cause) => set({ cause })}
            />
            {draft.cause && (
              <div className="hint">{CAUSE_HINTS[draft.cause]}</div>
            )}

            <div className="label">세부 — 여러 개 가능</div>
            {isMath && (
              <MultiChipRow
                options={MATH_ERROR_TAGS}
                selected={draft.tags}
                onToggle={toggleTag}
                className="math-tag"
              />
            )}

            <Field label="메모" className="memo-field">
              <textarea
                rows={2}
                value={draft.memo}
                onChange={(e) => set({ memo: e.target.value })}
              />
            </Field>

            {gateActive && (
              <div className="gate">
                <div className="gate-title">
                  판정 체크 — 4항목 전부 체크해야 저장 가능
                </div>
                {GATE_CHECKLIST.map((item, i) => (
                  <label key={i} className="gate-item">
                    <input
                      type="checkbox"
                      checked={checks[i]}
                      onChange={() =>
                        setChecks((cs) =>
                          cs.map((c, j) => (j === i ? !c : c))
                        )
                      }
                    />
                    <span>{item}</span>
                  </label>
                ))}
              </div>
            )}
          </div>

          <Button
            variant="primary"
            size="lg"
            block
            disabled={!canSave}
            onClick={submit}
          >
            {editingId ? "수정 저장" : "저장"}
          </Button>
          {editingId && (
            <Button variant="neutral" block onClick={cancelEdit}>
              수정 취소
            </Button>
          )}
          {editingId && (
            <Button
              variant="danger"
              block
              className="note-delete"
              onClick={() => {
                if (confirm("이 기록을 삭제할까?")) onDelete(editingId);
              }}
            >
              이 기록 삭제
            </Button>
          )}
          {gateActive && !gatePassed && (
            <div className="gate-warn">판정 체크 미완료 — 저장 잠김</div>
          )}
        </div>
      </Panel>

      {!formOnly && (
        <>
      <div className="filter-row chip-row">
        <Chip
          label="전체"
          active={!filter.tag && !filter.topicMain}
          onClick={() => setFilter({ tag: "", topicMain: "" })}
        />
        {filter.topicMain && (
          <Chip
            label={`${filter.topicMain} ✕`}
            active
            onClick={() => setFilter((f) => ({ ...f, topicMain: "" }))}
          />
        )}
        {tagsInUse.map((t) => (
          <Chip
            key={t}
            label={t}
            active={filter.tag === t}
            onClick={() =>
              setFilter((f) => ({ ...f, tag: f.tag === t ? "" : t }))
            }
          />
        ))}
      </div>

      <div className="note-list">
        {visible.length === 0 && (
          <div className="empty">기록 없음.</div>
        )}
        {visible.map((n) => {
          const N = repeatN(n);
          const open = expandedId === n.id;
          return (
            <div key={n.id} className={`note${open ? " open" : ""}`}>
              <button
                type="button"
                className="note-row"
                onClick={() => setExpandedId(open ? null : n.id)}
              >
                <div className="note-row-head">
                  <Badge tone="info">{n.subject}</Badge>
                  <span className="note-prob">{n.problem}</span>
                  <span className="note-topic">
                    {n.topicMain}
                    {n.topicSub ? `·${n.topicSub}` : ""}
                  </span>
                  <span className="note-date">{n.date}</span>
                  {n.images?.length > 0 && (
                    <span className="photo-count">
                      📷{n.images.length > 1 ? n.images.length : ""}
                    </span>
                  )}
                  {N > 0 && <span className="repeat-marker">×{N}</span>}
                </div>
                {n.question && !open && (
                  <div className="note-preview">{n.question}</div>
                )}
              </button>
              {open && (
                <div className="note-detail">
                  <TagBadges tags={n.tags} />
                  <NoteImages ids={n.images} />
                  {n.question && (
                    <div className="field">
                      <div className="field-label">문제</div>
                      <div className="field-text">{n.question}</div>
                    </div>
                  )}
                  {n.mySol && (
                    <div className="field">
                      <div className="field-label red">내 풀이</div>
                      <div className="field-text">{n.mySol}</div>
                    </div>
                  )}
                  {n.optSol && (
                    <div className="field">
                      <div className="field-label green">최적 풀이</div>
                      <div className="field-text">{n.optSol}</div>
                    </div>
                  )}
                  {n.memo && (
                    <div className="field">
                      <div className="field-label">메모</div>
                      <div className="field-text memo-text">{n.memo}</div>
                    </div>
                  )}
                  {n.rechecked && (
                    <div className="recheck-mark">
                      <span
                        className={`grade-mark ${
                          n.recheckResult === "pass" ? "pass" : "fail"
                        }`}
                      >
                        {n.recheckResult === "pass" ? "○" : "✗"}
                      </span>{" "}
                      재검증:{" "}
                      {n.recheckResult === "pass"
                        ? "실행 실수 확정"
                        : "개념 갭 재분류"}
                    </div>
                  )}
                  <div className="note-actions">
                    <button
                      type="button"
                      className="edit-btn"
                      onClick={() => startEdit(n)}
                    >
                      수정
                    </button>
                    <button
                      type="button"
                      className="del-btn"
                      onClick={() => {
                        if (confirm("이 기록을 삭제할까?")) onDelete(n.id);
                      }}
                    >
                      삭제
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
        </>
      )}
    </div>
  );
}
