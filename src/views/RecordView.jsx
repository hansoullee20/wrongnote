import { useMemo, useRef, useState } from "react";
import {
  SUBJECTS,
  MAIN_ERROR_TAGS,
  MATH_ERROR_TAGS,
  EXECUTION_TAGS,
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
} from "../components.jsx";
import { ocrImage } from "../ocr.js";
import { copyText } from "../clipboard.js";

function buildClassifyPrompt(draft) {
  const isMath = draft.subject === "수학";
  const lines = [
    `수능 ${draft.subject} 오답 분류를 도와줘. 아래 문제를 보고:`,
    isMath
      ? "1) 토픽을 아래 [토픽 목록]에서 대단원 1개 + 소단원 1개로 골라줘."
      : "1) 어떤 유형의 문제인지 한 줄로 말해줘.",
    "2) 에러 유형을 아래 [에러 태그]에서 골라줘 (내 풀이 참고). 답은 짧게.",
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
    "[에러 태그]",
    MAIN_ERROR_TAGS.join(", ") +
      (isMath ? ` / 수학 세부: ${MATH_ERROR_TAGS.join(", ")}` : "")
  );
  return lines.join("\n");
}

const emptyDraft = (subject = "수학") => ({
  subject,
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
  onDelete,
  filter,
  setFilter,
}) {
  const [draft, setDraft] = useState(() => emptyDraft());
  const [formOpen, setFormOpen] = useState(true);
  const [checks, setChecks] = useState([false, false, false, false]);
  const [expandedId, setExpandedId] = useState(null);
  const [ocr, setOcr] = useState({ busy: false, label: "", error: "" });
  const [copied, setCopied] = useState("");
  const ocrInputRef = useRef(null);

  async function handleCopyPrompt() {
    const ok = await copyText(buildClassifyPrompt(draft));
    setCopied(ok ? "복사됨 — 클로드 앱에 붙여넣어라" : "복사 실패");
    setTimeout(() => setCopied(""), 2500);
  }

  async function handleOcrFile(e) {
    const file = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!file) return;
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
        error: "인식 실패 — 더 밝게, 정면에서 다시 찍어봐라.",
      });
    }
  }

  const isMath = draft.subject === "수학";
  const gateActive =
    isMath && draft.tags.some((t) => EXECUTION_TAGS.includes(t));
  const gatePassed = !gateActive || checks.every(Boolean);
  const canSave = draft.problem.trim().length > 0 && gatePassed;

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

  const submit = () => {
    if (!canSave) return;
    onAdd({ ...draft, problem: draft.problem.trim() });
    setDraft(emptyDraft(draft.subject));
    setChecks([false, false, false, false]);
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
    const order = [...MAIN_ERROR_TAGS, ...MATH_ERROR_TAGS];
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
        title="오답 기록"
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
                {ocr.busy ? ocr.label : "사진에서 문제 추출 (OCR)"}
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

            <div className="label">에러 태그</div>
            <MultiChipRow
              options={MAIN_ERROR_TAGS}
              selected={draft.tags}
              onToggle={toggleTag}
            />
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
            저장
          </Button>
          {gateActive && !gatePassed && (
            <div className="gate-warn">판정 체크 미완료 — 저장 잠김</div>
          )}
        </div>
      </Panel>

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
                  {N > 0 && <span className="repeat-marker">×{N}</span>}
                </div>
                {n.question && !open && (
                  <div className="note-preview">{n.question}</div>
                )}
              </button>
              {open && (
                <div className="note-detail">
                  <TagBadges tags={n.tags} />
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
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
