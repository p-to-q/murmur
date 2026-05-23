"use client";

import { useEffect, useId, useState } from "react";
import { motion } from "framer-motion";

export function MurmurMark({
  size = 39,
  showWord = true,
}: {
  size?: number;
  showWord?: boolean;
}) {
  const [burst, setBurst] = useState(false);
  const filterId = useId();

  useEffect(() => {
    const href = document.getElementById("murmur-vt323-font");
    if (href) return;
    const link = document.createElement("link");
    link.id = "murmur-vt323-font";
    link.rel = "stylesheet";
    link.href =
      "https://fonts.googleapis.com/css2?family=VT323&display=swap";
    document.head.appendChild(link);
  }, []);

  const triggerBurst = () => {
    setBurst(true);
    window.setTimeout(() => setBurst(false), 520);
  };

  return (
    <button
      type="button"
      onMouseEnter={() => setBurst(true)}
      onMouseLeave={() => setBurst(false)}
      onFocus={() => setBurst(true)}
      onBlur={() => setBurst(false)}
      onClick={triggerBurst}
      className="inline-flex items-center bg-transparent p-0 text-left select-none"
      style={{ transformOrigin: "left center" }}
      aria-label="MURMUR"
    >
      {showWord ? (
        <motion.svg
          width={Math.round(size * 5.05)}
          height={Math.round(size * 1.42)}
          viewBox="0 0 420 96"
          fill="none"
          aria-hidden="true"
          initial={false}
          animate={
            burst
              ? {
                  y: [0, -0.8, 0],
                  scale: [1, 1.006, 1],
                }
              : {
                  y: 0,
                  scale: 1,
                }
          }
          transition={{ duration: 0.38, ease: [0.22, 1, 0.36, 1] }}
          className="overflow-visible"
        >
          <defs>
            <filter
              id={filterId}
              x="-8%"
              y="-24%"
              width="116%"
              height="148%"
              colorInterpolationFilters="sRGB"
            >
              <feOffset dx="0" dy="0.45" result="shadowOffset" />
              <feGaussianBlur in="shadowOffset" stdDeviation="0.4" result="shadowBlur" />
              <feColorMatrix
                in="shadowBlur"
                type="matrix"
                values="0 0 0 0 0.96 0 0 0 0 0.92 0 0 0 0 0.85 0 0 0 0.8 0"
                result="shadowColor"
              />
              <feMerge>
                <feMergeNode in="shadowColor" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>

          <motion.text
            x="0"
            y="69"
            fill="#111111"
            style={{
              fontFamily: '"VT323", "Courier New", monospace',
              fontSize: 78,
              letterSpacing: "12.76px",
            }}
            filter={`url(#${filterId})`}
            animate={
              burst
                ? {
                    opacity: [1, 0.98, 1],
                    letterSpacing: ["12.76px", "13.5px", "12.76px"],
                  }
                : { opacity: 1, letterSpacing: "12.76px" }
            }
            transition={{ duration: 0.34, ease: [0.22, 1, 0.36, 1] }}
          >
            MURMUR
          </motion.text>
        </motion.svg>
      ) : null}
    </button>
  );
}
