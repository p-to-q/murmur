"use client";
import { motion } from "framer-motion";
import { useTranslator } from "@/lib/i18n";
import { SCENES, type Scene } from "./scene-presets";

export interface SceneGridProps {
  onPick: (scene: Scene) => void;
  className?: string;
}

export function SceneGrid({ onPick, className = "" }: SceneGridProps) {
  const t = useTranslator();
  return (
    <div className={className}>
      <div className="flex flex-wrap gap-2">
        {SCENES.map((scene) => (
          <motion.button
            key={scene.id}
            whileTap={{ scale: 0.94 }}
            onClick={() => onPick(scene)}
            className="group relative flex items-center gap-2 rounded-full border border-[#E5DDD0] bg-white/60 px-4 py-2 text-left transition-colors hover:border-[#FF5924]"
          >
            {/* Accent dot */}
            <span
              className="h-2 w-2 rounded-full flex-shrink-0"
              style={{ background: scene.accent }}
            />
            <span className="text-[12px] font-medium text-[#1A1A1A]">
              {t(scene.labelKey)}
            </span>
            <span className="text-[10px] text-[#B6B0A4]">
              {t(scene.descKey)}
            </span>
          </motion.button>
        ))}
      </div>
    </div>
  );
}
