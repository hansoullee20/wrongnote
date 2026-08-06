import { useCallback, useEffect, useRef, useState } from "react";
import { PALETTES } from "../palettes.js";
import { noteImageIds } from "../constants.js";
import { downloadJSON, exportEnvelope, importEnvelope } from "../storage.js";
import { exportImages, importImages } from "../imageStore.js";
import { Section, Button } from "../components.jsx";
import {
  readStorageHealth,
  requestPersistentStorage,
  fmtBytes,
  readLastExportAttempt,
  recordExportAttempt,
  readLastExportConfirmed,
  recordExportConfirmed,
  hasUserData,
  isExportStale,
} from "../storageHealth.js";

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
  const [health, setHealth] = useState(null);
  const [lastExport, setLastExport] = useState(() => readLastExportAttempt());
  const [confirmedExport, setConfirmedExport] = useState(() =>
    readLastExportConfirmed()
  );

  /* 캐시된 판정이 아니라 **지금** 값을 읽는다 — 크롬이 나중에 조용히 승인해줬을 수
     있는데 옛 "denied"를 보여주면 화면이 거짓말을 한다. */
  const refreshHealth = useCallback(
    () => readStorageHealth().then(setHealth),
    []
  );
  useEffect(() => {
    refreshHealth();
  }, [refreshHealth]);

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
    /* 여기서 기록하는 건 **시도** 시각이다. downloadJSON은 <a>.click()이라
       브라우저가 완료를 알려주지 않는다 — 차단되거나 저장 취소돼도 여기 온다.
       그래서 아래에 날짜를 보여준다: 사용자가 "그때 받은 적 없는데"를
       알아채는 게 조용한 실패를 드러내는 유일한 경로다. */
    const now = Date.now();
    recordExportAttempt(now);
    setLastExport(now);
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
        /* 사진을 먼저 복원한다. 하나라도 실패하면 교체를 취소하는데,
           자동 백업을 그 앞에서 받으면 아무것도 안 바뀌었는데 "가져오기 직전
           백업" 파일만 손에 쥐게 돼 혼란스럽다. 그래서 사진 복원 성공 뒤로 옮겼다.
           (이 시점까지 notes/cards는 그대로라 백업 내용은 동일하다) */
        if (!(await importImages(parsed.images))) {
          /* 문구가 정확해야 한다. 여기까지 왔으면 일부 사진은 **이미 IDB에
             쓰였다** — 노트·카드는 그대로지만 "아무것도 안 바뀌었다"는 거짓이다.
             하필 사용자의 문제가 공간 부족이라 더 그렇다. */
          setImportError(
            "사진 복원에 실패했다. 기존 노트·카드는 그대로다. 다만 복원하다 만 사진이 저장소에 남아 있을 수 있으니, 공간을 정리한 뒤 다시 시도해라."
          );
          return; // onReplaceAll을 부르지 않는다 → 상태 교체도 GC도 없다
        }
        /* 교체 직전 기존 데이터 자동 백업 다운로드 (사진 포함).
           이 백업은 되돌릴 수 없는 전체 교체의 유일한 안전망이라, 못 만들면
           교체를 진행하지 않는다. 자체 try/catch로 감싸는 이유: 바깥 catch가
           잡으면 원인과 무관한 "파싱 실패 — JSON 파일을 확인해라"가 뜬다. */
        try {
          const curImages = await exportImages(notes.flatMap(noteImageIds));
          downloadJSON("wr_backup_before_import.json", {
            ...exportEnvelope(notes, cards),
            images: curImages,
          });
        } catch {
          /* 이 시점엔 importImages가 성공했으므로 백업의 사진이 **전부 IDB에
             들어가 있다.** 교체를 취소하면 그것들은 아무 노트도 참조하지 않는
             고아가 된다 — 그래서 "변경 없음"이라고 말하지 않는다. */
          setImportError(
            "교체 직전 백업을 만들지 못해 가져오기를 취소했다. 기존 노트·카드는 그대로다. 다만 복원된 사진이 저장소에 남아 있으니, 다시 가져오거나 공간을 정리해라."
          );
          return;
        }
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

      <Section title="저장소" className="storage-health">
        {health === null ? (
          <div className="hint">확인 중…</div>
        ) : !health.supported ? (
          <div className="hint">
            이 브라우저는 저장소 상태를 알려주지 않는다. 내보내기를 자주 해라.
          </div>
        ) : (
          <>
            <div className="storage-row">
              <span className="storage-label">영구 보관</span>
              <span
                className={`storage-value${health.persisted ? " ok" : " warn"}`}
              >
                {health.persisted === null
                  ? "알 수 없음"
                  : health.persisted
                    ? "예"
                    : "아니오"}
              </span>
            </div>
            <div className="storage-row">
              <span className="storage-label">사용량</span>
              <span className="storage-value">
                {/* 값이 없으면 0으로 꾸미지 않는다 */}
                {health.usage === null
                  ? "알 수 없음"
                  : `${fmtBytes(health.usage)}${health.quota ? ` / ${fmtBytes(health.quota)}` : ""}`}
              </span>
            </div>
            {/* 영구가 아니면 절대 "안전하다"고 말하지 않는다.
                **확인 실패(null)도 안전하지 않은 쪽으로 친다** — persisted()만
                거부되고 estimate()는 살아 있는 부분 실패가 실제로 가능한데,
                그때 경고도 재요청 버튼도 없으면 확인이 안 되는 순간에 오히려
                보호가 얇아진다. 모르면 보장되지 않은 것이다. */}
            {health.persisted !== true && (
              <div className="storage-warn">
                {health.persisted === null
                  ? "영구 보관 여부를 확인하지 못했다. 보장된 상태가 아니므로 브라우저가 데이터를 지울 수 있다. 내보내기를 자주 해라."
                  : "기기 저장 공간이 부족하면 브라우저가 이 앱의 데이터를 통째로 지울 수 있다. 내보내기를 자주 해라."}
              </div>
            )}
            {health.persisted === true && (
              <div className="hint">
                브라우저가 임의로 지우지 않는다. 다만 사용자가 직접 사이트 데이터를
                삭제하면 그대로 사라진다 — 내보내기는 여전히 필요하다.
              </div>
            )}
            {health.persisted !== true && health.canRequest && (
              <Button
                variant="neutral"
                onClick={() =>
                  requestPersistentStorage({ force: true }).then(refreshHealth)
                }
              >
                영구 보관 요청
              </Button>
            )}
          </>
        )}
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
        {/* 알림은 설정 안에서만, 수동적으로. 배너·토스트·배지로 띄우면
            매일 쓰는 앱에서 소음이 되고 결국 무시하게 된다. */}
        {/* 확인 대기: 시도만으로는 경고를 끄지 않는다. downloadJSON은
            <a>.click()이라 차단·취소를 알 수 없어서, 사용자가 파일을 실제로
            받았다고 말해줘야 그때 신선한 것으로 친다. */}
        {lastExport !== null &&
          (confirmedExport === null || lastExport > confirmedExport) && (
            <div className="export-confirm">
              <span>내보낸 파일을 실제로 받았나?</span>
              <Button
                variant="neutral"
                onClick={() => {
                  const now = Date.now();
                  recordExportConfirmed(now);
                  setConfirmedExport(now);
                }}
              >
                받았다
              </Button>
            </div>
          )}
        {hasUserData() && isExportStale(confirmedExport, Date.now()) && (
          <div className="backup-stale">
            {confirmedExport === null
              ? "확인된 백업이 아직 없다. 이 앱은 이 기기에만 저장된다."
              : "마지막 확인된 백업이 일주일이 넘었다."}
          </div>
        )}
        {confirmedExport !== null && (
          <div className="hint last-export">
            마지막 확인된 백업:{" "}
            {new Date(confirmedExport).toLocaleDateString("ko-KR")}
          </div>
        )}
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
