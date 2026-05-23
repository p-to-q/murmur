"use client";
import { motion } from "framer-motion";
import { useTranslator } from "@/lib/i18n";
import { SCENES, type Scene } from "./scene-presets";

export interface SceneGridProps {
  onPick: (scene: Scene) => void;
}

export function SceneGrid({ onPick }: SceneGridProps) {
  const t = useTranslator();
  return (
    <div
      className="bg-[#FFFEFB] rounded-2xl p-5"
      style={{ boxShadow: "0 2px 12px rgba(26, 26, 26,0.06)" }}
    >
      <p className="text-[#8C8780] text-xs font-medium tracking-wider uppercase mb-3">
        {t("studio.scenes")}
      </p>
      <div className="grid grid-cols-2 gap-2.5">
        {SCENES.map((scene) => (
          <motion.button
            key={scene.id}
            whileTap={{ scale: 0.94 }}
            onClick={() => onPick(scene)}
            className="flex flex-col items-start px-4 py-3 rounded-2xl bg-[#F5F1EB] border border-[#E5DDD0] hover:border-[#FF5924] transition-colors text-left"
          >
            <p className="text-[#1A1A1A] text-sm font-medium">{t(scene.labelKey)}</p>
            <p className="text-[#8C8780] text-[11px] mt-0.5">{t(scene.descKey)}</p>
          </motion.button>
        ))}
      </div>
    </div>
  );
}
