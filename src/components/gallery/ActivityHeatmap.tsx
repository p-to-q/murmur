"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { SongCard } from "./SongCard";
import type { VisualArtwork } from "@/modules/shared/types";

const CELL_COLORS = [
  "#E8E2D8",
  "#F5D4B8",
  "#FFBA8A",
  "#FF8A5C",
  "#FF5924",
];

// Mobile: smaller cells
const CELL_SIZE_MOBILE = 11;
const CELL_GAP_MOBILE = 3;
const CELL_RADIUS_MOBILE = 3;

// Desktop: larger cells
const CELL_SIZE_DESKTOP = 18;
const CELL_GAP_DESKTOP = 5;
const CELL_RADIUS_DESKTOP = 4;

interface DayCell {
  date: Date;
  level: number;
}

export interface ActivityHeatmapProps {
  dates: string[];
  songCount?: number;
  title?: string;
  className?: string;
  recentSongs?: Array<{
    id: string;
    title: string;
    vibe: string;
    gradient?: string;
    artwork?: VisualArtwork;
    bpm?: number;
    createdAt: string;
  }>;
  onSongClick?: (id: string) => void;
}

export function ActivityHeatmap({
  dates,
  songCount = 0,
  title,
  className = "",
  recentSongs = [],
  onSongClick,
}: ActivityHeatmapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [numWeeks, setNumWeeks] = useState(20);
  const [isDesktop, setIsDesktop] = useState(false);

  // Responsive cell sizing
  const CELL_SIZE = isDesktop ? CELL_SIZE_DESKTOP : CELL_SIZE_MOBILE;
  const CELL_GAP = isDesktop ? CELL_GAP_DESKTOP : CELL_GAP_MOBILE;
  const CELL_RADIUS = isDesktop ? CELL_RADIUS_DESKTOP : CELL_RADIUS_MOBILE;
  const STRIDE = CELL_SIZE + CELL_GAP;

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const measure = () => {
      const containerWidth = el.offsetWidth;
      const desktop = containerWidth >= 768; // md breakpoint
      setIsDesktop(desktop);

      const stride = desktop
        ? CELL_SIZE_DESKTOP + CELL_GAP_DESKTOP
        : CELL_SIZE_MOBILE + CELL_GAP_MOBILE;

      const cols = Math.floor((containerWidth + (desktop ? CELL_GAP_DESKTOP : CELL_GAP_MOBILE)) / stride);
      setNumWeeks(Math.max(8, Math.min(52, cols)));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const countMap = useMemo(() => {
    const m = new Map<string, number>();
    for (const d of dates) {
      const key = d.slice(0, 10);
      m.set(key, (m.get(key) ?? 0) + 1);
    }
    return m;
  }, [dates]);

  const { weeks, months } = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const dow = today.getDay();
    const mondayOffset = dow === 0 ? 6 : dow - 1;
    const thisMonday = new Date(today);
    thisMonday.setDate(today.getDate() - mondayOffset);

    const result: DayCell[][] = [];
    const monthLabels: { label: string; col: number }[] = [];
    let lastMonth = -1;

    for (let w = numWeeks - 1; w >= 0; w--) {
      const week: DayCell[] = [];
      for (let d = 0; d < 7; d++) {
        const date = new Date(thisMonday);
        date.setDate(thisMonday.getDate() - w * 7 + d);

        if (date > today) {
          week.push({ date, level: -1 });
        } else {
          const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
          const count = countMap.get(key) ?? 0;
          week.push({ date, level: count === 0 ? 0 : Math.min(4, count) });
        }
      }

      const firstDay = week[0].date;
      const monthIdx = firstDay.getMonth();
      if (monthIdx !== lastMonth) {
        const colIndex = numWeeks - 1 - w;
        if (monthLabels.length === 0 || colIndex - monthLabels[monthLabels.length - 1].col >= 3) {
          monthLabels.push({
            label: firstDay.toLocaleDateString("en", { month: "short" }),
            col: colIndex,
          });
        }
        lastMonth = monthIdx;
      }

      result.push(week);
    }

    return { weeks: result, months: monthLabels };
  }, [numWeeks, countMap]);

  const gridHeight = 7 * CELL_SIZE + 6 * CELL_GAP;

  // Pick top 2-3 recent songs
  const displaySongs = recentSongs.slice(0, isDesktop ? 3 : 2);

  const isEmpty = songCount === 0;

  return (
    <div className={className}>
      <div ref={containerRef}>
        {/* ── Heatmap grid (hidden when no real songs) ──────────────────── */}
        {!isEmpty && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.12, duration: 0.5 }}
              className="flex justify-between w-full"
              style={{ gap: CELL_GAP, height: gridHeight }}
            >
              {weeks.map((week, wi) => (
                <div key={wi} className="flex flex-col" style={{ gap: CELL_GAP }}>
                  {week.map((day, di) => (
                    <div
                      key={di}
                      style={{
                        width: CELL_SIZE,
                        height: CELL_SIZE,
                        borderRadius: CELL_RADIUS,
                        background:
                          day.level < 0 ? "transparent" : CELL_COLORS[day.level],
                        boxShadow:
                          day.level >= 3
                            ? `0 0 ${isDesktop ? 6 : 5}px ${CELL_COLORS[day.level]}35`
                            : undefined,
                        transition: "background 0.2s ease",
                      }}
                    />
                  ))}
                </div>
              ))}
            </motion.div>

            {/* ── Month labels ───────────────────────────────────────────── */}
            <div className="relative mt-2 md:mt-2.5" style={{ height: isDesktop ? 18 : 16 }}>
              {months.map(({ label, col }) => (
                <span
                  key={`${label}-${col}`}
                  className="absolute text-[10px] md:text-[11px] tracking-[0.04em] text-[#B7AEA1]"
                  style={{ left: col * STRIDE }}
                >
                  {label}
                </span>
              ))}
            </div>
          </>
        )}

        {/* ── Title + Legend row ─────────────────────────────────────────── */}
        <div className={`flex items-start justify-between ${isEmpty ? "mb-4 md:mb-6" : "mt-3 md:mt-4 mb-6 md:mb-8"}`}>
          {title ? (
            <h1 className="hero-serif-italic text-[#1A1A1A] text-[40px] leading-[1.0] md:text-[72px] lg:text-[84px] -mb-1">
              {title}
            </h1>
          ) : (
            <span className="font-serif-italic text-[11px] md:text-[13px] text-[#8C8780]">
              {songCount > 0 ? `${songCount} song${songCount === 1 ? "" : "s"}` : ""}
            </span>
          )}

          {/* Legend — hidden when no real songs */}
          {!isEmpty && (
            <div className="flex items-center gap-1.5 md:gap-2.5 shrink-0">
              <span className="text-[10px] md:text-[12px] text-[#B7AEA1] mr-0.5 md:mr-1">Less</span>
              {CELL_COLORS.map((color, i) => (
                <div
                  key={i}
                  style={{
                    width: isDesktop ? 14 : 9,
                    height: isDesktop ? 14 : 9,
                    borderRadius: isDesktop ? 3 : 2,
                    background: color,
                  }}
                />
              ))}
              <span className="text-[10px] md:text-[12px] text-[#B7AEA1] ml-0.5 md:ml-1">More</span>
            </div>
          )}
        </div>

        {/* ── Recent songs showcase ──────────────────────────────────────── */}
        {displaySongs.length > 0 && !displaySongs[0]?.id.startsWith("demo-") && (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3, duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
          >
            <div className="mb-4 md:mb-5">
              <p className="text-[11px] md:text-[12px] uppercase tracking-[0.16em] text-[#B7AEA1]">
                Recent
              </p>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4 md:gap-5">
              {displaySongs.map((song, i) => (
                <SongCard
                  key={song.id}
                  id={song.id}
                  title={song.title}
                  vibe={song.vibe}
                  gradient={song.gradient}
                  artwork={song.artwork}
                  bpm={song.bpm}
                  createdAt={song.createdAt}
                  index={i}
                  onClick={() => onSongClick?.(song.id)}
                />
              ))}
            </div>
          </motion.div>
        )}
      </div>
    </div>
  );
}
