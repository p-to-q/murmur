"use client";
import { useMurmurStore } from "@/lib/store/murmur-store";
import { UserBadge } from "@/components/user-profile/user-badge";
import { useTranslator, useI18nStore } from "@/lib/i18n";
import { PageBackdrop } from "@/components/murmur/page-backdrop";
import {
  getConfiguredTranscriptionProvider,
  getProviderStatuses,
  getRuntimeStatusLabel,
} from "@/modules/stainer/runtime";

export function MeScreen() {
  const { songs } = useMurmurStore();
  const t = useTranslator();
  const lang = useI18nStore((s) => s.lang);
  const setLang = useI18nStore((s) => s.setLang);
  const providerStatuses = getProviderStatuses();
  const configuredProvider = getConfiguredTranscriptionProvider();
  const runtimeStatus = getRuntimeStatusLabel();

  return (
    <div className="relative min-h-svh overflow-hidden bg-[#F5F1EB]">
      <PageBackdrop variant="soft" />
      <div
        className="relative z-10 px-6 md:px-12 pb-10 max-w-2xl"
        style={{ paddingTop: "max(env(safe-area-inset-top, 0px), 56px)" }}
      >
        <p className="eyebrow mb-4">PROFILE</p>
        <h1 className="hero-serif-italic text-[#1A1A1A] text-[48px] md:text-[76px]">
          {t("me.title")}
        </h1>
      </div>

      <div className="relative z-10 px-6 md:px-12 max-w-2xl space-y-5 pb-6">
        <Card>
          <UserBadge />
        </Card>

        <Card>
          <SectionLabel>{t("me.stats.title")}</SectionLabel>
          <div className="grid grid-cols-3 gap-6 text-left">
            <Stat value={songs.length} label={t("me.stats.songs")} />
            <Stat value={6} label={t("me.stats.vibes")} />
            <Stat value={"∞"} label={t("me.stats.melodies")} />
          </div>
        </Card>

        <Card>
          <SectionLabel>{t("me.language.title")}</SectionLabel>
          <div className="flex gap-2">
            <LangPill active={lang === "zh"} onClick={() => setLang("zh")} label={t("me.language.zh")} />
            <LangPill active={lang === "en"} onClick={() => setLang("en")} label={t("me.language.en")} />
          </div>
        </Card>

        <Card>
          <SectionLabel>{t("me.status.title")}</SectionLabel>
          <div className="space-y-2.5">
            <StatusRow
              label={t("me.status.transcribe")}
              value={runtimeStatus}
            />
            <StatusRow label={t("me.status.arrange")} value="Strummer v0.2" />
            <StatusRow label={t("me.status.visual")} value="Canvas Particles" />
            <StatusRow label={t("me.status.export")} value="MP3 / HTML / PNG" />
          </div>
          <div className="mt-4 space-y-2">
            {providerStatuses.map((status) => (
              <ProviderStatusRow
                key={status.id}
                id={status.id}
                active={configuredProvider === "auto" ? status.enabled : configuredProvider === status.id}
                enabled={status.enabled}
                reason={status.reason}
              />
            ))}
          </div>
        </Card>
      </div>

      {/* Manifesto block — mymind signature */}
      <div className="relative z-10 px-6 md:px-12 max-w-2xl pb-10">
        <div className="mm-manifesto">
          <p className="eyebrow text-[#FF8A5C] mb-5">A QUIET PLACE</p>
          <p className="font-serif text-[28px] md:text-[34px] leading-[1.15] text-[#F5F1EB]">
            No <span className="mm-strike">ads</span>, no{" "}
            <span className="mm-strike">feeds</span>, no{" "}
            <span className="mm-strike">algorithm</span>, no{" "}
            <span className="mm-strike">likes</span>.
          </p>
          <p className="mt-6 text-[#F5F1EB]/70 text-[15px] leading-[1.55] max-w-md">
            Just a tiny private workshop for the songs you hum and forget. Every
            recording is yours — kept here, shared only when you choose to.
          </p>
        </div>
      </div>

      {/* About */}
      <div className="relative z-10 px-6 md:px-12 max-w-2xl pb-28">
        <Card>
          <SectionLabel>{t("me.about.title")}</SectionLabel>
          <p className="font-serif text-[#1A1A1A] text-[22px] leading-tight mb-2">
            {t("app.title")}
          </p>
          <p className="text-[#3A3A3A] text-[14px] leading-[1.55]">
            {t("me.about.desc")}
          </p>
          <p className="text-[#B6B0A4] text-[11px] mt-4 tracking-[0.18em] uppercase">
            {t("me.about.version")}
          </p>
        </Card>
      </div>
    </div>
  );
}

function ProviderStatusRow({
  id,
  active,
  enabled,
  reason,
}: {
  id: string;
  active: boolean;
  enabled: boolean;
  reason?: string;
}) {
  return (
    <div className="flex items-start justify-between gap-4 text-xs">
      <div className="flex items-center gap-2">
        <span
          className={`mt-[3px] h-1.5 w-1.5 rounded-full ${
            enabled ? "bg-[#FF5924]" : "bg-[#C8C0B2]"
          }`}
        />
        <span className="font-mono text-[#8C8780]">{id}</span>
      </div>
      <span className="text-right text-[#B6B0A4]">
        {enabled ? (active ? "ready" : "available") : reason ?? "disabled"}
      </span>
    </div>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return <div className="mm-card p-6">{children}</div>;
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <p className="eyebrow mb-5">{children}</p>;
}

function Stat({ value, label }: { value: number | string; label: string }) {
  return (
    <div>
      <p className="font-serif text-[#1A1A1A] text-[44px] leading-none">{value}</p>
      <p className="text-[#8C8780] text-[10px] mt-3 tracking-[0.2em] uppercase">
        {label}
      </p>
    </div>
  );
}

function LangPill({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      className={`flex-1 h-10 rounded-md text-sm transition-all ${
        active
          ? "bg-[#1A1A1A] text-[#F5F1EB]"
          : "bg-[#EFE8DA] text-[#8C8780] hover:text-[#1A1A1A]"
      }`}
    >
      {label}
    </button>
  );
}

function StatusRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-[#1A1A1A] text-sm">{label}</span>
      <div className="flex items-center gap-1.5">
        <span className="w-1.5 h-1.5 rounded-full bg-[#FF5924]" />
        <span className="text-[#8C8780] text-xs font-mono">{value}</span>
      </div>
    </div>
  );
}
