import { useEffect, useMemo, useState } from "react";
import { SUBJECTS, CAUSES, MATH_TOPICS } from "../constants.js";
import { Button, ChipRow, Field } from "../components.jsx";

function normalizeInitial(imported) {
  return {
    subject: imported.subject || "수학",
    cause: imported.cause || "",
    correctAnswer: imported.correctAnswer || "",
    myAnswer: "",
    examTime: "",
    problem: imported.problem || "",
    topicMain: imported.topicMain || "",
    topicSub: imported.topicSub || "",
    question: imported.question || "",
    mySol: imported.mySol || "",
    optSol: imported.optSol || "",
    derived: null,
    tags: Array.isArray(imported.tags) ? imported.tags : [],
    memo: imported.memo || "",
    concepts: Array.isArray(imported.concepts) ? imported.concepts : [],
    questionLatex: imported.questionLatex || "",
    analysisLocale: imported.analysisLocale || "ko",
    failurePoint: imported.failurePoint || "",
    images: [],
    solutionImages: [],
    attempts: [],
  };
}

export default function AiReviewView({
  delivery,
  saving = false,
  disabled = false,
  onSave,
  onReject,
}) {
  const [draft, setDraft] = useState(() => normalizeInitial(delivery.imported));

  useEffect(() => {
    setDraft(normalizeInitial(delivery.imported));
  }, [delivery.eventId, delivery.imported]);

  const set = (patch) => setDraft((current) => ({ ...current, ...patch }));
  const subtopics = useMemo(
    () => (draft.topicMain && MATH_TOPICS[draft.topicMain]) || [],
    [draft.topicMain]
  );
  const canSave = Boolean(draft.problem.trim() && draft.cause && !saving && !disabled);

  return (
    <div className="view ai-review-view" data-testid="ai-review-view">
      <div className="form-shell">
        <div className="form">
          <div className="form-group">
            <div className="form-group-title">AI가 채운 내용을 검토해라</div>
            <p className="form-hint">
              AI 결과는 아직 기록이 아니다. 내용을 수정한 뒤 저장해야 오답노트에 들어간다.
            </p>
          </div>

          <div className="form-group">
            <div className="form-group-title">사실</div>
            <ChipRow
              options={SUBJECTS}
              value={draft.subject}
              onPick={(subject) =>
                set({ subject, topicMain: "", topicSub: "", derived: null })
              }
            />
            <Field label="문제 식별" htmlFor="ai-review-problem">
              <input
                id="ai-review-problem"
                value={draft.problem}
                onChange={(e) => set({ problem: e.target.value })}
              />
            </Field>
            <Field label="문제 내용" htmlFor="ai-review-question">
              <textarea
                id="ai-review-question"
                rows={6}
                value={draft.question}
                onChange={(e) => set({ question: e.target.value })}
              />
            </Field>
            <Field label="정답" htmlFor="ai-review-answer">
              <input
                id="ai-review-answer"
                value={draft.correctAnswer}
                onChange={(e) => set({ correctAnswer: e.target.value })}
              />
            </Field>
          </div>

          {draft.subject === "수학" && (
            <div className="form-group">
              <div className="form-group-title">분류</div>
              <Field label="대단원" htmlFor="ai-review-topic-main">
                <select
                  id="ai-review-topic-main"
                  value={draft.topicMain}
                  onChange={(e) => set({ topicMain: e.target.value, topicSub: "" })}
                >
                  <option value="">미분류</option>
                  {Object.keys(MATH_TOPICS).map((topic) => (
                    <option key={topic} value={topic}>{topic}</option>
                  ))}
                </select>
              </Field>
              <Field label="소단원" htmlFor="ai-review-topic-sub">
                <select
                  id="ai-review-topic-sub"
                  value={draft.topicSub}
                  disabled={!draft.topicMain}
                  onChange={(e) => set({ topicSub: e.target.value })}
                >
                  <option value="">미분류</option>
                  {subtopics.map((topic) => (
                    <option key={topic} value={topic}>{topic}</option>
                  ))}
                </select>
              </Field>
            </div>
          )}

          <div className="form-group">
            <div className="form-group-title">왜 틀렸나</div>
            <ChipRow options={CAUSES} value={draft.cause} onPick={(cause) => set({ cause })} />
            <Field label="실패 지점" htmlFor="ai-review-failure-point">
              <textarea
                id="ai-review-failure-point"
                rows={3}
                value={draft.failurePoint}
                onChange={(e) => set({ failurePoint: e.target.value })}
              />
            </Field>
          </div>

          <div className="form-group">
            <div className="form-group-title">풀이 비교</div>
            <Field label="내 풀이" htmlFor="ai-review-my-solution">
              <textarea
                id="ai-review-my-solution"
                rows={7}
                value={draft.mySol}
                onChange={(e) => set({ mySol: e.target.value })}
              />
            </Field>
            <Field label="추천 풀이" htmlFor="ai-review-optimal-solution">
              <textarea
                id="ai-review-optimal-solution"
                rows={8}
                value={draft.optSol}
                onChange={(e) => set({ optSol: e.target.value })}
              />
            </Field>
            {draft.concepts.length > 0 && (
              <div className="field">
                <div className="field-label">핵심 개념</div>
                <div>{draft.concepts.join(" · ")}</div>
              </div>
            )}
            <Field label="메모" htmlFor="ai-review-memo">
              <textarea
                id="ai-review-memo"
                rows={4}
                value={draft.memo}
                onChange={(e) => set({ memo: e.target.value })}
              />
            </Field>
          </div>

          <div className="form-actions">
            <Button
              variant="ghost"
              disabled={saving}
              onClick={() => onReject("사용자가 AI 분석을 검토한 뒤 기록하지 않기로 함")}
            >
              거절
            </Button>
            <Button
              variant="primary"
              disabled={!canSave}
              onClick={() => onSave({ ...draft, problem: draft.problem.trim() })}
            >
              {saving ? "저장 중…" : "저장 (기록하기)"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
