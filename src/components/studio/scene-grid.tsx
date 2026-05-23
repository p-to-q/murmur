"use client";
import { motion } from "framer-motion";
import { useTranslator } from "@/lib/i18n";
import { SCENES, type Scene } from "./scene-presets";
import { SceneParticles } from "./scene-particles";

export interface SceneGridProps {
  onPick: (scene: Scene) => void;
}

export function SceneGrid({ onPick }: SceneGridProps) {
  const t = useTranslator();
  return (
    <div
      className="rounded-[28px] border border-[#E9E1D4] bg-[linear-gradient(180deg,rgba(255,254,251,0.98),rgba(247,241,232,0.98))] p-5 shadow-[0_16px_42px_rgba(26,26,26,0.05)] md:p-6"
    >
      <p className="eyebrow mb-2 text-[#FF8A5C]">
        {t("studio.scenes")}
      </p>
      <h3 className="font-serif text-[24px] leading-[1.02] text-[#1A1A1A] md:text-[30px]">
        {t("studio.mood.title")}
      </h3>
      <p className="mt-3 max-w-[34rem] text-[13px] leading-[1.6] text-[#6F6A63] md:text-[14px]">
        {t("studio.mood.sub")}
      </p>
      <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-5">
        {SCENES.map((scene, i) => (
          <motion.button
            key={scene.id}
            whileTap={{ scale: 0.94 }}
            onClick={() => onPick(scene)}
            className="group relative isolate flex min-h-[128px] flex-col items-start justify-between overflow-hidden rounded-[22px] border border-[#E7DECF] bg-[#FFFCF7] px-4 py-4 text-left transition-colors hover:border-[#FF8A5C]"
          >
            {/* Diffusing particles in the bottom half of the card */}
            <SceneParticles color={scene.accent} seed={i * 17 + 3} />

            <span className="relative z-10 text-[10px] uppercase tracking-[0.22em] text-[#B7AEA1]">
              Mood
            </span>
            <div className="relative z-10">
              <p className="text-[15px] font-medium text-[#1A1A1A]">
                {t(scene.labelKey)}
              </p>
              <p className="mt-1 text-[11px] leading-[1.5] text-[#8C8780]">
                {t(scene.descKey)}
              </p>
            </div>
          </motion.button>
        ))}
      </div>
    </div>
  );
}
