"use client";

import Image from "next/image";
import { useState } from "react";
import { motion } from "framer-motion";

export function MurmurMark({
  size = 39,
  showWord = true,
}: {
  size?: number;
  showWord?: boolean;
}) {
  const [burst, setBurst] = useState(false);

  const triggerBurst = () => {
    setBurst(true);
    window.setTimeout(() => setBurst(false), 520);
  };

  const width = Math.round(size * 4.28);
  const height = Math.round(size * 1.62);

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
        <motion.span
          initial={false}
          animate={
            burst
              ? { y: [0, -0.8, 0], scale: [1, 1.006, 1] }
              : { y: 0, scale: 1 }
          }
          transition={{ duration: 0.38, ease: [0.22, 1, 0.36, 1] }}
          className="relative block"
          style={{ width, height }}
          aria-hidden="true"
        >
          <Image
            src="/brand/murmur-wordmark-source.png"
            alt=""
            fill
            sizes={`${width}px`}
            className="object-contain drop-shadow-[0_6px_16px_rgba(26,26,26,0.12)]"
            priority
          />
        </motion.span>
      ) : null}
    </button>
  );
}
