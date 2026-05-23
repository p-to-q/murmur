"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { cn } from "@/utils/utils";
import { useMurmurStore } from "@/lib/store/murmur-store";
import { getPlayer } from "@/lib/music/tone-player";
import { useI18nStore, useTranslator } from "@/lib/i18n";
import { MurmurMark } from "./murmur-mark";
import { NAV_ITEMS } from "./nav-items";

/**
 * Desktop sidebar — 240px column on md+. Quiet, plenty of breathing room,
 * mymind-style sign-off block at the bottom.
 */
export function SideNav() {
  const pathname = usePathname();
  const router = useRouter();
  const t = useTranslator();
  const lang = useI18nStore((s) => s.lang);
  const { resetFlow } = useMurmurStore();

  const goHome = (e: React.MouseEvent) => {
    e.preventDefault();
    getPlayer().stop().catch(() => {});
    resetFlow();
    router.push("/");
  };

  return (
    <aside
      className="hidden md:flex fixed top-0 left-0 bottom-0 w-[252px] z-40 flex-col bg-[#FFFEFB] border-r border-[#ECE5D6] px-7 py-9"
      style={{
        paddingTop: "max(env(safe-area-inset-top, 0px), 36px)",
        background:
          "radial-gradient(circle at 78% 18%, rgba(255,138,92,0.14), transparent 0 24%), linear-gradient(180deg, rgba(255,254,251,0.98), rgba(255,254,251,0.98))",
      }}
    >
      <Link
        href="/"
        onClick={goHome}
        className="mb-14 inline-flex items-center transition-opacity hover:opacity-80"
      >
        <MurmurMark size={39} />
      </Link>

      <nav className="flex flex-col gap-0.5">
        {NAV_ITEMS.filter((item) => item.desktopNav !== false).map((item) => {
          const isActive =
            item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
          const Icon = item.icon;
          const label = t(item.labelKey);
          const baseClass = cn(
            "group flex items-center gap-3.5 px-3 py-2.5 rounded-md transition-all duration-200",
            isActive
              ? "text-[#1A1A1A]"
              : "text-[#8C8780] hover:text-[#1A1A1A]"
          );

          const content = (
            <>
              <span
                className={cn(
                  "flex h-[18px] w-[18px] shrink-0 items-center justify-center transition-all",
                  isActive
                    ? "text-[#FF5924]"
                    : "text-[#B6B0A4] group-hover:text-[#1A1A1A]"
                )}
              >
                <Icon className="h-[18px] w-[18px]" active={isActive} />
              </span>
              <span
                className={cn(
                  "min-w-0 tracking-[0.01em]",
                  lang === "zh" ? "text-[16px]" : "text-[14px]"
                )}
              >
                {label}
              </span>
              {isActive ? (
                <span className="ml-auto h-1 w-1 rounded-full bg-[#FF5924]" />
              ) : null}
            </>
          );

          return item.href === "/" ? (
            <button
              key={item.href}
              onClick={goHome}
              className={cn(baseClass, "text-left w-full")}
            >
              {content}
            </button>
          ) : (
            <Link key={item.href} href={item.href} className={baseClass}>
              {content}
            </Link>
          );
        })}
      </nav>

      <div className="mt-auto pt-12">
        <div className="rounded-[28px] border border-[#ECE5D6] bg-[radial-gradient(circle_at_50%_38%,rgba(255,184,120,0.28),transparent_0_26%),linear-gradient(180deg,#FFFEFB,#F8F4ED)] px-6 py-7 shadow-[0_10px_30px_rgba(26,26,26,0.05)]">
          <p className="font-serif text-[#1A1A1A] text-[36px] leading-[0.9] tracking-[-0.05em]">
            ○
          </p>
          <p className="mt-5 font-serif-italic text-[#1A1A1A] text-[19px] leading-[1.18]">
            A hum of yours,
            <br />
            becomes a song.
          </p>
          <p className="mt-4 text-[10px] text-[#B6B0A4] tracking-[0.22em] uppercase">
            private music oasis
          </p>
        </div>
        <p className="mt-4 text-[10px] text-[#B6B0A4] tracking-[0.18em] uppercase">
          murmur — 2026
          <br />
          create · studio · gallery · me
        </p>
      </div>
    </aside>
  );
}
