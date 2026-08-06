export const SUBJECTS = ["수학", "국어", "영어", "과탐"];

/* 주원인 — 노트당 정확히 1개. 통계 집계의 축이다.
   문제당 1개라 합계가 노트 수와 일치하고 비율이 의미를 가진다.
   국내외 오답 분류 체계가 독립적으로 수렴한 5분류와 같다
   (개념 / 오독 / 전략 / 계산·실행 / 시간). */
export const CAUSE_EXECUTION = "실행 실수";

export const CAUSES = [
  "개념 부족",
  "읽기 실패",
  "전략 실패",
  CAUSE_EXECUTION,
  "시간 부족",
];

/** 주원인을 고를 때 뜻이 흔들리지 않도록 붙는 한 줄 설명 */
export const CAUSE_HINTS = {
  "개념 부족": "개념·공식을 몰라서 못 풀었다",
  "읽기 실패": "조건을 잘못 읽었다",
  "전략 실패": "제대로 읽었는데 접근을 못 잡았다",
  [CAUSE_EXECUTION]: "방향은 맞았는데 계산·처리에서 틀렸다",
  "시간 부족": "시간이 없어서 못 풀었거나 찍었다",
};

// 세부 태그 — 여러 개 선택 가능. 주원인과 달리 집계 축이 아니다.
export const MATH_ERROR_TAGS = [
  "부호 실수",
  "상하한 변환",
  "내부도함수 누락",
  "C 누락",
  "조건 누락",
  "막판 실수",
];

/** 5지선다 마킹 */
export const CHOICES = ["①", "②", "③", "④", "⑤"];

/** 시험에서 걸린 시간 — 선택 입력. 초 단위로 받으면 아무도 안 쓴다. */
export const EXAM_TIME_BUCKETS = [
  "1분 이내",
  "2~3분",
  "4~5분",
  "5분 이상",
  "못 풀고 넘김",
];

/* v3까지 쓰던 평면 태그 — 마이그레이션에서 주원인으로 옮기는 데만 쓴다.
   '지위 오해'는 뜻이 소실되어 제거했고, 추측해서 옮기지 않는다. */
export const LEGACY_CAUSE_MAP = {
  "실행 실수": CAUSE_EXECUTION,
  "개념 오류": "개념 부족",
  "독해 오류": "읽기 실패",
  "문제 파악 실패": "전략 실패",
  "시간 부족": "시간 부족",
};

export const LEGACY_DROPPED_TAG = "지위 오해";

export const MATH_TOPICS = {
  "수I·지수로그": ["지수확장", "로그성질", "그래프", "방정식부등식"],
  "수I·삼각함수": ["호도법", "그래프", "사인법칙", "코사인법칙"],
  "수I·수열": ["등차등비", "Σ", "여러가지수열합", "귀납법·점화식"],
  "수II·함수극한": ["극한존재", "미정계수", "연속", "사잇값정리"],
  "수II·미분": [
    "미분계수",
    "미분가능성",
    "접선",
    "평균값정리",
    "극대극소판정",
    "개형",
    "최대최소",
    "속도가속도",
  ],
  "수II·적분": ["부정적분", "정적분정의", "∫포함함수", "넓이", "속도거리"],
  "미적·수열극한": ["수렴발산", "등비극한케이스", "급수", "등비급수", "도형활용"],
  "미적·미분법": [
    "표준극한(e)",
    "지수로그미분",
    "덧셈정리",
    "삼각극한",
    "몫미분",
    "합성함수",
    "매개변수",
    "음함수",
    "역함수",
    "이계도함수",
    "변곡점",
    "개형",
  ],
  "미적·적분법": [
    "여러함수부정적분",
    "치환적분",
    "부분적분",
    "급수↔정적분",
    "넓이",
    "부피(단면적)",
    "속도거리",
  ],
};

export const GATE_CHECKLIST = [
  "근/후보 찾은 뒤 판정했는가 (부호변화·구간 유효성·경계)",
  "답 범위 sanity check (단답 0~999 정수)",
  "문제 조건 전부 사용했는가",
  "경계값 대입 줄을 정렬해서 썼는가 (F(b)−F(a) 한 줄씩)",
];

export const RECHECK_DAYS = 14;
export const DAY_MS = 24 * 60 * 60 * 1000;

/* ---- 재풀이 궤적 (v5) ---- */
// 연속 pass 이 횟수 이상이면 '졸업' — 판정·테스트 모두 이 상수만 쓴다
export const GRADUATION_PASS_STREAK = 2;
// 카드·이력에 보여주는 최근 시도 수
export const TRAJECTORY_LIMIT = 5;
// fail 후 다음 복습까지 (pass는 RECHECK_DAYS)
export const FAIL_RECHECK_DAYS = 1;
// 태그 변화 통계의 비교 창
export const TAG_TREND_WINDOW_DAYS = 14;

/**
 * 재검증 대상 판정 — 탭 배지와 풀기 세션이 반드시 같은 기준을 쓴다.
 *
 * v4부터 fail은 종결이 아니다. 틀린 문제야말로 다시 봐야 하므로
 * 다음 복습을 내일로 당기고 큐에 남긴다. (예전엔 fail을 영구 제외해서
 * 한 번 틀리면 두 번 다시 안 나왔다.)
 */
export const isRecheckDue = (n, now = Date.now()) =>
  now >= (n.nextRecheckTs ?? n.ts + RECHECK_DAYS * DAY_MS);

/**
 * 균등 셔플 (Fisher-Yates). 원본은 건드리지 않는다.
 *
 * [...pool].sort(() => Math.random() - 0.5) 를 쓰면 안 된다. 비교 함수가
 * 비일관적이라(같은 쌍을 다시 물어도 답이 달라진다) 정렬 알고리즘의 전제가
 * 깨지고, 결과가 균등 분포가 아니라 원래 순서 앞쪽에 치우친다.
 * "랜덤으로 뽑기"가 사실은 앞쪽 문제만 자주 뽑는 상태였다.
 */
export const shuffle = (arr) => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

/**
 * 노트가 참조하는 모든 IDB 이미지 id — 문제 사진 + 풀이 사진.
 *
 * 사진 필드가 둘(images, solutionImages)이라 수명주기를 다루는 곳은 반드시
 * 이 함수를 거쳐야 한다. 예전엔 삭제·GC·내보내기가 각자 n.images만 봐서,
 * solutionImages가 채워지는 순간 GC가 살아 있는 사진을 지웠다.
 */
export const noteImageIds = (n) => [
  ...(n?.images || []),
  ...(n?.solutionImages || []),
];

export const uid = () =>
  typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}_${Math.random().toString(36).slice(2)}`;

export const fmtDate = (ts) => {
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};
