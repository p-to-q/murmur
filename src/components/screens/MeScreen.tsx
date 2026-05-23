"use client";
import { useMurmurStore } from "@/lib/store/murmur-store";
import { UserBadge } from "@/components/user-profile/user-badge";
import { useTranslator, useI18nStore } from "@/lib/i18n";

export function MeScreen() {
  const { songs } = useMurmurStore();
  const t = useTranslator();
  const lang = useI18nStore((s) => s.lang);
  const setLang = useI18nStore((s) => s.setLang);

  return (
    <div className="min-h-svh bg-[#F7F3EA]">
      <div
        className="px-6 md:px-10 pb-8 max-w-2xl"
        style={{ paddingTop: "max(env(safe-area-inset-top, 0px), 44px)" }}
      >
        <p className="eyebrow mb-3">PROFILE</p>
        <h1
          className="font-serif-italic text-[#22303A] text-[40px] md:text-[52px] leading-none tracking-[-0.02em]"
          style={{ fontWeight: 500 }}
        >
          {t("me.title")}
        </h1>
      </div>

      <div className="px-5 md:px-10 max-w-2xl mb-5">
        <Card>
          <UserBadge />
        </Card>
      </div>

      <div className="px-5 md:px-10 max-w-2xl mb-5">
        <Card>
          <SectionLabel>{t("me.stats.title")}</SectionLabel>
          <div className="grid grid-cols-3 gap-4 text-center">
            <Stat value={songs.length} label={t("me.stats.songs")} />
            <Stat value={6} label={t("me.stats.vibes")} />
            <Stat value={"∞"} label={t("me.stats.melodies")} />
          </div>
        </Card>
      </div>

      <div className="px-5 md:px-10 max-w-2xl mb-5">
        <Card>
          <SectionLabel>{t("me.language.title")}</SectionLabel>
          <div className="flex gap-2">
            <LangPill
              active={lang === "zh"}
              onClick={() => setLang("zh")}
              label={t("me.language.zh")}
            />
            <LangPill
              active={lang === "en"}
              onClick={() => setLang("en")}
              label={t("me.language.en")}
            />
          </div>
        </Card>
      </div>

      <div className="px-5 md:px-10 max-w-2xl mb-5">
        <Card>
          <SectionLabel>{t("me.status.title")}</SectionLabel>
          <div className="space-y-2.5">
            <StatusRow
              label={t("me.status.transcribe")}
              value={
                process.env.NEXT_PUBLIC_TRANSCRIPTION_PROVIDER ?? "browser-yin"
              }
              ok
            />
            <StatusRow label={t("me.status.arrange")} value="Strummer v0.2" ok />
            <StatusRow label={t("me.status.visual")} value="Canvas Particles" ok />
            <StatusRow label={t("me.status.export")} value="MP3 / HTML / PNG" ok />
          </div>
        </Card>
      </div>

      <div className="px-5 md:px-10 max-w-2xl pb-24">
        <Card>
          <SectionLabel>{t("me.about.title")}</SectionLabel>
          <p
            className="font-serif text-[#22303A] text-[20px] leading-tight mb-2"
            style={{ fontWeight: 600, letterSpacing: "-0.01em" }}
          >
            {t("app.title")}
          </p>
          <p className="text-[#8B8680] text-[14px] leading-relaxed">
            {t("me.about.desc")}
          </p>
          <p className="text-[#B8B0A2] text-[11px] mt-4 tracking-[0.06em]">
            {t("me.about.version")}
          </p>
        </Card>
      </div>
    </div>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="bg-[#FFFDF8] rounded-2xl p-5"
      style={{ boxShadow: "0 2px 12px rgba(34,48,58,0.06)" }}
    >
      {children}
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <p className="eyebrow mb-4">{children}</p>;
}

function Stat({ value, label }: { value: number | string; label: string }) {
  return (
    <div>
      <p
        className="font-serif text-[#22303A] text-[34px] leading-none"
        style={{ fontWeight: 600, letterSpacing: "-0.02em" }}
      >
        {value}
      </p>
      <p className="text-[#8B8680] text-[11px] mt-2 tracking-[0.14em] uppercase">
        {label}
      </p>
    </div>
  );
}

function LangPill({
  active, onClick, label,
}: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      className={`flex-1 h-10 rounded-xl text-sm font-medium transition-colors ${
        active
          ? "bg-[#E9A06D] text-white"
          : "bg-[#F0EAE0] text-[#8B8680] hover:text-[#22303A]"
      }`}
    >
      {label}
    </button>
  );
}

function StatusRow({ label, value, ok }: { label: string; value: string; ok?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-[#22303A] text-sm">{label}</span>
      <div className="flex items-center gap-1.5">
        <span
          className={`w-1.5 h-1.5 rounded-full ${ok ? "bg-green-400" : "bg-[#8B8680]"}`}
        />
        <span className="text-[#8B8680] text-xs font-mono">{value}</span>
      </div>
    </div>
  );
}
