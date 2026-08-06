import { useRef, useState } from "react";
import { PALETTES } from "../palettes.js";
import { noteImageIds } from "../constants.js";
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
  parseError = "",
  writeError = "",
  onReplaceAll,
  palette,
  onSetPalette,
  theme,
  onSetTheme,
}) {
  const fileRef = useRef(null);
  const [importError, setImportError] = useState("");

  /* 파싱 실패 상태에서는 notes/cards가 빈 배열이다. 내보내기를 열어두면
     "정상 백업"처럼 보이는 빈 파일을 쥐여주게 된다 — 원본은 localStorage에
     멀쩡히 있는데도. 그래서 이때만 내보내기까지 막는다.
     쓰기 실패는 반대다. 메모리 데이터가 온전하고 내보내기가 유일한 구조
     수단이라 반드시 열어둔다. 다만 가져오기는 둘 다 막는다 — 저장할 수 없는
     상태에서 전체 교체를 허용하면 되돌릴 방법이 없다. */
  const exportBlocked = Boolean(parseError);
  const importBlocked = Boolean(parseError) || Boolean(writeError);

  async function handleExport() {
    if (exportBlocked) return; // 버튼도 막지만 호출부가 늘어도 안전하게
    const d = new Date();
    const p = (n) => String(n).padStart(2, "0");
    const name = `wr_backup_${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}.json`;
    // 첨부 사진(base64)까지 포함한 완전 백업 — 문제 사진 + 풀이 사진
    const images = await exportImages(notes.flatMap(noteImageIds));
    downloadJSON(name, { ...exportEnvelope(notes, cards), images });
  }

  function handleImportFile(e) {
    const file = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!file || importBlocked) return;
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
        const curImages = await exportImages(notes.flatMap(noteImageIds));
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
          <Button
            variant="neutral"
            disabled={exportBlocked}
            onClick={handleExport}
          >
            내보내기 (JSON)
          </Button>
          <Button
            variant="neutral"
            disabled={importBlocked}
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
        {parseError && (
          <div className="io-error">
            데이터를 읽지 못해 내보내기·가져오기를 막았다. 지금 내보내면 빈 파일이
            나온다 — 원본은 이 브라우저에 그대로 있으니 덮어쓰지 마라.
          </div>
        )}
        {!parseError && writeError && (
          <div className="io-error">
            저장이 잠겨 가져오기를 막았다. 내보내기는 지금 하는 게 좋다 — 화면의
            데이터는 온전하다.
          </div>
        )}
        <div className="hint">
          저장소는 이 브라우저의 localStorage뿐이다. 주기적으로 내보내라.
          가져오기 직전 기존 데이터는 wr_backup_before_import.json으로 자동
          다운로드된다.
        </div>
      </Section>
    </div>
  );
}
