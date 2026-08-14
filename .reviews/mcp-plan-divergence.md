# Plan divergence — Claude vs Codex, wrongnote AI bridge v1

Both planned the same fixed architecture from .reviews/mcp-plan-prompt.md.
Agreements are omitted. Only divergence, per Han's rule.

Short version: Codex's plan is better on almost every technical axis. I concede
5 of 8 points outright. I hold 2. One needs Han.

---

## 1. Queue durability — CODEX RIGHT, I CONCEDE

- Claude: in-memory only. Argued a stale queue surviving a reboot is worse than
  an empty one; host can resubmit.
- Codex: durable at `~/.wrongnote/ai-queue-v1.json`, atomic temp+fsync+rename,
  0600/0700, 24h tombstones, startup fails rather than overwrite a corrupt file.

I was wrong. The failure I dismissed is real user-visible data loss: Claude says
"queued", the machine reboots, the analysis is gone, and nobody is told. The
user's work here is the analysis itself. "The host can resubmit" assumes the
user knows to — they don't. Take Codex's.

## 2. Delivery: badge vs auto-open — I HOLD, PARTIALLY

- Claude: poll returns pending items → badge → user taps → apply, with a confirm
  if the draft is dirty.
- Codex: claim-one → **automatically opens the record sheet**. No badge. Never
  merges into an already-open form; polling is disabled whenever the form is
  open.

Codex's *eligibility gate* is strictly better than my confirm dialog and I
concede that half: by only polling when `tab === problems`, not recording, not
in settings, and document visible, the mid-edit clobber becomes impossible by
construction. My confirm dialog merely handles the race. Structural beats
defensive.

But auto-opening a form the user didn't ask for is wrong. The user is browsing
their problem list and a record sheet pops open because a background process
received something. That is the app taking the wheel.

**Synthesis I recommend:** keep Codex's eligibility gate exactly as specified,
and keep my badge. Delivery arms a badge; the tap opens the sheet. Costs one
extra tap, removes the surprise, and the anti-clobber invariant is unchanged.

## 3. Rejected payloads: silent or surfaced — NEEDS HAN

- Claude: settle rejected, then surface the existing error copy once.
- Codex: settle rejected, do not open the form, **show nothing**.

Genuine disagreement. Constraint 4 in the brief mandates silence for an *absent
companion*. Codex extends that to *malformed payloads*, which I think
overreaches. A present companion delivering garbage is a real failure the user
can act on — Claude produced bad JSON, ask it again. Silence means the user asks
for an analysis, is told it was queued, and nothing ever happens with no
explanation. That is exactly the silent-failure shape.

Cost of my version: one error line that could appear when the user isn't looking
at the record view. Han decides.

## 4. Concurrency: ack-on-apply vs lease+receipt — CODEX RIGHT, WITH A CAVEAT

- Claude: items stay visible to all pollers, ack on apply, duplicate application
  across two tabs tolerated as harmless.
- Codex: 60s lease, opaque receipt, owner-bound settle, 409/410, exactly one
  live lease, expired lease reclaimable.

Codex's is correct where mine is merely adequate. Concede.

Caveat worth stating: this is a single-user local desktop app, and the lease
machinery is the single largest complexity item in Codex's plan. It buys
correctness for a scenario (two tabs racing) that costs nothing when it goes
wrong in my design. If the plan needs trimming, this is the first place to look
— not the durability in §1.

## 5. Private Network Access — CODEX RIGHT, AND THIS IS THE REAL RISK

- Claude: "echo the allowed origin, don't use `*`". Under-specified.
- Codex: explicit PNA preflight, `Access-Control-Allow-Private-Network: true`,
  loopback `Host` check, `Cache-Control: no-store`, documented troubleshooting.

Concede, and escalate: the deployed app is served over **https** (GitHub Pages)
while the companion is **http://127.0.0.1**. Loopback is exempt from
mixed-content blocking because it's a potentially-trustworthy origin, so this
can work — but only with the PNA preflight handled correctly, and browser policy
here is actively changing. This is the highest-risk item in the whole build and
the one most likely to fail on Han's actual machine rather than in tests.
Codex's plan handles it; mine would have discovered it the hard way.

## 6. Two gaps Codex found that I missed — CONCEDE BOTH

- **No `subject` in the AI envelope.** An auto-opened draft has to default
  somewhere; Codex defaults to 수학 and says so out loud rather than smuggling
  subject through a transport field. I never noticed the field was absent.
- **`failurePoint` is requested but discarded.** `buildChatGPTRequest`
  (src/aiBridge.js:11) asks the model for `failurePoint`; `parseAiImport`
  (src/aiBridge.js:14-46) never reads it. Every analysis to date has thrown that
  field away. Pre-existing, out of scope for v1, but it should be logged as a
  product decision rather than left as an accident.

## 7. Test honesty — CODEX RIGHT

I flagged my `inbox-absent.spec.js` as un-reddable (with no polling code, "no
error appears" passes trivially) and reported it as a known weakness. Codex
solved it instead: assert **at least one intercepted poll was attempted**, which
does fail before the change. Better answer than my disclosure. Concede.

## 8. Where taxonomy single-sourcing lands — CODEX RIGHT

Already conceded before the plans were compared. `get_taxonomy()` establishes
one data source because both paths read `src/constants.js`; it cannot remove the
inlined taxonomy from `buildChatGPTRequest`, because manual paste is the
permanent mobile fallback and needs it. My step 9 / commit D was wrong. Codex
keeps `src/aiBridge.js` explicitly unchanged, which is right.

---

## Recommended merge of the two plans

Take Codex's plan as the base. Apply three changes:

1. §2 — badge-to-open instead of auto-open. Keep Codex's eligibility gate verbatim.
2. §3 — surface rejected payloads once, pending Han's ruling.
3. Log the `failurePoint` discard (§6) as a separate product question. Do not
   fix it inside this work.

Everything else: Codex's plan as written.
