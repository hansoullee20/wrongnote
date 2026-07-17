import { useMemo, useRef, useState } from "react";
import {
  DAY_MS,
  RECHECK_DAYS,
  EXECUTION_TAGS,
  MATH_TOPICS,
} from "../constants.js";
import { downloadJSON } from "../storage.js";

export default function StatsView({ notes, cards, onReplaceAll, onTopicClick }) {
  const fileRef = useRef(null);
  const [importError, setImportError] = useState("");

  const tagCounts = useMemo(() => {
    const m = new Map();
    notes.forEach((n) => n.tags.forEach((t) => m.set(t, (m.get(t) || 0) + 1)));
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [notes]);
  const maxTagCount = tagCounts.length ? tagCounts[0][1] : 1;

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
        exec: tn.filter((n) => n.tags.some((t) => EXECUTION_TAGS.includes(t)))
          .length,
        concept: tn.filter((n) => n.tags.includes("개념 오류")).length,
        status: tn.filter((n) => n.tags.includes("지위 오해")).length,
      };
    });
  }, [notes]);

  const audit = useMemo(() => {
    const done = notes.filter((n) => n.rechecked);
    const pass = done.filter((n) => n.recheckResult === "pass").length;
    const fail = done.filter((n) => n.recheckResult === "fail").length;
    const waiting = notes.filter(
      (n) => !n.rechecked && Date.now() - n.ts >= RECHECK_DAYS * DAY_MS
    ).length;
    const rate = pass + fail > 0 ? fail / (pass + fail) : 0;
    return { done: done.length, pass, fail, waiting, rate };
  }, [notes]);

  function handleExport() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, "0");
    const name = `wr_backup_${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}.json`;
    downloadJSON(name, { notes, cards });
  }

  function handleImportFile(e) {
    const file = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result);
        if (
          !parsed ||
          !Array.isArray(parsed.notes) ||
          !Array.isArray(parsed.cards)
        ) {
          throw new Error("invalid shape");
        }
        const ok = confirm(
          `가져오면 현재 데이터 전체가 교체된다 (노트 ${parsed.notes.length}건, 카드 ${parsed.cards.length}장). 계속?`
        );
        if (!ok) return;
        // 교체 직전 기존 데이터 자동 백업 다운로드
        downloadJSON("wr_backup_before_import.json", { notes, cards });
        onReplaceAll(parsed.notes, parsed.cards);
        setImportError("");
      } catch {
        setImportError("파싱 실패 — 데이터 변경 없음. JSON 파일을 확인해라.");
      }
    };
    reader.readAsText(file);
  }

  return (
    <div className="view">
      <section className="stats-section">
        <h2 className="stats-title">에러 타입 분포</h2>
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
      </section>

      <section className="stats-section">
        <h2 className="stats-title">토픽 × 에러타입</h2>
        {matrix.length === 0 && <div className="empty">데이터 없음.</div>}
        {matrix.length > 0 && (
          <table className="matrix">
            <thead>
              <tr>
                <th>토픽</th>
                <th>실행</th>
                <th>개념</th>
                <th>지위</th>
              </tr>
            </thead>
            <tbody>
              {matrix.map((row) => (
                <tr key={row.topic} onClick={() => onTopicClick(row.topic)}>
                  <td className="matrix-topic">{row.topic}</td>
                  <td className={row.exec ? "hit" : ""}>{row.exec || ""}</td>
                  <td className={row.concept ? "hit" : ""}>
                    {row.concept || ""}
                  </td>
                  <td className={row.status ? "hit" : ""}>
                    {row.status || ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div className="hint">행 탭 → 기록 뷰에서 해당 토픽 필터</div>
      </section>

      <section className="stats-section">
        <h2 className="stats-title">재검증 감사</h2>
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
      </section>

      <section className="stats-section">
        <h2 className="stats-title">백업</h2>
        <div className="io-row">
          <button type="button" className="io-btn" onClick={handleExport}>
            내보내기 (JSON)
          </button>
          <button
            type="button"
            className="io-btn"
            onClick={() => fileRef.current && fileRef.current.click()}
          >
            가져오기 (전체 교체)
          </button>
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
      </section>
    </div>
  );
}
