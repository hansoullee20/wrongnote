import { useRef, useState } from "react";
import { PALETTES } from "../palettes.js";
import { downloadJSON, exportEnvelope, importEnvelope } from "../storage.js";
import { exportImages, importImages } from "../imageStore.js";
import { Section, Button } from "../components.jsx";

/**
 * 설정 — 통계(데이터)와 섞이면 안 되는 것들만 모은다.
 * 화면 색 · 낮/밤 · 백업.
 */
export default function SettingsView({
  notes,
  cards,
  onReplaceAll,
  palette,
  onSetPalette,
  theme,
  onSetTheme,
}) {
  const fileRef = useRef(null);
  const [importError, setImportError] = useState("");

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
        // 옛 백업들도 전부 현재 스키마로 마이그레이션
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
      <Section title="화면 색">
        <div className="palette-grid">
          {PALETTES.map((p) => {
            const c = theme === "dark" ? p.night : p.day;
            return (
              <button
                key={p.id}
                type="button"
                className={`palette-card${palette === p.id ? " on" : ""}`}
                aria-pressed={palette === p.id}
                onClick={() => onSetPalette(p.id)}
              >
                {/* 지금 보고 있는 모드 기준 미리보기 — 밤에 고르면 밤 색이 보인다 */}
                <span className="palette-swatch" style={{ background: c.bg }}>
                  <i style={{ background: c.paper }} />
                  <i style={{ background: c.act }} />
                  <i style={{ background: c.fail }} />
                </span>
                <span className="palette-name">{p.name}</span>
                <span className="palette-desc">{p.desc}</span>
              </button>
            );
          })}
        </div>
      </Section>

      <Section title="낮 · 밤">
        <div className="mode-switch">
          {[
            { id: "light", label: "☀ 주간" },
            { id: "dark", label: "☾ 야간" },
          ].map((m) => (
            <button
              key={m.id}
              type="button"
              className={`mode-switch-btn${theme === m.id ? " on" : ""}`}
              aria-pressed={theme === m.id}
              onClick={() => onSetTheme(m.id)}
            >
              {m.label}
            </button>
          ))}
        </div>
        <div className="hint">
          맨 위 ☾ 버튼으로도 바로 바꿀 수 있다. 처음엔 기기 설정을 따른다
        </div>
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
