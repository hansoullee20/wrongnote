import { useEffect, useRef, useState } from "react";
import {
  SUBJECTS,
  CAUSES,
  CAUSE_HINTS,
  CHOICES,
  EXAM_TIME_BUCKETS,
  CAUSE_EXECUTION,
  MATH_ERROR_TAGS,
  MATH_TOPICS,
} from "../constants.js";
import {
  ChipRow,
  MultiChipRow,
  Button,
  Field,
  ExecutionGate,
  AttemptHistory,
} from "../components.jsx";
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
  initialEditId = null,
  onCancelEdit,
  storageLocked = false,
}) {
  const [draft, setDraft] = useState(() => emptyDraft());
  const [checks, setChecks] = useState([false, false, false, false]);
  const [editingId, setEditingId] = useState(null);
  // 기록은 2페이지 — 사실을 먼저 적고, 해설은 주원인을 고른 뒤에 본다
  const [step, setStep] = useState(1);
  const [photo, setPhoto] = useState({ busy: false, label: "", error: "" });
  const [copied, setCopied] = useState("");
  const photoInputRef = useRef(null);

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
    setStep(1);
    setChecks([false, false, false, false]); // 게이트는 수정에도 다시 통과해야 함
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  /** 수정 취소 — 반쯤 고친 draft가 새 노트로 새는 것 방지 */
  function cancelEdit() {
    setEditingId(null);
    setStep(1);
    // 바깥(시트 헤더)도 수정 상태를 벗어나야 한다.
    // 안 그러면 헤더는 '오답 수정 + 삭제'인데 폼은 빈 새 기록이 된다.
    if (onCancelEdit) onCancelEdit();
    setDraft(emptyDraft(draft.subject));
    setStep(1);
    setChecks([false, false, false, false]);
    clearPendingPhotos();
    originalImageIds.current = [];
  }

  async function handleCopyPrompt() {
    const ok = await copyText(buildClassifyPrompt(draft));
    setCopied(ok ? "복사됨 — 클로드 앱에 붙여넣어라" : "복사 실패");
    setTimeout(() => setCopied(""), 2500);
  }

  async function handlePhotoFiles(e) {
    const files = Array.from(e.target.files || []);
    e.target.value = "";
    if (!files.length) return;

    // 사진 첨부 — 각 파일을 압축해서 그대로 붙인다. 글자 추출은 하지 않는다.
    setPhoto({ busy: true, label: "사진 처리 중…", error: "" });
    try {
      for (const file of files) {
        const blob = await compressImage(file);
        setPhotos((ps) => [...ps, { blob, url: URL.createObjectURL(blob) }]);
      }
      setPhoto({ busy: false, label: "", error: "" });
    } catch {
      setPhoto({ busy: false, label: "", error: "사진 첨부 실패" });
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
    // 수정 중 제거한 기존 사진은 IDB에서도 삭제.
    // 저장이 잠겼으면 지우지 않는다 — onUpdate가 디스크에 안 남으므로
    // 새로고침하면 옛 노트가 이미 지워진 사진 id를 가리키게 된다.
    // (App.deleteNote와 같은 최소 완화책 — 근본 수정은 별도 Tier 2)
    const removed = originalImageIds.current.filter(
      (id) => !imageIds.includes(id)
    );
    if (removed.length && !storageLocked) await deleteImages(removed);

    const payload = { ...draft, problem: draft.problem.trim(), images: imageIds };
    if (editingId) {
      onUpdate(editingId, payload); // 수정 시 자동 카드 생성 없음
      setEditingId(null);
    } else {
      onAdd(payload);
    }
    setDraft(emptyDraft(draft.subject));
    setStep(1);
    setChecks([false, false, false, false]);
    setPhotos([]);
    originalImageIds.current = [];
  };

  return (
    <div className="view">
      <div className="form-shell">
        <div className="form">
          <div className="steps">
            <span className={`step${step === 1 ? " on" : ""}`}>
              <span className="step-num">1</span>사실
            </span>
            <span className="step-line" />
            <span className={`step${step === 2 ? " on" : ""}`}>
              <span className="step-num">2</span>분석
            </span>
          </div>

          {step === 1 && (
            <>
              {/* ── 1페이지: 무슨 일이 있었나. 풀이·해설은 여기 없다 ── */}
              <div className="form-group">
                <div className="form-group-title">사실</div>
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
            <div className="ocr-row">
              <Button
                variant="ink"
                disabled={photo.busy}
                onClick={() =>
                  photoInputRef.current && photoInputRef.current.click()
                }
              >
                {photo.busy ? photo.label : "📷 문제 사진 첨부"}
              </Button>
              <input
                ref={photoInputRef}
                type="file"
                accept="image/*"
                multiple
                style={{ display: "none" }}
                onChange={handlePhotoFiles}
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
            {photo.error && <div className="io-error">{photo.error}</div>}
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
            <Field label="문제 원문 (선택)" hint="필요하면 직접 입력" htmlFor="rec-question">
              <textarea
                id="rec-question"
                rows={2}
                value={draft.question}
                onChange={(e) => set({ question: e.target.value })}
              />
            </Field>

                <div className="label">답 마킹</div>
                <div className="ans-line">
                  <span className="ans-name">정답</span>
                  {CHOICES.map((c) => (
                    <button
                      key={c}
                      type="button"
                      className={`ans-o${draft.correctAnswer === c ? " right" : ""}`}
                      onClick={() =>
                        set({ correctAnswer: draft.correctAnswer === c ? "" : c })
                      }
                    >
                      {c}
                    </button>
                  ))}
                  <input
                    className="ans-sub"
                    type="text"
                    placeholder="주관식"
                    value={
                      CHOICES.includes(draft.correctAnswer)
                        ? ""
                        : draft.correctAnswer
                    }
                    onChange={(e) => set({ correctAnswer: e.target.value })}
                  />
                </div>
                <div className="ans-line">
                  <span className="ans-name">내가 고른 답</span>
                  {CHOICES.map((c) => (
                    <button
                      key={c}
                      type="button"
                      className={`ans-o${draft.myAnswer === c ? " mine" : ""}`}
                      onClick={() =>
                        set({ myAnswer: draft.myAnswer === c ? "" : c })
                      }
                    >
                      {c}
                    </button>
                  ))}
                  <input
                    className="ans-sub"
                    type="text"
                    placeholder="주관식"
                    value={
                      CHOICES.includes(draft.myAnswer) ? "" : draft.myAnswer
                    }
                    onChange={(e) => set({ myAnswer: e.target.value })}
                  />
                </div>
              </div>

              <Button
                variant="primary"
                size="lg"
                block
                disabled={!draft.problem.trim()}
                onClick={() => setStep(2)}
              >
                다음 — 왜 틀렸나
              </Button>
            </>
          )}

          {step === 2 && (
            <>
              {/* ── 2페이지: 왜 그랬나. 해설은 주원인을 고른 뒤에 나온다 ── */}
              <div className="form-group">
                <div className="form-group-title">분석</div>
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
              <ExecutionGate
                checks={checks}
                onToggle={(i) =>
                  setChecks((cs) => cs.map((c, j) => (j === i ? !c : c)))
                }
              />
            )}
              </div>

              <div className="form-group">
                <div className="form-group-title">토픽 & 풀이</div>
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
            <Field label="내 풀이 — 실패 지점" htmlFor="rec-mysol">
              <textarea
                id="rec-mysol"
                rows={2}
                value={draft.mySol}
                onChange={(e) => set({ mySol: e.target.value })}
              />
            </Field>
            <Field label="최적 풀이 — 시험 전략 포함" htmlFor="rec-optsol">
              <textarea
                id="rec-optsol"
                rows={2}
                value={draft.optSol}
                onChange={(e) => set({ optSol: e.target.value })}
              />
            </Field>

                <div className="label">시험에서 걸린 시간 — 선택</div>
                <ChipRow
                  options={EXAM_TIME_BUCKETS}
                  value={draft.examTime}
                  onPick={(t) =>
                    set({ examTime: t === draft.examTime ? "" : t })
                  }
                />
              </div>

              <Button variant="neutral" block onClick={() => setStep(1)}>
                이전
              </Button>
          {/* 잠금 사유는 잠긴 버튼 바로 위에서 말한다 */}
          {gateActive && !gatePassed && (
            <div className="gate-warn">판정 체크 미완료 — 저장 잠김</div>
          )}
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
          {/* 수정 중엔 이 문제의 재풀이 이력을 함께 보여준다 (읽기 전용) */}
          {editingId && (
            <AttemptHistory
              attempts={notes.find((x) => x.id === editingId)?.attempts}
            />
          )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
