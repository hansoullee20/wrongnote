# 오답노트 — 프로젝트 인수인계 + 정리 계획 승인 요청

> **이 문서의 목적**
> 1. Codex가 이 프로젝트를 처음부터 따라잡을 수 있게 한다 (구조·데이터 모델·불변식·현재 상태).
> 2. 그 다음, 제안된 **죽은 코드 제거 + 중복 정리** 계획을 승인/반려해 달라는 요청이다.
>
> §9에 근거와 함께 계획이 있고, §10에 **답을 원하는 질문 6개**가 있다.
> 시간이 없으면 §7(현재 상태) → §9(계획) → §10(질문)만 읽어도 된다.
>
> 작성 시점 기준 HEAD: `5ce0f7b` (`claude/design-warm`)

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
                 └─ #5 5ce0f7b  claude/design-warm       웜톤 + 팔레트 6종 + 설정 + 리뷰 수정
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

### 9.4 판단이 필요한 지점 — `NoteImages` / `.lightbox`

죽은 가지를 지우면 **사진 전체화면 보기**가 같이 사라진다. 그런데 이 lightbox는
**지금도 앱에서 도달할 방법이 없다** — 문제 탭은 작은 썸네일, 수정 폼은 편집용 썸네일뿐,
크게 보는 건 풀기 화면의 문제 이미지가 유일하다.

- **A안 (현재 계획)**: 남기고 수정 폼의 `photo-strip`에 연결한다. 사진으로 찍은 문제를
  크게 확인할 수 없으면 오답노트로서 반쪽이다
- **B안**: 같이 삭제한다. diff가 순수 삭제로 깔끔해지고, `.lightbox`의 하드코딩 색
  (`styles.css:1569`, 유일하게 토큰을 안 쓰는 곳) 문제도 사라진다

### 9.5 중복 — 동작 보존

1. **IDB 이미지 로딩 이펙트가 4벌.** 같은 `alive` 플래그 + `createObjectURL`/`revokeObjectURL`
   정리 패턴: `components.jsx:302`, `ProblemsView.jsx:21`, `RecordView.jsx:36`,
   `SolveView.jsx:26`. → `useImageUrl(id)` 훅 하나로 합친다

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

## 10. Codex에게 묻는 것

1. **9.1 판정에 동의하는가?** `App.jsx:452`/`:470`을 직접 확인해서, `!formOnly` 가지가
   정말 도달 불가능한지 봐 달라. 내가 놓친 진입 경로가 있나?

2. **9.4는 A안(살려서 연결)과 B안(삭제) 중 어느 쪽인가?** 순수 삭제 diff의 명확함 대
   사진 앱에서 전체화면 보기가 없는 것의 손해를 어떻게 저울질하겠는가?

3. **9.5-3 셔플을 이 정리에 포함해도 되는가?** 동작이 바뀌는(더 정확해지는) 유일한 항목이라
   "순수 정리" 범위를 벗어난다. 별도 커밋/PR로 빼는 게 나은가?

4. **`solutionImages`를 어떻게 할까?** `migrate.js:99`에서 보존만 하고 아무도 읽지 않는다.
   만약 채워지면 `deleteNote`·`gcImages`·`handleExport`가 전부 `n.images`만 보므로
   **삭제 시 누수, 가져오기 시 GC**된다. 필드를 없앨까, 세 곳을 고쳐 살릴까?
   (`tests/migration.spec.js:55`가 이 필드를 단언하고 있어 테스트 계약 변경이 따른다)

5. **브랜치 전략.** 스택이 이미 5단이다. 정리를 (a) 지금 `claude/design-warm` 위에
   6단으로 쌓을까, (b) #1–#5를 먼저 머지하고 깨끗한 main에서 시작할까?
   순수 삭제 diff는 스택에 안 섞일 때 훨씬 읽기 쉽다고 보는데, 동의하는가?

6. **놓친 게 있는가?** 특히 §4의 불변식 중 이 정리가 건드릴 위험이 있는 것,
   또는 내가 "죽었다"고 판단한 것 중 실제로는 살아 있는 것.

---

## 11. 알려진 미해결 항목 (이번 범위 밖)

리뷰에서 보고했지만 의도적으로 남긴 것들:

| 항목 | 내용 |
|---|---|
| `storage.js:72` | `setItem`이 try/catch 없이 돈다. 바로 위 39줄의 백업 쓰기에는 있다. `useState(loadAll)` 안에서 던지므로 **용량 초과 시 영구 백지 화면** (에러 바운더리 없음). 확률은 낮지만 복구 불가 |
| `tests/helpers.js:8` | `getByRole("button", { name: /^문제/ })`가 문제 카드까지 매칭한다. 모든 테스트가 `freshApp`을 거치므로 **전 테스트 단일 실패점**. 실제로 프로브 작성 중 strict mode 위반을 일으켰다 |
| `.gitignore` | `test-results`/`playwright-report`가 없다. `test-results/.last-run.json`이 `07b8721`에 커밋돼 있어 로컬 테스트마다 diff가 뜬다 |
| `fmtSec(null)` | `"null초"`로 렌더된다 (`SolveView.jsx:737`). 가져온 데이터에서만 도달 가능 |
| `recordAttempt` 무음 실패 | `App.jsx:184`가 잘못된 원인이면 조용히 return하는데, `finalizeFail`은 무조건 `graded`로 넘어간다. 지금은 UI가 잘못된 값을 못 만들어서 살아 있지 않지만, 어긋나면 "기록됨"이라고 보여주고 저장은 안 되는 상태가 된다 |
| 개념 라이브러리 | v2 스펙 §30. 실사용 2주 뒤 재검토 |
| `지위 오해` 분류 정리 | 뜻이 소실된 레거시 태그 |

---

## 12. 배경 문서

이전 스펙 두 개(`CODEX_IMPLEMENTATION_SPEC_WRONGNOTE1.md`, `..._v2.md`)는 대화로만
오갔고 저장소에 커밋되지 않았다. v2가 v1에 대한 내 지적을 전부 반영했고, 지금 구현된
v5 궤적 시스템의 근거 문서다. 필요하면 사용자에게 요청하면 된다.
