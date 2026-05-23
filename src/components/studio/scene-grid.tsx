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
      className="bg-[#FFFDF8] rounded-2xl p-5"
      style={{ boxShadow: "0 2px 12px rgba(34,48,58,0.06)" }}
    >
      <p className="text-[#8B8680] text-xs font-medium tracking-wider uppercase mb-3">
        {t("studio.scenes")}
      </p>
      <div className="grid grid-cols-2 gap-2.5">
        {SCENES.map((scene) => (
          <motion.button
            key={scene.id}
            whileTap={{ scale: 0.94 }}
            onClick={() => onPick(scene)}
            className="flex flex-col items-start px-4 py-3 rounded-2xl bg-[#F7F3EA] border border-[#E8E2D9] hover:border-[#E9A06D] transition-colors text-left"
          >
            <p className="text-[#22303A] text-sm font-medium">{t(scene.labelKey)}</p>
            <p className="text-[#8B8680] text-[11px] mt-0.5">{t(scene.descKey)}</p>
          </motion.button>
        ))}
      </div>
    </div>
  );
}
