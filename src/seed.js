import { DAY_MS, fmtDate } from "./constants.js";

const daysAgo = (n) => Date.now() - n * DAY_MS;

export function seedNotes() {
  const raw = [
    {
      subject: "수학",
      problem: "Q15",
      topicMain: "미적·적분법",
      topicSub: "",
      question: "",
      mySol: "구간 분리 후 상수 즉시 대입 안 함",
      optSol: "",
      tags: ["실행 실수"],
      derived: null,
      memo: "",
      ts: daysAgo(10),
    },
    {
      subject: "수학",
      problem: "Q19",
      topicMain: "미적·미분법",
      topicSub: "",
      question: "",
      mySol: "부호 전사 오류",
      optSol: "",
      tags: ["실행 실수", "부호 실수"],
      derived: null,
      memo: "",
      ts: daysAgo(10),
    },
    {
      subject: "수학",
      problem: "Q20",
      topicMain: "미적·적분법",
      topicSub: "",
      question: "",
      mySol: "인지 과부하에서 단계 점프",
      optSol: "",
      tags: ["실행 실수", "막판 실수"],
      derived: null,
      memo: "",
      ts: daysAgo(10),
    },
    {
      subject: "수학",
      problem: "Q11",
      topicMain: "수II·미분",
      topicSub: "",
      question: "",
      mySol: "마지막 실행 단계 오류",
      optSol: "",
      tags: ["실행 실수"],
      derived: null,
      memo: "",
      ts: daysAgo(10),
    },
    {
      subject: "수학",
      problem: "표준극한 인출",
      topicMain: "미적·수열극한",
      topicSub: "",
      question: "",
      mySol: "",
      optSol: "",
      tags: ["지위 오해"],
      derived: null,
      memo: "암기 항목인 걸 몰랐음",
      ts: daysAgo(3),
    },
    {
      subject: "수학",
      problem: "극값 경계 판정 (23번 계열)",
      topicMain: "수II·미분",
      topicSub: "",
      question: "",
      mySol: "근/후보 찾고 판정 스킵 ×3회",
      optSol: "후보 → 부호변화·구간유효성·경계 확인 → 답",
      tags: ["개념 오류"],
      derived: null,
      memo: "판정 단계 자체가 절차에 없었음",
      ts: daysAgo(3),
    },
    {
      subject: "수학",
      problem: "기출 Q26 입체도형 부피",
      topicMain: "미적·적분법",
      topicSub: "",
      question: "y=√(x+xlnx), x=1~2, 단면 정삼각형. V=?",
      mySol:
        "setup 정확 (α=√3/4 조기 분리). ∫xlnx를 현장 재유도 — 3줄 소모. 막판 F(2)−F(1) 대입 구간 수정 다발.",
      optSol:
        "∫xlnx dx = x²/2·lnx − x²/4 즉시 인출. V = (√3/4)(3/4 + 2ln2) = √3(3+8ln2)/16. 답①. 대입은 F(2), F(1) 한 줄씩 정렬.",
      tags: ["지위 오해", "막판 실수"],
      derived: "yes",
      memo: "",
      ts: daysAgo(0),
    },
  ];
  return raw.map((n, i) => ({
    ...n,
    id: `seed_note_${i + 1}`,
    date: fmtDate(n.ts),
    rechecked: false,
    recheckResult: null,
  }));
}

export function seedCards() {
  const raw = [
    {
      front: "표준 극한값 (인출용)",
      back: "lim sinx/x = 1, lim(1+x)^(1/x) = e, lim(e^x−1)/x = 1, lim ln(1+x)/x = 1 (x→0)",
    },
    { front: "ds 적분", back: "ds가 적분을 닫는다" },
    {
      front: "0의 부호",
      back: "0은 양수가 아니다. 양수 조건에서 0 포함 여부 확인",
    },
    {
      front: "배각 공식",
      back: "sin2x=2sinxcosx, cos2x=cos²−sin²=2cos²−1=1−2sin², tan2x=2tanx/(1−tan²x)",
    },
    {
      front: "∫x ln x dx (즉시 인출)",
      back: "x²/2·lnx − x²/4 + C. 계열: ∫lnx=xlnx−x, ∫xe^x=(x−1)e^x",
    },
  ];
  return raw.map((c, i) => ({
    ...c,
    id: `seed_card_${i + 1}`,
    noteId: null,
    subject: "수학",
  }));
}
