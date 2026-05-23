"use client";
/**
 * MurmurMark — the brand mark. Coral hum-wave dot + serif wordmark.
 *
 * The wordmark is set in Instrument Serif italic at a slightly smaller size
 * relative to the dot than v1 — restraint is the point. mymind never lets the
 * mark dominate.
 */
export function MurmurMark({
  size = 26,
  showWord = true,
}: {
  size?: number;
  showWord?: boolean;
}) {
  return (
    <div className="flex items-center gap-2.5 select-none">
      <svg
        width={size}
        height={size}
        viewBox="0 0 32 32"
        fill="none"
        aria-hidden
      >
        <defs>
          <linearGradient id="murmur-mark-grad" x1="0" y1="0" x2="32" y2="32">
            <stop offset="0%" stopColor="#FF8A5C" />
            <stop offset="100%" stopColor="#FF5924" />
          </linearGradient>
        </defs>
        <circle cx="16" cy="16" r="14" fill="url(#murmur-mark-grad)" />
        <path
          d="M7 17 C 10 13, 12 13, 14 17 S 18 21, 20 17 S 24 13, 26 17"
          stroke="#FFFEFB"
          strokeWidth="2.2"
          strokeLinecap="round"
          fill="none"
        />
      </svg>
      {showWord ? (
        <span
          className="font-serif-italic text-[#1A1A1A]"
          style={{ fontSize: Math.round(size * 0.62) }}
        >
          murmur
        </span>
      ) : null}
    </div>
  );
}
