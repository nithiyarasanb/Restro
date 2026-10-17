"use client";

import { useEffect, useRef, useState } from "react";

// SSE subscription with a visible connection state (FR-08, NT-7).
// - "live": heartbeats arriving
// - "stale": heartbeats missed — UI must warn that data may be out of date
// - "offline": the browser reports no network
// On every (re)connect onReconnect() runs so callers refetch the
// authoritative snapshot; duplicate events are dropped by id.

export type ConnectionState = "connecting" | "live" | "stale" | "offline";

export interface StreamMessage {
  eventId: string;
  type: string;
  orderId: string | null;
  payload: Record<string, unknown>;
  at: string;
}

export function useEventStream(url: string | null, handlers: { onMessage?: (m: StreamMessage) => void; onReconnect?: () => void }) {
  const [state, setState] = useState<ConnectionState>("connecting");
  const [lastBeat, setLastBeat] = useState<number | null>(null);
  const handlersRef = useRef(handlers);
  useEffect(() => {
    handlersRef.current = handlers;
  });

  useEffect(() => {
    if (!url) return;
    const seen = new Set<string>();
    let last = Date.now();
    let opened = false;
    const source = new EventSource(url, { withCredentials: true });
    const beat = () => {
      last = Date.now();
      setLastBeat(last);
      setState(navigator.onLine ? "live" : "offline");
    };
    source.addEventListener("ready", () => {
      beat();
      // First open and every reconnect: reload the source of truth.
      if (opened) handlersRef.current.onReconnect?.();
      opened = true;
    });
    source.addEventListener("heartbeat", beat);
    source.addEventListener("message", (e) => {
      beat();
      try {
        const m = JSON.parse((e as MessageEvent<string>).data) as StreamMessage;
        if (seen.has(m.eventId)) return;
        seen.add(m.eventId);
        if (seen.size > 500) seen.clear();
        handlersRef.current.onMessage?.(m);
      } catch {
        /* ignore malformed */
      }
    });
    source.onerror = () => setState((s) => (s === "live" ? "stale" : s === "connecting" ? "connecting" : "stale"));
    const watchdog = setInterval(() => {
      if (!navigator.onLine) setState("offline");
      else if (Date.now() - last > 35_000) setState("stale");
    }, 5_000);
    const online = () => setState("connecting");
    const offline = () => setState("offline");
    window.addEventListener("online", online);
    window.addEventListener("offline", offline);
    return () => {
      clearInterval(watchdog);
      window.removeEventListener("online", online);
      window.removeEventListener("offline", offline);
      source.close();
    };
  }, [url]);

  return { state, lastBeat };
}
