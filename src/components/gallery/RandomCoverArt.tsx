"use client";

/**
 * RandomCoverArt — 使用 Python 脚本生成的 Aurora 风格封面
 *
 * 每次生成不同的颜色、blob 位置、大小都随机化
 * 基于 generate-app-icon.py 的逻辑
 */

import { useState, useEffect, useMemo } from "react";

export interface RandomCoverArtProps {
  /** Song ID - 用于生成唯一但随机的封面 */
  songId: string;
  className?: string;
  size?: number;
}

export function RandomCoverArt({ songId, className, size = 400 }: RandomCoverArtProps) {
  // Generate cover URL with song ID as seed
  const imageUrl = useMemo(
    () => `/api/cover/generate?seed=${encodeURIComponent(songId)}&size=${size}`,
    [songId, size]
  );

  return <RandomCoverArtInner key={imageUrl} imageUrl={imageUrl} className={className} />;
}

function RandomCoverArtInner({ imageUrl, className }: { imageUrl: string; className?: string }) {
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let isCancelled = false;

    // Start loading
    const img = new Image();
    const handleLoad = () => {
      if (!isCancelled) setIsLoading(false);
    };
    const handleError = () => {
      if (!isCancelled) setIsLoading(false);
    };

    img.addEventListener('load', handleLoad);
    img.addEventListener('error', handleError);
    img.src = imageUrl;

    return () => {
      isCancelled = true;
      img.removeEventListener('load', handleLoad);
      img.removeEventListener('error', handleError);
    };
  }, [imageUrl]);

  return (
    <div className={className} style={{ position: "relative", overflow: "hidden" }}>
      {isLoading && (
        <div className="absolute inset-0 bg-gradient-to-r from-[#ECE5D6] via-[#F5F1EB] to-[#ECE5D6] animate-shimmer" />
      )}
      <img
        src={imageUrl}
        alt=""
        className="w-full h-full object-cover"
        style={{ opacity: isLoading ? 0 : 1, transition: "opacity 0.3s" }}
      />
    </div>
  );
}
