// 화면 색 팔레트 — 여기가 유일한 색 정의처다.
// tools/gen-themes.mjs가 이 파일을 읽어 src/themes.css를 만들고,
// tools/verify-contrast.mjs가 같은 파일로 명도 대비를 검사한다.
// 색을 고치려면 여기만 고치고 `npm run themes`를 돌린다.
//
// 키: bg=책상, paper=지면, s2=보조면, sunken=눌린면, bd/bds=테두리,
//     ink=본문, sec=보조글씨, mut=흐린글씨, act=누르는것, on=행동색 위 글씨,
//     fail/failBg=틀림, pass/passBg=통과, info/infoBg=안내, hi/hiStrong=형광, warn=경고

export const PALETTES = [
  {
    id: "warm",
    name: "미색",
    desc: "따뜻한 종이",
    day: {
      bg: "#e7ddcb", paper: "#fbf7ef", s2: "#f4ede0", sunken: "#eee6d8",
      bd: "#e3d9c8", bds: "#c3b5a0",
      ink: "#33291f", sec: "#63564a", mut: "#736555",
      act: "#5f5145", actHover: "#726255", on: "#fbf7ef",
      fail: "#a0574a", failBg: "#faeeea", pass: "#5e6b4a", passBg: "#e9eddc",
      info: "#6e6247", infoBg: "#efe8d6", hi: "#f7eacb", hiStrong: "#e2cb93", warn: "#7e5f16",
    },
    night: {
      bg: "#1a1714", paper: "#221e1a", s2: "#2a251f", sunken: "#1e1a17",
      bd: "#322c25", bds: "#4a4238",
      ink: "#e8e1d5", sec: "#b4a897", mut: "#978b7a",
      act: "#d9a05b", actHover: "#e5b375", on: "#221e1a",
      fail: "#e0806c", failBg: "#2e211d", pass: "#95ae84", passBg: "#232b1f",
      info: "#c4b48e", infoBg: "#262117", hi: "#302816", hiStrong: "#5e4e28", warn: "#d9a05b",
    },
  },
  {
    id: "mauve",
    name: "모브",
    desc: "흐린 장밋빛",
    day: {
      bg: "#e8dcda", paper: "#fbf5f3", s2: "#f3eae7", sunken: "#ebe0dd",
      bd: "#e5d8d4", bds: "#bea5a1",
      ink: "#382c2c", sec: "#63504f", mut: "#6e5a59",
      act: "#5f4547", actHover: "#73585a", on: "#fbf5f3",
      fail: "#8f4b55", failBg: "#f7e6e7", pass: "#4f5b47", passBg: "#e9ede3",
      info: "#6b5350", infoBg: "#f2e7e4", hi: "#f5e6df", hiStrong: "#dcc0b4", warn: "#7d5518",
    },
    night: {
      bg: "#1b1618", paper: "#241e20", s2: "#2c2427", sunken: "#1f1a1c",
      bd: "#332a2d", bds: "#4c4044",
      ink: "#ebe0de", sec: "#b7a5a4", mut: "#9e8a87",
      act: "#b9afe2", actHover: "#ccc3ee", on: "#241e20",
      fail: "#de8792", failBg: "#2e2023", pass: "#9cb08a", passBg: "#212a1e",
      info: "#cbaea8", infoBg: "#291f1e", hi: "#2f2620", hiStrong: "#584434", warn: "#d9a05b",
    },
  },
  {
    id: "plum",
    name: "자두",
    desc: "자두에서 모래로",
    day: {
      bg: "#dfd3be", paper: "#faf5ec", s2: "#f2eadc", sunken: "#e8dfcc",
      bd: "#e4d9c4", bds: "#b5a48a",
      ink: "#372b39", sec: "#5c4a57", mut: "#6b5665",
      act: "#523856", actHover: "#674a6b", on: "#faf5ec",
      fail: "#8e4b58", failBg: "#f4e4e6", pass: "#57633f", passBg: "#eaeddc",
      info: "#63524c", infoBg: "#f0e8da", hi: "#f5e9d4", hiStrong: "#dcc59a", warn: "#7a5a14",
    },
    night: {
      bg: "#1a151c", paper: "#231c26", s2: "#2b232e", sunken: "#1e1820",
      bd: "#332a36", bds: "#4b4050",
      ink: "#ede3dc", sec: "#b8a8b4", mut: "#9d8ca2",
      act: "#d9b98e", actHover: "#e5c9a4", on: "#231c26",
      fail: "#dd8794", failBg: "#2e2028", pass: "#a3b487", passBg: "#232b1e",
      info: "#c9b2a4", infoBg: "#271f22", hi: "#2f2718", hiStrong: "#5b4a2c", warn: "#d9b98e",
    },
  },
  {
    id: "teal",
    name: "로즈 & 딥틸",
    desc: "분홍 속 진한 청록",
    day: {
      bg: "#e6dedc", paper: "#fbf7f5", s2: "#f2ece9", sunken: "#eee7e4",
      bd: "#e3dad6", bds: "#b4a9a5",
      ink: "#2a3031", sec: "#4f5958", mut: "#5f6a69",
      act: "#25464a", actHover: "#345c61", on: "#fbf7f5",
      fail: "#a2504f", failBg: "#f7e5e3", pass: "#2f6154", passBg: "#e1ede8",
      info: "#4c5f61", infoBg: "#e6eeee", hi: "#f6e7de", hiStrong: "#dcc0b0", warn: "#7c5716",
    },
    night: {
      bg: "#141a1a", paper: "#1c2424", s2: "#232c2c", sunken: "#181e1e",
      bd: "#2a3434", bds: "#3e4a4a",
      ink: "#e3e9e7", sec: "#a6b3b1", mut: "#879391",
      act: "#7daed2", actHover: "#94c0df", on: "#1c2424",
      fail: "#e08c86", failBg: "#2a1f1e", pass: "#7fbfa9", passBg: "#182722",
      info: "#9fbdbd", infoBg: "#1a2426", hi: "#2c2620", hiStrong: "#544437", warn: "#d6a45f",
    },
  },
  {
    id: "sage",
    name: "세이지",
    desc: "세이지와 점토",
    day: {
      bg: "#dde0d4", paper: "#f9f8f2", s2: "#eff0e7", sunken: "#e8eade",
      bd: "#dee1d5", bds: "#a9af9c",
      ink: "#2c302a", sec: "#525b4b", mut: "#626b5b",
      act: "#4b596c", actHover: "#5e6e84", on: "#f9f8f2",
      fail: "#96513c", failBg: "#f4e4dc", pass: "#456046", passBg: "#e4ede1",
      info: "#55604e", infoBg: "#e9ece1", hi: "#f4ebd4", hiStrong: "#d9c89b", warn: "#775814",
    },
    night: {
      bg: "#171a15", paper: "#1f231c", s2: "#262b22", sunken: "#1b1e18",
      bd: "#2e342a", bds: "#434b3d",
      ink: "#e4e8dc", sec: "#aab4a0", mut: "#8a9482",
      act: "#91b7d2", actHover: "#a7c7dd", on: "#1f231c",
      fail: "#de9070", failBg: "#2b211b", pass: "#8fbf92", passBg: "#1d2a1e",
      info: "#adbba2", infoBg: "#1f2620", hi: "#2c2818", hiStrong: "#55502c", warn: "#d6ab5c",
    },
  },
  {
    id: "sky",
    name: "흐린 하늘",
    desc: "회청색과 모래",
    day: {
      bg: "#dce0e3", paper: "#f8f9f8", s2: "#eef0f1", sunken: "#e5e8ea",
      bd: "#dce0e2", bds: "#a5aeb4",
      ink: "#282e34", sec: "#4e5860", mut: "#5d6874",
      act: "#3b5165", actHover: "#4e657a", on: "#f8f9f8",
      fail: "#9c5149", failBg: "#f5e4e1", pass: "#456055", passBg: "#e2ebe6",
      info: "#4d5c68", infoBg: "#e6ebef", hi: "#f3ead8", hiStrong: "#d7c7a4", warn: "#755a17",
    },
    night: {
      bg: "#14181c", paper: "#1c2126", s2: "#232930", sunken: "#181c20",
      bd: "#2a3138", bds: "#3e4750",
      ink: "#e2e7eb", sec: "#a6b0ba", mut: "#87919c",
      act: "#8db3d2", actHover: "#a3c3dc", on: "#1c2126",
      fail: "#de8b80", failBg: "#2a1f1d", pass: "#83b79c", passBg: "#1a2823",
      info: "#a8b6c4", infoBg: "#1e242a", hi: "#2a2719", hiStrong: "#524b2f", warn: "#d5a95f",
    },
  },
  {
    /* 색보다 정보 구조를 앞세우는 팔레트. 상태색만 제한적으로 드러나서
       색각 차이가 있어도 비교적 안정적으로 읽힌다. */
    id: "graphite",
    name: "흑연",
    desc: "중립 회색과 푸른 잉크",
    day: {
      bg: "#e1e2e3", paper: "#fafaf8", s2: "#f0f1f1", sunken: "#e8e9ea",
      bd: "#d9dbdc", bds: "#a4a8ab",
      ink: "#25282a", sec: "#4d5357", mut: "#62686c",
      act: "#334a5e", actHover: "#415f78", on: "#fafaf8",
      fail: "#9a4f43", failBg: "#f6e5e1", pass: "#48624d", passBg: "#e5ece5",
      info: "#4e5f70", infoBg: "#e7ecf0", hi: "#f4e9cf", hiStrong: "#d9c493", warn: "#735615",
    },
    night: {
      bg: "#121416", paper: "#1a1d20", s2: "#22262a", sunken: "#16181a",
      bd: "#2b3035", bds: "#454c52",
      ink: "#e7e9ea", sec: "#afb5b9", mut: "#92999e",
      act: "#8cb8d7", actHover: "#a4c8e0", on: "#182027",
      fail: "#e28a7a", failBg: "#2d211f", pass: "#8eb79a", passBg: "#1d2921",
      info: "#a7bacb", infoBg: "#1d252b", hi: "#2c271a", hiStrong: "#594d2b", warn: "#d4a85b",
    },
  },
  {
    /* 행동·성공·실패·경고가 가장 또렷하게 갈리는 팔레트.
       시험지 결을 지키면서도 흔한 생산성 앱에 가까운 인상. */
    id: "navy",
    name: "남색 & 호박",
    desc: "남색 잉크와 따뜻한 강조색",
    day: {
      bg: "#dee3e8", paper: "#f9fafb", s2: "#eef2f5", sunken: "#e6ebef",
      bd: "#d7dee5", bds: "#9eaab5",
      ink: "#202832", sec: "#485562", mut: "#5b6875",
      act: "#243f5a", actHover: "#315575", on: "#f9fafb",
      fail: "#a14f4a", failBg: "#f7e5e3", pass: "#3f644f", passBg: "#e2ece6",
      info: "#4b6075", infoBg: "#e6edf3", hi: "#f5e8c9", hiStrong: "#dbc38c", warn: "#73550f",
    },
    night: {
      bg: "#10151b", paper: "#18212a", s2: "#202b36", sunken: "#141a22",
      bd: "#2a3642", bds: "#435263",
      ink: "#e6ebf0", sec: "#aab5c0", mut: "#8d99a4",
      act: "#7eb2e1", actHover: "#98c3e8", on: "#16202a",
      fail: "#e4877f", failBg: "#2d2020", pass: "#83b99c", passBg: "#192a22",
      info: "#a5b9cc", infoBg: "#1b2732", hi: "#2d2818", hiStrong: "#5a4a25", warn: "#e0b55d",
    },
  },
];

export const DEFAULT_PALETTE = "warm";

export const isPalette = (id) => PALETTES.some((p) => p.id === id);
