"use client";
/**
 * MurmurMark — brand mark. A soft hum wave inside a coral dot, paired with
 * the wordmark in Lora serif for an mymind-leaning private-calm feel.
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
            <stop offset="0%" stopColor="#F4C87A" />
            <stop offset="100%" stopColor="#E9A06D" />
          </linearGradient>
        </defs>
        <circle cx="16" cy="16" r="14" fill="url(#murmur-mark-grad)" />
        <path
          d="M7 17 C 10 13, 12 13, 14 17 S 18 21, 20 17 S 24 13, 26 17"
          stroke="white"
          strokeWidth="2.2"
          strokeLinecap="round"
          fill="none"
          opacity="0.95"
        />
      </svg>
      {showWord ? (
        <span
          className="font-serif text-[#22303A] tracking-[0.22em] font-semibold"
          style={{ fontSize: 14, fontStyle: "italic" }}
        >
          murmur
        </span>
      ) : null}
    </div>
  );
}
