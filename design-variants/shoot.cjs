/* 디자인 변형 스크린샷 생성기 — :root 토큰 오버라이드로 3개 변형 캡처 */
const { chromium } = require("playwright");

const variants = {
  // B. 한지 에디토리얼 — 종이+먹+감(persimmon). 출판/잡지 느낌.
  "B-hanji": `:root{
    --bg:#F6F3EC; --surface:#FFFEFA; --surface-2:#F1EDE3; --sunken:#E7E1D3;
    --border:#DDD5C4; --border-strong:#C2B69E;
    --text:#26221C; --text-secondary:#5C554A; --text-muted:#98907F; --text-on-accent:#FDFBF6;
    --primary:#C4472B; --primary-hover:#A93A21; --primary-soft:#F7DFD8;
    --success:#4E6B4C; --success-soft:#DFE8DC;
    --error:#B03A2E; --error-soft:#F4DAD6;
    --warning:#A87B23; --warning-soft:#F2E5C8;
    --info:#39566B; --info-soft:#DCE5EC;
    --sh-sm:0 1px 2px rgba(38,34,28,.07);
    --sh-md:0 2px 8px rgba(38,34,28,.09),0 1px 2px rgba(38,34,28,.05);
    --sh-lg:0 10px 24px rgba(38,34,28,.13);
    --focus-ring:0 0 0 3px rgba(196,71,43,.30);
  }`,
  // C. 세이지 스터디 — 차분한 그린 베이스, 집중 모드.
  "C-sage": `:root{
    --bg:#E5E7DC; --surface:#F4F5EE; --surface-2:#EDEFE3; --sunken:#D6D9C8;
    --border:#C3C7B0; --border-strong:#A6AC8E;
    --text:#2E3226; --text-secondary:#5A6050; --text-muted:#8A9179; --text-on-accent:#F6F7F1;
    --primary:#5B7052; --primary-hover:#4B5E43; --primary-soft:#DCE3D5;
    --success:#4F7350; --success-soft:#D9E5D9;
    --error:#A34A38; --error-soft:#EDD8D1;
    --warning:#A5822F; --warning-soft:#EDE3C5;
    --info:#4A6B70; --info-soft:#D8E3E4;
    --sh-sm:0 1px 2px rgba(46,50,38,.08);
    --sh-md:0 2px 7px rgba(46,50,38,.10),0 1px 2px rgba(46,50,38,.06);
    --sh-lg:0 8px 20px rgba(46,50,38,.14);
    --focus-ring:0 0 0 3px rgba(91,112,82,.32);
  }`,
  // D. 웜 그라파이트 + 앰버 — SaaS 프로덕트 느낌.
  "D-amber": `:root{
    --bg:#ECE9E3; --surface:#FBFAF7; --surface-2:#F3F1EB; --sunken:#DEDACF;
    --border:#D2CCBE; --border-strong:#B3AB97;
    --text:#2B2823; --text-secondary:#5D584E; --text-muted:#928B7C; --text-on-accent:#FBFAF5;
    --primary:#B08430; --primary-hover:#977028; --primary-soft:#F1E6CB;
    --success:#57724E; --success-soft:#DEE6D8;
    --error:#AC4438; --error-soft:#F0DAD6;
    --warning:#B5852C; --warning-soft:#EFE3C4;
    --info:#3F5E75; --info-soft:#DAE3EA;
    --sh-sm:0 1px 2px rgba(43,40,35,.08);
    --sh-md:0 2px 7px rgba(43,40,35,.10),0 1px 2px rgba(43,40,35,.06);
    --sh-lg:0 8px 22px rgba(43,40,35,.14);
    --focus-ring:0 0 0 3px rgba(176,132,48,.32);
  }`,
};

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 820, height: 1180 } });
  await page.goto("http://localhost:5174/");
  await page.waitForTimeout(1200);

  // A안 (현재 테라코타) 기준 캡처
  await page.screenshot({ path: "design-variants/A-terracotta-record.png" });
  await page.click('.tab:has-text("통계")');
  await page.waitForTimeout(300);
  await page.screenshot({ path: "design-variants/A-terracotta-stats.png" });
  await page.click('.tab:has-text("기록")');
  await page.waitForTimeout(300);

  for (const [name, css] of Object.entries(variants)) {
    await page.evaluate((c) => {
      const s = document.createElement("style");
      s.id = "variant-style";
      s.textContent = c;
      document.head.appendChild(s);
    }, css);
    await page.waitForTimeout(200);
    await page.screenshot({ path: `design-variants/${name}-record.png` });
    await page.click('.tab:has-text("통계")');
    await page.waitForTimeout(300);
    await page.screenshot({ path: `design-variants/${name}-stats.png` });
    await page.click('.tab:has-text("기록")');
    await page.waitForTimeout(200);
    await page.evaluate(() => document.getElementById("variant-style")?.remove());
  }
  await browser.close();
  console.log("done");
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
