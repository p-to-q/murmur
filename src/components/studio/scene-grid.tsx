"use client";
import { motion } from "framer-motion";
import { useTranslator } from "@/lib/i18n";
import { SCENES, type Scene } from "./scene-presets";

export interface SceneGridProps {
  onPick: (scene: Scene) => void;
  className?: string;
  /** "dark" = inline glass pills for immersive backgrounds */
  variant?: "default" | "dark";
}

export function SceneGrid({ onPick, className = "", variant = "default" }: SceneGridProps) {
  const t = useTranslator();
  const dark = variant === "dark";

  return (
    <div className={className}>
      <div className="flex flex-wrap gap-2">
        {SCENES.map((scene) => (
          <motion.button
            key={scene.id}
            whileTap={{ scale: 0.94 }}
            onClick={() => onPick(scene)}
            className={
              dark
                ? "group relative flex items-center gap-2 rounded-full border border-white/25 bg-white/8 px-3.5 py-1.5 text-left transition-colors hover:bg-white/16 hover:border-white/40"
                : "group relative flex items-center gap-2 rounded-full border border-[#E5DDD0] bg-white/60 px-4 py-2 text-left transition-colors hover:border-[#FF5924]"
            }
          >
            {/* Accent dot */}
            <span
              className="h-2 w-2 rounded-full flex-shrink-0"
              style={{ background: scene.accent }}
            />
            <span className={
              dark
                ? "text-[11px] font-medium text-white/90"
                : "text-[12px] font-medium text-[#1A1A1A]"
            }>
              {t(scene.labelKey)}
            </span>
          </motion.button>
        ))}
      </div>
    </div>
  );
}
