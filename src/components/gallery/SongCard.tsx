"use client";

/**
 * SongCard — 带酷炫动效的歌曲卡片（Capwords 风格）
 *
 * 特点：
 * - 大封面 + 白边标签
 * - 3D Hover 效果
 * - 弹性入场动画
 * - 懒加载支持
 */

import { useState } from "react";
import { useInView } from "react-intersection-observer";
import { useSpring, animated } from "@react-spring/web";
import { RandomCoverArt } from "./RandomCoverArt";

export interface SongCardProps {
  id: string;
  title: string;
  vibe: string;
  bpm?: number;
  createdAt: string;
  index: number;
  onClick: () => void;
}

export function SongCard({ id, title, vibe, bpm, createdAt, index, onClick }: SongCardProps) {
  const [isHovered, setIsHovered] = useState(false);
  const [isLoaded, setIsLoaded] = useState(false);

  // 懒加载
  const { ref, inView } = useInView({
    threshold: 0.1,
    triggerOnce: true,
  });

  // 入场动画（弹性）
  const entrySpring = useSpring({
    from: {
      opacity: 0,
      y: 30,
      rotateX: 15,
      scale: 0.9,
    },
    to: {
      opacity: inView ? 1 : 0,
      y: inView ? 0 : 30,
      rotateX: inView ? 0 : 15,
      scale: inView ? 1 : 0.9,
    },
    delay: index * 50, // 错开入场
    config: {
      tension: 280,
      friction: 60,
      mass: 0.8,
    },
  });

  // Hover 动画（3D 效果）
  const hoverSpring = useSpring({
    scale: isHovered ? 1.08 : 1,
    rotateX: isHovered ? -2 : 0,
    rotateY: isHovered ? 4 : 0,
    y: isHovered ? -8 : 0,
    shadowBlur: isHovered ? 32 : 12,
    shadowOpacity: isHovered ? 0.25 : 0.12,
    config: {
      tension: 300,
      friction: 25,
    },
  });

  // 标签动画
  const labelSpring = useSpring({
    y: isHovered ? -6 : 0,
    borderColor: isHovered ? "#FF5924" : "#E5DDD0",
    backgroundColor: isHovered ? "#FFF9F5" : "#FFFFFF",
    config: { tension: 400, friction: 30 },
  });

  // 格式化日期
  const timeAgo = formatTimeAgo(createdAt);

  return (
    <animated.div
      ref={ref}
      style={{
        opacity: entrySpring.opacity,
        transform: entrySpring.y.to(y => `translateY(${y}px) perspective(1000px) rotateX(${entrySpring.rotateX.get()}deg) scale(${entrySpring.scale.get()})`),
      }}
      className="relative"
    >
      <animated.button
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        onClick={onClick}
        style={{
          transform: hoverSpring.scale.to((s) =>
            `scale(${s}) perspective(1000px) rotateX(${hoverSpring.rotateX.get()}deg) rotateY(${hoverSpring.rotateY.get()}deg) translateY(${hoverSpring.y.get()}px)`
          ),
          filter: hoverSpring.shadowBlur.to(blur =>
            `drop-shadow(0 ${blur / 2}px ${blur}px rgba(26, 26, 26, ${hoverSpring.shadowOpacity.get()}))`
          ),
        }}
        className="group relative block w-full text-left"
      >
        {/* 封面 */}
        <div className="relative overflow-hidden rounded-[16px] bg-[#F5F1EB]" style={{ aspectRatio: "1" }}>
          {inView ? (
            <div
              className="absolute inset-0"
              style={{
                transform: isLoaded ? "rotate(0deg)" : "rotate(360deg)",
                transition: "transform 1.2s cubic-bezier(0.34, 1.56, 0.64, 1)",
              }}
              onTransitionEnd={() => setIsLoaded(true)}
            >
              <RandomCoverArt songId={id} className="w-full h-full" />
            </div>
          ) : (
            // 骨架屏（shimmer 效果）
            <div className="absolute inset-0 bg-gradient-to-r from-[#ECE5D6] via-[#F5F1EB] to-[#ECE5D6] animate-shimmer" />
          )}
        </div>

        {/* Capwords 风格白边标签 */}
        <animated.div
          style={{
            transform: labelSpring.y.to(y => `translateY(${y}px)`),
            borderColor: labelSpring.borderColor,
            backgroundColor: labelSpring.backgroundColor,
          }}
          className="mt-3 mx-auto w-fit max-w-[90%] rounded-[10px] border-[1.5px] px-3 py-2 shadow-sm"
        >
          <p className="font-serif-italic text-[#1A1A1A] text-[18px] leading-tight truncate">
            {title}
          </p>
        </animated.div>

        {/* 元信息（Hover 时显示更多） */}
        <div className="mt-2 text-center">
          <p className="text-[10px] uppercase tracking-[0.18em] text-[#B7AEA1]">
            {vibe}
            {bpm && ` · ${bpm} BPM`}
          </p>
          <animated.p
            style={{
              opacity: hoverSpring.scale.to(s => (s > 1.02 ? 1 : 0)),
              height: hoverSpring.scale.to(s => (s > 1.02 ? "auto" : 0)),
            }}
            className="mt-1 text-[10px] text-[#8C8780]"
          >
            {timeAgo}
          </animated.p>
        </div>
      </animated.button>
    </animated.div>
  );
}

/* ── Utilities ───────────────────────────────────────────────────────── */

function formatTimeAgo(dateStr: string): string {
  const now = new Date();
  const date = new Date(dateStr);
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays} days ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
  if (diffDays < 365) return `${Math.floor(diffDays / 30)} months ago`;
  return `${Math.floor(diffDays / 365)} years ago`;
}
