"use client";

import { useEffect, useState } from "react";
import { WifiOff } from "lucide-react";
import type { ConnectionState } from "@/hooks/use-event-stream";
import { cn } from "@/lib/utils";

const label: Record<ConnectionState, string> = { connecting: "Connecting…", live: "Live", stale: "Reconnecting", offline: "Offline" };

export function ConnectionPill({ state, className }: { state: ConnectionState; className?: string }) {
  return (
    <span
      role="status"
      aria-live="polite"
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold",
        state === "live" ? "bg-ok-600 text-white" : state === "connecting" ? "bg-white/15 text-current" : "bg-danger-600 text-white",
        className,
      )}
    >
      <span className={cn("size-2 rounded-full", state === "live" ? "bg-white" : "bg-white/70", state !== "live" && "animate-pulse")} aria-hidden />
      {label[state]}
    </span>
  );
}

/** Full-width warning when live updates are not arriving (BRD: "visible stale-connection warning"). */
export function StaleBanner({ state, lastBeat }: { state: ConnectionState; lastBeat: number | null }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  if (state === "live" || state === "connecting") return null;
  const ago = lastBeat ? Math.round((now - lastBeat) / 1000) : null;
  return (
    <div role="alert" className="flex items-center gap-3 bg-danger-600 px-4 py-2.5 text-sm font-semibold text-white">
      <WifiOff className="size-5 shrink-0" aria-hidden />
      <span>
        {state === "offline" ? "You are offline." : "Connection lost."} Showing the last known state{ago !== null ? ` from ${ago}s ago` : ""}. The queue will
        reload from the server when the connection returns.
      </span>
    </div>
  );
}
