"use client";

import Image from "next/image";
import { useState } from "react";
import { motion } from "framer-motion";

const WORDMARK_SOURCE_WIDTH = 1320;
const WORDMARK_SOURCE_HEIGHT = 300;

export function MurmurMark({
  as = "span",
  size = 39,
  showWord = true,
  yOffset = 0,
  className = "",
  imageClassName = "",
}: {
  as?: "button" | "span";
  size?: number;
  showWord?: boolean;
  yOffset?: number;
  className?: string;
  imageClassName?: string;
}) {
  const [burst, setBurst] = useState(false);

  const triggerBurst = () => {
    setBurst(true);
    window.setTimeout(() => setBurst(false), 520);
  };

  const width = Math.round(size * 4.4);
  const height = size;
  const MarkRoot = as;
  const rootProps =
    as === "button"
      ? {
          type: "button" as const,
          onFocus: () => setBurst(true),
          onBlur: () => setBurst(false),
          onClick: triggerBurst,
          "aria-label": "MURMUR",
        }
      : { "aria-hidden": true };

  return (
    <MarkRoot
      {...rootProps}
      onMouseEnter={() => setBurst(true)}
      onMouseLeave={() => setBurst(false)}
      className={`inline-flex items-center bg-transparent p-0 text-left select-none ${className}`.trim()}
      style={{ transformOrigin: "left center" }}
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
            src="/brand/murmur-wordmark-source-cropped.png"
            alt=""
            width={WORDMARK_SOURCE_WIDTH}
            height={WORDMARK_SOURCE_HEIGHT}
            sizes={`${width}px`}
            className={`h-full w-full object-contain drop-shadow-[0_8px_18px_rgba(26,26,26,0.1)] ${imageClassName}`.trim()}
            style={{ transform: `translateY(${yOffset}px)`, width: "100%", height: "100%" }}
            priority
          />
        </motion.span>
      ) : null}
    </MarkRoot>
  );
}
