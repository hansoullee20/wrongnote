import { useCallback, useEffect, useRef, useState } from "react";
import { parseAiImport } from "./aiBridge.js";
import { createCompanionClient, newCompanionSessionId } from "./companionClient.js";

const POLL_MS = 4_000;
const RENEW_MS = 20_000;

const terminalOwnershipStatus = new Set(["no_session", "not_owner", "stale_fence"]);

function parseFailureReason(err) {
  const message = err?.message ? String(err.message) : "unknown AI import error";
  return `Wrongnote parseAiImport rejected the queued payload: ${message}`;
}

export function useCompanionInbox({ enabled, client: clientOverride } = {}) {
  const clientRef = useRef(clientOverride || createCompanionClient());
  const sessionIdRef = useRef(newCompanionSessionId());
  const sessionRef = useRef(null);
  const readyRef = useRef(null);
  const pendingRejectRef = useRef(null);
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

  const settlePending = useCallback(async (pending) => {
    const session = sessionRef.current;
    if (!session || session.fence !== pending.fence) return false;
    try {
      const result = await clientRef.current.settle(
        session.sessionId,
        session.fence,
        pending.receipt,
        pending.outcome,
        pending.error ? { error: pending.error } : undefined
      );
      if (["released", "rejected", "already_settled"].includes(result.status)) return true;
      if (terminalOwnershipStatus.has(result.status)) {
        clearSession();
        return true;
      }
      return false;
    } catch (err) {
      if (err?.code === "companion_unavailable") return false;
      return false;
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
    const settled = await settlePending(pending);
    if (settled) pendingRejectRef.current = null;
    if (aliveRef.current) {
      setNotice(
        settled
          ? "AI 분석 JSON이 Wrongnote 검증을 통과하지 못해 격리했다."
          : "AI 분석 JSON 검증 실패 — 격리 상태를 로컬 컴패니언에 기록하는 중이다."
      );
    }
  }, [settlePending]);

  const acquireIfNeeded = useCallback(async () => {
    if (sessionRef.current) return sessionRef.current;
    let result;
    try {
      result = await clientRef.current.acquireSession(sessionIdRef.current);
    } catch (err) {
      if (err?.code === "companion_unavailable") return null;
      return null;
    }
    if (["acquired", "already_acquired"].includes(result.status)) {
      const session = {
        sessionId: sessionIdRef.current,
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
        if (await settlePending(pendingRejectRef.current)) {
          pendingRejectRef.current = null;
          if (aliveRef.current) setNotice("AI 분석 JSON이 Wrongnote 검증을 통과하지 못해 격리했다.");
        }
        return;
      }
      if (pendingReleaseRef.current) {
        if (await settlePending(pendingReleaseRef.current)) pendingReleaseRef.current = null;
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
    const settled = await settlePending(pending);
    if (settled) pendingReleaseRef.current = null;
    return settled;
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
      if (!session || (!readyRef.current && !enabled)) return;
      try {
        const result = await clientRef.current.renewSession(session.sessionId, session.fence);
        if (result.status === "renewed") {
          session.expiresAt = result.expiresAt;
        } else if (terminalOwnershipStatus.has(result.status)) {
          clearSession();
          if (readyRef.current) {
            setReady(null);
            if (aliveRef.current) setNotice("AI 분석 소유권이 다른 탭으로 넘어갔다. 다시 도착하면 배지에 표시한다.");
          }
        }
      } catch {
        // 컴패니언이 잠깐 꺼져도 delivery를 버리지 않는다. 같은 receipt로
        // settle을 재시도할 수 있어야 하므로 네트워크 실패는 조용히 둔다.
      }
    }, RENEW_MS);
    return () => window.clearInterval(timer);
  }, [clearSession, enabled, setReady]);

  useEffect(() => {
    if (enabled || readyRef.current || !sessionRef.current) return;
    const session = sessionRef.current;
    clearSession();
    void clientRef.current
      .releaseSession(session.sessionId, session.fence, { keepalive: true })
      .catch(() => {});
  }, [clearSession, enabled]);

  useEffect(() => () => {
    const session = sessionRef.current;
    if (!session || readyRef.current) return;
    void clientRef.current
      .releaseSession(session.sessionId, session.fence, { keepalive: true })
      .catch(() => {});
  }, []);

  return {
    ready,
    notice,
    dismissNotice: () => setNotice(""),
    releaseReady,
  };
}
