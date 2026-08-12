# Wrongnote real-machine AI bridge gate

Purpose: prove the part CI cannot falsify — a real browser on the user's Windows machine talking from the Wrongnote UI to the local companion, with Claude Code producing the queued event.

This gate is **after** the browser/save boundary review. It is not a substitute for those tests.

## Gate A — local functional end-to-end

This can run before merging the stacked PRs to production. It proves:

```text
Claude Code MCP
→ wrongnote-mcp process
→ durable queue
→ localhost HTTP
→ browser inbox
→ editable review
→ localStorage note save
→ accepted settlement
→ no duplicate on reload
```

### 1. Prepare the reviewed branch

From the Wrongnote repository on the Windows PC:

```powershell
git fetch origin
git switch feat/browser-ai-inbox
git pull --ff-only
npm ci
npm --prefix companion ci
```

### 2. Start the browser app on one explicit origin

PowerShell window A:

```powershell
npm run dev -- --host 127.0.0.1
```

Open the exact URL Vite reports for `127.0.0.1` (normally `http://127.0.0.1:5173`). Keep the host spelling exact; CORS origin matching is intentional.

### 3. Start Claude Code with the same origin allowed

PowerShell window B, from the repository root:

```powershell
$env:WRONGNOTE_ALLOWED_ORIGINS="http://127.0.0.1:5173"
```

If the Wrongnote MCP server has not already been registered for this project:

```powershell
claude mcp add wrongnote --scope project -- node companion/src/mcp.js
```

Then start/use Claude Code from this same environment so the MCP subprocess inherits `WRONGNOTE_ALLOWED_ORIGINS`.

Do not separately start `wrongnote-companion` while `wrongnote-mcp` is the producer. The MCP process lazily becomes the one queue + HTTP owner on the first real submission.

### 4. Browser opt-in

In Wrongnote click:

```text
✦ AI 연결
```

No analysis should open automatically.

### 5. Submit one deterministic transport event

For the first gate, do **not** depend on OCR/image interpretation. Ask Claude to submit this exact structure through `wrongnote_submit_analysis` so a failure can be attributed to transport rather than model reasoning:

```text
Use the Wrongnote MCP tool to submit exactly one test analysis.
Use eventId: e2e-20260812-001
Reuse that exact eventId if you need to retry; do not create a replacement id.

Payload:
{
  "version": 1,
  "locale": "ko",
  "subject": "수학",
  "question": {
    "problem": "E2E-MCP-1",
    "plainText": "테스트 문제: f(x)의 최댓값을 구하여라.",
    "latex": "\\max f(x)",
    "correctAnswer": "11"
  },
  "analysis": {
    "topicMain": "수II·미분",
    "topicSub": "최대최소",
    "concepts": ["도함수 부호", "최대최소"],
    "cause": "개념 부족",
    "tags": ["조건 누락"],
    "failurePoint": "후보 하나를 비교에서 누락했다.",
    "mySolution": "후보 하나만 확인했다.",
    "optimalSolution": "가능한 후보를 모두 구한 뒤 값을 비교한다.",
    "memo": "실제 시험에서는 후보 집합을 먼저 고정한다."
  }
}
```

Expected Claude/tool outcome: queued/waiting, or an idempotent duplicate if the exact same event was already submitted. A different eventId must not be generated merely because the first response was ambiguous.

### 6. Browser acceptance criteria

Within a polling cycle Wrongnote should show a non-intrusive badge similar to:

```text
✦ AI 분석 · E2E-MCP-1 검토
```

Required observations:

1. the app did not auto-open the review;
2. tapping the badge opens `AI 분석 검토`;
3. problem, answer, cause, failure point, my solution and recommended solution are populated;
4. edit at least one field to prove this is a review surface rather than an authoritative import;
5. click `저장 (기록하기)`;
6. review closes only after the note is saved;
7. the problem appears in Wrongnote;
8. reload the browser;
9. the same queued event does not create a second note;
10. if the tool is called again with the same eventId + same payload, no duplicate note appears.

### 7. Failure-path spot checks

Do these only after the happy path succeeds.

**Later/release:** submit a second event, open it, choose `나중에`. The result should return to waiting and reappear later rather than disappear.

**User reject:** submit a third event, open it, choose `거절`. It should not become a note and should enter rejected/dead-letter state.

**Malformed payload:** if intentionally testing malformed AI output, it must not become a note or disappear silently. The companion should retain rejection evidence.

## Gate B — production-origin browser security

Gate A proves the application flow but does **not** prove the real production-origin Local Network Access/CORS behavior, because the dev origin is HTTP loopback.

After the reviewed stack is deliberately deployed, repeat one deterministic event from:

```text
https://hansoullee20.github.io/wrongnote/
```

with the companion using its default allowed origin. This gate specifically observes the real Chrome behavior for HTTPS public origin → `127.0.0.1:43119`.

Record:

- Chrome version;
- whether a Local Network Access permission prompt appears;
- exact prompt wording if it appears;
- whether Allow succeeds;
- whether Deny fails visibly without corrupting queue state;
- whether re-enabling permission later allows the same queued event to be delivered;
- whether save/ACK/no-duplicate still hold.

Do not change CORS/PNA headers based only on theory if Gate B behaves differently. Capture the browser failure first, then patch against the observed behavior.

## Pass rule

The bridge is production-usable only after:

```text
Gate A functional E2E = PASS
AND
Gate B production-origin browser security = PASS
```

The solution-progression / best-known-solution / contextual AI-coach work starts after this bridge gate, on a separate reviewed change.