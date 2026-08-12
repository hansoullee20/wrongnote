import { useCallback, useEffect, useRef, useState } from "react";
import { parseAiImport } from "./aiBridge.js";
import { createCompanionClient, newCompanionSessionId } from "./companionClient.js";
import { hasPersistedAiEvent } from "./storage.js";

const POLL_MS = 4_000;
const RENEW_MS = 20_000;

const terminalOwnershipStatus = new Set(["no_session", "not_owner", "stale_fence"]);
const directSettlementStatus = new Set(["released", "rejected", "accepted"]);

function parseFailureReason(err) {
  const message = err?.message ? String(err.message) : "unknown AI import error";
  return `Wrongnote parseAiImport rejected the queued payload: ${message}`;
}

export function useCompanionInbox({ enabled, client: clientOverride } = {}) {
  const clientRef = useRef(clientOverride || createCompanionClient());
  // AI가 꺼진 브라우저는 session identity조차 만들 필요가 없다. randomUUID 같은
  // companion 전용 capability가 일반 Wrongnote 부팅을 깨면 안 된다.
  const sessionIdRef = useRef(null);
  const sessionRef = useRef(null);
  const readyRef = useRef(null);
  const pendingRejectRef = useRef(null);
  const pendingAcceptRef = useRef(null);
  const pendingReleaseRef = useRef(null);
  const tickBusyRef = useRef(false);
  const aliveRef = useRef(true);
  const [ready, setReadyState] = useState(null);
  const [notice, setNotice] = useState("");

  const setReady = useCallback((value) => {
    readyRef.current = value;
    if (aliveRef.current) setReadyState(value);
  }, []);

  const clearSession = useCallback(() => {
    sessionRef.current = null;
  }, []);

  /*
   * 반환값은 "HTTP가 끝났나"가 아니라 settlement intent의 상태다.
   * done=true면 같은 receipt를 더 재시도하면 안 된다.
   * matched=true일 때만 요청한 outcome과 durable queue outcome이 일치한다.
   */
  const settlePending = useCallback(async (pending) => {
    const session = sessionRef.current;
    if (!session || session.fence !== pending.fence) {
      return { done: true, matched: false };
    }
    try {
      const result = await clientRef.current.settle(
        session.sessionId,
        session.fence,
        pending.receipt,
        pending.outcome,
        pending.error ? { error: pending.error } : undefined
      );

      if (directSettlementStatus.has(result.status)) {
        return {
          done: true,
          matched: result.status === pending.outcome,
          result,
        };
      }

      if (result.status === "already_settled") {
        if (result.outcome === pending.outcome) {
          return { done: true, matched: true, result };
        }
        if (aliveRef.current) {
          setNotice(
            `AI 처리 상태 충돌: ${pending.outcome}로 완료하려 했지만 로컬 큐에는 이미 ${result.outcome || "다른 상태"}로 기록되어 있다. 자동으로 덮어쓰지 않았다.`
          );
        }
        return { done: true, matched: false, conflict: true, result };
      }

      /* release는 event를 파괴하지 않는다. release 응답만 유실된 뒤 재시도하면
         store에는 terminal receipt가 없어서 receipt_mismatch가 정상적으로 나온다.
         그 오래된 receipt를 계속 재시도하면 세션을 영원히 잡으므로 여기서 끝낸다. */
      if (
        pending.outcome === "released" &&
        ["receipt_mismatch", "not_found"].includes(result.status)
      ) {
        return { done: true, matched: true, recoveredRelease: true, result };
      }

      if (terminalOwnershipStatus.has(result.status)) {
        clearSession();
        return { done: true, matched: false, result };
      }
      return { done: false, matched: false, result };
    } catch (err) {
      // 네트워크 단절·commit durability uncertainty·일시 I/O는 같은 receipt로
      // 재시도하는 것이 안전하다. 영속 terminal outcome은 다음 응답에서 판별한다.
      return { done: false, matched: false, error: err };
    }
  }, [clearSession]);

  const rejectMalformed = useCallback(async (delivery, reason) => {
    const session = sessionRef.current;
    if (!session) return;
    const pending = {
      fence: session.fence,
      receipt: delivery.receipt,
      outcome: "rejected",
      error: reason,
    };
    pendingRejectRef.current = pending;
    const settlement = await settlePending(pending);
    if (settlement.done) pendingRejectRef.current = null;
    if (aliveRef.current && !settlement.conflict) {
      setNotice(
        settlement.matched
          ? "AI 분석 JSON이 Wrongnote 검증을 통과하지 못해 격리했다."
          : "AI 분석 JSON 검증 실패 — 격리 상태를 로컬 컴패니언에 기록하는 중이다."
      );
    }
  }, [settlePending]);

  const acquireIfNeeded = useCallback(async () => {
    if (sessionRef.current) return sessionRef.current;
    const sessionId = sessionIdRef.current || newCompanionSessionId();
    sessionIdRef.current = sessionId;
    let result;
    try {
      result = await clientRef.current.acquireSession(sessionId);
    } catch {
      return null;
    }
    if (["acquired", "already_acquired"].includes(result.status)) {
      const session = {
        sessionId,
        fence: result.fence,
        expiresAt: result.expiresAt,
      };
      sessionRef.current = session;
      return session;
    }
    if (result.status === "busy") return null;
    if (terminalOwnershipStatus.has(result.status)) clearSession();
    return null;
  }, [clearSession]);

  const tick = useCallback(async () => {
    if (!aliveRef.current || tickBusyRef.current) return;
    tickBusyRef.current = true;
    try {
      if (pendingRejectRef.current) {
        const settlement = await settlePending(pendingRejectRef.current);
        if (settlement.done) {
          pendingRejectRef.current = null;
          if (aliveRef.current && settlement.matched && !settlement.conflict) {
            setNotice("AI 분석 JSON이 Wrongnote 검증을 통과하지 못해 격리했다.");
          }
        }
        return;
      }
      if (pendingAcceptRef.current) {
        const settlement = await settlePending(pendingAcceptRef.current);
        if (settlement.done) pendingAcceptRef.current = null;
        return;
      }
      if (pendingReleaseRef.current) {
        const settlement = await settlePending(pendingReleaseRef.current);
        if (settlement.done) pendingReleaseRef.current = null;
        return;
      }
      if (!enabled || readyRef.current || document.visibilityState === "hidden") return;

      const session = await acquireIfNeeded();
      if (!session) return;
      let result;
      try {
        result = await clientRef.current.claim(session.sessionId, session.fence);
      } catch (err) {
        if (err?.code !== "companion_unavailable" && aliveRef.current) {
          setNotice("로컬 AI 컴패니언 응답을 확인하지 못했다. 다음 주기에 다시 시도한다.");
        }
        return;
      }

      if (result.status === "empty") return;
      if (result.status === "lease_expired") {
        clearSession();
        return;
      }
      if (terminalOwnershipStatus.has(result.status)) {
        clearSession();
        return;
      }
      if (result.status !== "delivered") return;

      try {
        const imported = parseAiImport(result.payload);
        setReady({
          eventId: result.eventId,
          itemId: result.itemId,
          receipt: result.receipt,
          imported,
        });
        if (aliveRef.current) setNotice("");
      } catch (err) {
        await rejectMalformed(result, parseFailureReason(err));
      }
    } finally {
      tickBusyRef.current = false;
    }
  }, [acquireIfNeeded, clearSession, enabled, rejectMalformed, setReady, settlePending]);

  const releaseReady = useCallback(async () => {
    const current = readyRef.current;
    const session = sessionRef.current;
    if (!current || !session) {
      setReady(null);
      return true;
    }
    const pending = {
      fence: session.fence,
      receipt: current.receipt,
      outcome: "released",
    };
    pendingReleaseRef.current = pending;
    setReady(null);
    const settlement = await settlePending(pending);
    if (settlement.done) pendingReleaseRef.current = null;
    return settlement.matched;
  }, [setReady, settlePending]);

  const acceptReady = useCallback(async () => {
    const current = readyRef.current;
    const session = sessionRef.current;
    if (!current || !session) return true;

    /* Defense in depth: App의 호출 순서가 나중에 바뀌어도 queue accepted가
       durable note보다 앞설 수 없다. 저장 실패 상태의 in-memory note는 증거가 아니다. */
    if (!hasPersistedAiEvent(current.eventId)) {
      if (aliveRef.current) {
        setNotice("AI 분석은 아직 기기에 저장되지 않아 완료 처리하지 않았다.");
      }
      return false;
    }

    const pending = {
      fence: session.fence,
      receipt: current.receipt,
      outcome: "accepted",
    };
    pendingAcceptRef.current = pending;
    setReady(null);
    const settlement = await settlePending(pending);
    if (settlement.done) pendingAcceptRef.current = null;
    return settlement.matched;
  }, [setReady, settlePending]);

  const rejectReady = useCallback(async (reason = "사용자가 AI 분석을 기록하지 않음") => {
    const current = readyRef.current;
    const session = sessionRef.current;
    if (!current || !session) {
      setReady(null);
      return true;
    }
    const error = String(reason || "").trim();
    if (!error) throw new Error("rejection reason must be nonblank");
    const pending = {
      fence: session.fence,
      receipt: current.receipt,
      outcome: "rejected",
      error,
    };
    pendingRejectRef.current = pending;
    setReady(null);
    const settlement = await settlePending(pending);
    if (settlement.done) pendingRejectRef.current = null;
    return settlement.matched;
  }, [setReady, settlePending]);

  useEffect(() => {
    aliveRef.current = true;
    void tick();
    const timer = window.setInterval(() => void tick(), POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") void tick();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      aliveRef.current = false;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [tick]);

  useEffect(() => {
    const timer = window.setInterval(async () => {
      const session = sessionRef.current;
      const hasPending = Boolean(
        pendingRejectRef.current || pendingAcceptRef.current || pendingReleaseRef.current
      );
      if (!session || (!readyRef.current && !hasPending && !enabled)) return;
      try {
        const result = await clientRef.current.renewSession(session.sessionId, session.fence);
        if (result.status === "renewed") {
          session.expiresAt = result.expiresAt;
        } else if (terminalOwnershipStatus.has(result.status)) {
          clearSession();
          pendingRejectRef.current = null;
          pendingAcceptRef.current = null;
          pendingReleaseRef.current = null;
          if (readyRef.current) {
            setReady(null);
            if (aliveRef.current) setNotice("AI 분석 소유권이 다른 탭으로 넘어갔다. 다시 도착하면 배지에 표시한다.");
          }
        }
      } catch {
        // 컴패니언이 잠깐 꺼져도 delivery/settlement intent를 버리지 않는다.
      }
    }, RENEW_MS);
    return () => window.clearInterval(timer);
  }, [clearSession, enabled, setReady]);

  useEffect(() => {
    const hasPending = Boolean(
      pendingRejectRef.current || pendingAcceptRef.current || pendingReleaseRef.current
    );
    if (enabled || readyRef.current || hasPending || !sessionRef.current) return;
    const session = sessionRef.current;
    clearSession();
    void clientRef.current
      .releaseSession(session.sessionId, session.fence, { keepalive: true })
      .catch(() => {});
  }, [clearSession, enabled]);

  useEffect(() => () => {
    const session = sessionRef.current;
    const hasPending = Boolean(
      pendingRejectRef.current || pendingAcceptRef.current || pendingReleaseRef.current
    );
    if (!session || readyRef.current || hasPending) return;
    void clientRef.current
      .releaseSession(session.sessionId, session.fence, { keepalive: true })
      .catch(() => {});
  }, []);

  return {
    ready,
    notice,
    dismissNotice: () => setNotice(""),
    releaseReady,
    acceptReady,
    rejectReady,
  };
}
