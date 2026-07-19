import { useMemo, useRef, useState } from "react";
import { CAUSES, MATH_TOPICS, isRecheckDue } from "../constants.js";
import { downloadJSON, exportEnvelope, importEnvelope } from "../storage.js";
import { exportImages, importImages } from "../imageStore.js";
import { Section, Button } from "../components.jsx";

export default function StatsView({ notes, cards, onReplaceAll, onTopicClick }) {
  const fileRef = useRef(null);
  const [importError, setImportError] = useState("");

  const tagCounts = useMemo(() => {
    const m = new Map();
    notes.forEach((n) => n.tags.forEach((t) => m.set(t, (m.get(t) || 0) + 1)));
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [notes]);
  const maxTagCount = tagCounts.length ? tagCounts[0][1] : 1;

  /* 주원인 분포 — 노트당 1개라 합계가 노트 수와 일치한다.
     미분류는 묻지 않고 따로 센다. */
  const causeCounts = useMemo(() => {
    const counts = CAUSES.map((cause) => ({
      cause,
      count: notes.filter((n) => n.cause === cause).length,
    }));
    counts.sort((a, b) => b.count - a.count);
    return counts;
  }, [notes]);
  const maxCauseCount = causeCounts.length ? causeCounts[0].count : 1;
  const unclassified = useMemo(
    () => notes.filter((n) => !n.cause).length,
    [notes]
  );

  const matrix = useMemo(() => {
    const topics = [...new Set(notes.map((n) => n.topicMain).filter(Boolean))];
    const order = Object.keys(MATH_TOPICS);
    topics.sort(
      (a, b) =>
        ((order.indexOf(a) + 1 || 999) - (order.indexOf(b) + 1 || 999)) ||
        a.localeCompare(b)
    );
    return topics.map((topic) => {
      const tn = notes.filter((n) => n.topicMain === topic);
      return {
        topic,
        cells: CAUSES.map((cause) => tn.filter((n) => n.cause === cause).length),
        none: tn.filter((n) => !n.cause).length,
      };
    });
  }, [notes]);

  /* 가장 약한 칸 하나만 강조 — 표를 훑지 않아도 눈에 박히게 */
  const worst = useMemo(() => {
    let best = null;
    matrix.forEach((row, r) =>
      row.cells.forEach((v, c) => {
        if (v > 0 && (!best || v > best.v)) best = { r, c, v };
      })
    );
    return best;
  }, [matrix]);

  const audit = useMemo(() => {
    // 완료 = 한 번이라도 재검증한 노트 (반복 사이클 도입 후 기준)
    const done = notes.filter((n) => n.recheckCount > 0);
    const pass = done.filter((n) => n.recheckResult === "pass").length;
    const fail = done.filter((n) => n.recheckResult === "fail").length;
    const waiting = notes.filter((n) => isRecheckDue(n)).length;
    const rate = pass + fail > 0 ? fail / (pass + fail) : 0;
    return { done: done.length, pass, fail, waiting, rate };
  }, [notes]);

  async function handleExport() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, "0");
    const name = `wr_backup_${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}.json`;
    // 첨부 사진(base64)까지 포함한 완전 백업
    const images = await exportImages(notes.flatMap((n) => n.images || []));
    downloadJSON(name, { ...exportEnvelope(notes, cards), images });
  }

  function handleImportFile(e) {
    const file = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const parsed = JSON.parse(reader.result);
        // v1({notes,cards})·v2·v3 백업 모두 현재 스키마로 마이그레이션
        const migrated = importEnvelope(parsed);
        const ok = confirm(
          `가져오면 현재 데이터 전체가 교체된다 (노트 ${migrated.notes.length}건, 카드 ${migrated.cards.length}장). 계속?`
        );
        if (!ok) return;
        // 교체 직전 기존 데이터 자동 백업 다운로드 (사진 포함)
        const curImages = await exportImages(notes.flatMap((n) => n.images || []));
        downloadJSON("wr_backup_before_import.json", {
          ...exportEnvelope(notes, cards),
          images: curImages,
        });
        // 백업에 담긴 사진 복원 후 교체
        await importImages(parsed.images);
        onReplaceAll(migrated.notes, migrated.cards);
        setImportError("");
      } catch {
        setImportError("파싱 실패 — 데이터 변경 없음. JSON 파일을 확인해라.");
      }
    };
    reader.readAsText(file);
  }

  return (
    <div className="view">
      <Section title="주원인 분포">
        {notes.length === 0 && <div className="empty">데이터 없음.</div>}
        {causeCounts.map(({ cause, count }) => (
          <div key={cause} className="bar-row">
            <span className="bar-label">{cause}</span>
            <div className="bar-track">
              {count > 0 && (
                <div
                  className="bar-fill"
                  style={{ width: `${(count / maxCauseCount) * 100}%` }}
                />
              )}
            </div>
            <span className="bar-count">{count}</span>
          </div>
        ))}
        {unclassified > 0 && (
          <div className="unclassified">
            <span className="unclassified-num">{unclassified}</span>
            <span className="unclassified-text">
              주원인이 비어 있는 노트. 옛 분류에서 뜻을 확정할 수 없어 추측하지
              않고 남겨뒀다 — 기록 뷰에서 하나씩 골라주면 위 통계에 합류한다.
            </span>
          </div>
        )}
      </Section>

      <Section title="세부 태그 분포">
        {tagCounts.length === 0 && <div className="empty">데이터 없음.</div>}
        {tagCounts.map(([tag, count]) => (
          <div key={tag} className="bar-row">
            <span className="bar-label">{tag}</span>
            <div className="bar-track">
              <div
                className="bar-fill"
                style={{ width: `${(count / maxTagCount) * 100}%` }}
              />
            </div>
            <span className="bar-count">{count}</span>
          </div>
        ))}
      </Section>

      <Section title="토픽 × 주원인">
        {matrix.length === 0 && <div className="empty">데이터 없음.</div>}
        {matrix.length > 0 && (
          <table className="matrix">
            <thead>
              <tr>
                <th>토픽</th>
                {CAUSES.map((c) => (
                  <th key={c}>{c.split(" ")[0]}</th>
                ))}
                {unclassified > 0 && <th>미분류</th>}
              </tr>
            </thead>
            <tbody>
              {matrix.map((row, r) => (
                <tr key={row.topic} onClick={() => onTopicClick(row.topic)}>
                  <td className="matrix-topic">{row.topic}</td>
                  {row.cells.map((v, c) => (
                    <td
                      key={CAUSES[c]}
                      className={
                        worst && worst.r === r && worst.c === c
                          ? "hit worst"
                          : v
                            ? "hit"
                            : ""
                      }
                    >
                      {v || ""}
                    </td>
                  ))}
                  {unclassified > 0 && (
                    <td className={row.none ? "dim" : ""}>{row.none || ""}</td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div className="hint">
          진한 칸이 제일 약한 지점. 행 탭 → 기록 뷰에서 해당 토픽 필터
        </div>
      </Section>

      <Section title="재검증 감사">
        <div className="audit-grid">
          <div className="audit-cell">
            <div className="audit-num">{audit.done}</div>
            <div className="audit-label">완료</div>
          </div>
          <div className="audit-cell">
            <div className="audit-num green">{audit.pass}</div>
            <div className="audit-label">실행 확정</div>
          </div>
          <div className="audit-cell">
            <div className="audit-num red">{audit.fail}</div>
            <div className="audit-label">개념 갭 재분류</div>
          </div>
          <div className="audit-cell">
            <div className="audit-num">{audit.waiting}</div>
            <div className="audit-label">대기</div>
          </div>
        </div>
        {audit.done > 0 && audit.rate > 0.4 && (
          <div className="audit-warn">
            재분류율 {Math.round(audit.rate * 100)}% — 실행 실수 자가 태깅이
            개념 갭을 가리고 있음. 태깅 기준 재점검.
          </div>
        )}
      </Section>

      <Section title="백업">
        <div className="io-row">
          <Button variant="neutral" onClick={handleExport}>
            내보내기 (JSON)
          </Button>
          <Button
            variant="neutral"
            onClick={() => fileRef.current && fileRef.current.click()}
          >
            가져오기 (전체 교체)
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept=".json,application/json"
            style={{ display: "none" }}
            onChange={handleImportFile}
          />
        </div>
        {importError && <div className="io-error">{importError}</div>}
        <div className="hint">
          저장소는 이 브라우저의 localStorage뿐이다. 주기적으로 내보내라.
          가져오기 직전 기존 데이터는 wr_backup_before_import.json으로 자동
          다운로드된다.
        </div>
      </Section>
    </div>
  );
}
