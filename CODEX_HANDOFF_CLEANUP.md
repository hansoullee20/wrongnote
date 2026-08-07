# 오답노트 — 프로젝트 인수인계 + 정리 계획 승인 요청

> **이 문서의 목적**
> 1. Codex가 이 프로젝트를 처음부터 따라잡을 수 있게 한다 (구조·데이터 모델·불변식·현재 상태).
> 2. 그 다음, 제안된 **죽은 코드 제거 + 중복 정리** 계획을 승인/반려해 달라는 요청이다.
>
> §9에 근거와 함께 계획이 있고, §10에 **확정된 결정 6건**이 있다.
> 시간이 없으면 §7(현재 상태) → §9(계획) → §10(결정)만 읽어도 된다.
>
> **상태: 스택 #1–#5 머지 완료, 정리 A·B·C 완료.** §10.1에 결과가 있다.
> 결정 6(`storage.js:72`)도 해결됐다 — §10.4·§11.
>
> **2026-08-07 기준 남은 것:** E-2 원자적 저장(계획 `.reviews/e2-plan-claude.md`,
> PR #10은 테스트 헬퍼 대조군만 머지했고 `storage.js`는 그대로다),
> D-gc(§11.1), 전체화면 보기 기능 PR, 그리고 열린 PR #11(테마).
>
> 이 문서의 §9 서술(줄 번호·"죽어 있다" 판정)은 **정리 전 코드 기준**이다.
> A 커밋이 그 대상을 실제로 지웠으므로, 지금 코드에서 §9의 줄 번호를 찾으면 없다.
> 근거 기록으로 남긴 것이니 그대로 읽되 현재 코드와 대조하지 말 것.
> 브랜치 tip 해시는 적지 않는다 — 갱신할 때마다 낡는다.
> `git rev-parse origin/<branch>`로 확인할 것.
>
> **개정 이력** (해시 없이, 순서만)
> 1. 최초 작성
> 2. Codex 1차 리뷰 반영 — §9.4를 순서 강제 단계로 재작성(P1), 브랜치 상태 명시(P2),
>    §9.5-1 이미지 훅을 스칼라/복수로 분리(P3). §9.1은 Codex가 독립 확인.
> 3. Codex 2차 리뷰 반영 — dep 키를 `JSON.stringify`로 교정, tip 해시 제거.
>    **질문 6건 전부 답을 받아 §10을 "결정" 절로 전환.**

---

## 1. 프로젝트 개요

수능 대비 **개인 오답노트** PWA. 단일 사용자, 서버 없음, 전부 브라우저에 저장.
주 사용 환경은 **10인치 안드로이드 태블릿**(세로), 홈 화면에 설치해서 쓴다.

핵심 루프는 "기록 → 다시 풀기 → 궤적 확인"이다:

1. 틀린 문제를 **사진으로 찍어** 붙이고, 주원인을 하나 고른다
2. 복습 주기가 돌아오면 **다시 푼다**. 틀리면 *이번 시도의* 원인을 다시 고른다
3. 연속으로 맞히면 **졸업**, 계속 틀리면 **불안정**으로 남아 계속 올라온다

설계에서 가장 중요하게 지킨 원칙 하나: **추측해서 데이터를 만들지 않는다.**
옛 데이터의 뜻을 확정할 수 없으면 빈 값으로 두고 사용자에게 묻는다. 통계가 거짓말을
하기 시작하면 오답노트는 쓸모가 없어지기 때문이다.

---

## 2. 스택

| | |
|---|---|
| 프레임워크 | React 18 + Vite 5, **바닐라 JS** (TypeScript 아님) |
| 상태 | `useState`/`useMemo`만. 상태관리 라이브러리 없음 |
| 저장 | `localStorage` (텍스트) + `IndexedDB` (사진 blob) |
| PWA | `vite-plugin-pwa`, `registerType: "autoUpdate"` |
| 테스트 | Playwright E2E **65건** (단위 테스트 없음 — 전부 실제 브라우저) |
| 배포 | GitHub Pages, `base: "/wrongnote/"` (build 시에만) |
| 폰트 | Pretendard Variable + 나눔명조, `public/fonts/`에 자체 호스팅 |

의존성은 `react`, `react-dom` 둘뿐이다. devDependencies도 vite/playwright 계열만 있다.
**의도적으로 얇게 유지하고 있다** — 새 런타임 의존성을 추가할 이유가 생기면 그건
설계를 다시 볼 신호다.

---

## 3. 파일 인벤토리

```
src/
  App.jsx              479  탭·오버레이 라우팅, 모든 CRUD, 테마/팔레트 상태
  main.jsx              16  엔트리. styles.css → themes.css 순서가 중요
  constants.js         150  분류 체계·주기 상수·isRecheckDue·uid·fmtDate
  migrate.js           103  스키마 마이그레이션 (순수 함수, 멱등)
  storage.js           118  localStorage 로드/저장, 백업 봉투, 파싱 실패 잠금
  imageStore.js        132  IndexedDB blob CRUD, 압축, base64 내보내기/가져오기
  review.js            132  궤적 셀렉터 (순수). 상태를 저장하지 않고 파생시킨다
  srs.js                57  플래시카드 간격 반복
  seed.js              136  첫 실행 시드 데이터
  clipboard.js          25  분류 프롬프트 복사
  palettes.js          141  색의 단일 출처 — 팔레트 6종 × 주간/야간
  themes.css           661  ⚠️ 자동 생성물. 직접 고치지 말 것
  styles.css         2,791  레이아웃·타이포·컴포넌트 규칙 (색 토큰은 themes.css)
  components.jsx       351  공용 UI 14개
  views/
    RecordView.jsx     780  기록/수정 폼   ← §9의 정리 대상
    SolveView.jsx      820  다시 풀기 세션 상태 기계
    StatsView.jsx      308  통계 (데이터 전용)
    ProblemsView.jsx   277  문제 그리드 + 안정성 그룹
    CardsView.jsx      227  플래시카드 복습/관리
    SettingsView.jsx   140  화면 색 · 낮/밤 · 백업
tools/
  gen-themes.mjs       104  palettes.js → themes.css 생성기
  verify-contrast.mjs   52  WCAG 4.5:1 게이트 (204조합)
tests/                2,020  Playwright 스펙 10개 + 헬퍼
```

---

## 4. 데이터 모델과 불변식

### 4.1 저장 키

| 키 | 내용 |
|---|---|
| `wr_notes` | 노트 배열 |
| `wr_cards` | 플래시카드 배열 |
| `wr_schema_version` | 현재 `5` |
| `wr_backup_v{n}` | 스키마 n → n+1 올리기 **직전**의 원본 문자열 스냅샷 |
| `wr_theme` | `"light"` \| `"dark"` |
| `wr_palette` | 팔레트 id (기본 `"warm"`) |
| `gap_cards` | v1 시절 카드 키. **읽기 전용**으로만 남아 있다 |

사진은 localStorage에 넣지 않는다 — IndexedDB `wrongnote/images`에 blob으로 저장하고
노트는 `images: [id]` 참조만 갖는다.

### 4.2 노트

```js
{
  id, ts, date,                     // 불변
  subject, problem,                 // problem = "6모 Q22" 같은 식별자
  topicMain, topicSub,
  question, mySol, optSol, memo,
  cause,                            // 주원인 — 노트당 정확히 1개 (통계의 축)
  tags: [],                         // 세부 태그 — 여러 개. 집계 축 아님
  correctAnswer, myAnswer, examTime,
  derived,                          // "yes"면 "지위 오해" 자동 태그 + 카드 생성
  images: [],                       // IndexedDB 참조
  attempts: [],                     // v5 — 아래
  rechecked, recheckResult,         // 마지막 재풀이 결과
  recheckCount, nextRecheckTs,
}
```

**`cause`가 노트당 정확히 하나**인 게 통계 전체의 전제다. 합계가 노트 수와 일치해야
비율이 뜻을 가진다. 이걸 여러 개로 바꾸면 `StatsView`의 모든 집계가 무의미해진다.

### 4.3 시도 (v5)

```js
{
  id,                               // 결정적 — 레거시는 `legacy:${noteId}:${i}:${ts}`
  ts, answer, correct,
  result: "pass" | "fail",
  seconds,                          // 없으면 null
  cause,                            // fail만. pass는 항상 ""
  tags: [], memo: "",               // fail만
  source,                           // scheduled|random|manual|solution_reveal|legacy
}
```

### 4.4 반드시 지켜야 하는 불변식

1. **마이그레이션은 멱등이고 추측하지 않는다.**
   `migrateNote`/`migrateCard`/`migrateAttempt`는 순수 함수이고 몇 번을 돌려도 같은 결과가
   나와야 한다. 옛 태그에서 주원인을 못 정하면 `cause: ""`로 두고 **절대 추측하지 않는다**.
   모르는 필드는 spread로 보존한다.

2. **파싱 실패 시 저장을 잠근다.**
   `loadAll`이 JSON 파싱에 실패하면 `error`를 반환하고 `App`이 저장 이펙트를 잠근다.
   깨진 데이터를 빈 배열로 덮어쓰면 안 된다.

3. **fail은 분류 없이 저장되지 않는다.**
   `SolveView`가 `classifying_fail` 페이즈에서 원인을 받을 때까지 시도는 **메모리에만**
   있다(`pendingFailure`). `App.recordAttempt`도 `CAUSES`에 없는 원인이면 거부한다.
   분류 없이 이탈하면 그 시도는 없던 일이 된다. (테스트로 잠겨 있음)

4. **틀렸다고 노트의 주원인을 자동으로 바꾸지 않는다.**
   잘못된 재분류는 잘못된 처방으로 이어진다. 세션 요약에서 사용자에게 물어본다.

5. **졸업 판정은 저장하지 않고 파생시킨다.**
   `review.js`의 셀렉터가 `attempts`에서 계산한다. `GRADUATION_PASS_STREAK` 상수 하나만
   보고, `ProblemsView`와 `StatsView`가 같은 셀렉터를 쓰기 때문에 숫자가 어긋날 수 없다.

6. **`isRecheckDue`는 단일 기준이다.** 탭 배지와 풀기 세션 큐가 같은 함수를 쓴다.

---

## 5. 테마 시스템

축이 **둘**이고 서로 직교한다:

- **팔레트** (`data-palette`) — 6종. 한 번 고르는 것. ⚙ 설정 안에 있다
- **낮/밤** (`data-theme`) — 자주 바꾸는 것. 마스트헤드 ☾ 로 원탭

색은 **`src/palettes.js`가 단일 출처**다. `tools/gen-themes.mjs`가 여기서
`src/themes.css`를 찍어낸다 (`npm run themes`). 손으로 12개 토큰 블록을 관리하면
반드시 어긋나기 때문에 생성으로 관리한다. **`themes.css`를 직접 고치면 안 된다.**

CSS 특이도 순서가 중요하다:

```
:root                                     (0,1,0)  주간 기본
:root[data-theme="dark"]                  (0,2,0)  야간 기본 — 팔레트 몰라도 어둡게
:root[data-palette="X"]                   (0,2,0)  주간 팔레트 (뒤에 와서 이김)
:root[data-palette="X"][data-theme="dark"](0,3,0)  야간 팔레트 (제일 셈)
```

`tools/verify-contrast.mjs`가 팔레트 6종 × 주간·야간 × 17쌍 = **204조합**의 명암비를
실제로 계산해서 4.5:1 미만이면 빌드를 깬다. 개발 중 총 18건의 미달을 이 도구가 잡았다 —
**눈대중으로는 전부 괜찮아 보였다.**

`index.html` `<head>`에 blocking 인라인 스크립트가 있어 첫 페인트 전에 두 속성을 찍는다.
없으면 야간 사용자가 켤 때마다 주간 크림색이 번쩍인다.

---

## 6. 개발 · 검증 명령

```bash
npm ci
npm run dev          # localhost:5173
npm test             # Playwright 65건
npm run build
npm run themes       # palettes.js → themes.css 재생성
npm run contrast     # 204조합 명암비 게이트
```

**샌드박스 주의**: Playwright 1.61이 chromium 빌드 1228을 원하는데 환경에는 1194가 있다.
`launchOptions: { executablePath: "/opt/pw-browsers/chromium" }`를 덮어쓴 임시 설정으로
돌린다. **이 파일은 커밋하지 않는다** — CI는 `npx playwright install`을 하므로 불필요하다.

CI(`.github/workflows/deploy.yml`)는 `npm ci` → playwright install → `npm test` →
`npm run contrast` → `npm run themes && git diff --exit-code src/themes.css` →
`npm run build` → Pages 배포. **main push와 `workflow_dispatch`에만 걸린다 — PR 트리거 CI는 없다.**

---

## 7. 현재 상태

### 7.1 PR 스택 5단

```
main
 └─ #1 f75bb49  claude/text-extract-image-upload-z8p69m  OCR 제거 → 사진 첨부
     └─ #2 9b6559f  claude/spec-v2-trajectory            v5 궤적 + 통계
         └─ #3 5947de6  claude/design-refresh            디자인 마감
             └─ #4 05135e1  claude/design-editorial      디자인 재설계 + 야간 분리
                 └─ #5 claude/design-warm  웜톤 + 팔레트 6종 + 설정 + 리뷰 수정
                        └ 코드 기준선 5ce0f7b, 그 위에 이 문서 커밋들 (코드 변경 없음)
```

전부 **draft, `mergeable_state: clean`, 리뷰 0건·코멘트 0건**.
`main...claude/design-warm` = **31 files, +3,785 / −628**.

⚠️ **#1과 #2는 둘 다 base가 `main`인데, #2가 #1을 포함한다** (`f75bb49`가 `9b6559f`의
조상임을 확인). 즉 **#2를 머지하면 #1도 함께 들어간다.** #1을 먼저 머지하고 #2로 가는 게
이력상 깔끔하지만, #2만 머지해도 코드는 동일하다. 순서: #1 → #2 → #3 → #4 → #5.

### 7.2 배포

`https://hansoullee20.github.io/wrongnote/` 에 **`a122748`**(설정 화면 커밋)이 올라가 있다.
run `31018035087`, build·deploy 둘 다 성공.

두 가지 주의:

- 라이브는 **`5ce0f7b`보다 한 커밋 뒤**다. 즉 §8의 야간 번쩍임 수정이 아직 반영 안 됐다.
- 라이브는 **브랜치 빌드**다. main에 뭐라도 푸시되는 순간 PR #1 이전 버전으로 덮인다.
  스택을 머지하는 게 근본 해결이다.

---

## 8. 지금까지의 주요 결정과 이유

| 결정 | 이유 |
|---|---|
| **OCR(tesseract.js) 제거** | 한글 수식 인식률이 실용 수준이 아니었다. 사진을 그대로 붙이고 눈으로 보는 게 낫다. 번들도 크게 줄었다 |
| **fail을 종결로 취급하지 않음** | v3까지는 한 번 틀리면 큐에서 영구 제외됐다. 틀린 문제야말로 다시 봐야 한다 → 다음 복습을 내일로 당긴다 |
| **시도별 원인 (v5)** | 노트에 원인이 하나만 있으면 "처음엔 개념, 지금은 계산"을 표현할 수 없다. 시도마다 원인을 붙이되 노트의 주원인은 건드리지 않는다 |
| **졸업을 저장하지 않고 파생** | 저장하면 재계산 로직이 바뀔 때 옛 데이터가 거짓말을 한다 |
| **설정을 통계 탭에서 분리** | 통계는 데이터 탭이다. 기능 설정이 섞이면 성격이 어긋난다. 탭을 5개로 늘리지 않고 전체화면 시트로 뺐다 |
| **눈부심을 배경 광량으로 해결** | 글씨 대비를 낮추는 게 아니라 순백(100%) → 미색(96%)으로 내렸다. 본문 대비는 오히려 13.3:1로 **올라갔다** |
| **색을 생성물로 관리** | 팔레트 6종 × 주야 = 12블록을 손으로 쓰면 반드시 어긋난다 |
| **개념 라이브러리 보류** | v2 스펙 §30. 실사용 2주 뒤 재검토 조건부 |

### 8.1 방금 머지 전 코드리뷰에서 잡은 것 (`5ce0f7b`)

프로브 테스트로 **재현한** 버그 2건 + CI 공백 1건:

1. **야간인데 켤 때마다 주간 크림색 번쩍임** — 테마 이펙트가 첫 페인트 뒤에 돈다.
   측정: DOMContentLoaded 시점 `--bg`가 `#e7ddcb`(주간), 마운트 후 `#1a1714`
2. **풀기 중 노트 삭제 시 막다른 화면** — 복구 이펙트가 `solving`만 봐서,
   `graded`에서 '지금 추가'→삭제하면 버튼 0개인 화면에 갇혔다
3. **CI가 `npm run contrast`와 themes 동기화를 검사하지 않았다**

신규 회귀 테스트 3건은 **각각 수정을 되돌리면 실패하는 것을 확인**했다.

---

## 9. 제안 — 죽은 코드 제거 + 중복 정리 ⭐

> 여기가 승인을 받고 싶은 부분이다.

### 9.1 가장 큰 것: `RecordView.jsx`의 17%가 도달 불가능

**근거**: `App.jsx:452`가 `RecordView`를 렌더하는 **유일한** 지점이고, 항상 `formOnly`를
넘긴다(`App.jsx:470`). 따라서 `RecordView.jsx:649`의 `{!formOnly && ...}` 가지 전체가
죽어 있다. 이건 시트 리팩터 **이전**의 옛 기록 목록이고, 지금은 `ProblemsView`가 그 일을 한다.

죽은 것:

- **JSX 649–777** — 필터 행, 노트 목록, 상세 펼침, 수정/삭제 버튼
- **`FormShell` 89–96** — `formOnly`가 항상 참이라 `Panel` 경로가 죽었다
- **상태** `formOpen`, `expandedId`
- **파생값 4개** — `repeatCounts`(291), `repeatN`(302), `tagsInUse`(311), `visible`(321).
  **노트가 바뀔 때마다 아무 데도 안 쓰이는 계산을 돌린다**
- **props** `filter`, `setFilter`, `onDelete`, 그리고 `formOnly` 자체

**134 / 781줄 (17%)**

### 9.2 안 쓰이는 export

| 심볼 | 위치 | 상태 |
|---|---|---|
| `Card` | `components.jsx:108` | **전 코드베이스 사용 0건** |
| `Panel` | `components.jsx:125` | 죽은 `FormShell` 경로에서만 |
| `TagBadges` | `components.jsx:50` | 죽은 가지에서만 |
| `ATTEMPT_SOURCES` | `constants.js:123` | 참조 0건. 허용값을 문서화하지만 아무도 강제하지 않는다 |
| `LEGACY_DROPPED_TAG` | `migrate.js:3` import | 미사용 |
| `onReplaceAll` | `StatsView.jsx:14` | 구조분해만 하고 안 씀 (백업이 SettingsView로 이동한 잔재) |

`Badge`는 `CardsView:153`에서 살아 있다. 다만 실제 쓰이는 tone은 `info`뿐이라
`badge--success/error/warning` CSS는 죽었다.

### 9.3 CSS 약 409줄 / 2,791줄 (14%)

이미 죽은 15개: `io-btn` `next-btn` `ocr-btn` `save-btn` `notice` `prob-try`
`note-subj` `rc-head` `rc-question` `rc-actions` `rc-pass` `rc-fail` `recheck-item`
`stats-section` `stats-title`

9.1과 함께 죽는 것: `filter-row` `note-detail` `note-topic` `note-actions` `edit-btn`
`del-btn` `field-label` `field-text` `memo-text` `recheck-mark` `repeat-marker`
`photo-count` `tag-badges` `tag-badge` `panel` `panel-head` `card--interactive`
`note-images` `note-image-thumb` `lightbox`

**남겨야 하는 것** (CardsView·AttemptHistory가 쓴다): `note-list` `note` `note-row`
`note-row-head` `note-prob` `note-date` `note-preview` `grade-mark`

스크립트로 확인했다: **테스트가 참조하는 클래스는 하나도 없다.**

### 9.4 판단이 필요한 지점 — 사진 전체화면 보기 ⚠️ 순서가 중요하다

**정확한 상황** (Codex 1차 리뷰에서 이 절의 초안이 비용을 과소평가한다고 지적받아 다시 씀):

앱에 존재하는 **유일한 전체화면 구현체**는 `components.jsx:294–349`의 `NoteImages`이고,
이건 **오직 죽은 `!formOnly` 가지(`RecordView.jsx:709–713`)를 통해서만 렌더된다.**
즉 지금 사용자는 사진을 크게 볼 방법이 없고, 그 기능을 담당하는 코드는 9.1이 지우려는
바로 그 블록 안에 매달려 있다.

여기서 순진하게 "A안: 남기고 나중에 연결"이라고 승인하면, 정리 PR이 **동작하는 유일한
lightbox를 먼저 지우고** 재연결을 별도 리팩터로 미루는 게 너무 쉽다. 그러면 중간 상태가
기능 손실이 되고, 두 번째 리팩터는 안 올 수도 있다.

그래서 A안을 고른다면 **단계 순서를 계획에 못 박는다**:

| 순서 | 내용 | 검증 |
|---|---|---|
| **A-1** | `NoteImages`를 **살아 있는** 수정 폼의 `photo-strip`에 먼저 연결한다. 이 시점에 죽은 가지는 아직 그대로 둔다 | 새 E2E 1건: 수정 시트에서 사진 탭 → `.lightbox` 표시 → 닫기. **이 테스트가 통과한 뒤에만 다음 단계로 간다** |
| **A-2** | 그제서야 9.1의 죽은 가지를 지운다 | A-1의 테스트가 계속 통과 = lightbox에 살아 있는 호출자가 생겼다는 증거 |

이렇게 하면 어느 커밋에서도 기능이 사라진 상태가 존재하지 않는다.
A-1 없이 A-2만 머지되는 사고를 테스트가 막는다.

- **A안**: 위 2단계. 사진으로 찍은 문제를 크게 확인할 수 없으면 오답노트로서 반쪽이다.
  대신 정리 PR이 "순수 삭제"가 아니게 되고 리뷰 범위가 커진다
- **B안**: `NoteImages` + `.lightbox`도 같이 삭제. diff가 순수 삭제로 깔끔해지고,
  `.lightbox`의 하드코딩 색(`styles.css:1569`, 유일하게 토큰을 안 쓰는 곳)도 함께 사라진다.
  전체화면 보기는 **별도 기능 PR**로 나중에 제대로 설계한다

> ### ✅ 결정: **B안** (2차 리뷰에서 확정)
>
> 도달 불가능한 lightbox는 정리 때 **같이 지운다.** 전체화면 보기는 **별도 기능 PR**로
> 되살린다. "정리"와 "기능 복원"은 다른 일이고, 섞으면 둘 다 흐려진다.
>
> 따라오는 결과:
> - `components.jsx`의 `NoteImages` 삭제 → §9.1 블록이 **순수 삭제 diff**로 유지된다
> - `styles.css:1569`의 하드코딩 색(토큰 미사용 유일 지점)도 함께 사라진다
> - 위 A-1/A-2 표는 **실행하지 않는다.** 기록으로만 남긴다 —
>   나중에 A를 재고할 일이 생기면 순서 제약이 뭐였는지 남아 있어야 한다
> - 별도 기능 PR은 §9.5-1의 복수형 훅 설계(`JSON.stringify` dep 포함)를 기준선으로 쓴다

### 9.5 중복 — 동작 보존

1. **IDB 이미지 로딩 이펙트가 4벌 — 단, 네 곳이 같은 모양이 아니다.**

   초안은 `useImageUrl(id)` 하나로 합친다고 썼는데, Codex 지적대로 그건 틀렸다.
   세 곳은 **id 하나 → url 하나**지만 `NoteImages`는 **id 배열 → url 배열 + 일괄 정리**다.
   넷을 한 추출로 밀어넣으면 훅을 즉시 특수 분기시키거나 정리 시맨틱을 깨뜨리게 된다.

   | 호출부 | 모양 | 현재 dep |
   |---|---|---|
   | `ProblemsView.jsx:21` (`ProblemShot`) | 스칼라 | `[firstId]` — 문자열, 안전 |
   | `SolveView.jsx:26` (`Shot`) | 스칼라 | `[firstId]` — 문자열, 안전 |
   | `RecordView.jsx:36` (`PhotoThumb`) | 스칼라 | `[photo]` — **객체 identity, 잠재 위험** |
   | `components.jsx:302` (`NoteImages`) | **복수 + 일괄 revoke** | `[ids]` — **배열 identity, 잠재 위험** |

   **설계**: 복수형을 원시 함수로 두고 스칼라를 파생시킨다.

   ```js
   useImageUrls(ids)  // → [{id, url}] . dep은 JSON.stringify(ids)
   useImageUrl(id)    // → url | "" .   useImageUrls를 감싼 얇은 래퍼
   ```

   **주의 — 이게 P3의 핵심**: 스칼라 래퍼가 매 렌더 `[id]`를 새로 만들면 배열 identity가
   계속 바뀌어 이펙트가 무한 반복한다. 그래서 이펙트 dep은 배열이 아니라 **직렬화한
   문자열**이어야 한다.

   dep 키는 **`JSON.stringify(ids)`를 쓴다. `ids.join(",")`은 안 된다** — 2차 리뷰 지적대로
   가져오기로 들어온 id에 쉼표가 들어 있으면 서로 다른 목록이 같은 키로 뭉개진다
   (`["a,b"]`와 `["a","b"]`가 둘 다 `"a,b"`). id는 우리가 만든 것만 있는 게 아니라
   **가져온 JSON에서도 온다**(§4 불변식) — 형식을 신뢰할 수 없다.
   `JSON.stringify`는 따옴표와 이스케이프가 있어 충돌하지 않는다.

   이렇게 하면 지금 `[ids]`·`[photo]`에 있는 identity 기반 잠재 위험 두 개도 같이 없어진다.
   중복 제거보다 **버그 예방이 실제 이득**이다.

   **§9.4를 B안으로 확정했으므로 지금 당장은 복수형 호출자가 0이다.** 정리 단계에서는
   `useImageUrl(id)` 스칼라만 만든다(dep은 id 문자열 그대로, 직렬화 불필요).
   위 복수형 설계와 `JSON.stringify` 규칙은 **전체화면 보기를 되살리는 별도 기능 PR**에서
   목록 케이스가 다시 생길 때 적용한다 — 그때 이 절을 다시 읽을 것.

2. **`fmtSec` 2벌.** `SolveView.jsx:18`과 `components.jsx:249`(`fmtSecShort`)가 널 가드만
   빼면 동일. → `constants.js`로 하나만

3. **편향된 셔플 2벌 — 중복이자 정확성 문제.**
   `App.jsx:340`과 `SolveView.jsx:227`이 `[...pool].sort(() => Math.random() - 0.5)`를 쓴다.
   비교 함수가 비일관적이라 **균등 셔플이 아니다** — "랜덤으로 뽑기"가 실제로는
   원래 순서 앞쪽에 치우친다. → `constants.js`에 Fisher-Yates `shuffle()`

### 9.6 중복 계산 (작음)

`isRecheckDue` 전체 순회가 5곳에서 돈다. 그중 `App.jsx:92`와 `ProblemsView.jsx:113`은
**완전히 같은 값**을 각자 계산한다. App이 이미 메모한 걸 내려주면 된다
(`cardDueCount`는 이미 그렇게 하고 있다). 노트 배열이 작아 성능 문제는 아니고,
**같은 기준이 흩어지면 한 곳만 바뀌는 게 위험**하다는 관점에서만 정리한다.

### 9.7 검증 계획

1. Playwright **65건 전부** — 제거 대상 클래스를 참조하는 테스트가 없음을 확인했으므로
   계약 변경이 없어야 한다
2. `npm run contrast` (204/204) · `npm run themes && git diff --exit-code src/themes.css`
3. `npm run build` — **번들 크기 before/after 비교** (CSS 14% 감소가 실제로 나오는지)
4. 수동: 기록 폼 저장·수정, 사진 첨부·제거, 문제 그리드 필터, 풀기 세션 전 구간, 카드
5. `shuffle` 균등성 분포 테스트 1건 추가

---

## 10. 확정된 결정 (Codex 리뷰 완료)

여섯 항목 모두 답을 받았다. **이 절이 정리 PR의 계약이다.**

| # | 사안 | 결정 |
|---|---|---|
| 1 | §9.1 도달 불가능 판정 | **확인됨.** `App.jsx:452–473` 기준 `!formOnly` 가지 도달 불가 — Codex 독립 확인 |
| 2 | lightbox 처리 | **B안.** 정리 때 같이 삭제, 전체화면 보기는 별도 기능 PR |
| 3 | 셔플(§9.5-3) | **독립 커밋으로 분리.** 정리 커밋에 섞지 않는다 |
| 4 | `solutionImages` | **보존 + 올바르게 관리.** 필드를 없애지 않는다 |
| 5 | 브랜치 전략 | **#1–#5 먼저 머지**, 깨끗한 main에서 정리 시작 |
| 6 | 최우선 후속 | **`storage.js:72`.** §11 중 1순위 |

### 10.1 실행 순서 — 1~5 완료

```
1) PR #1 → #2 → #3 → #4 → #5 순서대로 머지          (결정 5)  ✅ main = 576837f
2) main에서 새 브랜치                                          ✅
3) 커밋 A: 죽은 코드 삭제 (§9.1–9.4, lightbox 포함)  (결정 2)  ✅ 677줄 삭제 / 3줄 삽입
4) 커밋 B: solutionImages 수명주기 수정              (결정 4)  ✅ 회귀 4건
5) 커밋 C: 셔플 수정                                 (결정 3)  ✅ 회귀 2건
6) 후속 PR: storage.js:72 방어                       (결정 6)  ⬜ 남음
```

**#3~#5는 GitHub이 base를 자동 재지정하지 않았다.** 부모가 머지돼도 base가
그대로 남아, 그냥 머지했으면 main이 아니라 이미 머지된 브랜치로 들어갔을 것이다.
각 단계에서 base를 main으로 직접 옮기고 diff 크기가 부풀지 않는 것을 확인한 뒤
머지했다. 스택 PR을 다시 쌓는다면 이 점을 기억할 것.

실제 결과:

| 커밋 | 내용 | 테스트 |
|---|---|---|
| `f401d15` | A — 순수 삭제 | 65/65 (계약 변경 없음) |
| `469b7c2` | B — `noteImageIds` 도입, 네 호출부 교정 | 69/69 (+4) |
| `705c708` | C — `shuffle()` Fisher-Yates | 71/71 (+2) |

B·C의 신규 테스트는 **각각 수정을 되돌리면 실패하는 것을 확인**했다.
B는 대조군(고아 blob은 계속 수거)도 함께 둬서, 수정이 GC 자체를 무력화한 게
아님을 잠갔다.

커밋 A는 순수 삭제로 유지한다 — 동작이 바뀌는 B·C와 섞이면 "삭제해도 안전한가"를
리뷰에서 판단할 수 없게 된다. B와 C는 서로 무관하므로 순서는 바꿔도 된다.

### 10.2 결정 4의 범위 — `solutionImages`를 살린다

필드를 지우지 않고 **네 곳의 누락을 고친다.** 지금은 `migrate.js:99`가 보존만 하고
아무도 읽지 않아, 채워지는 순간 삭제 시 누수 / 가져오기 시 GC가 난다.

고칠 지점:

| 위치 | 현재 | 고친 뒤 |
|---|---|---|
| `deleteNote` | `n.images`만 revoke | `solutionImages`도 함께 |
| `gcImages` | `n.images`만 도달 가능으로 표시 | `solutionImages`도 포함 — **안 고치면 GC가 살아 있는 이미지를 지운다** |
| `handleExport` | `n.images`만 수집 | `solutionImages`도 수집 |
| `handleImportFile` 교체 직전 자동 백업 (`SettingsView.jsx:48`) | `n.images`만 수집 | `solutionImages`도 수집 |

`gcImages`가 넷 중 가장 위험하다. 나머지 셋은 누수(회수 실패)지만 이건 **데이터 손실**이다.

> **정정 (2026-08-06).** 이 표는 원래 셋만 적고 있었다. 실제 호출부는 **넷**이다 —
> 가져오기 직전 자동 백업이 내보내기와 같은 수집 경로를 쓴다.
> 커밋 `469b7c2`는 네 곳을 다 고쳤으므로 **코드는 처음부터 맞았고 표만 틀렸다.**
> 세 곳이라고 적힌 표를 계약으로 삼으면 다음 사람이 네 번째를 못 본다.
> 사진 수명주기를 건드릴 땐 `noteImageIds()` 사용처를 grep하는 게 확실하다 —
> 그게 단일 출처다 (`constants.js:156`).

`tests/migration.spec.js:55`가 이 필드를 단언하고 있다. 계약이 넓어지므로
**세 경로 각각에 테스트를 추가한다** — 특히 "`solutionImages`만 있고 `images`는 빈
노트가 GC를 견디는지"가 핵심 케이스다.

### 10.3 결정 6 — `storage.js:72`를 §11 1순위로

§11 표에서 이 항목만 **복구 불가**다(용량 초과 → `useState(loadAll)` 안에서 throw →
에러 바운더리 없음 → 영구 백지). 나머지는 성가심이거나 도달 경로가 좁다.
정리 PR 다음 작업으로 잡는다.

### 10.4 결정 6의 결과 — 범위가 세 배로 늘었다 (2026-08-06)

Claude·Codex 재논의에서 **"72줄만 try/catch"는 틀린 수리**로 결론났다. 이유:

1. 부팅을 막아도 `App.jsx`의 저장 이펙트가 같은 예외를 던진다. React가 트리를
   언마운트하므로 결과는 똑같이 백지이고, **도달 빈도는 오히려 높다** —
   용량 한계는 노트를 추가하는 순간에 먼저 만나지 부팅할 때 만나지 않는다.
2. 테마·팔레트 쓰기도 무방비다. 꽉 찬 저장소에서 ☾ 한 번에 앱이 죽는다.

그리고 논의 중 **quota와 무관한 별개 함정**이 나왔다. 파싱 실패 시 `loadAll`이
`notes`를 `[]`로 만들고, `SettingsView`가 그 빈 배열을 그대로 받아
(`App.jsx`에서 상태를 내려준다) 내보낸다. 즉 **손상 상태에서 내보내기를 누르면
"정상 백업"처럼 보이는 빈 파일이 나온다.** 원본은 localStorage에 멀쩡히 있는데도.

그래서 두 실패를 **합치지 않고 분리**했다:

| 상태 | 메모리 | 디스크 저장 | 가져오기 | 내보내기 |
|---|---|---|---|---|
| `parseError` | 비어 있다 | 중단 | 잠금 | **잠금** — 빈 백업 방지 |
| `writeError` | 온전하다 | 중단 | 잠금 | **허용** — 유일한 구조 수단 |

⚠️ **"잠금"은 저장을 멈춘다는 뜻이지 편집 UI를 막는다는 뜻이 아니다.**
`storageLocked`는 저장 이펙트만 게이트한다. 기록·수정·삭제·채점 핸들러는
그대로 살아 있어서, 이 상태에서도 사용자는 계속 입력할 수 있고 **그 변경은
새로고침하면 사라진다.** 이건 `parseError`가 원래부터 그랬던 동작이고
(`tests/migration.spec.js:163`이 잠그고 있다) `writeError`도 같은 규칙을 따른다.

지금은 **배너로만** 알린다 — 그래서 배너를 탭 화면과 기록 시트 양쪽에 띄운다.
기록 시트는 전체화면 오버레이라 한쪽에만 띄우면 하필 새 노트를 쓰는 순간에
경고가 가려진다.

편집 UI 자체를 비활성화할지는 **미결**이다. 6개 뷰의 모든 변경 동선을 막아야 하고
`parseError`의 기존 동작까지 바꾸게 되므로 별도 판단이 필요하다.
후보 두 가지: (1) 전면 읽기 전용, (2) 초안 모드 — 변경을 받되 저장 안 됨을
명시하고 내보내기로만 회수. 지금은 어느 쪽도 하지 않았다.

의도적으로 **뺀 것**: sink별 "저장 재시도" 버튼. 복구 경로가 "내보내기 → 저장공간
정리 → 다시 열기"이고, 다시 여는 순간 `loadAll`이 자연히 재시도한다. 필요해지면
그때 붙인다.

커밋 `f532785`, 신규 계약 4건 (넷 다 되돌리면 실패 확인). 75/75.

---

## 11. 알려진 미해결 항목 (이번 범위 밖)

리뷰에서 보고했지만 의도적으로 남긴 것들:

| 항목 | 내용 |
|---|---|
| ~~**`storage.js:72` ⚠️ 1순위**~~ | ✅ **해결됨** — §10.4 참고. 범위가 부팅 경로 하나가 아니라 저장 이펙트·테마 쓰기까지였고, 파싱 실패 시 빈 백업을 내보내는 별개 함정도 같이 나왔다 |
| **IDB 파괴 순서 ⚠️ 1순위 (Tier 2)** | `5d385af`의 D-min은 **의도적으로 불완전하다.** `storageLocked`가 이미 켜진 뒤에만 파괴를 막으므로, **첫 저장 실패가 감지되기 전의 삭제에는 창이 그대로 남는다** — 그 삭제는 사진을 지우고 노트는 되살아난다. 정책이 호출부 3곳에 복제된 것도 §10.2 재발이다. 근본 수정은 §11.1 |
| **고아 카드 (`App.jsx:107`)** | `addNote`가 notes·cards를 같은 렌더에서 바꾼다. effect1(notes) 실패 → `setWriteError`를 걸어도 **effect2(cards)는 같은 flush에서 `storageLocked=false`를 캡처한 채 실행**된다. 큰 notes는 실패하고 작은 cards는 성공 → 재시작 후 없는 노트를 가리키는 카드가 남는다. D 수정이 이걸 자동으로 해결하지 못한다 |
| `RecordView.jsx:239` `putImage` | `submit`이 `async`인데 `try/catch`가 없다. IDB 쿼터 초과면 unhandled rejection → `onAdd`가 안 불려 **노트가 통째로 저장되지 않는데 사용자에겐 아무 메시지도 없다.** 앞선 사진은 이미 IDB에 들어가 고아로 남는다. localStorage가 멀쩡해도 도달한다 |
| `imageStore.js:123` `importImages` | 개별 사진 복원 실패를 삼킨 뒤 그대로 `onReplaceAll`을 진행한다 → 사진 id는 있는데 blob은 없는 "성공한" 가져오기 |
| 저장 실패 테스트 공백 | `tests/storage-failure.spec.js`는 대부분 **부팅 시점 전면 quota**만 본다. 사용 중 `saveNotes` 실패, notes만 실패/cards만 성공, IDB 자체 쿼터는 잠그지 못한다 |
| `tests/helpers.js:8` | `getByRole("button", { name: /^문제/ })`가 문제 카드까지 매칭한다. 모든 테스트가 `freshApp`을 거치므로 **전 테스트 단일 실패점**. 실제로 프로브 작성 중 strict mode 위반을 일으켰다 |
| `.gitignore` | `test-results`/`playwright-report`가 없다. `test-results/.last-run.json`이 `07b8721`에 커밋돼 있어 로컬 테스트마다 diff가 뜬다 |
| `fmtSec(null)` | `"null초"`로 렌더된다 (`SolveView.jsx:737`). 가져온 데이터에서만 도달 가능 |
| `recordAttempt` 무음 실패 | `App.jsx:184`가 잘못된 원인이면 조용히 return하는데, `finalizeFail`은 무조건 `graded`로 넘어간다. 지금은 UI가 잘못된 값을 못 만들어서 살아 있지 않지만, 어긋나면 "기록됨"이라고 보여주고 저장은 안 되는 상태가 된다 |
| 개념 라이브러리 | v2 스펙 §30. 실사용 2주 뒤 재검토 |
| `지위 오해` 분류 정리 | 뜻이 소실된 레거시 태그 |

### 11.1 다음 Tier 2 — IDB 파괴 순서 (D-gc)

**불변식 하나로 묶인다:** *되돌릴 수 없는 IndexedDB 파괴가, 대응하는
localStorage 쓰기의 성공을 기다리지 않는다.* 위 표의 1·2번이 같은 뿌리다.

세 안을 Claude·Codex가 검토해 **D-gc**로 합의했다 (Han 결정: 지금은 D-min만,
구조 변경은 별도 Tier 2):

- **D-min** (지금 상태) — 잠금 시 파괴 건너뛰기. 창이 남고 정책이 3곳에 복제됨
- **D-full** — 저장 성공 뒤 파괴. 영속성 모델을 반쯤 재설계해야 하는데 고아 카드는 여전히 안 풀림
- **D-gc ✅** — 즉시 삭제를 아예 없애고, **영속 성공 뒤 GC가 도달 불가 blob만 수거**한다.
  삭제가 "사용자 행동의 결과"가 아니라 "영속된 상태의 결과"가 된다.
  실패 비용이 *복구 불가능한 손실* → *회수 가능한 고아 blob*으로 바뀐다

**기존 테스트는 D-gc를 막지 않는다.** `photos.spec.js`·`solution-images.spec.js`의
삭제 검증이 전부 `expect.poll(..., {timeout: 5000})`이라 **즉시성이 아니라 최종
일관성만** 단언한다. 성공 커밋 직후 GC를 예약하면 수정 없이 통과한다.

⚠️ **D-gc를 순진하게 구현하면 커밋 B의 버그가 재현된다.** 저장 성공 이펙트에서
매번 `gcImages(notes)`를 부르면 **방금 업로드됐지만 아직 노트에 저장되지 않은
blob을 수거한다** (`RecordView.submit`은 `putImage` → `onAdd` 순서다).
최소 안전 범위:

1. GC를 **직렬화**한다 (동시 실행 금지)
2. 참조 집합에 **미저장분까지 포함** — 메모리 노트 + 업로드 대기 + import 대기
3. "언젠가"가 아니라 **성공 커밋 뒤 반드시 예약** (import 고아 수거 테스트가 요구)

---

## 12. 배경 문서

이전 스펙 두 개(`CODEX_IMPLEMENTATION_SPEC_WRONGNOTE1.md`, `..._v2.md`)는 대화로만
오갔고 저장소에 커밋되지 않았다. v2가 v1에 대한 내 지적을 전부 반영했고, 지금 구현된
v5 궤적 시스템의 근거 문서다. 필요하면 사용자에게 요청하면 된다.
