# Frozen queue-boundary adversarial review — Codex

Scope: `f9994d4..cf9ce9d` (`feat/companion-boundary-rewrite`, PR #17). Reviewed after `git fetch origin`; code-only review, no test execution.

[high] companion/src/lockFile.js:217 — `releaseOnce()` treats a missing lock marker or a marker with another token as successful release. A manual/external replacement (or unexpected deletion) between acquisition and `close()` therefore makes the owner report a clean shutdown while the single-owner invariant has already been lost; a subsequent process can act on a queue whose prior owner was never forced to stop. Return a `lock_ownership_lost` integrity error (and do not mark the handle released) whenever the marker is absent or token-mismatched.

[high] companion/src/lockFile.js:216 — token verification and `unlink(lockPath)` are separate path operations. If the marker is replaced after `readHolder()` verifies this owner’s token but before `unlink()`, the old owner deletes the replacement lock and enables two live owners. Make release use an ownership-safe primitive/guard, or fail closed with a recovery guard and a re-check that prevents unlinking a replaced marker.

Verdict: block
