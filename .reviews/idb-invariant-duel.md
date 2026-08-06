# 결투 결론 — IDB 파괴 순서 불변식

날짜: 2026-08-06 · 브랜치: `claude/storage-write-guard` · Tier 2
계획: Codex · 실행: Claude · 리뷰: Claude · DEBATE: Codex(공격)

이 파일이 다음 세션의 시작점이다. 대화 이력 대신 이걸 읽어라.

---

## 1. 도출된 불변식 (이게 결론이다)

> **되돌릴 수 없는 IndexedDB 파괴가, 대응하는 localStorage 쓰기의 성공을
> 기다리지 않는다.**

Claude 리뷰 4건 중 3건과 Codex가 새로 찾은 high 2건이 전부 이 뿌리 하나로 묶인다.
IDB와 localStorage는 **다른 저장소이고 쿼터도 따로**라, localStorage 쪽 잠금
(`storageLocked`)이 IDB 파괴를 자동으로 막지 못한다는 게 핵심이다.

증상 형태: 노트 삭제/수정이 디스크에 안 남아 새로고침 때 **되살아나는데**,
사진은 이미 **영구 소실**된 뒤다. 사용자에겐 "삭제는 안 먹었는데 사진만 날아갔다".

---

## 2. DEBATE 판정 — Claude 리뷰 4건

| # | 지적 | 판정 | 요지 |
|---|---|---|---|
| 1 | `App.jsx` `deleteNote` IDB 손실 | **CONFIRMED** | 단, Claude의 수정안(`storageLocked` 검사)은 부실. 옳은 수정은 **순서 뒤집기**(영속 성공 뒤 파괴) |
| 2 | 부분 성공 시 배너가 "사실과 반대" | **PARTIAL** | 문구는 "**지금부터의** 변경"이고 부분 성공 쓰기는 배너 *전*에 일어남 → 거짓 아님. 진단 품질 문제 |
| 3 | `replaceAll` 가드 위치 | **PARTIAL** | 게다가 Claude의 수정안이 **안 통함**. 잠기지 않은 상태로 import 시작 → `gcImages`가 이미 삭제 → 그 뒤 저장 실패. 함수 내 플래그로는 시간차를 못 막음 |
| 4 | "UI에 안 드러난다" | **PARTIAL** | `WRITE_ERROR_MESSAGE`가 이미 "저장공간을 정리하고 앱을 다시 열어라"라고 안내 중 |

**결과: Claude 4건 중 CONFIRMED 1 · PARTIAL 3.** 세 건 모두 Claude가 과장했다.

## 3. Codex가 새로 찾은 것 (Claude가 놓침)

| 심각도 | 위치 | 문제 |
|---|---|---|
| **high** | `RecordView.jsx:247` | 잠긴 상태에서 사진 뺀 노트를 저장 → `deleteImages(removed)`가 먼저 영구 삭제, `onUpdate`는 디스크에 안 남음. #1과 같은 병, 다른 호출부 |
| **high** | `App.jsx:107` | `addNote`가 notes·cards를 같은 렌더에서 변경. effect1(notes) 실패 → `setWriteError` 걸어도 **effect2(cards)는 같은 flush에서 `storageLocked=false`를 캡처**한 채 실행. 큰 notes 실패 + 작은 cards 성공 → **없는 노트를 가리키는 고아 카드** |
| med | `imageStore.js:123` | `importImages`가 IDB 실패를 삼킨 뒤 `onReplaceAll` 진행 → 사진 없는 "성공한" import |
| med | `tests/storage-failure.spec.js` | 대부분 **부팅 시점 전면 quota**만 검증. 사용 중 저장 실패·키별 부분 실패·IDB 쿼터를 못 잠금 |
| low | `App.jsx` 배너 | 시트 열리면 배경/시트 배너가 DOM에 동시 존재, `role="alert"` 없음 |

**무승부 1건:** `RecordView.jsx:239` `putImage` unhandled rejection — 양쪽이 독립적으로 찾음.

---

## 4. 작업 목록 D~H

| | 내용 | 상태 |
|---|---|---|
| **D** | IDB 파괴 순서 | **D-min만 완료** (`5d385af`). 근본 수정 D-gc는 미착수 |
| **E** | notes+cards 단일 내구성 단위 (고아 카드) | ⬜ **Tier 2로 확정** · high · §E-2 참고 |
| **F** | `putImage` try/catch + `importImages` 실패 반환 | ✅ 완료 (`508cad9`, `29cf671`, `d2e71fd`) |
| **G** | 배너 중복 제거 + `role="alert"` | ✅ 완료 (`5d385af`) |
| **H** | 테스트 보강 (사용 중 실패·부분 실패·IDB 쿼터) | 🔶 부분 — IDB 쿼터는 F에서 추가됨 |

### F 실행 결과 (Tier 1 · 계획 Codex · 리뷰 Claude)

계획에서 **바꾼 것 2건** (내 CRITIQUE를 Han이 승인):

1. `deleteImages(removed)`를 중단 경로에서 뺐다. `putImage` 실패는 "저장할 수
   없다"지만 이건 "옛 사진이 남는다"(누수)일 뿐이라, *정리* 실패로 사용자의
   편집을 버리는 건 과하다. 게다가 D-gc가 이 삭제를 없앨 예정이라 지금
   중단 의미를 부여하면 나중에 되돌려야 한다.
2. 자동 백업 다운로드를 `importImages` 성공 뒤로 옮겼다. 앞에 두면 교체가
   취소됐는데 "가져오기 직전 백업" 파일만 손에 쥐게 돼 혼란스럽다.

핵심 구현 포인트:
- 성공한 blob은 즉시 `photos`에 id로 **체크포인트** → 재시도 시 `p.id` 경로를
  타 같은 사진이 두 번째 blob으로 중복 저장되지 않는다
- object URL은 노트 저장이 **실제로 성공한 뒤에만** 해제 (실패 후 미리보기 유지)
- 실패 문구를 저장 버튼 위에도 렌더 — 기존 `photo.error` 자리는 `step===1`
  블록 안이라 실패가 일어나는 2페이지에서 보이지 않았다
- catch에서 blob을 지우지 않는다 (§5 안전 3조건 준수)

REVIEW 결과: blocker/high 없음 → DEBATE 스킵. [med] 1건은 `d2e71fd`로 수정,
[low] 1건(제출 중 시트 닫기 미잠금, 동작상 무해)은 남겨둠.

테스트 트랩이 추가됐다: `installIdbPutTrap` / `armIdbFailAt` / `disarmIdb`.
localStorage용 `installQuotaTrap`과 **다른 저장소**라 재사용 불가 —
이 구분이 F와 D의 공통 원인이기도 하다. `seedBlobs`도 raw `put`을 쓰므로
반드시 시드 **뒤에** arm해야 한다.

**Han 결정:** "D 최소+G 먼저, 구조 변경은 별도 Tier 2."

---

## 5. D 세 안 비교 → **D-gc 합의**

| | D-min (현재) | D-full | **D-gc ✅** |
|---|---|---|---|
| 방식 | 잠금 시 파괴 건너뛰기 | 저장 성공 뒤 파괴 | 즉시 삭제 제거, 영속 성공 뒤 GC만 |
| 남는 실패 모드 | ⚠️ **첫 실패 감지 전 창** | 새 blob 고아 가능(안전) | GC 미실행 시 잔존 = **지연 회수** |
| 정책 위치 | ⚠️ 호출부 3곳 복제 | 싱크 | 싱크 1곳 |
| E 해결? | ❌ | ❌ | ❌ (단 조정기 구조가 E의 기반) |

핵심 근거: D-gc는 실패 비용을 **복구 불가능한 손실 → 회수 가능한 고아 blob**으로
바꾼다. 삭제가 "사용자 행동의 결과"가 아니라 "영속된 상태의 결과"가 된다.

**기존 테스트는 D-gc를 막지 않는다.** `photos.spec.js`·`solution-images.spec.js`의
삭제 검증이 전부 `expect.poll(..., {timeout: 5000})` → 즉시성이 아니라 **최종
일관성만** 단언. 성공 커밋 직후 GC를 예약하면 수정 없이 통과.
(Claude가 처음에 "즉시성 계약을 깨야 한다"고 우려했으나 사실이 아니었음. 양쪽이
테스트를 직접 읽고 확인.)

### ⚠️ D-gc 구현 시 필수 안전 3조건

순진하게 저장 성공 이펙트에서 `gcImages(notes)`를 부르면 **커밋 B의 버그가
재현된다** — `RecordView.submit`이 `putImage` → `onAdd` 순서라, 방금 올렸지만
아직 노트에 저장되지 않은 blob을 GC가 수거한다.

1. GC를 **직렬화**한다 (동시 실행 금지)
2. 참조 집합에 **미저장분까지 포함** — 메모리 노트 + 업로드 대기 + import 대기
3. "언젠가"가 아니라 **성공 커밋 뒤 반드시 예약** (import 고아 수거 테스트가 요구)

---

## 6. 현재 상태

브랜치 `claude/storage-write-guard` — **푸시·PR 안 함** (Han 승인 대기).

```
3af7cf3 docs: §11 잔여 위험 + 미해결 4건, §11.1 Tier 2 계획
5d385af fix: 잠긴 상태 IDB 파괴 차단 (D-min) + 배너 중복 제거 (G)
bf36237 docs: CLAUDE.md DEBATE 단계
2e8bbe0 docs: CLAUDE.md 워크플로 규칙
c5061d4 fix: 배너를 기록 시트에도 + 문서 거짓 주장 정정
5382dcd docs: §10.2 호출부 정정(3→4), §10.4
f532785 fix: 저장소 쓰기 실패에 앱이 죽지 않는다 — 파싱 실패와 분리
```

80/80 · contrast 204/204 · themes 드리프트 없음 · 빌드 성공.
(위 커밋 목록은 F 이전 시점이다. 최신은 `git log`로 확인할 것)

**다음 세션 추천:** **E**(고아 카드, high)를 먼저. `addNote`가 notes·cards를
같은 렌더에서 바꾸는데 두 저장 이펙트가 같은 flush에서 **같은 stale
`storageLocked`를 캡처**하는 게 원인이라, D-gc와 독립적으로 고칠 수 있다.
그 다음 D-gc를 Tier 2로 — 반드시 §5 안전 3조건과 함께.

관련 문서: `CODEX_HANDOFF_CLEANUP.md` §11 표, §11.1

---

## E-2 — Tier 2 확정 (DEBATE 합의, 2026-08-06)

**결론: 중간 완화(ref 게이트) 없이 바로 Tier 2.**

### 왜 ref 게이트를 안 하나

- ref는 `addNote`의 `notes → cards` **한 방향만** 막는다
- `deleteNote`는 notes에서 노트를, cards에서 연결 카드를 지운다 →
  **notes 성공 / cards 실패**면 재시작 후 옛 카드가 없는 noteId를 가리킨다.
  `replaceAll`도 동일. 즉 **역방향도 고아를 만들고 ref는 E를 닫지 못한다**
- D-min을 중간 완화로 넣은 것과 판단이 다른 이유: D는 **영구 손실**(blob)이고
  E는 **불일치**(카드 삭제로 복구 가능)다. 임시 경로의 구현·리뷰 비용이
  E-2에서 곧 걷힐 코드에 붙는다

### 왜 Tier 2인가 (CLAUDE.md: data/risky)

새 권위키 `wr_state` 도입 + legacy 전환 + fallback + `readNotes`/`readCards`
헬퍼 변경 + `migration.spec` 전면 조정. 저장 스키마 변경이고
`SCHEMA_VERSION`·`wr_backup_v{n}` 규약이 걸린 영역이다.

### 설계 방향 (Codex 초안, 합의됨)

`{version, notes, cards}`를 단일 키 `wr_state`에 저장. 한 `setItem`의
성공/실패가 두 배열에 함께 적용된다. `saveNotes`/`saveCards` → `saveState` 하나.
`App`의 두 저장 이펙트 → `[notes, cards, storageLocked]` 의존 단일 이펙트.
레거시 키는 **삭제하지 않는다** (삭제 실패를 새 위험으로 만들지 않는다).

### ⚠️ Tier 2 계획이 반드시 답해야 할 3가지 (DEBATE에서 도출)

1. **최초 전환 쓰기가 quota로 실패하면?** state=absent + legacy=present가 지속된다.
   매 부팅 재시도라 손실은 아니지만, `wr_backup_v{n}` 스냅샷 조건
   (`storedVersion < SCHEMA_VERSION && backupKey === null`)과의 상호작용,
   그리고 legacy→state 전환을 '버전 승격'으로 볼지가 미정이다
2. **이미 존재하는 고아 카드**는 E-2로도 안 사라진다. 자동삭제는 손실 위험이라
   **비파괴 탐지/진단**만 할지 무시할지가 설계 결정이다
3. **테스트 트랩 확장 필요.** 현재 `installQuotaTrap`은 `BLOCKED` 배열 하드코딩 +
   단일 on/off라 **키별로 막을 수 없다.** `armQuota(page, keys)`로 바꿔야
   'wr_notes만 실패 / wr_cards는 성공' 같은 고아 재현이 가능하다

### Tier 2 절차

CLAUDE.md대로 **양쪽이 전체 계획을 쓰고** 비교 → 발산 지점만 논쟁 → Han 판단 →
실행 → 계획 안 쓴 쪽이 리뷰 → **DEBATE 필수**(Tier 2는 심각도 무관) → CI 검증.
