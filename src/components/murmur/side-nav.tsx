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
 * Desktop sidebar — 232px column on md+. Quiet, no card chrome, just nav and
 * a soft one-line sign-off at the bottom.
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
      className="hidden md:flex fixed top-0 left-0 bottom-0 w-[232px] z-40 flex-col bg-[#FFFEFB] border-r border-[#ECE5D6] px-6 py-8"
      style={{
        paddingTop: "max(env(safe-area-inset-top, 0px), 32px)",
        background:
          "radial-gradient(circle at 84% 12%, rgba(255,138,92,0.10), transparent 0 26%), #FFFEFB",
      }}
    >
      <Link
        href="/"
        onClick={goHome}
        className="mb-12 inline-flex items-center transition-opacity hover:opacity-80"
      >
        <MurmurMark size={34} />
      </Link>

      <nav className="flex flex-col gap-[2px]">
        {NAV_ITEMS.filter((item) => item.desktopNav !== false).map((item) => {
          const isActive =
            item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
          const Icon = item.icon;
          const label = t(item.labelKey);
          const baseClass = cn(
            "group flex items-center gap-3 px-2.5 py-2 rounded-md transition-colors duration-150",
            isActive
              ? "text-[#1A1A1A]"
              : "text-[#8C8780] hover:text-[#1A1A1A]"
          );

          const content = (
            <>
              <span
                className={cn(
                  "flex h-[18px] w-[18px] shrink-0 items-center justify-center transition-colors",
                  isActive
                    ? "text-[#FF5924]"
                    : "text-[#BFB6A8] group-hover:text-[#1A1A1A]"
                )}
              >
                <Icon className="h-[18px] w-[18px]" active={isActive} />
              </span>
              <span
                className={cn(
                  "min-w-0 tracking-[0.01em]",
                  lang === "zh" ? "text-[15px]" : "text-[14px]"
                )}
              >
                {label}
              </span>
              {isActive ? (
                <span className="ml-auto h-[5px] w-[5px] rounded-full bg-[#FF5924]" />
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

      <div className="mt-auto pt-10 px-1">
        <p className="font-serif text-[#1A1A1A] text-[22px] leading-none tracking-[-0.04em] mb-4">
          ○
        </p>
        <p className="font-serif-italic text-[#1A1A1A] text-[15px] leading-[1.25]">
          A hum of yours,
          <br />
          becomes a song.
        </p>
        <p className="mt-4 text-[10px] text-[#B6B0A4] tracking-[0.2em] uppercase">
          private music oasis
        </p>
      </div>
    </aside>
  );
}
