"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";

const CELL_COLORS = [
  "#E8E2D8",
  "#F5D4B8",
  "#FFBA8A",
  "#FF8A5C",
  "#FF5924",
];

const CELL_SIZE = 11;
const CELL_GAP = 3;
const CELL_RADIUS = 3;
const STRIDE = CELL_SIZE + CELL_GAP;

interface DayCell {
  date: Date;
  level: number;
}

export interface ActivityHeatmapProps {
  dates: string[];
  songCount?: number;
  title?: string;
  className?: string;
}

export function ActivityHeatmap({
  dates,
  songCount = 0,
  title,
  className = "",
}: ActivityHeatmapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [numWeeks, setNumWeeks] = useState(20);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const measure = () => {
      const cols = Math.floor((el.offsetWidth + CELL_GAP) / STRIDE);
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

  return (
    <div className={className}>
      <div ref={containerRef}>
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.12, duration: 0.5 }}
          className="flex"
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
                        ? `0 0 5px ${CELL_COLORS[day.level]}35`
                        : undefined,
                    transition: "background 0.2s ease",
                  }}
                />
              ))}
            </div>
          ))}
        </motion.div>

        {/* Month labels */}
        <div className="relative mt-1.5" style={{ height: 16 }}>
          {months.map(({ label, col }) => (
            <span
              key={`${label}-${col}`}
              className="absolute text-[10px] tracking-[0.04em] text-[#B7AEA1]"
              style={{ left: col * STRIDE }}
            >
              {label}
            </span>
          ))}
        </div>

        {/* Summary row — title left, legend right, top-aligned */}
        <div className="flex items-start justify-between mt-1.5">
          {title ? (
            <h1 className="hero-serif-italic text-[#1A1A1A] text-[40px] leading-[1.0] md:text-[64px] -mb-1">
              {title}
            </h1>
          ) : (
            <span className="font-serif-italic text-[11px] text-[#8C8780]">
              {songCount > 0 ? `${songCount} song${songCount === 1 ? "" : "s"}` : ""}
            </span>
          )}

          {/* Legend */}
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] text-[#B7AEA1] mr-0.5">Less</span>
            {CELL_COLORS.map((color, i) => (
              <div
                key={i}
                style={{
                  width: 9,
                  height: 9,
                  borderRadius: 2,
                  background: color,
                }}
              />
            ))}
            <span className="text-[10px] text-[#B7AEA1] ml-0.5">More</span>
          </div>
        </div>
      </div>
    </div>
  );
}
