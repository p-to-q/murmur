"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { formatHumSupportCode } from "@/lib/observability/support-code";
import type { RecentEvent } from "@/lib/observability/recent-events";

const REFRESH_INTERVAL_MS = 2_000;
const EVENT_FILTERS = [
  "all",
  "transcribe.requested",
  "transcribe.completed",
  "transcribe.failed",
  "capture.failed",
  "capture.prepared",
  "arrangement.generated",
] as const;

type EventFilter = (typeof EVENT_FILTERS)[number];

interface RecentEventsResponse {
  events?: RecentEvent[];
  captured_at?: string;
  error?: string;
}

const LEVEL_COLOR: Record<string, string> = {
  info: "#1A1A1A",
  warn: "#C77800",
  error: "#FF5924",
};

/**
 * `/me/debug` — single-page diagnostic surface for the audio pipeline.
 *
 * Pull-driven: re-fetches `/api/observability/recent-events` every two
 * seconds. Renders the typed-log ring buffer described in
 * `docs/observability.md` §8 — most-recent-first, color-coded by level,
 * with copy-to-clipboard for sharing a single request id during
 * incident triage. Pure read surface; no mutations.
 */
export default function DebugPage() {
  return (
    <Suspense fallback={<DebugPageFallback />}>
      <DebugPageContent />
    </Suspense>
  );
}

function DebugPageContent() {
  const searchParams = useSearchParams();
  const [events, setEvents] = useState<RecentEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [filter, setFilter] = useState<EventFilter>("all");
  const [paused, setPaused] = useState(false);
  const debugEnabled = searchParams.get("debug") === "1";

  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/observability/recent-events", {
        cache: "no-store",
      });
      if (!response.ok) {
        setError(`HTTP ${response.status}`);
        return;
      }
      const data = (await response.json()) as RecentEventsResponse;
      if (data.error) {
        setError(data.error);
        return;
      }
      setEvents(data.events ?? []);
      setUpdatedAt(data.captured_at ?? new Date().toISOString());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "fetch_failed");
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const tick = () => {
      if (cancelled) return;
      void refresh();
    };
    // setTimeout(0) defers the first setState out of the synchronous
    // effect body, sidestepping the cascading-render rule while still
    // hydrating the panel as fast as the browser allows.
    const initial = setTimeout(tick, 0);
    const interval = paused ? null : setInterval(tick, REFRESH_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearTimeout(initial);
      if (interval) clearInterval(interval);
    };
  }, [paused, refresh]);

  const filteredEvents = useMemo(
    () => (filter === "all" ? events : events.filter((e) => e.event === filter)),
    [events, filter],
  );

  const copyAll = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(
        JSON.stringify({ events, captured_at: updatedAt }, null, 2),
      );
    } catch {
      // Clipboard write can fail in some browsers; silent here is fine
      // for an internal-only debug surface.
    }
  }, [events, updatedAt]);

  if (!debugEnabled) {
    return (
      <div className="min-h-svh bg-[#F5F1EB] px-6 py-12 text-[#1A1A1A]">
        <div className="mx-auto max-w-2xl rounded-[18px] border border-[#1A1A1A]/10 bg-white px-6 py-8">
          <p className="text-[10px] uppercase tracking-[0.24em] text-[#8C8780]">
            Murmur / Debug
          </p>
          <h1 className="mt-3 hero-serif text-[28px] leading-tight">
            Hidden by default
          </h1>
          <p className="mt-3 text-[14px] leading-[1.6] text-[#6F6A63]">
            This page is for support and audio investigation. Add
            <span className="mx-1 font-mono text-[13px] text-[#1A1A1A]">
              ?debug=1
            </span>
            when you need the live event stream.
          </p>
          <Link
            href="/me"
            className="mt-5 inline-flex rounded-full border border-[#E7DCCB] px-4 py-2 text-[12px] tracking-[0.06em] text-[#6F6A63] transition-colors hover:border-[#D6C7B0] hover:text-[#1A1A1A]"
          >
            Back to Me
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-svh bg-[#F5F1EB] text-[#1A1A1A]">
      <header className="border-b border-[#1A1A1A]/10 px-6 py-5 flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-[10px] tracking-[0.24em] uppercase text-[#8C8780]">
            Murmur / Debug
          </p>
          <h1 className="hero-serif text-[28px] leading-tight">
            Recent pipeline events
          </h1>
          <p className="text-[12px] text-[#8C8780] mt-1">
            Last {events.length} events ·{" "}
            {updatedAt ? `updated ${formatTime(updatedAt)}` : "loading…"}
            {paused ? " · paused" : ""}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={filter}
            onChange={(event) => setFilter(event.target.value as EventFilter)}
            className="text-[12px] border border-[#1A1A1A]/15 rounded-md px-3 py-1.5 bg-white"
          >
            {EVENT_FILTERS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => setPaused((prev) => !prev)}
            className="text-[12px] border border-[#1A1A1A]/15 rounded-md px-3 py-1.5 bg-white hover:bg-[#EFE8DA]"
          >
            {paused ? "Resume" : "Pause"}
          </button>
          <button
            type="button"
            onClick={() => void refresh()}
            className="text-[12px] border border-[#1A1A1A]/15 rounded-md px-3 py-1.5 bg-white hover:bg-[#EFE8DA]"
          >
            Refresh
          </button>
          <button
            type="button"
            onClick={() => void copyAll()}
            className="text-[12px] border border-[#1A1A1A]/15 rounded-md px-3 py-1.5 bg-white hover:bg-[#EFE8DA]"
          >
            Copy JSON
          </button>
        </div>
      </header>

      <main className="px-6 py-6 max-w-5xl mx-auto">
        {error && (
          <div className="mb-4 rounded-md border border-[#FF5924]/40 bg-[#FFE9DD] px-3 py-2 text-[12px] text-[#7A1F00]">
            Failed to load events: {error}
          </div>
        )}

        {filteredEvents.length === 0 && !error && (
          <div className="rounded-md border border-[#1A1A1A]/10 bg-white px-4 py-6 text-center text-[13px] text-[#8C8780]">
            No events yet. Trigger a hum or fixture run to see entries here.
          </div>
        )}

        <ol className="space-y-2 font-mono text-[12px]">
          {filteredEvents.map((event, idx) => (
            <li
              key={`${event.ts}-${idx}`}
              className="rounded-md border border-[#1A1A1A]/10 bg-white px-4 py-3"
            >
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span
                  className="text-[10px] tracking-[0.15em] uppercase"
                  style={{ color: LEVEL_COLOR[event.level] ?? "#8C8780" }}
                >
                  {event.level}
                </span>
                <span className="text-[#1A1A1A] font-medium">{event.event}</span>
                <span className="text-[#8C8780]">
                  {formatTime(event.ts)}
                </span>
                {event.durationMs !== null && (
                  <span className="text-[#8C8780]">
                    {event.durationMs} ms
                  </span>
                )}
                {event.route && (
                  <span className="text-[#8C8780]">{event.route}</span>
                )}
                {event.requestId && (
                  <span className="text-[#8C8780]">
                    req · {event.requestId.slice(0, 8)}
                  </span>
                )}
                {typeof event.ext.error_code === "string" && (
                  <span className="text-[#8C8780]">
                    code ·{" "}
                    {formatHumSupportCode({
                      code: event.ext.error_code,
                      requestId: event.requestId,
                    })}
                  </span>
                )}
              </div>
              {Object.keys(event.ext).length > 0 && (
                <pre className="mt-2 overflow-x-auto rounded bg-[#F5F1EB] px-2 py-2 text-[11px] leading-relaxed text-[#3A3A3A]">
                  {JSON.stringify(event.ext, null, 2)}
                </pre>
              )}
            </li>
          ))}
        </ol>
      </main>
    </div>
  );
}

function DebugPageFallback() {
  return (
    <div className="min-h-svh bg-[#F5F1EB] px-6 py-12 text-[#1A1A1A]">
      <div className="mx-auto max-w-2xl rounded-[18px] border border-[#1A1A1A]/10 bg-white px-6 py-8">
        <p className="text-[10px] uppercase tracking-[0.24em] text-[#8C8780]">
          Murmur / Debug
        </p>
        <h1 className="mt-3 hero-serif text-[28px] leading-tight">
          Loading debug surface
        </h1>
        <p className="mt-3 text-[14px] leading-[1.6] text-[#6F6A63]">
          Preparing the recent event stream…
        </p>
      </div>
    </div>
  );
}

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString(undefined, {
      hour12: false,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      fractionalSecondDigits: 3,
    });
  } catch {
    return iso;
  }
}
